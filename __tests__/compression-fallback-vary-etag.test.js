//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  COMPRESSION-ERROR FALLBACK (#7)
//  When buffered compression throws, the response falls back to identity. This must:
//    • keep Vary: Accept-Encoding (the resource is still compressible), and
//    • reset the ETag to the un-suffixed (identity) form, so a shared proxy does not
//      cache this identity body under the -br/-gz validator of the compressed variant.
//
//  zlib.brotliCompress is mocked to always fail. util.promisify captures the reference
//  at index.cjs load time, so the mock must be declared (hoisted) before requiring it.
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

jest.mock('zlib', () => {
    const actual = jest.requireActual('zlib');
    return {
        ...actual,
        // Buffered path uses util.promisify(zlib.brotliCompress): (buf, options, cb).
        brotliCompress: (buf, optsOrCb, maybeCb) => {
            const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
            process.nextTick(() => cb(new Error('forced brotli failure')));
        },
    };
});

const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const path = require('path');

const root = path.join(__dirname, 'compression-fixtures');

function createApp(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { dirListing: { enabled: false }, ...opts }));
    return app.listen();
}

describe('Compression-error fallback (#7)', () => {
    let server;
    beforeAll(() => {
        server = createApp({
            browserCacheEnabled: true,
            compression: { encodings: ['br'] }, // only br — which the mock forces to fail
        });
    });
    afterAll(() => server.close());

    test('brotli failure → identity body, Vary kept, ETag reset to un-suffixed', async () => {
        const res = await supertest(server).get('/large.txt').set('Accept-Encoding', 'br');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined(); // fell back to identity
        expect(res.headers['vary']).toBe('Accept-Encoding');     // Vary STAYS
        expect(res.headers['etag']).toBeDefined();
        expect(res.headers['etag']).not.toMatch(/-br"$/);        // reset to base ETag
        expect(res.text).toBe('A'.repeat(2000));                 // content intact
    });
});
