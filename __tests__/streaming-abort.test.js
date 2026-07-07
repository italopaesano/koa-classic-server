/**
 * Streaming-compression teardown tests — finding B1 of
 * docs/analisi_robustezza_v3.1.md (fd leak on aborted downloads).
 *
 * The streaming compression path used `src.pipe(compress)`: when the client
 * disconnected mid-transfer, Koa destroyed the zlib transform but the source
 * fs.ReadStream stayed paused with its file descriptor open forever. The fix
 * uses stream.pipeline(), which propagates teardown in both directions.
 *
 * Covers:
 *   - client aborts mid-download → the underlying ReadStream is destroyed
 *     (fd closed) shortly after
 *   - normal completion still works and also closes the ReadStream
 *
 * Fixture: huge.txt — 8 MB of random hex (compressible MIME, but high entropy
 * so the compressed output far exceeds the socket buffers: the server is
 * guaranteed to be mid-stream when the client aborts).
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const HUGE_CONTENT = crypto.randomBytes(4 * 1024 * 1024).toString('hex'); // 8 MB

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-streaming-abort-'));
    fs.writeFileSync(path.join(fixturesDir, 'huge.txt'), HUGE_CONTENT);
    fs.writeFileSync(path.join(fixturesDir, 'small.txt'), 'S'.repeat(4096));
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

// Streaming mode: compressed cache disabled → every compressed response pipes
// a fresh fs.ReadStream through the zlib transform.
function createStreamingApp() {
    const app = new Koa();
    // A client abort makes Koa emit an app-level 'error' (premature close of
    // the response). Expected in these tests — keep the output clean.
    app.on('error', () => {});
    app.use(koaClassicServer(fixturesDir, {
        dirListing: { enabled: false },
        serverCache: { compressedFile: { enabled: false } },
    }));
    return app.listen();
}

// Captures every fs.ReadStream the middleware opens.
function captureReadStreams() {
    const streams = [];
    const real = fs.createReadStream;
    jest.spyOn(fs, 'createReadStream').mockImplementation((...args) => {
        const s = real.apply(fs, args);
        streams.push(s);
        return s;
    });
    return streams;
}

// Resolves true when the stream closes (fd released), false after timeoutMs.
function waitForClose(stream, timeoutMs = 3000) {
    if (stream.closed || stream.destroyed) return Promise.resolve(true);
    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), timeoutMs);
        stream.once('close', () => { clearTimeout(timer); resolve(true); });
    });
}

describe('streaming compression — client abort mid-download', () => {
    let server;
    beforeAll(() => { server = createStreamingApp(); });
    afterAll(() => server.close());

    test('the source ReadStream is destroyed after the client disconnects', async () => {
        const streams = captureReadStreams();
        const { port } = server.address();

        // Raw http client: destroy the socket on the first body chunk, while the
        // server still has megabytes of compressed output pending.
        await new Promise(resolve => {
            const req = http.get(
                { port, path: '/huge.txt', headers: { 'Accept-Encoding': 'gzip' } },
                res => {
                    expect(res.statusCode).toBe(200);
                    expect(res.headers['content-encoding']).toBe('gzip');
                    res.once('data', () => { req.destroy(); resolve(); });
                }
            );
            req.on('error', () => resolve()); // errors from our own destroy are expected
        });

        expect(streams.length).toBe(1);
        // Before the pipeline() fix this timed out: the ReadStream stayed
        // paused forever with its fd open.
        await expect(waitForClose(streams[0])).resolves.toBe(true);
        expect(streams[0].destroyed).toBe(true);
    });
});

describe('streaming compression — normal completion', () => {
    let server;
    beforeAll(() => { server = createStreamingApp(); });
    afterAll(() => server.close());

    test('full download works and the ReadStream is closed afterwards', async () => {
        const streams = captureReadStreams();
        const res = await supertest(server)
            .get('/small.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.text).toBe('S'.repeat(4096));
        expect(streams.length).toBe(1);
        await expect(waitForClose(streams[0])).resolves.toBe(true);
    });
});
