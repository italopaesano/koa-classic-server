//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  CONTENT-NEGOTIATION TESTS
//  #6 — getClientEncoding honors Accept-Encoding q-values (excludes q=0), keeps server
//       preference order, matches tokens exactly, and understands the "*" wildcard.
//  #7 — Vary: Accept-Encoding is present on every response that content-negotiates on
//       Accept-Encoding (compressed, identity-of-compressible, and their 304s), and absent
//       when the resource never negotiates (below threshold / non-compressible MIME).
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const path = require('path');

const root = path.join(__dirname, 'compression-fixtures');
// Fixtures:
//   large.txt — 2000 bytes text/plain (compressible, above the 1KB threshold)
//   small.txt — 4 bytes (below threshold → never negotiates)
//   image.png — 16 bytes image/png (non-compressible MIME → never negotiates)

function createApp(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { dirListing: { enabled: false }, ...opts }));
    return app.listen();
}

// ─── #6 — Accept-Encoding q-values ─────────────────────────────────────────────

describe('Content negotiation (#6) — Accept-Encoding q-values', () => {
    let server;
    beforeAll(() => { server = createApp(); }); // default encodings: ['br', 'gzip']
    afterAll(() => server.close());

    const enc = (header) => supertest(server).get('/large.txt').set('Accept-Encoding', header);

    test('br;q=0, gzip → br refused, gzip served', async () => {
        const res = await enc('br;q=0, gzip');
        expect(res.headers['content-encoding']).toBe('gzip');
    });

    test('br;q=0 alone → no compression (identity), Vary still present', async () => {
        const res = await enc('br;q=0');
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['vary']).toBe('Accept-Encoding');
    });

    test('gzip;q=0, br → gzip refused, br served', async () => {
        const res = await enc('gzip;q=0, br');
        expect(res.headers['content-encoding']).toBe('br');
    });

    test('gzip, br → server preference (br) wins regardless of client order', async () => {
        const res = await enc('gzip, br');
        expect(res.headers['content-encoding']).toBe('br');
    });

    test('client q-value ordering does NOT override server preference (gzip;q=1.0, br;q=0.1 → br)', async () => {
        const res = await enc('gzip;q=1.0, br;q=0.1');
        expect(res.headers['content-encoding']).toBe('br');
    });

    test('wildcard * → server-preferred (br)', async () => {
        const res = await enc('*');
        expect(res.headers['content-encoding']).toBe('br');
    });

    test('*;q=0 → all encodings refused → identity', async () => {
        const res = await enc('*;q=0');
        expect(res.headers['content-encoding']).toBeUndefined();
    });

    test('br;q=0, * → br refused, gzip picked up via wildcard', async () => {
        const res = await enc('br;q=0, *');
        expect(res.headers['content-encoding']).toBe('gzip');
    });

    test('exact token match: x-gzip does NOT match gzip → identity', async () => {
        const res = await enc('x-gzip');
        expect(res.headers['content-encoding']).toBeUndefined();
    });

    test('case-insensitive token and q param: BR;Q=0, GZIP → gzip', async () => {
        const res = await enc('BR;Q=0, GZIP');
        expect(res.headers['content-encoding']).toBe('gzip');
    });

    test('fractional q > 0 still accepted: br;q=0.001 → br', async () => {
        const res = await enc('br;q=0.001');
        expect(res.headers['content-encoding']).toBe('br');
    });

    test('surrounding whitespace tolerated: " gzip ; q=0 , br " → br', async () => {
        const res = await enc(' gzip ; q=0 , br ');
        expect(res.headers['content-encoding']).toBe('br');
    });

    test('no Accept-Encoding header → identity', async () => {
        // supertest sets a default Accept-Encoding; clear it to simulate a bare client.
        const res = await supertest(server).get('/large.txt').set('Accept-Encoding', '');
        expect(res.headers['content-encoding']).toBeUndefined();
    });
});

// ─── #7 — Vary: Accept-Encoding completeness ───────────────────────────────────

describe('Vary + 304 (#7)', () => {
    let server;
    beforeAll(() => { server = createApp({ browserCacheEnabled: true }); });
    afterAll(() => server.close());

    test('304 of a compressed variant carries Vary: Accept-Encoding', async () => {
        const r1 = await supertest(server).get('/large.txt').set('Accept-Encoding', 'br');
        expect(r1.status).toBe(200);
        const etag = r1.headers['etag'];
        expect(etag).toMatch(/-br"$/);

        const r2 = await supertest(server).get('/large.txt')
            .set('Accept-Encoding', 'br')
            .set('If-None-Match', etag);
        expect(r2.status).toBe(304);
        expect(r2.headers['vary']).toBe('Accept-Encoding');
    });

    test('304 of the identity variant of a compressible resource also carries Vary', async () => {
        const r1 = await supertest(server).get('/large.txt').set('Accept-Encoding', 'identity');
        expect(r1.status).toBe(200);
        const etag = r1.headers['etag'];
        expect(etag).not.toMatch(/-(br|gz)"$/);

        const r2 = await supertest(server).get('/large.txt')
            .set('Accept-Encoding', 'identity')
            .set('If-None-Match', etag);
        expect(r2.status).toBe(304);
        expect(r2.headers['vary']).toBe('Accept-Encoding');
    });

    test('below-threshold compressible file → no Vary (never negotiates)', async () => {
        const res = await supertest(server).get('/small.txt').set('Accept-Encoding', 'br, gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['vary']).toBeUndefined();
    });

    test('non-compressible MIME (image/png) → no Vary', async () => {
        const res = await supertest(server).get('/image.png').set('Accept-Encoding', 'br, gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['vary']).toBeUndefined();
    });
});
