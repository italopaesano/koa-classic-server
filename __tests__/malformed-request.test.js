/**
 * Malformed-request handling (V-2) — koa-classic-server
 *
 * Client-controlled inputs that used to surface as 500 Internal Server Error
 * must now return 400 Bad Request:
 *   - malformed percent-encoding in the path  (decodeURIComponent throws URIError)
 *   - an invalid Host header                  (new URL() throws)
 * Well-formed requests (including valid percent-encoding) are unaffected.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

describe('malformed request handling (V-2)', () => {
    let root, server, request;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-v2-'));
        fs.writeFileSync(path.join(root, 'ok.txt'), 'ok content');
        fs.writeFileSync(path.join(root, 'a b.txt'), 'spaced');
        const app = new Koa();
        app.use(koaClassicServer(root, { dirListing: { enabled: true } }));
        server = app.listen();
        request = supertest(server);
    });

    afterAll(() => {
        server?.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    describe('malformed percent-encoding → 400', () => {
        test.each([
            ['/%', 'lone percent'],
            ['/%zz', 'invalid hex digits'],
            ['/%E0%A4%A', 'truncated UTF-8 sequence'],
            ['/a%2fb%', 'trailing lone percent'],
            ['/%c3%28', 'invalid UTF-8 continuation'],
        ])('%s (%s) returns 400 Bad Request', async (urlPath) => {
            const res = await request.get(urlPath);
            expect(res.status).toBe(400);
            expect(res.text).toBe('Bad Request');
        });
    });

    describe('invalid Host header → 400', () => {
        test('Host with spaces returns 400', async () => {
            const res = await request.get('/ok.txt').set('Host', 'bad host with spaces');
            expect(res.status).toBe(400);
            expect(res.text).toBe('Bad Request');
        });
    });

    describe('null byte → 400 (regression)', () => {
        test('%00 in path returns 400', async () => {
            const res = await request.get('/file%00.txt');
            expect(res.status).toBe(400);
            expect(res.text).toBe('Bad Request');
        });
    });

    describe('well-formed requests unaffected', () => {
        test('valid path returns 200', async () => {
            const res = await request.get('/ok.txt');
            expect(res.status).toBe(200);
            expect(res.text).toContain('ok content');
        });

        test('valid percent-encoding (space) returns 200', async () => {
            const res = await request.get('/a%20b.txt');
            expect(res.status).toBe(200);
            expect(res.text).toContain('spaced');
        });

        test('valid Host returns 200', async () => {
            const res = await request.get('/ok.txt').set('Host', 'example.com');
            expect(res.status).toBe(200);
        });

        test('non-existent but well-formed path returns 404 (not 400/500)', async () => {
            const res = await request.get('/does-not-exist.txt');
            expect(res.status).toBe(404);
        });
    });

    describe('with urlPrefix configured', () => {
        let root2, server2, request2;
        beforeAll(() => {
            root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-v2p-'));
            fs.writeFileSync(path.join(root2, 'ok.txt'), 'prefixed');
            const app = new Koa();
            app.use(koaClassicServer(root2, { urlPrefix: '/static', dirListing: { enabled: true } }));
            server2 = app.listen();
            request2 = supertest(server2);
        });
        afterAll(() => {
            server2?.close();
            fs.rmSync(root2, { recursive: true, force: true });
        });

        test('malformed percent-encoding under prefix returns 400', async () => {
            const res = await request2.get('/static/%');
            expect(res.status).toBe(400);
        });

        test('valid prefixed path returns 200', async () => {
            const res = await request2.get('/static/ok.txt');
            expect(res.status).toBe(200);
            expect(res.text).toContain('prefixed');
        });
    });
});
