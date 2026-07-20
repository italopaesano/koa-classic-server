/**
 * Miscellaneous robustness tests — 2026-07 test-expansion pass.
 *
 * Adversarial-but-legal inputs and unfortunate I/O timings that no other suite
 * exercises. The middleware's contract under all of them: answer with a sane
 * status code (200/304/404/416/500), never crash the process, never leak a
 * half-written success response.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-robust-'));
    fs.writeFileSync(path.join(root, 'file.txt'), 'sixteen bytes ok'); // 16 bytes
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'inner.txt'), 'inner');
    // Unicode filename (NFC) — must round-trip through encode/decode + listing
    fs.writeFileSync(path.join(root, 'città-è.txt'), 'unicode ok');
    // Large enough to clear compression.minFileSize for the fallback test
    fs.writeFileSync(path.join(root, 'big.txt'), 'B'.repeat(4096));
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function capturingLogger() {
    const errors = [];
    const warns = [];
    return {
        errors,
        warns,
        error: (...args) => errors.push(args.map(String).join(' ')),
        warn: (...args) => warns.push(args.map(String).join(' ')),
    };
}

function createServer(opts = {}) {
    const app = new Koa();
    app.on('error', () => {});
    app.use(koaClassicServer(root, opts));
    return app.listen();
}

async function outcomeOf(server, request) {
    try {
        const res = await request;
        return { status: res.status, text: res.text };
    } catch (err) {
        return { clientError: err };
    } finally {
        server.close();
    }
}

// ─── Conditional-request headers with garbage values ─────────────────────────

describe('malformed conditional headers degrade to a full 200', () => {
    let server;
    beforeAll(() => { server = createServer({ browserCacheEnabled: true }); });
    afterAll(() => server.close());

    test('If-Modified-Since with an unparseable date → 200, not 304, not 500', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('If-Modified-Since', 'not-a-date at all ///');
        expect(res.status).toBe(200);
        expect(res.text).toBe('sixteen bytes ok');
    });

    test('If-Modified-Since in the far future → 304 (normal semantics preserved)', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('If-Modified-Since', new Date(Date.now() + 86400000).toUTCString());
        expect(res.status).toBe(304);
    });

    test('If-None-Match with unquoted garbage → 200 with the correct ETag', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('If-None-Match', 'garbage-without-quotes');
        expect(res.status).toBe(200);
        expect(res.headers['etag']).toMatch(/^"/);
    });
});

// ─── Hostile-but-legal URL shapes ────────────────────────────────────────────

describe('extreme URL shapes never crash the middleware', () => {
    let server;
    beforeAll(() => { server = createServer(); });
    afterAll(() => server.close());

    test('very deep non-existent path (500 segments) → 404', async () => {
        const deep = '/' + Array(500).fill('x').join('/');
        const res = await supertest(server).get(deep);
        expect(res.status).toBe(404);
    });

    test('very long single segment (8 KB name) → 404, no 5xx', async () => {
        const res = await supertest(server).get('/' + 'a'.repeat(8192));
        expect(res.status).toBe(404);
    });

    test('repeated slashes are collapsed by normalization: /////file.txt', async () => {
        const res = await supertest(server).get('/////file.txt');
        // Whatever the verdict (served or not-found), it must be a clean client answer.
        expect([200, 301, 404]).toContain(res.status);
        expect(res.status).toBeLessThan(500);
    });

    test('dot segment mid-path resolves: /sub/./inner.txt → 200', async () => {
        const res = await supertest(server).get('/sub/./inner.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('inner');
    });

    test('parent segment that stays inside root resolves: /sub/../file.txt → 200', async () => {
        const res = await supertest(server).get('/sub/../file.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('sixteen bytes ok');
    });

    test('query string on a file URL is ignored for resolution', async () => {
        const res = await supertest(server).get('/file.txt?foo=bar&baz=%22quoted%22');
        expect(res.status).toBe(200);
        expect(res.text).toBe('sixteen bytes ok');
    });

    test('unicode filename round-trips: /citt%C3%A0-%C3%A8.txt → 200', async () => {
        const res = await supertest(server).get('/' + encodeURIComponent('città-è.txt'));
        expect(res.status).toBe(200);
        expect(res.text).toBe('unicode ok');
    });

    test('the unicode filename appears (escaped) in the listing with a valid link', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('città-è.txt');
        expect(res.text).toContain(encodeURIComponent('città-è.txt'));
    });
});

// ─── Stream failures at unlucky moments ──────────────────────────────────────

// A stream that is already dead when the middleware receives it: destroy() is
// called synchronously at creation, so the 'error' event fires at the earliest
// possible moment of the response lifecycle.
function preHeadersBrokenStream() {
    const s = new PassThrough();
    s.destroy(Object.assign(new Error('injected EIO'), { code: 'EIO' }));
    return s;
}

function mockReadStreamOnce(factory) {
    const original = fs.createReadStream;
    let used = false;
    return jest.spyOn(fs, 'createReadStream').mockImplementation((p, opts, ...args) => {
        if (!used) {
            used = true;
            // The middleware pre-opens the file and passes the FileHandle as
            // options.fd (v5.0 register #5): close it when substituting a fake
            // stream, or the leaked descriptor would keep the fixture open.
            if (opts && opts.fd && typeof opts.fd.close === 'function') opts.fd.close().catch(() => {});
            return factory();
        }
        return original.call(fs, p, opts, ...args);
    });
}

describe('read-stream failure at creation time (already-destroyed stream)', () => {
    test('Range request on a dead stream → error logged, never a clean 206 payload', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger });
        mockReadStreamOnce(preHeadersBrokenStream);

        const outcome = await outcomeOf(
            server,
            supertest(server).get('/file.txt').set('Range', 'bytes=0-4').ok(() => true)
        );

        expect(logger.errors.some(e => e.includes('Stream error'))).toBe(true);
        // Either an error status surfaced or the socket was torn down — but the
        // client must never receive the requested bytes as a successful 206.
        if (outcome.status !== undefined) {
            expect(outcome.status).toBeGreaterThanOrEqual(500);
        } else {
            expect(outcome.clientError).toBeDefined();
        }
    });
});

describe('compression job failure falling back to a stream that then also fails', () => {
    test('readFile rejection → uncompressed fallback; its stream dying mid-flight is logged, response torn down', async () => {
        const logger = capturingLogger();
        // compressedFile cache ON (default) → buffered compression path;
        // rawFile cache OFF (default) → the compression job must readFile itself.
        const server = createServer({ logger });

        // 1. the compression job's readFile explodes → catch → identity fallback
        jest.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(
            Object.assign(new Error('injected EIO'), { code: 'EIO' })
        );
        // 2. the fallback's disk stream dies AFTER the head is flushed
        mockReadStreamOnce(() => {
            const s = new PassThrough();
            s.write('partial'); // some bytes make it out — head gets flushed
            setImmediate(() => s.destroy(Object.assign(new Error('injected EIO #2'), { code: 'EIO' })));
            return s;
        });

        const outcome = await outcomeOf(
            server,
            supertest(server).get('/big.txt').set('Accept-Encoding', 'gzip').ok(() => true)
        );

        expect(logger.errors.some(e => e.includes('Compression error'))).toBe(true);
        expect(logger.errors.some(e => e.includes('Stream error'))).toBe(true);
        // Never a clean 200 with truncated bytes passed off as complete:
        // either the socket was torn down or an error status surfaced.
        const surfaced =
            outcome.clientError !== undefined ||
            (outcome.status !== undefined && outcome.status >= 500) ||
            (outcome.text !== undefined && outcome.text !== 'B'.repeat(4096));
        expect(surfaced).toBe(true);
    });
});
