/**
 * compression.maxFileSize + LFUCache.set() early-return tests — finding #4
 * of docs/revisione_codice_v3.1.md.
 *
 * Covers the safety net against unbounded RAM/CPU on huge compressible files:
 *   - files within maxFileSize use the buffered+cached path (Content-Length known)
 *   - files above maxFileSize are STILL compressed, but via the bounded-RAM
 *     streaming mode (no Content-Length, not cached)
 *   - maxFileSize: false removes the cap (buffered path for any size)
 *   - invalid maxFileSize values fall back to the 10 MB default (no throw)
 *   - LFUCache.set(): an entry larger than the whole cache no longer flushes
 *     the other entries before being discarded (early-return regression test)
 *
 * Fixtures are created in a temp dir:
 *   mid.txt           — 4096 bytes of 'M'  (compressible, above 1 KB minFileSize)
 *   tiny-compress.txt — 2000 bytes of 'a'  (gzip-compresses to a few dozen bytes)
 *   big-random.txt    — 8192 bytes of random hex (gzip result well above 300 bytes)
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const MID_CONTENT  = 'M'.repeat(4096);
const TINY_CONTENT = 'a'.repeat(2000);
const BIG_RANDOM   = crypto.randomBytes(4096).toString('hex'); // 8192 chars, high entropy
const silentLogger = { error: () => {}, warn: () => {} };

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-max-file-size-'));
    fs.writeFileSync(path.join(fixturesDir, 'mid.txt'), MID_CONTENT);
    fs.writeFileSync(path.join(fixturesDir, 'tiny-compress.txt'), TINY_CONTENT);
    fs.writeFileSync(path.join(fixturesDir, 'big-random.txt'), BIG_RANDOM);
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

// Logs every fs.promises.readFile call (the buffered compression path reads via
// readFile; the streaming path uses createReadStream and never shows up here).
function instrumentReadFile() {
    const real = fs.promises.readFile;
    const calls = [];
    jest.spyOn(fs.promises, 'readFile').mockImplementation((...args) => {
        calls.push(String(args[0]));
        return real.apply(fs.promises, args);
    });
    return calls;
}

// ─── Default: files within the 10 MB cap use the buffered path ───────────────

describe('compression.maxFileSize — default keeps small files on the buffered path', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('4 KB file → compressed with Content-Length (buffered + cached)', async () => {
        const res = await supertest(server)
            .get('/mid.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeDefined();
        expect(res.text).toBe(MID_CONTENT);
    });
});

// ─── Above the cap: streaming mode ───────────────────────────────────────────

describe('compression.maxFileSize — files above the cap use streaming mode', () => {
    let server;
    beforeAll(() => {
        // mid.txt (4096 B) exceeds this cap
        server = createApp({ compression: { maxFileSize: 2048 } });
    });
    afterAll(() => server.close());

    test('response is still compressed, but streamed (no Content-Length)', async () => {
        const calls = instrumentReadFile();
        const res = await supertest(server)
            .get('/mid.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeUndefined(); // streaming → chunked
        expect(res.text).toBe(MID_CONTENT);
        expect(calls.length).toBe(0); // createReadStream, not readFile: never buffered
    });

    test('second request streams again — nothing was cached', async () => {
        const calls = instrumentReadFile();
        const res = await supertest(server)
            .get('/mid.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeUndefined();
        expect(calls.length).toBe(0);
    });

    test('file within the cap still uses the buffered path', async () => {
        const res = await supertest(server)
            .get('/tiny-compress.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeDefined();
        expect(res.text).toBe(TINY_CONTENT);
    });
});

// ─── maxFileSize: false removes the cap ──────────────────────────────────────

describe('compression.maxFileSize — false disables the cap', () => {
    test('file is buffered regardless of size', async () => {
        const server = createApp({ compression: { maxFileSize: false } });
        const res = await supertest(server)
            .get('/mid.txt')
            .set('Accept-Encoding', 'gzip');
        server.close();
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeDefined();
    });
});

// ─── Invalid values fall back to the default ─────────────────────────────────

describe('compression.maxFileSize — invalid values fall back to the 10 MB default', () => {
    test.each([-5, 0, 'big', null])('maxFileSize: %p → no throw, buffered path for small files', async (bad) => {
        const server = createApp({ compression: { maxFileSize: bad } });
        const res = await supertest(server)
            .get('/mid.txt')
            .set('Accept-Encoding', 'gzip');
        server.close();
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeDefined(); // 4 KB << 10 MB default
    });
});

// ─── HEAD must mirror GET on the streaming path (RFC 9110 §9.3.2) ────────────
// Regression: the streaming branch never assigned a body/status for HEAD, so
// Koa's default 404 leaked. Made reachable with default config by the
// maxFileSize gate; also present with the compressed cache disabled.

describe('HEAD on the streaming compression path mirrors GET', () => {
    test('file above maxFileSize: HEAD → 200 with compression headers, no Content-Length', async () => {
        const server = createApp({
            method: ['GET', 'HEAD'],
            compression: { maxFileSize: 2048 },
        });
        const get = await supertest(server).get('/mid.txt').set('Accept-Encoding', 'gzip');
        const head = await supertest(server).head('/mid.txt').set('Accept-Encoding', 'gzip');
        server.close();
        expect(get.status).toBe(200);
        expect(head.status).toBe(200); // was 404 before the fix
        expect(head.headers['content-encoding']).toBe('gzip');
        expect(head.headers['content-length']).toBeUndefined(); // compressed size unknown
        expect(head.text).toBeFalsy(); // no body on HEAD
    });

    test('compressed cache disabled (pre-existing streaming path): HEAD → 200', async () => {
        const server = createApp({
            method: ['GET', 'HEAD'],
            serverCache: { compressedFile: { enabled: false } },
        });
        const head = await supertest(server).head('/mid.txt').set('Accept-Encoding', 'gzip');
        server.close();
        expect(head.status).toBe(200);
        expect(head.headers['content-encoding']).toBe('gzip');
    });
});

// ─── LFUCache.set() early-return (no cache flush for oversized entries) ──────

describe('LFUCache.set — oversized entry no longer flushes the cache', () => {
    let server;
    beforeAll(() => {
        // Compressed cache of 300 bytes: tiny-compress.txt's gzip (~30 B) fits,
        // big-random.txt's gzip (~4 KB) can never fit.
        server = createApp({
            logger: silentLogger,
            serverCache: { compressedFile: { maxSize: 300, warnInterval: false } },
        });
    });
    afterAll(() => server.close());

    test('an entry bigger than the whole cache leaves cached entries intact', async () => {
        const calls = instrumentReadFile();
        const tinyPath = path.join(fixturesDir, 'tiny-compress.txt');

        // 1. Populate the cache with the small file (1 readFile)
        const first = await supertest(server)
            .get('/tiny-compress.txt')
            .set('Accept-Encoding', 'gzip');
        expect(first.status).toBe(200);
        expect(calls.filter(p => p === tinyPath).length).toBe(1);

        // 2. Request the file whose compressed form exceeds the whole cache:
        //    served fine (buffered response), but set() must bail out early
        //    without evicting the tiny entry.
        const big = await supertest(server)
            .get('/big-random.txt')
            .set('Accept-Encoding', 'gzip');
        expect(big.status).toBe(200);
        expect(big.headers['content-encoding']).toBe('gzip');
        expect(big.text).toBe(BIG_RANDOM);

        // 3. The tiny file must still be served from cache: no new readFile.
        //    (Before the fix, step 2 flushed the cache and this re-read the file.)
        const second = await supertest(server)
            .get('/tiny-compress.txt')
            .set('Accept-Encoding', 'gzip');
        expect(second.status).toBe(200);
        expect(second.text).toBe(TINY_CONTENT);
        expect(calls.filter(p => p === tinyPath).length).toBe(1);
    });
});

describe('LFUCache.set — oversized entry emits a throttled warning', () => {
    test('the operator is told the entry will never be cached', async () => {
        const warns = [];
        const server = createApp({
            logger: { error: () => {}, warn: (...args) => warns.push(args.join(' ')) },
            serverCache: { compressedFile: { maxSize: 300, warnInterval: 0 } },
        });
        const res = await supertest(server)
            .get('/big-random.txt')
            .set('Accept-Encoding', 'gzip');
        server.close();
        expect(res.status).toBe(200);
        expect(warns.some(w => w.includes('will never be cached'))).toBe(true);
    });
});
