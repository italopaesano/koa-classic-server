/**
 * Compression-failure fallback — full branch matrix (2026-07 coverage review).
 *
 * compression-fallback-vary-etag.test.js asserts the header contract of the
 * fallback (#7: Vary kept, ETag reset). This file completes the matrix of the
 * fallback's four serving branches, which were previously uncovered:
 *
 *                        │ GET                     │ HEAD
 *   ──────────────────────┼─────────────────────────┼──────────────────────────
 *   rawBuffer in memory   │ body from buffer        │ empty body, CL restored
 *   no rawBuffer          │ body from disk stream   │ empty body, CL = fileStat
 *
 * plus the stream-error path of the no-rawBuffer GET branch.
 *
 * zlib.brotliCompress is mocked to always fail (same hoisted-mock technique as
 * the existing fallback test: util.promisify captures the reference at
 * index.cjs load time, so the mock must exist before requiring it).
 */

jest.mock('zlib', () => {
    const actual = jest.requireActual('zlib');
    return {
        ...actual,
        brotliCompress: (buf, optsOrCb, maybeCb) => {
            const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
            process.nextTick(() => cb(new Error('forced brotli failure')));
        },
    };
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const CONTENT = 'Z'.repeat(2048); // above compression.minFileSize (1024)
let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-compression-fallback-'));
    fs.writeFileSync(path.join(fixturesDir, 'asset.txt'), CONTENT);
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function capturingLogger() {
    const errors = [];
    return { errors, error: (...args) => errors.push(args.map(String).join(' ')), warn: () => {} };
}

function createServer(opts = {}) {
    const app = new Koa();
    app.on('error', () => {});
    app.use(koaClassicServer(fixturesDir, {
        method: ['GET', 'HEAD'], // HEAD is opt-in (v2-stable default is ['GET'])
        dirListing: { enabled: false },
        compression: { encodings: ['br'] }, // br only — always fails via the mock
        ...opts,
    }));
    return app.listen();
}

describe('fallback with rawBuffer in memory (serverCache.rawFile enabled)', () => {
    test('GET → identity body served straight from the buffer, correct Content-Length', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger, serverCache: { rawFile: { enabled: true } } });

        let res;
        try {
            res = await supertest(server).get('/asset.txt').set('Accept-Encoding', 'br');
        } finally {
            server.close();
        }

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['content-length']).toBe(String(CONTENT.length));
        expect(res.headers['vary']).toBe('Accept-Encoding'); // fallback keeps Vary (#7)
        expect(res.text).toBe(CONTENT);
        expect(logger.errors.some(e => e.includes('Compression error'))).toBe(true);
    });

    test('HEAD → same headers as GET, empty body, Content-Length restored', async () => {
        const server = createServer({ logger: capturingLogger(), serverCache: { rawFile: { enabled: true } } });

        let res;
        try {
            res = await supertest(server).head('/asset.txt').set('Accept-Encoding', 'br');
        } finally {
            server.close();
        }

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['content-length']).toBe(String(CONTENT.length));
        expect(res.text ?? '').toBe(''); // RFC 9110 §9.3.2: no body on HEAD
    });
});

describe('fallback without rawBuffer (rawFile cache disabled — default)', () => {
    test('GET → identity body streamed from disk, correct Content-Length', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger });

        let res;
        try {
            res = await supertest(server).get('/asset.txt').set('Accept-Encoding', 'br');
        } finally {
            server.close();
        }

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['content-length']).toBe(String(CONTENT.length));
        expect(res.text).toBe(CONTENT);
        expect(logger.errors.some(e => e.includes('Compression error'))).toBe(true);
    });

    test('HEAD → empty body, Content-Length from the file stat', async () => {
        const server = createServer({ logger: capturingLogger() });

        let res;
        try {
            res = await supertest(server).head('/asset.txt').set('Accept-Encoding', 'br');
        } finally {
            server.close();
        }

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['content-length']).toBe(String(CONTENT.length));
        expect(res.text ?? '').toBe('');
    });

    test('GET + fallback stream error → logged, error surfaced (no truncated 200)', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger });

        // Second-level failure: compression already failed, and now the disk
        // stream of the identity fallback fails too.
        const original = fs.createReadStream;
        jest.spyOn(fs, 'createReadStream').mockImplementation((p, opts, ...args) => {
            if (String(p).endsWith('asset.txt')) {
                // Close the middleware's pre-opened FileHandle (options.fd,
                // v5.0 register #5) so the fake stream doesn't leak it.
                if (opts && opts.fd && typeof opts.fd.close === 'function') opts.fd.close().catch(() => {});
                const s = new PassThrough();
                setImmediate(() => s.destroy(Object.assign(new Error('injected EIO'), { code: 'EIO' })));
                return s;
            }
            return original.call(fs, p, opts, ...args);
        });

        // Koa 3 tears the connection down on a stream error, so the client may
        // see a client-side error (socket hang up) rather than a 5xx response.
        let outcome;
        try {
            const res = await supertest(server)
                .get('/asset.txt')
                .set('Accept-Encoding', 'br')
                .ok(() => true);
            outcome = { status: res.status };
        } catch (err) {
            outcome = { clientError: err };
        } finally {
            server.close();
        }

        expect(logger.errors.some(e => e.includes('Compression error'))).toBe(true);
        expect(logger.errors.some(e => e.includes('Stream error'))).toBe(true);
        // Never a clean 200 hiding a truncated body:
        if (outcome.status !== undefined) {
            expect(outcome.status).toBeGreaterThanOrEqual(500);
        } else {
            expect(outcome.clientError).toBeDefined();
        }
    });
});
