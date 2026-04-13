const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const path = require('path');

const root = path.join(__dirname, 'compression-fixtures');

// Fixtures:
//   large.txt  — 2000 bytes of 'A' (text/plain, exceeds 1KB threshold)
//   small.txt  — 4 bytes of 'tiny' (text/plain, below 1KB threshold)
//   data.json  — 16 bytes '{"key":"value"}\n' (application/json, below threshold)

function createApp(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { showDirContents: false, ...opts }));
    return app.listen();
}

// ─── Default behaviour (compression enabled, serverCache enabled) ─────────────

describe('Compression — default: br preferred', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('large.txt with Accept-Encoding: br → brotli compressed', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'br');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('br');
        expect(res.headers['vary']).toBe('Accept-Encoding');
    });

    test('large.txt with Accept-Encoding: gzip → gzip compressed, body decompressed by supertest', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['vary']).toBe('Accept-Encoding');
        // supertest auto-decompresses gzip — res.text is the original content
        expect(res.text).toBe('A'.repeat(2000));
    });

    test('large.txt with Accept-Encoding: br,gzip → br preferred (higher priority)', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'br, gzip');
        expect(res.headers['content-encoding']).toBe('br');
    });

    // Use 'identity' to prevent supertest's default Accept-Encoding from triggering compression
    test('large.txt with Accept-Encoding: identity → uncompressed', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers['vary']).toBeUndefined();
        expect(res.text).toBe('A'.repeat(2000));
    });

    test('Content-Length present on compressed response (serverCache)', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.headers['content-length']).toBeDefined();
        expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
    });

    test('Compressed Content-Length is smaller than original file size', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(Number(res.headers['content-length'])).toBeLessThan(2000);
    });
});

// ─── Threshold: files below threshold are served uncompressed ────────────────

describe('Compression — threshold (default 1024 bytes)', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('small.txt (4 bytes) below threshold → no compression', async () => {
        const res = await supertest(server)
            .get('/small.txt')
            .set('Accept-Encoding', 'br, gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.text).toBe('tiny');
    });

    test('large.txt (2000 bytes) above threshold → compressed', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.headers['content-encoding']).toBe('gzip');
    });

    test('threshold: false → compress regardless of size', async () => {
        const s = createApp({ compression: { threshold: false } });
        const res = await supertest(s)
            .get('/small.txt')
            .set('Accept-Encoding', 'gzip');
        s.close();
        expect(res.headers['content-encoding']).toBe('gzip');
        // supertest auto-decompresses gzip
        expect(res.text).toBe('tiny');
    });
});

// ─── compression: false shorthand ────────────────────────────────────────────

describe('Compression — disabled', () => {
    let server;
    beforeAll(() => { server = createApp({ compression: false }); });
    afterAll(() => server.close());

    test('compression: false → no compression on any file', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'br, gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.text).toBe('A'.repeat(2000));
    });
});

// ─── encodings configuration ──────────────────────────────────────────────────

describe('Compression — encodings configuration', () => {
    test('encodings: [gzip] → no brotli even if client prefers br', async () => {
        const s = createApp({ compression: { encodings: ['gzip'] } });
        const res = await supertest(s)
            .get('/large.txt')
            .set('Accept-Encoding', 'br, gzip');
        s.close();
        expect(res.headers['content-encoding']).toBe('gzip');
    });

    test('encodings: [] → no compression', async () => {
        const s = createApp({ compression: { encodings: [] } });
        const res = await supertest(s)
            .get('/large.txt')
            .set('Accept-Encoding', 'br, gzip');
        s.close();
        expect(res.headers['content-encoding']).toBeUndefined();
    });
});

// ─── mimeTypes configuration ──────────────────────────────────────────────────

describe('Compression — mimeTypes configuration', () => {
    test('custom mimeTypes replaces default list', async () => {
        // Only compress application/json; text/plain should not be compressed
        const s = createApp({ compression: { mimeTypes: ['application/json'], threshold: false } });

        const resTxt = await supertest(s)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(resTxt.headers['content-encoding']).toBeUndefined();

        s.close();
    });
});

// ─── ETag encoding-specific ───────────────────────────────────────────────────

describe('Compression — encoding-specific ETag', () => {
    let server;
    beforeAll(() => { server = createApp({ browserCacheEnabled: true }); });
    afterAll(() => server.close());

    test('ETag for br response has -br suffix', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'br');
        expect(res.headers['etag']).toMatch(/-br"$/);
    });

    test('ETag for gzip response has -gz suffix', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.headers['etag']).toMatch(/-gz"$/);
    });

    test('ETag for uncompressed response has no suffix', async () => {
        // Use 'identity' to prevent supertest's default Accept-Encoding from triggering compression
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'identity');
        expect(res.headers['etag']).not.toMatch(/-(br|gz)"$/);
    });

    test('304 returned when If-None-Match matches encoding-specific ETag', async () => {
        const first = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        const etag = first.headers['etag'];

        const second = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip')
            .set('If-None-Match', etag);
        expect(second.status).toBe(304);
    });

    test('304 NOT returned when ETag suffix differs (br ETag sent with gzip request)', async () => {
        const brRes = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'br');
        const brEtag = brRes.headers['etag'];

        // Send the br ETag but request gzip → ETag mismatch → 200
        const gzipRes = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip')
            .set('If-None-Match', brEtag);
        expect(gzipRes.status).toBe(200);
    });
});

// ─── serverCache disabled (streaming mode) ────────────────────────────────────

describe('Compression — serverCache: false (streaming)', () => {
    let server;
    beforeAll(() => {
        server = createApp({ compression: { serverCache: { enabled: false } } });
    });
    afterAll(() => server.close());

    test('streaming: Content-Encoding set but no Content-Length', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.headers['content-encoding']).toBe('gzip');
        // Streaming compressed responses use Transfer-Encoding: chunked → no Content-Length
        expect(res.headers['content-length']).toBeUndefined();
    });

    test('streaming: response body is correctly decompressed', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        // supertest auto-decompresses gzip — res.text is the original content
        expect(res.text).toBe('A'.repeat(2000));
    });
});

// ─── Compression does not apply to Range requests ────────────────────────────

describe('Compression — no compression on Range requests (HTTP 206)', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('Range request is served uncompressed even with Accept-Encoding', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Range', 'bytes=0-9')
            .set('Accept-Encoding', 'br, gzip');
        expect(res.status).toBe(206);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.text).toBe('A'.repeat(10));
    });
});
