//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  hideExtension — trailing-slash & percent-encoded extension (Model B, register #14 + #20)
//
//  Model B (V4): an extension URL is canonicalized ONLY without a trailing slash. A trailing
//  slash means directory intent, so /foo.ejs/ falls through to the file/dir dispatch and 404s
//  as "a file requested with a trailing slash" (finding #3). The redirect target is built in
//  decoded space and re-encoded, so a percent-encoded dot (/foo%2Eejs) is handled consistently
//  and the extension slice can no longer eat the slash (/foo.ejs/ → /foo. was the #20 bug).
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let root;
beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-hideext-'));
    fs.writeFileSync(path.join(root, 'foo.ejs'), 'FOO');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'index.ejs'), 'IDX');
    fs.writeFileSync(path.join(root, 'my file.ejs'), 'SPACE'); // filename with a space
});
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

function createApp(dirListing = { enabled: false }) {
    const app = new Koa();
    app.use(koaClassicServer(root, {
        dirListing,
        index: ['index.ejs'],
        hideExtension: { ext: '.ejs' },
        template: { render: async (ctx) => { ctx.body = 'RENDERED'; }, ext: ['ejs'] },
    }));
    return app.listen();
}

// ─── #20 — trailing slash on an extension URL → 404 (Model B) ───────────────────

describe('hideExtension trailing slash → 404 (Model B, #20)', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('/foo.ejs (no slash) → 301 → /foo', async () => {
        const res = await supertest(server).get('/foo.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/foo');
    });

    test('/foo.ejs/ (trailing slash) → 404 (file + slash, not /foo.)', async () => {
        const res = await supertest(server).get('/foo.ejs/').redirects(0);
        expect(res.status).toBe(404);
        expect(res.headers.location).toBeUndefined();
    });

    test('/sub/index.ejs → 301 → /sub/ (index special case, unchanged)', async () => {
        const res = await supertest(server).get('/sub/index.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/sub/');
    });

    test('/sub/index.ejs/ (trailing slash) → 404, not /sub/index.', async () => {
        const res = await supertest(server).get('/sub/index.ejs/').redirects(0);
        expect(res.status).toBe(404);
    });

    test('escape hatch: with dirListing.trailingSlash:false, /foo.ejs/ is served (200)', async () => {
        const s = createApp({ enabled: false, trailingSlash: false });
        const res = await supertest(s).get('/foo.ejs/').redirects(0);
        s.close();
        expect(res.status).toBe(200);
        expect(res.text).toBe('RENDERED');
    });
});

// ─── #14 — percent-encoded extension handled consistently ──────────────────────

describe('hideExtension percent-encoded extension (#14)', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('/foo%2Eejs (encoded dot) → 301 → /foo (not the broken /foo%2)', async () => {
        const res = await supertest(server).get('/foo%2Eejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/foo');
    });

    test('/foo%2Eejs/ (encoded dot + trailing slash) → 404', async () => {
        const res = await supertest(server).get('/foo%2Eejs/').redirects(0);
        expect(res.status).toBe(404);
    });

    test('/my%20file.ejs (space in name) → 301 → /my%20file (space stays encoded)', async () => {
        const res = await supertest(server).get('/my%20file.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/my%20file');
    });
});

// ─── open-redirect guard survives the decode/re-encode path ────────────────────

describe('hideExtension open-redirect guard with decoded %2F (#14/#20 security)', () => {
    let server, port;
    beforeAll(() => {
        server = createApp(); // createApp already calls listen()
        port = server.address().port;
    });
    afterAll(() => server.close());

    // Raw request so the encoded %2F reaches the server untouched.
    function rawGet(rawPath) {
        return new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: rawPath }, (res) => {
                res.resume();
                resolve({ status: res.statusCode, location: res.headers.location });
            });
            req.on('error', reject);
            req.end();
        });
    }

    test('/%2F%2Fevil.com/foo.ejs → Location collapsed, not protocol-relative', async () => {
        // %2F decodes to "/", so a naive re-encode could reintroduce a leading "//".
        const res = await rawGet('/%2F%2Fevil.com/foo.ejs');
        expect(res.status).toBe(301);
        expect(res.location).toBeDefined();
        expect(res.location.startsWith('//')).toBe(false);
        expect(res.location.startsWith('/\\')).toBe(false);
        expect(res.location).toBe('/evil.com/foo');
    });
});
