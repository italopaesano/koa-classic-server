//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  CONDITIONAL REQUESTS — precedence & If-None-Match parsing
//  #8 — Validators (If-None-Match / If-Modified-Since) take precedence over Range
//       (RFC 9110 §13.2.2): a matching conditional returns 304 (Not Modified), not 206
//       (Partial Content). 206 responses now carry ETag + Last-Modified.
//  #9 — If-None-Match understands "*", comma-separated lists, and weak comparison (W/).
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const path = require('path');

const rangeRoot = path.join(__dirname, 'range-fixtures');       // sample.txt: 20 bytes, below compression threshold
const compRoot  = path.join(__dirname, 'compression-fixtures'); // large.txt: 2000 bytes text/plain, compressible

function createApp(root, opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { dirListing: { enabled: false }, ...opts }));
    return app.listen();
}

// ─── #8 — validators precede Range; 206 carries validators ─────────────────────

describe('Conditional precedence over Range (#8)', () => {
    let server;
    let baseEtag;
    beforeAll(async () => {
        server = createApp(rangeRoot, { browserCacheEnabled: true });
        // sample.txt is below the compression threshold → uncompressed → fullEtag === baseEtag
        const res = await supertest(server).get('/sample.txt');
        baseEtag = res.headers['etag'];
    });
    afterAll(() => server.close());

    test('206 (Partial Content) now carries ETag and Last-Modified', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=0-4');
        expect(res.status).toBe(206);
        expect(res.headers['etag']).toBe(baseEtag);
        expect(res.headers['last-modified']).toBeDefined();
    });

    test('Range + matching If-None-Match → 304 (Not Modified), not 206', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('Range', 'bytes=0-4')
            .set('If-None-Match', baseEtag);
        expect(res.status).toBe(304);
        expect(res.headers['content-range']).toBeUndefined(); // never entered the Range branch
    });

    test('Range + If-Modified-Since (not modified) → 304, not 206', async () => {
        const future = new Date(Date.now() + 86400000).toUTCString();
        const res = await supertest(server)
            .get('/sample.txt')
            .set('Range', 'bytes=0-4')
            .set('If-Modified-Since', future);
        expect(res.status).toBe(304);
    });

    test('Range + non-matching If-None-Match → 206 (Partial Content)', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('Range', 'bytes=0-4')
            .set('If-None-Match', '"nope-not-this"');
        expect(res.status).toBe(206);
        expect(res.text).toBe('01234');
    });

    test('without browserCacheEnabled, 206 carries no ETag (and no 304 shortcut)', async () => {
        const plain = createApp(rangeRoot); // browserCacheEnabled defaults to false
        const res = await supertest(plain)
            .get('/sample.txt')
            .set('Range', 'bytes=0-4')
            .set('If-None-Match', baseEtag);
        plain.close();
        expect(res.status).toBe(206);
        expect(res.headers['etag']).toBeUndefined();
    });
});

// ─── #8 — 206 of a compressible resource is tagged with the identity (base) ETag ──

describe('206 ETag on a compressible resource (#8)', () => {
    let server;
    beforeAll(() => { server = createApp(compRoot, { browserCacheEnabled: true }); });
    afterAll(() => server.close());

    test('full GET (gzip) → encoding-specific ETag; Range GET → un-suffixed base ETag', async () => {
        const full = await supertest(server).get('/large.txt').set('Accept-Encoding', 'gzip');
        expect(full.status).toBe(200);
        expect(full.headers['etag']).toMatch(/-gz"$/);

        const part = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip')
            .set('Range', 'bytes=0-99');
        expect(part.status).toBe(206);
        expect(part.headers['etag']).not.toMatch(/-(gz|br)"$/); // identity partial → base ETag
        // base ETag is the full-GET ETag minus the -gz suffix
        expect(part.headers['etag']).toBe(full.headers['etag'].replace('-gz"', '"'));
    });
});

// ─── #9 — If-None-Match: "*", comma-lists, weak comparison ─────────────────────

describe('If-None-Match parsing (#9)', () => {
    let server;
    let etag;
    beforeAll(async () => {
        server = createApp(rangeRoot, { browserCacheEnabled: true });
        etag = (await supertest(server).get('/sample.txt')).headers['etag']; // strong: "mtime-size"
    });
    afterAll(() => server.close());

    test('If-None-Match: * → 304 (resource exists)', async () => {
        const res = await supertest(server).get('/sample.txt').set('If-None-Match', '*');
        expect(res.status).toBe(304);
    });

    test('comma-list containing the current ETag → 304', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-None-Match', `"wrong-1", ${etag}, "wrong-2"`);
        expect(res.status).toBe(304);
    });

    test('comma-list NOT containing the current ETag → 200', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-None-Match', '"wrong-1", "wrong-2"');
        expect(res.status).toBe(200);
        expect(res.text).toBe('0123456789abcdefghij');
    });

    test('weak-tagged client ETag (W/) matches our strong ETag → 304', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-None-Match', `W/${etag}`);
        expect(res.status).toBe(304);
    });

    test('weak tag inside a list → 304', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-None-Match', `"other", W/${etag}`);
        expect(res.status).toBe(304);
    });

    test('single non-matching ETag → 200 (unchanged behavior)', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-None-Match', '"definitely-not-it"');
        expect(res.status).toBe(200);
    });
});

// ─── #3 (v4.3 register) — If-None-Match presence disables If-Modified-Since ────
//
// RFC 9110 §13.1.3: "A recipient MUST ignore If-Modified-Since if the request
// contains an If-None-Match header field". The ETag is the strong validator;
// the date has 1-second resolution: honoring it after a FAILED ETag match
// would 304 a client whose cached copy is provably stale (two same-second
// edits with a size change, or an encoding-suffix change).

describe('If-None-Match presence disables If-Modified-Since (#3, v4.3 register)', () => {
    let server;
    let etag;
    let lastModified;
    beforeAll(async () => {
        server = createApp(rangeRoot, { browserCacheEnabled: true });
        const res = await supertest(server).get('/sample.txt');
        etag = res.headers['etag'];
        lastModified = res.headers['last-modified'];
    });
    afterAll(() => server.close());

    test('stale ETag + matching date → 200 (date MUST be ignored)', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-None-Match', '"stale-etag-from-old-version"')
            .set('If-Modified-Since', lastModified);
        expect(res.status).toBe(200);
    });

    test('stale ETag + far-future date → 200 (date MUST be ignored)', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-None-Match', '"stale-etag-from-old-version"')
            .set('If-Modified-Since', new Date(Date.now() + 86400000).toUTCString());
        expect(res.status).toBe(200);
    });

    test('matching ETag + stale date → 304 (the ETag verdict wins both ways)', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-None-Match', etag)
            .set('If-Modified-Since', new Date(0).toUTCString());
        expect(res.status).toBe(304);
    });

    test('If-None-Match: * + any date → 304 (unchanged)', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-None-Match', '*')
            .set('If-Modified-Since', new Date(0).toUTCString());
        expect(res.status).toBe(304);
    });

    test('If-Modified-Since alone still produces 304 (unchanged)', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-Modified-Since', lastModified);
        expect(res.status).toBe(304);
    });

    test('If-Modified-Since alone with a stale date still produces 200 (unchanged)', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('If-Modified-Since', new Date(0).toUTCString());
        expect(res.status).toBe(200);
    });
});
