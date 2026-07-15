/**
 * Sort / pagination links vs urlPrefix — regression tests for finding #2 of
 * docs/revisione_codice_v4.3.md.
 *
 * Before the fix the listing's self-referencing links (column-sort headers,
 * paginator) were built from the OUT-prefix pathname: with urlPrefix
 * '/static', the listing of /static/sub/ emitted href="/sub?sort=..." — a URL
 * outside the served tree (404 or someone else's route) — while the parent /
 * entry links correctly kept the prefix. The fix builds them from the
 * WITH-prefix pathname and normalizes to the canonical trailing-slash form,
 * so every click lands directly on the directory URL with no 301 hop.
 *
 * supertest does not follow redirects by default, so asserting 200 on an
 * extracted link also proves the hop is gone.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-links-'));
    fs.mkdirSync(path.join(root, 'sub'));
    for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(root, 'sub', `f${i}.txt`), 'x'.repeat(10 + i));
    }
    fs.writeFileSync(path.join(root, 'top.txt'), 'top');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function makeServer(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { dirListing: { entriesPerPage: 2 }, ...opts }));
    return app.listen();
}

// All hrefs that carry a sort or page query parameter (the listing's
// self-referencing links), reduced to path + query.
function selfLinks(html) {
    return [...html.matchAll(/href="([^"]*\?[^"]*(?:sort|page)=[^"]*)"/g)]
        .map((m) => {
            const raw = m[1].replace(/&amp;/g, '&');
            return raw.startsWith('http') ? raw.replace(/^https?:\/\/[^/]+/, '') : raw;
        });
}

describe('finding #2 — listing self-links under urlPrefix', () => {
    let server;
    beforeAll(() => { server = makeServer({ urlPrefix: '/static' }); });
    afterAll(() => server.close());

    test('sort and pagination links in a subdirectory keep the prefix', async () => {
        const res = await supertest(server).get('/static/sub/');
        expect(res.status).toBe(200);
        const links = selfLinks(res.text);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
            expect(link.startsWith('/static/sub/?')).toBe(true);
        }
    });

    test('sort link click-through: 200 directly, still a listing', async () => {
        const res = await supertest(server).get('/static/sub/');
        const sortLink = selfLinks(res.text).find((l) => l.includes('sort='));
        expect(sortLink).toBeDefined();
        const r2 = await supertest(server).get(sortLink);
        expect(r2.status).toBe(200); // no 301 hop, no escape from the prefix
        expect(r2.text).toContain('<table>');
        // The clicked link toggles the sort order, so which files land on
        // page 0 varies — just assert real entries are being listed.
        expect(r2.text).toMatch(/f\d\.txt/);
    });

    test('pagination link click-through serves the next page', async () => {
        const res = await supertest(server).get('/static/sub/');
        expect(res.headers['x-dir-pagination']).toBe('0/2'); // 5 files / 2 per page
        const pageLink = selfLinks(res.text).find((l) => l.includes('page=1'));
        expect(pageLink).toBeDefined();
        expect(pageLink.startsWith('/static/sub/?')).toBe(true);
        const r2 = await supertest(server).get(pageLink);
        expect(r2.status).toBe(200);
        expect(r2.headers['x-dir-pagination']).toBe('1/2');
    });

    test('at the prefix root the links point to /static/', async () => {
        const res = await supertest(server).get('/static/');
        for (const link of selfLinks(res.text)) {
            expect(link.startsWith('/static/?')).toBe(true);
        }
    });
});

describe('finding #2 — no 301 hop on self-links without a prefix', () => {
    let server;
    beforeAll(() => { server = makeServer(); });
    afterAll(() => server.close());

    test('subdirectory sort links carry the canonical trailing slash', async () => {
        const res = await supertest(server).get('/sub/');
        const links = selfLinks(res.text);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
            expect(link.startsWith('/sub/?')).toBe(true);
        }
    });

    test('clicking a sort link answers 200 directly (redirects not followed)', async () => {
        const res = await supertest(server).get('/sub/');
        const sortLink = selfLinks(res.text).find((l) => l.includes('sort='));
        const r2 = await supertest(server).get(sortLink);
        expect(r2.status).toBe(200);
    });

    test('root listing links keep the historical /?sort=... shape', async () => {
        const res = await supertest(server).get('/');
        const links = selfLinks(res.text);
        expect(links.length).toBeGreaterThan(0);
        for (const link of links) {
            expect(link.startsWith('/?')).toBe(true);
        }
    });

    test('page links preserve active sort and order', async () => {
        const res = await supertest(server).get('/sub/?sort=size&order=desc');
        const pageLink = selfLinks(res.text).find((l) => l.includes('page=1'));
        expect(pageLink).toBeDefined();
        expect(pageLink).toContain('sort=size');
        expect(pageLink).toContain('order=desc');
        const r2 = await supertest(server).get(pageLink);
        expect(r2.status).toBe(200);
        expect(r2.headers['x-dir-pagination']).toBe('1/2');
    });
});
