/**
 * Single-flight (thundering herd) tests for koa-classic-server — finding #5
 * of docs/revisione_codice_v3.1.md.
 *
 * Covers the in-flight deduplication of cache-population jobs:
 *   - N concurrent cold-cache requests to the same file+encoding run ONE
 *     readFile + compression (compressedFile cache)
 *   - N concurrent cold-cache requests to the same file run ONE readFile
 *     (rawFile cache)
 *   - br and gzip are independent jobs (key = path:encoding)
 *   - a failing job is shared by all waiters (single failure, everyone falls
 *     back to the uncompressed stream) and the in-flight entry is cleaned up,
 *     so the next request retries from scratch
 *
 * Fixtures are created in a temp dir: big.txt — 4096 bytes of 'S'
 * (text/plain, above the 1 KB compression.minFileSize default).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const CONTENT = 'S'.repeat(4096);
const silentLogger = { error: () => {}, warn: () => {} };

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-single-flight-'));
    fs.writeFileSync(path.join(fixturesDir, 'big.txt'), CONTENT);
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function createApp(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(fixturesDir, { dirListing: { enabled: false }, ...opts }));
    return app.listen();
}

// Wraps fs.promises.readFile with a call log and an artificial delay so that
// concurrent requests reliably overlap the in-flight window of the first one.
function instrumentReadFile(delayMs = 30) {
    const real = fs.promises.readFile;
    const calls = [];
    jest.spyOn(fs.promises, 'readFile').mockImplementation(async (...args) => {
        calls.push(String(args[0]));
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return real.apply(fs.promises, args);
    });
    return calls;
}

// ─── compressedFile cache population ─────────────────────────────────────────

describe('single-flight — compressedFile cache population', () => {
    let server;
    beforeAll(() => { server = createApp(); }); // defaults: compression + compressedFile cache on
    afterAll(() => server.close());

    test('N concurrent cold-cache requests run exactly one readFile + compression', async () => {
        const calls = instrumentReadFile();
        const results = await Promise.all(
            Array.from({ length: 8 }, () =>
                supertest(server).get('/big.txt').set('Accept-Encoding', 'gzip')
            )
        );
        for (const res of results) {
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBe('gzip');
            // supertest auto-decompresses gzip — res.text is the original content
            expect(res.text).toBe(CONTENT);
        }
        expect(calls.length).toBe(1);
    });

    test('subsequent request is a plain cache hit — no further readFile', async () => {
        const calls = instrumentReadFile();
        const res = await supertest(server).get('/big.txt').set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(calls.length).toBe(0);
    });
});

// ─── Key granularity: path + encoding ────────────────────────────────────────

describe('single-flight — br and gzip are independent jobs', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('concurrent br and gzip requests on a cold file each run their own job', async () => {
        const calls = instrumentReadFile();
        const [br, gz] = await Promise.all([
            supertest(server).get('/big.txt').set('Accept-Encoding', 'br'),
            supertest(server).get('/big.txt').set('Accept-Encoding', 'gzip'),
        ]);
        expect(br.status).toBe(200);
        expect(br.headers['content-encoding']).toBe('br');
        expect(gz.status).toBe(200);
        expect(gz.headers['content-encoding']).toBe('gzip');
        expect(gz.text).toBe(CONTENT);
        // One read per representation: the two encodings never share a job
        expect(calls.length).toBe(2);
    });
});

// ─── rawFile cache population ────────────────────────────────────────────────

describe('single-flight — rawFile cache population', () => {
    let server;
    beforeAll(() => {
        server = createApp({
            compression: false,
            serverCache: { rawFile: { enabled: true } },
        });
    });
    afterAll(() => server.close());

    test('N concurrent cold-cache requests run exactly one readFile', async () => {
        const calls = instrumentReadFile();
        const results = await Promise.all(
            Array.from({ length: 8 }, () =>
                supertest(server).get('/big.txt').set('Accept-Encoding', 'identity')
            )
        );
        for (const res of results) {
            expect(res.status).toBe(200);
            expect(res.text).toBe(CONTENT);
            expect(Number(res.headers['content-length'])).toBe(CONTENT.length);
        }
        expect(calls.length).toBe(1);
    });
});

// ─── Failure sharing and retry ───────────────────────────────────────────────

describe('single-flight — shared failure, cleanup and retry', () => {
    let server;
    beforeAll(() => { server = createApp({ logger: silentLogger }); });
    afterAll(() => server.close());

    test('a failing job is shared by all waiters; the next request retries fresh', async () => {
        // Phase 1: every readFile fails → the shared job rejects once and all
        // waiters fall back together to the uncompressed stream response.
        let failCalls = 0;
        jest.spyOn(fs.promises, 'readFile').mockImplementation(async () => {
            failCalls++;
            await new Promise(resolve => setTimeout(resolve, 30));
            throw Object.assign(new Error('injected read failure'), { code: 'EIO' });
        });

        const results = await Promise.all(
            Array.from({ length: 5 }, () =>
                supertest(server).get('/big.txt').set('Accept-Encoding', 'gzip')
            )
        );
        for (const res of results) {
            expect(res.status).toBe(200);                            // fallback still serves the file
            expect(res.headers['content-encoding']).toBeUndefined(); // ...uncompressed, streamed from disk
            expect(res.text).toBe(CONTENT);
        }
        expect(failCalls).toBe(1); // the failure was shared, not re-run per waiter

        // Phase 2: reads work again → the in-flight entry was removed on
        // settlement, so a fresh job runs and compression succeeds.
        jest.restoreAllMocks();
        const calls = instrumentReadFile();
        const res = await supertest(server).get('/big.txt').set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.text).toBe(CONTENT);
        expect(calls.length).toBe(1);
    });
});
