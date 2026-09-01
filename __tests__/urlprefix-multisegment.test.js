/**
 * Multi-segment urlPrefix ('/a/b') — 2026-09 coverage review.
 *
 * Every urlPrefix test in the suite used a SINGLE-segment prefix ('/static',
 * '/public', '/p'). The matching loop walks `urlPrefix.split('/')` against the
 * request pathname segment by segment, so a two-segment prefix exercises the
 * loop for real (index 2 exists) instead of the degenerate one-iteration case.
 * Nothing asserted that a deployment mounted at '/a/b' routes at all, nor that
 * the listing links, the parent link, the canonical redirect and urlsReserved
 * stay in the right URL space once more than one segment is stripped.
 *
 * The second half is the security surface of that loop: the prefix must not be
 * bypassable by a partial segment match, an encoded slash, a dot-segment or a
 * leading double slash. Those all currently fall through to next() — pinned
 * here so a future rewrite of the matcher cannot loosen them silently.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-prefix-multi-'));
    fs.mkdirSync(path.join(root, 'dir'));
    fs.writeFileSync(path.join(root, 'dir', 'inner.txt'), 'inner');
    fs.writeFileSync(path.join(root, 'file.txt'), 'plain');
    fs.writeFileSync(path.join(root, 'about.ejs'), 'ABOUT');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

// The downstream middleware answers 599 so "fell through to next()" is
// distinguishable from "the middleware answered 404".
const NEXT = 599;

function makeServer(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, opts));
    app.use(async (ctx) => { ctx.status = NEXT; ctx.body = 'NEXT'; });
    return app.callback();
}

// All hrefs in a listing, unescaped and reduced to path + query.
function hrefs(html) {
    return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

// ─── routing ─────────────────────────────────────────────────────────────────

describe("urlPrefix '/a/b' — routing", () => {
    let server;
    beforeAll(() => { server = makeServer({ urlPrefix: '/a/b', index: [] }); });

    test('a file under the prefix is served', async () => {
        const res = await supertest(server).get('/a/b/file.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('plain');
    });

    test('a nested file under the prefix is served', async () => {
        const res = await supertest(server).get('/a/b/dir/inner.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('inner');
    });

    test('a missing file under the prefix is the middleware\'s own 404, not a fall-through', async () => {
        const res = await supertest(server).get('/a/b/nope.txt');
        expect(res.status).toBe(404);
    });

    test('the prefix root serves the listing', async () => {
        const res = await supertest(server).get('/a/b/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('file.txt');
    });

    test('the bare prefix canonicalizes to /a/b/', async () => {
        const res = await supertest(server).get('/a/b').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/a/b/');
    });

    test('a directory under the prefix canonicalizes with the prefix intact', async () => {
        const res = await supertest(server).get('/a/b/dir').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/a/b/dir/');
    });

    test('an INCOMPLETE prefix falls through — /a/ is not the mount point', async () => {
        expect((await supertest(server).get('/a/')).status).toBe(NEXT);
        expect((await supertest(server).get('/a')).status).toBe(NEXT);
    });

    test('the un-prefixed path falls through — the tree is only reachable at /a/b', async () => {
        expect((await supertest(server).get('/file.txt')).status).toBe(NEXT);
        expect((await supertest(server).get('/b/file.txt')).status).toBe(NEXT);
    });
});

// ─── links generated inside the listing ──────────────────────────────────────

describe("urlPrefix '/a/b' — listing links stay in prefixed space", () => {
    let server;
    beforeAll(() => { server = makeServer({ urlPrefix: '/a/b', index: [] }); });

    test('entry links at the prefix root carry the full prefix', async () => {
        const res = await supertest(server).get('/a/b/');
        expect(hrefs(res.text)).toEqual(expect.arrayContaining([
            '/a/b/file.txt',
            '/a/b/dir/',
        ]));
    });

    test('every href is path-absolute under the prefix — none escapes to /', async () => {
        const res = await supertest(server).get('/a/b/');
        for (const href of hrefs(res.text)) {
            expect(href.startsWith('/a/b/')).toBe(true);
        }
    });

    test('sort links keep both prefix segments', async () => {
        const res = await supertest(server).get('/a/b/dir/');
        expect(hrefs(res.text)).toEqual(expect.arrayContaining([
            '/a/b/dir/?sort=name&order=desc',
        ]));
    });

    test('the parent link of a subdirectory is the prefix root, not /', async () => {
        const res = await supertest(server).get('/a/b/dir/');
        expect(res.text).toContain('Parent Directory');
        expect(hrefs(res.text)).toContain('/a/b/');
    });

    test('the prefix root is the LOGICAL root — no parent link out of the tree', async () => {
        const res = await supertest(server).get('/a/b/');
        expect(res.text).not.toContain('Parent Directory');
    });

    test('an extracted link resolves in one hop (no 301 chain)', async () => {
        const listing = await supertest(server).get('/a/b/');
        const dirLink = hrefs(listing.text).find((h) => h.endsWith('/dir/'));
        const res = await supertest(server).get(dirLink).redirects(0);
        expect(res.status).toBe(200);
    });
});

// ─── interaction with the other URL-space features ───────────────────────────

describe("urlPrefix '/a/b' — urlsReserved is matched AFTER the prefix is stripped", () => {
    let server;
    beforeAll(() => {
        server = makeServer({ urlPrefix: '/a/b', urlsReserved: ['/dir'], index: [] });
    });

    test('the reserved first-level path is reserved under the prefix', async () => {
        expect((await supertest(server).get('/a/b/dir/')).status).toBe(NEXT);
    });

    test('a non-reserved path under the prefix is still served', async () => {
        const res = await supertest(server).get('/a/b/file.txt');
        expect(res.status).toBe(200);
    });

    test('the reserved name in UN-prefixed space is not the middleware\'s business', async () => {
        // Falls through at the prefix check, before urlsReserved is consulted —
        // same observable outcome, different reason.
        expect((await supertest(server).get('/dir/')).status).toBe(NEXT);
    });
});

describe("urlPrefix '/a/b' — hideExtension redirects keep the whole prefix", () => {
    let server;
    beforeAll(() => {
        server = makeServer({ urlPrefix: '/a/b', hideExtension: { ext: '.ejs' }, index: [] });
    });

    test('the clean URL under the prefix serves the file', async () => {
        const res = await supertest(server).get('/a/b/about');
        expect(res.status).toBe(200);
    });

    test('the extension URL redirects to the clean URL, prefix intact', async () => {
        const res = await supertest(server).get('/a/b/about.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/a/b/about');
    });
});

// ─── the matcher must not be bypassable ──────────────────────────────────────

describe("urlPrefix '/a/b' — no partial or encoded bypass", () => {
    let server;
    beforeAll(() => { server = makeServer({ urlPrefix: '/a/b', index: [] }); });

    test('a segment that merely STARTS with a prefix segment does not match', async () => {
        expect((await supertest(server).get('/a/bb/file.txt')).status).toBe(NEXT);
        expect((await supertest(server).get('/ab/file.txt')).status).toBe(NEXT);
    });

    test('the prefix match is case-sensitive', async () => {
        expect((await supertest(server).get('/a/B/file.txt')).status).toBe(NEXT);
    });

    test('a percent-encoded slash does not synthesize the prefix boundary', async () => {
        expect((await supertest(server).get('/a%2Fb/file.txt')).status).toBe(NEXT);
    });

    test('a leading double slash does not shift the segment indices into a match', async () => {
        expect((await supertest(server).get('//a/b/file.txt')).status).toBe(NEXT);
    });

    test('a dot-segment cannot re-enter the prefix: /a/b/../file.txt normalizes to /a/file.txt', async () => {
        // new URL() resolves the dot-segment before the prefix is compared, so
        // the request never reaches the served tree.
        expect((await supertest(server).get('/a/b/../file.txt')).status).toBe(NEXT);
    });

    test('a doubled slash INSIDE the served space is tolerated (normalizes to the file)', async () => {
        const res = await supertest(server).get('/a/b//file.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('plain');
    });
});
