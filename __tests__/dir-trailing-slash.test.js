/**
 * Canonical trailing-slash redirect / 404 — finding #3 of
 * docs/revisione_codice_v3.1.md (dirListing.trailingSlash, V4, default ON).
 *
 * Default (trailingSlash: true):
 *   - GET /dir  (directory, no slash)  → 301 → /dir/   (so relative links in an
 *     index page resolve against the directory)
 *   - GET /file/ (file, trailing slash) → 404          (a file is only reachable
 *     at its slash-less URL; option C)
 * trailingSlash: false restores the v3 behavior (serve regardless of slash).
 *
 * Edge cases: root, urlPrefix (incl. prefix root), percent-encoding, query
 * string, HEAD, listing disabled, open-redirect guard, useOriginalUrl:false,
 * hideExtension composition.
 */

const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-trailing-'));
    fs.writeFileSync(path.join(root, 'file.txt'), 'FILE');
    fs.mkdirSync(path.join(root, 'dir'));
    fs.writeFileSync(path.join(root, 'dir', 'index.html'), '<a href="p2.html">rel</a>');
    fs.mkdirSync(path.join(root, 'listdir'));            // no index → listing
    fs.writeFileSync(path.join(root, 'listdir', 'x.txt'), 'x');
    fs.mkdirSync(path.join(root, 'a space'));            // percent-encoding case
    fs.writeFileSync(path.join(root, 'a space', 'index.html'), 'SPACED');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function app(opts = {}) {
    const a = new Koa();
    a.on('error', () => {});
    a.use(koaClassicServer(root, { index: ['index.html'], method: ['GET', 'HEAD'], ...opts }));
    return a.listen();
}

// ─── Default: trailingSlash on ───────────────────────────────────────────────

describe('trailingSlash: true (default)', () => {
    let server;
    beforeAll(() => { server = app(); });
    afterAll(() => server.close());

    test('GET /dir (directory, no slash) → 301 to /dir/', async () => {
        const res = await supertest(server).get('/dir').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/dir/');
    });

    test('GET /dir/ serves the index (200)', async () => {
        const res = await supertest(server).get('/dir/').set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toContain('rel');
    });

    test('GET /listdir (no index) → 301 to /listdir/', async () => {
        const res = await supertest(server).get('/listdir').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/listdir/');
    });

    test('GET /file.txt (file, no slash) → 200', async () => {
        const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toBe('FILE');
    });

    test('GET /file.txt/ (file, trailing slash) → 404 (option C)', async () => {
        const res = await supertest(server).get('/file.txt/');
        expect(res.status).toBe(404);
    });

    test('GET / (root) → 200, never redirects', async () => {
        const res = await supertest(server).get('/').redirects(0).set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
    });

    test('query string is preserved across the redirect', async () => {
        const res = await supertest(server).get('/dir?sort=name&order=asc').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/dir/?sort=name&order=asc');
    });

    test('percent-encoded directory name is preserved verbatim', async () => {
        const res = await supertest(server).get('/a%20space').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/a%20space/');
    });

    test('HEAD /dir also redirects (mirrors GET)', async () => {
        const res = await supertest(server).head('/dir').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/dir/');
    });

    test('following the redirect reaches the index', async () => {
        const res = await supertest(server).get('/dir').redirects(1).set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toContain('rel');
    });
});

// ─── Opt-out: v3 behavior ────────────────────────────────────────────────────

describe('trailingSlash: false (v3 behavior restored)', () => {
    let server;
    beforeAll(() => { server = app({ dirListing: { enabled: true, trailingSlash: false } }); });
    afterAll(() => server.close());

    test('GET /dir serves the index directly (no redirect)', async () => {
        const res = await supertest(server).get('/dir').redirects(0).set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toContain('rel');
    });

    test('GET /file.txt/ serves the file (slash ignored)', async () => {
        const res = await supertest(server).get('/file.txt/').set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toBe('FILE');
    });
});

// ─── Listing disabled: no redirect (would 404 anyway) ────────────────────────

