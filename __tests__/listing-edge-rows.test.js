/**
 * Directory-listing edge rows + Content-Disposition escaping — 2026-07
 * coverage review.
 *
 * Four previously-untested rendering paths:
 *   1. the "DIR BUT RESERVED" row (a first-level directory whose URL is in
 *      urlsReserved: listed, but not clickable — requests for it go to next())
 *   2. the '-' size fallback when an entry's stat() races a delete
 *   3. the paginator ellipsis (gap between the window around the current page
 *      and the first/last page)
 *   4. RFC 5987 Content-Disposition escaping for filenames with characters
 *      that encodeURIComponent leaves alone (' ( )) and the quoted-string
 *      fallback for embedded double quotes
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

afterEach(() => {
    jest.restoreAllMocks();
});

function makeRoot(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createServer(root, opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { ...opts }));
    return app.listen();
}

// ─── 1. Reserved directory row ───────────────────────────────────────────────

describe('listing row for a reserved first-level directory', () => {
    let root;
    let server;

    beforeAll(() => {
        root = makeRoot('kcs-reserved-row-');
        fs.mkdirSync(path.join(root, 'admin'));
        fs.mkdirSync(path.join(root, 'public'));
        fs.writeFileSync(path.join(root, 'admin', 'panel.txt'), 'x');
        server = createServer(root, { urlsReserved: ['/admin'] });
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('reserved dir appears as "DIR BUT RESERVED" and is NOT a link', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('DIR BUT RESERVED');
        // The reserved row shows the bare name; a normal dir row would link it.
        expect(res.text).not.toMatch(/<a href="[^"]*admin[^"]*"/);
    });

    test('non-reserved sibling dir renders as a normal clickable DIR row', async () => {
        const res = await supertest(server).get('/');
        expect(res.text).toMatch(/<a href="[^"]*public[^"]*"/);
    });

    test('requests under the reserved URL fall through to next() (Koa 404 here)', async () => {
        const res = await supertest(server).get('/admin/panel.txt');
        // No downstream middleware in this app → Koa's default 404, not ours
        expect(res.status).toBe(404);
        expect(res.headers['content-security-policy']).toBeUndefined();
    });
});

// ─── 2. stat() race while sizing an entry ────────────────────────────────────

describe("listing '-' size fallback when an entry's stat races a delete", () => {
    let root;
    let server;

    beforeAll(() => {
        root = makeRoot('kcs-phantom-row-');
        fs.writeFileSync(path.join(root, 'stable.txt'), 'twelve bytes');
        fs.writeFileSync(path.join(root, 'phantom.txt'), 'soon gone');
        server = createServer(root);
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("entry whose stat fails is listed with size '-', siblings keep real sizes", async () => {
        const original = fs.promises.stat;
        jest.spyOn(fs.promises, 'stat').mockImplementation(async (p, ...args) => {
            if (String(p).endsWith('phantom.txt')) {
                throw Object.assign(new Error('injected ENOENT'), { code: 'ENOENT' });
            }
            return original.call(fs.promises, p, ...args);
        });

        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        // The racing entry is still listed (readdir saw it) but with no size…
        expect(res.text).toMatch(/phantom\.txt[\s\S]*?<td>-<\/td>/);
        // …while a healthy sibling shows its real size.
        expect(res.text).toMatch(/stable\.txt[\s\S]*?12 B/);
    });
});

// ─── 3. Paginator ellipsis ───────────────────────────────────────────────────

describe('paginator ellipsis', () => {
    let root;
    let server;

    beforeAll(() => {
        root = makeRoot('kcs-pager-ellipsis-');
        // 10 files × 1 per page = 10 pages (0..9): enough to open gaps between
        // the window around the current page and the first/last page.
        for (let i = 0; i < 10; i++) {
            fs.writeFileSync(path.join(root, `file-${String(i).padStart(2, '0')}.txt`), String(i));
        }
        server = createServer(root, { dirListing: { entriesPerPage: 1 } });
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    // Count the ellipsis ELEMENTS only: the class name also appears once in the
    // inline <style> block, which a bare substring count would pick up.
    const countEllipses = html => (html.match(/<span class="kcs-page-ellipsis">/g) || []).length;

    test('first page: ellipsis before the last page (…, 9)', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        // window = {0,1,2} plus last page 9 → gap → one ellipsis
        expect(countEllipses(res.text)).toBe(1);
        expect(res.text).toContain('<span class="kcs-page-current">0</span>');
        expect(res.headers['x-dir-pagination']).toBe('0/9');
    });

    test('middle page: ellipsis on BOTH sides of the window', async () => {
        const res = await supertest(server).get('/?page=5');
        expect(res.status).toBe(200);
        // pages shown: 0 … 3 4 [5] 6 7 … 9
        expect(countEllipses(res.text)).toBe(2);
        expect(res.text).toContain('<span class="kcs-page-current">5</span>');
    });

    test('adjacent pages leave no gap → no ellipsis on the left', async () => {
        const res = await supertest(server).get('/?page=2');
        // pages shown: 0 1 2 3 4 … 9 — single gap on the right only
        expect(countEllipses(res.text)).toBe(1);
    });

    test('sort parameters survive in the pager links', async () => {
        const res = await supertest(server).get('/?sort=size&order=desc&page=5');
        expect(res.text).toMatch(/href="[^"]*sort=size&(?:amp;)?order=desc&(?:amp;)?page=6"/);
    });
});

// ─── 4. Content-Disposition escaping ─────────────────────────────────────────

describe('Content-Disposition for exotic filenames', () => {
    let root;
    let server;

    beforeAll(() => {
        root = makeRoot('kcs-disposition-');
        fs.writeFileSync(path.join(root, "report (v1)'.txt"), 'quoted');
        fs.writeFileSync(path.join(root, 'plain.txt'), 'plain');
        server = createServer(root, { dirListing: { enabled: false } });
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test("RFC 5987 filename*: percent-encodes ' ( ) beyond encodeURIComponent", async () => {
        const res = await supertest(server).get('/' + encodeURIComponent("report (v1)'.txt"));
        expect(res.status).toBe(200);
        const cd = res.headers['content-disposition'];
        expect(cd).toBeDefined();
        // encodeURIComponent leaves ' ( ) untouched; RFC 5987 requires them encoded.
        expect(cd).toContain("filename*=UTF-8''report%20%28v1%29%27.txt");
        // Quoted-string fallback still present for legacy agents.
        expect(cd).toContain('filename="report (v1)\'.txt"');
    });

    test('plain ASCII name: both forms present and un-mangled', async () => {
        const res = await supertest(server).get('/plain.txt');
        expect(res.headers['content-disposition'])
            .toBe(`inline; filename="plain.txt"; filename*=UTF-8''plain.txt`);
    });
});
