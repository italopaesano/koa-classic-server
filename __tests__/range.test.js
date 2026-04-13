const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const path = require('path');

const root = path.join(__dirname, 'range-fixtures');

// Fixture: sample.txt contains '0123456789abcdefghij' — exactly 20 bytes, no newline
const FILE_SIZE = 20;
const FILE_CONTENT = '0123456789abcdefghij';

function createApp(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { showDirContents: false, ...opts }));
    return app.listen();
}

// ─── Accept-Ranges advertisement ─────────────────────────────────────────────

describe('Range — Accept-Ranges header', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('Accept-Ranges: bytes present on 200 response', async () => {
        const res = await supertest(server).get('/sample.txt');
        expect(res.status).toBe(200);
        expect(res.headers['accept-ranges']).toBe('bytes');
    });

    test('Accept-Ranges not added to directory listings', async () => {
        const listServer = createApp({ showDirContents: true });
        const res = await supertest(listServer).get('/');
        listServer.close();
        expect(res.headers['accept-ranges']).toBeUndefined();
    });
});

// ─── Basic 206 responses ──────────────────────────────────────────────────────

describe('Range — basic 206 Partial Content', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('bytes=0-4 → first 5 bytes', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=0-4');
        expect(res.status).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 0-4/${FILE_SIZE}`);
        expect(res.headers['content-length']).toBe('5');
        expect(res.text).toBe('01234');
    });

    test('bytes=10- → open range from offset 10', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=10-');
        expect(res.status).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 10-19/${FILE_SIZE}`);
        expect(res.headers['content-length']).toBe('10');
        expect(res.text).toBe('abcdefghij');
    });

    test('bytes=-5 → last 5 bytes', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=-5');
        expect(res.status).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 15-19/${FILE_SIZE}`);
        expect(res.headers['content-length']).toBe('5');
        expect(res.text).toBe('fghij');
    });

    test('bytes=0-19 (full file) → 206', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=0-19');
        expect(res.status).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 0-19/${FILE_SIZE}`);
        expect(res.headers['content-length']).toBe('20');
        expect(res.text).toBe(FILE_CONTENT);
    });

    test('bytes=-999 (suffix > file size) → 206 full file', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=-999');
        expect(res.status).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 0-19/${FILE_SIZE}`);
        expect(res.headers['content-length']).toBe('20');
        expect(res.text).toBe(FILE_CONTENT);
    });

    test('bytes=5-999 (end > file size) → end clamped to 19', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=5-999');
        expect(res.status).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 5-19/${FILE_SIZE}`);
        expect(res.headers['content-length']).toBe('15');
        expect(res.text).toBe('56789abcdefghij');
    });

    test('Accept-Ranges present on 206 response', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=0-4');
        expect(res.headers['accept-ranges']).toBe('bytes');
    });

    test('single byte range bytes=7-7', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=7-7');
        expect(res.status).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 7-7/${FILE_SIZE}`);
        expect(res.headers['content-length']).toBe('1');
        expect(res.text).toBe('7');
    });
});

// ─── 416 Range Not Satisfiable ────────────────────────────────────────────────

describe('Range — 416 Range Not Satisfiable', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('start beyond file size → 416', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=100-200');
        expect(res.status).toBe(416);
        expect(res.headers['content-range']).toBe(`bytes */${FILE_SIZE}`);
    });

    test('start exactly at file size → 416', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', `bytes=${FILE_SIZE}-`);
        expect(res.status).toBe(416);
        expect(res.headers['content-range']).toBe(`bytes */${FILE_SIZE}`);
    });
});

// ─── Fallback to 200 ──────────────────────────────────────────────────────────

describe('Range — fallback to 200 on invalid Range', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('malformed Range header → 200 full file', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=abc');
        expect(res.status).toBe(200);
        expect(res.text).toBe(FILE_CONTENT);
    });

    test('multi-range → 200 full file', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=0-2,5-7');
        expect(res.status).toBe(200);
        expect(res.text).toBe(FILE_CONTENT);
    });

    test('non-bytes unit → 200 full file', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'kilobytes=0-100');
        expect(res.status).toBe(200);
        expect(res.text).toBe(FILE_CONTENT);
    });

    test('inverted range bytes=10-5 → 200 full file', async () => {
        const res = await supertest(server).get('/sample.txt').set('Range', 'bytes=10-5');
        expect(res.status).toBe(200);
        expect(res.text).toBe(FILE_CONTENT);
    });
});

// ─── If-Range ────────────────────────────────────────────────────────────────

describe('Range — If-Range', () => {
    let server;
    let currentEtag;

    beforeAll(async () => {
        server = createApp({ browserCacheEnabled: true });
        const res = await supertest(server).get('/sample.txt');
        currentEtag = res.headers['etag'];
    });
    afterAll(() => server.close());

    test('If-Range with matching ETag → 206', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('Range', 'bytes=0-4')
            .set('If-Range', currentEtag);
        expect(res.status).toBe(206);
        expect(res.text).toBe('01234');
    });

    test('If-Range with wrong ETag → 200 full file', async () => {
        const res = await supertest(server)
            .get('/sample.txt')
            .set('Range', 'bytes=0-4')
            .set('If-Range', '"wrong-etag-does-not-match"');
        expect(res.status).toBe(200);
        expect(res.text).toBe(FILE_CONTENT);
    });
});

// ─── HEAD + Range ─────────────────────────────────────────────────────────────

describe('Range — HEAD method', () => {
    let server;
    beforeAll(() => { server = createApp({ method: ['GET', 'HEAD'] }); });
    afterAll(() => server.close());

    test('HEAD + Range → 206 status and correct headers, no body', async () => {
        const res = await supertest(server)
            .head('/sample.txt')
            .set('Range', 'bytes=0-4');
        expect(res.status).toBe(206);
        expect(res.headers['content-range']).toBe(`bytes 0-4/${FILE_SIZE}`);
        expect(res.headers['content-length']).toBe('5');
        // HEAD response: no body sent (supertest reports undefined, not '')
        expect(res.body).toEqual({});
    });

    test('HEAD without Range → 200, Accept-Ranges present', async () => {
        const res = await supertest(server).head('/sample.txt');
        expect(res.status).toBe(200);
        expect(res.headers['accept-ranges']).toBe('bytes');
    });

    test('HEAD + out-of-bounds Range → 416', async () => {
        const res = await supertest(server)
            .head('/sample.txt')
            .set('Range', 'bytes=999-');
        expect(res.status).toBe(416);
        expect(res.headers['content-range']).toBe(`bytes */${FILE_SIZE}`);
    });
});
