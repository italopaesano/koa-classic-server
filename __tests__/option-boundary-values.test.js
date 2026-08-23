/**
 * Option BOUNDARY values and rarely-exercised option shapes — 2026-08 coverage
 * review.
 *
 * The existing suites test each option's "on" and "off" states thoroughly, but
 * several exact thresholds and degenerate-but-legal configurations had no test:
 *
 *   1. compression.minFileSize / maxFileSize at the exact comparison boundary
 *      (>= and <=, so size === threshold must land on the INCLUSIVE side).
 *   2. compression.encodings: [] — a legal way to disable compression that goes
 *      through a different branch than compression: false, and must also
 *      suppress Vary (the resource no longer negotiates at all).
 *   3. Accept-Encoding: identity;q=0 — the client says identity is unacceptable
 *      and offers nothing else. RFC 9110 §12.5.3 would allow a 406; this
 *      middleware deliberately serves the identity representation (a file
 *      server whose job is "return the file" does not refuse to return it).
 *   4. options.method with a non-GET verb, and the degenerate method: [].
 *   5. browserCacheMaxAge: 0 — a legal value that must reach the header as
 *      max-age=0 rather than being treated as "unset" and defaulted to 3600.
 *   6. A zero-byte file: Content-Length 0, no compression negotiation.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const SIZE = 2000;
const BODY = 'x'.repeat(SIZE); // text/plain, highly compressible

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-option-bounds-'));
    fs.writeFileSync(path.join(root, 'file.txt'), BODY);
    fs.writeFileSync(path.join(root, 'empty.txt'), '');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function createApp(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { dirListing: { enabled: false }, ...opts }));
    return app.listen();
}

// Runs one request against a throwaway server so each boundary case gets a
// pristine compressed cache.
async function withApp(opts, fn) {
    const server = createApp(opts);
    try {
        return await fn(server);
    } finally {
        server.close();
    }
}

// ─── 1. Compression size thresholds are inclusive on the "compress" side ─────

describe('compression.minFileSize — the threshold is inclusive (size >= minFileSize)', () => {
    test(`size === minFileSize (${SIZE}) → compressed`, async () => {
        const res = await withApp({ compression: { minFileSize: SIZE } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'gzip'));

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['vary']).toBe('Accept-Encoding');
    });

    test(`size one byte above minFileSize (${SIZE - 1}) → compressed`, async () => {
        const res = await withApp({ compression: { minFileSize: SIZE - 1 } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'gzip'));

        expect(res.headers['content-encoding']).toBe('gzip');
    });

    test(`size < minFileSize (${SIZE + 1}) → identity AND no Vary (never negotiates)`, async () => {
        const res = await withApp({ compression: { minFileSize: SIZE + 1 } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'gzip'));

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['vary']).toBeUndefined();
        expect(res.headers['content-length']).toBe(String(SIZE));
    });

    test('minFileSize: 0 compresses everything above zero bytes', async () => {
        const res = await withApp({ compression: { minFileSize: 0 } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'gzip'));

        expect(res.headers['content-encoding']).toBe('gzip');
    });
});

describe('compression.maxFileSize — the cap is inclusive (size <= maxFileSize stays buffered)', () => {
    test(`size === maxFileSize (${SIZE}) → BUFFERED path (Content-Length known)`, async () => {
        const res = await withApp({ compression: { maxFileSize: SIZE } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'gzip'));

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeDefined();
        expect(res.headers['transfer-encoding']).toBeUndefined();
    });

    test(`size one byte above maxFileSize (${SIZE - 1}) → STREAMING path (chunked)`, async () => {
        const res = await withApp({ compression: { maxFileSize: SIZE - 1 } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'gzip'));

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        // Above the cap the compressed length is not known up front.
        expect(res.headers['content-length']).toBeUndefined();
        expect(res.headers['transfer-encoding']).toBe('chunked');
    });
});

// ─── 2. encodings: [] is a legal "off" switch ────────────────────────────────

describe('compression.encodings: [] — the empty offer list disables negotiation', () => {
    test('no Content-Encoding and, crucially, no Vary', async () => {
        const res = await withApp({ compression: { encodings: [] } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'br, gzip'));

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        // A Vary here would make shared caches key on a header that can never
        // change the response — needless cache fragmentation.
        expect(res.headers['vary']).toBeUndefined();
        expect(res.headers['content-length']).toBe(String(SIZE));
    });

    test('a list of only unknown tokens is filtered down to [] with the same effect', async () => {
        const res = await withApp({ compression: { encodings: ['deflate', 'zstd'] } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'br, gzip, deflate, zstd'));

        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['vary']).toBeUndefined();
    });

    test('a single-encoding offer list is honored exactly (gzip only, br never)', async () => {
        const res = await withApp({ compression: { encodings: ['gzip'] } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'br'));

        // The client offers br only; the server offers gzip only → identity,
        // but the resource still negotiates, so Vary stays.
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['vary']).toBe('Accept-Encoding');
    });

    test('server preference order is the CONFIGURED order, not a hardcoded one', async () => {
        const res = await withApp({ compression: { encodings: ['gzip', 'br'] } }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'br, gzip'));

        expect(res.headers['content-encoding']).toBe('gzip');
    });
});

// ─── 3. identity;q=0 does not make the middleware refuse the file ────────────

describe('Accept-Encoding: identity;q=0 — deliberate divergence from a 406', () => {
    test('the file is served identity anyway (200, not 406)', async () => {
        // "If a file exists, GET on its path returns it" (design philosophy).
        // Refusing a representation the operator placed on disk because a
        // client wrote q=0 would be a restriction, not a safety net.
        const res = await withApp({}, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'identity;q=0'));

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.text).toBe(BODY);
    });

    test('identity;q=0 alongside a usable coding still picks the coding', async () => {
        const res = await withApp({}, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'identity;q=0, gzip'));

        expect(res.headers['content-encoding']).toBe('gzip');
    });

    test('"identity" is not a configurable encoding token — it never appears as Content-Encoding', async () => {
        const res = await withApp({}, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', 'identity'));

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
    });
});

// ─── 4. options.method ───────────────────────────────────────────────────────

describe('options.method — verbs beyond GET', () => {
    test('a configured POST is served exactly like a GET (body, compression, headers)', async () => {
        const res = await withApp({ method: ['GET', 'POST'] }, (s) =>
            supertest(s).post('/file.txt').set('Accept-Encoding', 'gzip'));

        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-disposition']).toContain('filename="file.txt"');
        expect(res.text).toBe(BODY);
    });

    test('an unconfigured verb falls through to next() untouched', async () => {
        const res = await withApp({ method: ['GET', 'POST'] }, (s) =>
            supertest(s).put('/file.txt'));

        expect(res.status).toBe(404);
        // Koa's own 404 — none of the middleware's generated-page headers.
        expect(res.headers['content-security-policy']).toBeUndefined();
        expect(res.headers['x-frame-options']).toBeUndefined();
    });

    test('method: [] passes EVERY request through (the middleware becomes inert)', async () => {
        const res = await withApp({ method: [] }, (s) => supertest(s).get('/file.txt'));

        expect(res.status).toBe(404);
        expect(res.headers['content-security-policy']).toBeUndefined();
    });

    test('a non-array method value falls back to the ["GET", "HEAD"] default, and says so', async () => {
        const warns = [];
        const logger = { warn: (...a) => warns.push(a.map(String).join(' ')), error: () => {} };

        const res = await withApp({ method: 'GET', logger }, (s) => supertest(s).get('/file.txt'));
        expect(res.status).toBe(200);

        const head = await withApp({ method: 'GET', logger }, (s) => supertest(s).head('/file.txt'));
        expect(head.status).toBe(200); // HEAD is in the default list (5.3.0, RFC 9110 §9.1)

        // The fallback is deliberate, but not silent: discarding a stated method
        // list without a word is the failure mode this validation exists to end.
        expect(warns.some(w => w.includes('must be an ARRAY'))).toBe(true);
    });

    // The escape hatch. An operator who explicitly asks for GET-only gets GET-only,
    // even though that server is RFC 9110 §9.1 non-conformant — the middleware does
    // not second-guess an explicit configuration. This test is what protects that
    // promise from a future "HEAD is always implied by GET" refactor.
    test('an explicit method: ["GET"] still excludes HEAD (documented escape hatch)', async () => {
        const res = await withApp({ method: ['GET'] }, (s) => supertest(s).get('/file.txt'));
        expect(res.status).toBe(200);

        const head = await withApp({ method: ['GET'] }, (s) => supertest(s).head('/file.txt'));
        expect(head.status).toBe(404); // fell through to next() → Koa's own 404
        expect(head.headers['content-security-policy']).toBeUndefined();
    });

    test('verbs are upper-cased: method: ["get", "head"] behaves as ["GET", "HEAD"]', async () => {
        const res = await withApp({ method: ['get', 'head'] }, (s) => supertest(s).get('/file.txt'));
        expect(res.status).toBe(200);

        const head = await withApp({ method: ['get', 'head'] }, (s) => supertest(s).head('/file.txt'));
        expect(head.status).toBe(200);
    });

    test('a non-string entry is upper-cased harmlessly and simply never matches', async () => {
        const res = await withApp({ method: ['GET', null, 42] }, (s) => supertest(s).get('/file.txt'));
        expect(res.status).toBe(200);
    });
});

// ─── 5. browserCacheMaxAge: 0 ────────────────────────────────────────────────

describe('browserCacheMaxAge: 0 — a legal value, not "unset"', () => {
    test('reaches the header as max-age=0 (must-revalidate on every use)', async () => {
        const res = await withApp({ browserCacheEnabled: true, browserCacheMaxAge: 0 }, (s) =>
            supertest(s).get('/file.txt').set('Accept-Encoding', ''));

        expect(res.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
        // Validators are still emitted, so the revalidation can answer 304.
        expect(res.headers['etag']).toBeDefined();
        expect(res.headers['last-modified']).toBeDefined();
    });

    test('the 304 round-trip still works with max-age=0', async () => {
        const server = createApp({ browserCacheEnabled: true, browserCacheMaxAge: 0 });
        try {
            const first = await supertest(server).get('/file.txt').set('Accept-Encoding', '');
            const res = await supertest(server)
                .get('/file.txt')
                .set('If-None-Match', first.headers['etag'])
                .set('Accept-Encoding', '');

            expect(res.status).toBe(304);
        } finally {
            server.close();
        }
    });
});

// ─── 6. The zero-byte representation ─────────────────────────────────────────

describe('zero-byte file', () => {
    test('served as 200 with Content-Length: 0 and an empty body', async () => {
        const res = await withApp({}, (s) =>
            supertest(s).get('/empty.txt').set('Accept-Encoding', 'br, gzip'));

        expect(res.status).toBe(200);
        expect(res.headers['content-length']).toBe('0');
        expect(res.text).toBe('');
    });

    test('never negotiates: 0 bytes is below any positive minFileSize → no Vary', async () => {
        const res = await withApp({}, (s) =>
            supertest(s).get('/empty.txt').set('Accept-Encoding', 'br, gzip'));

        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['vary']).toBeUndefined();
    });

    test('with minFileSize: 0 an empty file IS compressed (0 >= 0)', async () => {
        const res = await withApp({ compression: { minFileSize: 0 } }, (s) =>
            supertest(s).get('/empty.txt').set('Accept-Encoding', 'gzip'));

        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['vary']).toBe('Accept-Encoding');
    });

    test('its ETag encodes size 0 and stays stable', async () => {
        const server = createApp({ browserCacheEnabled: true });
        try {
            const a = await supertest(server).get('/empty.txt').set('Accept-Encoding', '');
            const b = await supertest(server).get('/empty.txt').set('Accept-Encoding', '');
            expect(a.headers['etag']).toMatch(/-0"$/);
            expect(b.headers['etag']).toBe(a.headers['etag']);
        } finally {
            server.close();
        }
    });
});
