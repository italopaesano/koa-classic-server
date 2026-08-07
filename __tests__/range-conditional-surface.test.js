/**
 * Range / conditional-request HEADER SURFACE — 2026-08 coverage review.
 *
 * range.test.js and conditional-precedence.test.js already pin the *status
 * codes* and the ETag/Last-Modified precedence rules. What neither asserts is
 * the full set of headers each of those outcomes carries, and several
 * documented decisions had no test at all:
 *
 *   1. 416 Range Not Satisfiable — Content-Range: bytes STAR/size, an empty
 *      body, and the headers set BEFORE the range branch (Accept-Ranges,
 *      Cache-Control, nosniff, Vary, ETag). Notably the 416 keeps the
 *      ENCODING-SPECIFIC ETag ("...-br") because it represents the full
 *      representation the client asked about, not an identity partial.
 *   2. 416 on a zero-byte file — "bytes STAR/0"; every range on an empty
 *      representation is unsatisfiable, including "bytes=0-".
 *   3. HEAD + 416 (needs method: ['GET','HEAD']).
 *   4. 206 on a COMPRESSIBLE resource — Content-Encoding must be absent
 *      (ranges are always identity), Vary must still be present (the resource
 *      negotiates), and the ETag drops the -br/-gz suffix.
 *   5. If-Range with a DATE validator — docs/revisione_codice_v5.0.md #2 was
 *      consciously closed as "strong validator only, safe degradation to 200".
 *      That decision had no test: a date If-Range must NOT produce a 206.
 *   6. If-None-Match: '"bogus", *' — a "*" that is not the whole header value
 *      is not the RFC 9110 any-representation wildcard, so it does not 304.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const BODY = 'x'.repeat(2000); // compressible text/plain, above the 1 KB minFileSize

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-range-surface-'));
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

// ─── 1 + 2. The 416 header surface ───────────────────────────────────────────

describe('416 Range Not Satisfiable — full header surface', () => {
    let server;
    beforeAll(() => {
        server = createApp({
            browserCacheEnabled: true,
            staticSecurityHeaders: { nosniff: true },
        });
    });
    afterAll(() => server.close());

    test('Content-Range advertises the real size and the body is empty', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('Range', 'bytes=9999-')
            .set('Accept-Encoding', '');

        expect(res.status).toBe(416);
        expect(res.headers['content-range']).toBe(`bytes */${BODY.length}`);
        expect(res.headers['content-length']).toBe('0');
        expect(res.text).toBe('');
    });

    test('headers set before the range branch survive on a 416', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('Range', 'bytes=9999-')
            .set('Accept-Encoding', '');

        expect(res.status).toBe(416);
        // Accept-Ranges is advertised on every file response, 416 included.
        expect(res.headers['accept-ranges']).toBe('bytes');
        // browserCacheEnabled policy applies to 200 / 206 / 304 / 416 alike.
        expect(res.headers['cache-control']).toBe('public, max-age=3600, must-revalidate');
        expect(res.headers['last-modified']).toBeDefined();
        // Opt-in hardening reaches the 416 too.
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        // The representation is never compressed on this path.
        expect(res.headers['content-encoding']).toBeUndefined();
    });

    test('a 416 for a compressible resource keeps Vary and the ENCODING-specific ETag', async () => {
        // The 416 says nothing about a partial: it refers to the full
        // representation the client would have received, which under
        // Accept-Encoding: br is the brotli variant.
        const res = await supertest(server)
            .get('/file.txt')
            .set('Range', 'bytes=9999-')
            .set('Accept-Encoding', 'br');

        expect(res.status).toBe(416);
        expect(res.headers['vary']).toBe('Accept-Encoding');
        expect(res.headers['etag']).toMatch(/-br"$/);
    });

    test('every range on a zero-byte file is unsatisfiable — "bytes */0"', async () => {
        for (const spec of ['bytes=0-', 'bytes=0-0', 'bytes=-1']) {
            const res = await supertest(server)
                .get('/empty.txt')
                .set('Range', spec)
                .set('Accept-Encoding', '');

            expect(res.status).toBe(416);
            expect(res.headers['content-range']).toBe('bytes */0');
        }
    });
});

// ─── 3. HEAD mirrors the 416 ─────────────────────────────────────────────────

describe('HEAD + unsatisfiable Range', () => {
    let server;
    beforeAll(() => { server = createApp({ method: ['GET', 'HEAD'] }); });
    afterAll(() => server.close());

    test('HEAD → 416 with the same Content-Range as GET, no body', async () => {
        const res = await supertest(server)
            .head('/file.txt')
            .set('Range', 'bytes=9999-')
            .set('Accept-Encoding', '');

        expect(res.status).toBe(416);
        expect(res.headers['content-range']).toBe(`bytes */${BODY.length}`);
        expect(res.headers['accept-ranges']).toBe('bytes');
    });

    test('HEAD + a garbage Range falls through to the full 200 headers', async () => {
        const res = await supertest(server)
            .head('/file.txt')
            .set('Range', 'bytes=nonsense')
            .set('Accept-Encoding', '');

        expect(res.status).toBe(200);
        expect(res.headers['content-length']).toBe(String(BODY.length));
        expect(res.headers['content-range']).toBeUndefined();
    });
});

// ─── 4. 206 never carries a content coding ───────────────────────────────────

describe('206 on a compressible resource stays identity', () => {
    let server;
    beforeAll(() => {
        server = createApp({
            browserCacheEnabled: true,
            staticSecurityHeaders: { nosniff: true },
        });
    });
    afterAll(() => server.close());

    test('Accept-Encoding: br + Range → 206 identity bytes, no Content-Encoding', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('Range', 'bytes=0-9')
            .set('Accept-Encoding', 'br');

        expect(res.status).toBe(206);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['content-length']).toBe('10');
        expect(res.headers['content-range']).toBe(`bytes 0-9/${BODY.length}`);
        expect(res.text).toBe('x'.repeat(10));
    });

    test('the 206 keeps Vary (the resource negotiates) but drops the -br ETag suffix', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('Range', 'bytes=0-9')
            .set('Accept-Encoding', 'br');

        expect(res.headers['vary']).toBe('Accept-Encoding');
        expect(res.headers['etag']).toBeDefined();
        expect(res.headers['etag']).not.toMatch(/-(br|gz)"$/);
    });

    test('nosniff and Content-Disposition are present on the 206 as well', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('Range', 'bytes=0-9')
            .set('Accept-Encoding', 'br');

        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['content-disposition']).toContain('filename="file.txt"');
    });
});

// ─── 5. If-Range accepts the strong ETag only (v5.0 register #2) ──────────────

describe('If-Range — strong validator only, safe degradation to 200', () => {
    let server;
    let etag;
    let lastModified;

    beforeAll(async () => {
        server = createApp({ browserCacheEnabled: true });
        const probe = await supertest(server).get('/file.txt').set('Accept-Encoding', '');
        etag = probe.headers['etag'];
        lastModified = probe.headers['last-modified'];
    });
    afterAll(() => server.close());

    test('the exact ETag still produces a 206 (baseline)', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('Range', 'bytes=0-4')
            .set('If-Range', etag)
            .set('Accept-Encoding', '');

        expect(res.status).toBe(206);
    });

    test('a DATE If-Range (our own Last-Modified) degrades to a full 200, never 206', async () => {
        // RFC 9110 §13.1.5 permits a strong date validator here; this middleware
        // deliberately implements the ETag form only (v5.0 register #2, closed as
        // a documented wontfix). The degradation must be the SAFE direction:
        // the client gets the whole representation, never a mismatched partial.
        const res = await supertest(server)
            .get('/file.txt')
            .set('Range', 'bytes=0-4')
            .set('If-Range', lastModified)
            .set('Accept-Encoding', '');

        expect(res.status).toBe(200);
        expect(res.headers['content-range']).toBeUndefined();
        expect(res.text).toBe(BODY);
    });

    test('a weak-form If-Range (W/"...") also degrades to 200, not 206', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('Range', 'bytes=0-4')
            .set('If-Range', 'W/' + etag)
            .set('Accept-Encoding', '');

        expect(res.status).toBe(200);
    });

    test('If-Range without a Range header is inert (plain 200)', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('If-Range', etag)
            .set('Accept-Encoding', '');

        expect(res.status).toBe(200);
        expect(res.headers['content-length']).toBe(String(BODY.length));
    });
});

// ─── 6. "*" is the wildcard only as the WHOLE If-None-Match value ────────────

describe('If-None-Match wildcard placement', () => {
    let server;
    beforeAll(() => { server = createApp({ browserCacheEnabled: true }); });
    afterAll(() => server.close());

    test('a bare "*" → 304 (baseline)', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('If-None-Match', '*')
            .set('Accept-Encoding', '');

        expect(res.status).toBe(304);
    });

    test('surrounding whitespace does not break the wildcard: "  *  " → 304', async () => {
        const res = await supertest(server)
            .get('/file.txt')
            .set('If-None-Match', '  *  ')
            .set('Accept-Encoding', '');

        expect(res.status).toBe(304);
    });

    test('"*" INSIDE a tag list is not the wildcard → 200', async () => {
        // RFC 9110 §13.1.2 grammar is `"*" / #entity-tag` — a list member "*"
        // is malformed input, and treating it as "matches anything" would let a
        // sloppy client suppress every update it asked for.
        const res = await supertest(server)
            .get('/file.txt')
            .set('If-None-Match', '"bogus", *')
            .set('Accept-Encoding', '');

        expect(res.status).toBe(200);
        expect(res.text).toBe(BODY);
    });
});