describe('dirListing.enabled: false', () => {
    let server;
    beforeAll(() => { server = app({ dirListing: { enabled: false } }); });
    afterAll(() => server.close());

    test('GET /dir → 404, not a redirect', async () => {
        const res = await supertest(server).get('/dir').redirects(0);
        expect(res.status).toBe(404);
    });

    test('GET /file.txt/ still 404s (canonicalization independent of listing)', async () => {
        const res = await supertest(server).get('/file.txt/');
        expect(res.status).toBe(404);
    });
});

// ─── urlPrefix ───────────────────────────────────────────────────────────────

describe('with urlPrefix', () => {
    let server;
    beforeAll(() => { server = app({ urlPrefix: '/static' }); });
    afterAll(() => server.close());

    test('GET /static/dir → 301 /static/dir/ (prefix preserved)', async () => {
        const res = await supertest(server).get('/static/dir').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/static/dir/');
    });

    test('GET /static (prefix root, no slash) → 301 /static/', async () => {
        const res = await supertest(server).get('/static').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/static/');
    });
});

// ─── Open-redirect guard ─────────────────────────────────────────────────────

describe('open-redirect guard', () => {
    let server;
    beforeAll(() => { server = app(); });
    afterAll(() => server.close());

    test('a "//host"-style path never yields a protocol-relative Location', async () => {
        // Raw client: supertest would normalize the path; send it verbatim.
        const { port } = server.address();
        const res = await new Promise((resolve, reject) => {
            const req = http.request({ port, method: 'GET', path: '//dir' }, r => {
                resolve({ status: r.statusCode, location: r.headers.location });
                r.resume();
            });
            req.on('error', reject);
            req.end();
        });
        // Either a normal 301 to a single-leading-slash path, or a 404 — never a
        // Location that starts with "//" (which the browser reads as off-origin).
        if (res.location) {
            expect(res.location.startsWith('//')).toBe(false);
            expect(res.location.startsWith('/\\')).toBe(false);
        }
    });
});

// ─── useOriginalUrl: false (URL rewriting) ───────────────────────────────────

describe('useOriginalUrl: false', () => {
    let server;
    beforeAll(() => {
        const a = new Koa();
        a.on('error', () => {});
        // Rewrite /pretty → /dir; the redirect Location is built from the
        // client's originalUrl (/pretty), not the rewritten one.
        a.use((ctx, next) => { if (ctx.path === '/pretty') ctx.url = '/dir'; return next(); });
        a.use(koaClassicServer(root, { index: ['index.html'], useOriginalUrl: false }));
        server = a.listen();
    });
    afterAll(() => server.close());

    test('redirect Location reflects the client URL, not the rewritten path', async () => {
        const res = await supertest(server).get('/pretty').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/pretty/');
    });
});

// ─── hideExtension composition ───────────────────────────────────────────────

describe('composition with hideExtension', () => {
    let hideRoot;
    let server;
    beforeAll(() => {
        hideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-trailing-hide-'));
        fs.writeFileSync(path.join(hideRoot, 'about.ejs'), 'ABOUT');   // clean URL /about
        fs.mkdirSync(path.join(hideRoot, 'blog'));                     // directory
        fs.writeFileSync(path.join(hideRoot, 'blog', 'index.html'), 'BLOG');
        const a = new Koa();
        a.on('error', () => {});
        a.use(koaClassicServer(hideRoot, { index: ['index.html'], hideExtension: { ext: '.ejs' } }));
        server = a.listen();
    });
    afterAll(() => {
        server.close();
        fs.rmSync(hideRoot, { recursive: true, force: true });
    });

    test('clean URL /about resolves to the file (no directory redirect)', async () => {
        const res = await supertest(server).get('/about').redirects(0).set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);   // served, not 301 — the file wins over any dir handling
        // .ejs has no registered MIME → octet-stream → body lands in res.body
        const body = res.text !== undefined ? res.text : res.body.toString('utf8');
        expect(body).toBe('ABOUT');
    });

    test('directory /blog still gets the trailing-slash redirect', async () => {
        const res = await supertest(server).get('/blog').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/blog/');
    });
});
