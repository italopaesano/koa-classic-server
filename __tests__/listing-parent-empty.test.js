//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  DIRECTORY LISTING — Parent Directory link & empty-folder row (register #13, #16)
//  #13 — the "Parent Directory" link must stop at the middleware's logical root, not exit urlPrefix.
//  #16 — a directory whose entries are all hidden shows the "empty folder" row (like an empty dir),
//        not a header-only empty table (which would also hint that hidden files exist).
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

function makeApp(rootDir, opts = {}) {
    const app = new Koa();
    app.silent = true;
    app.use(koaClassicServer(rootDir, { dirListing: { enabled: true }, ...opts }));
    return app.listen();
}

function parentHref(html) {
    const m = html.match(/href="([^"]*)"><b>\.\. Parent Directory/);
    return m ? m[1] : null;
}

// ─── #13 — Parent Directory link respects urlPrefix ────────────────────────────

describe('Parent Directory link and urlPrefix (#13)', () => {
    let root;
    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-parent-'));
        fs.mkdirSync(path.join(root, 'sub'));
        fs.writeFileSync(path.join(root, 'sub', 'f.txt'), 'x');
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    test('no prefix: root listing has no Parent Directory link', async () => {
        const s = makeApp(root);
        const res = await supertest(s).get('/');
        s.close();
        expect(res.text).not.toContain('Parent Directory');
    });

    test('no prefix: /sub/ links parent to the origin root', async () => {
        const s = makeApp(root);
        const res = await supertest(s).get('/sub/');
        s.close();
        const href = parentHref(res.text);
        expect(href).not.toBeNull();
        expect(href).toMatch(/^https?:\/\/[^/]+$/); // origin only, no path → the root
    });

    test('prefix /static: logical root /static/ has NO Parent Directory link', async () => {
        const s = makeApp(root, { urlPrefix: '/static' });
        const res = await supertest(s).get('/static/');
        s.close();
        expect(res.text).not.toContain('Parent Directory');
    });

    test('prefix /static: /static/sub/ links parent to /static (inside the served tree)', async () => {
        const s = makeApp(root, { urlPrefix: '/static' });
        const res = await supertest(s).get('/static/sub/');
        s.close();
        const href = parentHref(res.text);
        expect(href).not.toBeNull();
        expect(href.endsWith('/static')).toBe(true);      // parent is the prefix root, not '/'
        expect(href.endsWith('/static/sub')).toBe(false);
    });
});

// ─── #16 — empty-folder row when every entry is hidden ─────────────────────────

describe('empty-folder row when all entries hidden (#16)', () => {
    let root;
    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-empty-'));
        fs.mkdirSync(path.join(root, 'allhidden'));
        fs.writeFileSync(path.join(root, 'allhidden', 'a.secret'), 'x');
        fs.writeFileSync(path.join(root, 'allhidden', 'b.secret'), 'x');
        fs.mkdirSync(path.join(root, 'reallyempty'));
        fs.mkdirSync(path.join(root, 'visible'));
        fs.writeFileSync(path.join(root, 'visible', 'shown.txt'), 'x');
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    test('directory where every entry is hidden → shows "empty folder"', async () => {
        const s = makeApp(root, { hidden: { alwaysHide: ['*.secret'] } });
        const res = await supertest(s).get('/allhidden/');
        s.close();
        expect(res.text).toContain('empty folder');
    });

    test('physically empty directory → shows "empty folder" (unchanged)', async () => {
        const s = makeApp(root);
        const res = await supertest(s).get('/reallyempty/');
        s.close();
        expect(res.text).toContain('empty folder');
    });

    test('directory with a visible entry → no "empty folder"', async () => {
        const s = makeApp(root, { hidden: { alwaysHide: ['*.secret'] } });
        const res = await supertest(s).get('/visible/');
        s.close();
        expect(res.text).not.toContain('empty folder');
        expect(res.text).toContain('shown.txt');
    });

    test('all-hidden looks identical to empty (no leak that hidden files exist)', async () => {
        const s = makeApp(root, { hidden: { alwaysHide: ['*.secret'] } });
        const res = await supertest(s).get('/allhidden/');
        s.close();
        expect(res.text).not.toContain('a.secret');
        expect(res.text).not.toContain('b.secret');
        expect((res.text.match(/empty folder/g) || []).length).toBe(1);
    });
});
