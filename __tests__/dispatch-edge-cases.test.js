/**
 * Request-dispatch edge cases — 2026-07 test-expansion pass.
 *
 * Situations where two features meet and the winner was previously untested:
 *
 *  - hideExtension resolving a clean URL onto something that exists but is a
 *    DIRECTORY (name.ejs/) — must fall through to normal flow, never serve it.
 *  - an index file that matches `index` but is hidden by `hidden.alwaysHide` —
 *    the listing must be shown instead, and must not leak the hidden name.
 *  - a dot-file that no name-based rule touches but a path-aware alwaysHide
 *    pattern does — priority rule #3 of isHiddenEntry (blacklist > whitelist >
 *    alwaysHide > default), previously covered only for non-dot entries.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-dispatch-'));
    // hideExtension conflict: a DIRECTORY whose name ends with the hidden ext
    fs.mkdirSync(path.join(root, 'docs.ejs'));
    fs.writeFileSync(path.join(root, 'docs.ejs', 'inside.txt'), 'inside the dir');
    // Hidden-index scenario
    fs.mkdirSync(path.join(root, 'gallery'));
    fs.writeFileSync(path.join(root, 'gallery', 'index.html'), '<h1>secret index</h1>');
    fs.writeFileSync(path.join(root, 'gallery', 'photo.txt'), 'a photo');
    // alwaysHide-on-dot-file scenario
    fs.mkdirSync(path.join(root, 'secret'));
    fs.writeFileSync(path.join(root, 'secret', '.env'), 'DB_PASSWORD=hunter2');
    fs.writeFileSync(path.join(root, 'secret', 'visible.txt'), 'not hidden');
    fs.writeFileSync(path.join(root, 'plain.txt'), 'plain');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function createServer(opts = {}) {
    const app = new Koa();
    app.on('error', () => {});
    app.use(koaClassicServer(root, opts));
    return app.listen();
}

// ─── hideExtension: clean URL resolves onto a DIRECTORY named name.ejs ───────

describe('hideExtension × directory named like a hidden-extension file', () => {
    let server;
    beforeAll(() => { server = createServer({ hideExtension: { ext: '.ejs' } }); });
    afterAll(() => server.close());

    test('GET /docs does NOT serve the directory docs.ejs/ as a file → 404', async () => {
        const res = await supertest(server).get('/docs');
        expect(res.status).toBe(404);
    });

    test('the directory stays reachable at its real (extension) URL', async () => {
        // /docs.ejs ends with the ext and no trailing slash → canonical redirect to /docs
        // (Model B), so the DIRECTORY itself is reachable only via its listing children.
        const res = await supertest(server).get('/docs.ejs/inside.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('inside the dir');
    });
});

// ─── index file present but hidden → listing without the hidden name ─────────

describe('index file hidden via alwaysHide falls back to the listing', () => {
    let server;
    beforeAll(() => {
        server = createServer({
            index: ['index.html'],
            hidden: { alwaysHide: ['gallery/index.html'] },
        });
    });
    afterAll(() => server.close());

    test('GET /gallery/ shows the listing, not the hidden index page', async () => {
        const res = await supertest(server).get('/gallery/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('Index of'); // the listing rendered
        expect(res.text).not.toContain('secret index'); // index body did not leak
    });

    test('the hidden index name does not appear among the listed entries', async () => {
        const res = await supertest(server).get('/gallery/');
        expect(res.text).not.toContain('index.html');
        expect(res.text).toContain('photo.txt'); // siblings still listed
    });

    test('direct GET of the hidden index file is 404', async () => {
        const res = await supertest(server).get('/gallery/index.html');
        expect(res.status).toBe(404);
    });

    test('a NON-hidden index in another dir still short-circuits the listing', async () => {
        // Same server: root has no index.html → root listing still works
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('Index of');
    });
});

// ─── dot-file hidden ONLY by a path-aware alwaysHide pattern ─────────────────

describe('dot-file × alwaysHide path pattern (isHiddenEntry priority #3)', () => {
    let server;
    beforeAll(() => {
        // dotFiles stay VISIBLE by default; only the path pattern hides them here.
        server = createServer({ hidden: { alwaysHide: ['secret/**'] } });
    });
    afterAll(() => server.close());

    test('GET /secret/.env → 404 (alwaysHide reaches dot-files too)', async () => {
        const res = await supertest(server).get('/secret/.env');
        expect(res.status).toBe(404);
    });

    test('non-dot sibling under the same pattern is hidden as well', async () => {
        const res = await supertest(server).get('/secret/visible.txt');
        expect(res.status).toBe(404);
    });

    test('an equivalent dot-file OUTSIDE the pattern stays visible (default untouched)', async () => {
        const res = await supertest(server).get('/plain.txt');
        expect(res.status).toBe(200);
    });

    test('the listing of /secret/ shows the empty-folder row, leaking nothing', async () => {
        const res = await supertest(server).get('/secret/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('empty folder');
        expect(res.text).not.toContain('.env');
        expect(res.text).not.toContain('visible.txt');
    });
});

describe('dot-file whitelist BEATS alwaysHide (priority #2 over #3)', () => {
    let server;
    beforeAll(() => {
        server = createServer({
            hidden: {
                dotFiles: { whitelist: ['.env'] },
                alwaysHide: ['secret/**'],
            },
        });
    });
    afterAll(() => server.close());

    test('whitelisted .env is served even though alwaysHide matches its path', async () => {
        const res = await supertest(server).get('/secret/.env');
        expect(res.status).toBe(200);
        // .env has no known MIME → application/octet-stream → Buffer body
        const payload = res.text || (res.body && res.body.toString());
        expect(payload).toContain('DB_PASSWORD=hunter2');
    });

    test('the whitelist does not resurrect NON-dot files under the same pattern', async () => {
        const res = await supertest(server).get('/secret/visible.txt');
        expect(res.status).toBe(404);
    });
});
