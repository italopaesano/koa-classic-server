/**
 * Listing link canonicalization — regression tests for #6 and #16 of
 * docs/revisione_codice_v4.3.md.
 *
 *  #6  every href the listing emits is PATH-ABSOLUTE (no origin): an absolute
 *      URL embedded the client-controlled Host header (cache-poisoning
 *      surface — verified with a forged Host) and pinned http:// behind a
 *      TLS-terminating proxy without app.proxy (scheme-downgrade per click).
 *  #16 directories — entries, dir-resolved symlinks and the Parent link — are
 *      linked in the canonical /dir/ form, so navigating the listing no
 *      longer pays a 301 redirect hop per click. Files stay slash-less.
 *
 * supertest does not follow redirects, so a direct 200 on a clicked link
 * proves the hop is gone.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-canon-'));
    fs.mkdirSync(path.join(root, 'sub', 'inner'), { recursive: true });
    fs.writeFileSync(path.join(root, 'top.txt'), 'top');
    fs.writeFileSync(path.join(root, 'sub', 'file.txt'), 'file');
    fs.writeFileSync(path.join(root, 'sub', 'inner', 'deep.txt'), 'deep');
    fs.symlinkSync(path.join(root, 'sub', 'inner'), path.join(root, 'sub', 'dirlink'));
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function makeServer(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, opts));
    return app.listen();
}

const allHrefs = (html) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
const hrefOf = (html, name) => {
    const m = new RegExp(`href="([^"]*)"[^>]*>${name}<`).exec(html);
    return m && m[1];
};
const parentHref = (html) => {
    const m = /href="([^"]*)"><b>\.\. Parent Directory/.exec(html);
    return m && m[1];
};

describe('#6 — listing hrefs are path-absolute (no origin, no Host reflection)', () => {
    let server;
    beforeAll(() => { server = makeServer(); });
    afterAll(() => server.close());

    test('no href embeds a scheme or host', async () => {
        const res = await supertest(server).get('/sub/');
        expect(res.status).toBe(200);
        const hrefs = allHrefs(res.text);
        expect(hrefs.length).toBeGreaterThan(0);
        for (const href of hrefs) {
            expect(href.startsWith('/')).toBe(true);
            expect(href).not.toMatch(/^https?:\/\//);
        }
    });

    test('a forged Host header no longer appears anywhere in the listing', async () => {
        const res = await supertest(server).get('/sub/').set('Host', 'evil.example');
        expect(res.status).toBe(200);
        expect(res.text).not.toContain('evil.example');
    });
});

describe('#16 — directories are linked in the canonical /dir/ form', () => {
    let server;
    beforeAll(() => { server = makeServer(); });
    afterAll(() => server.close());

    test('directory entry: href ends with "/" and clicks straight to 200', async () => {
        const res = await supertest(server).get('/sub/');
        const href = hrefOf(res.text, 'inner');
        expect(href).toBe('/sub/inner/');
        const r2 = await supertest(server).get(href);
        expect(r2.status).toBe(200); // pre-#16: 301 hop
        expect(r2.text).toContain('deep.txt');
    });

    test('symlink-to-directory gets the slash too (effectiveType-based)', async () => {
        const res = await supertest(server).get('/sub/');
        const href = hrefOf(res.text, 'dirlink');
        expect(href).toBe('/sub/dirlink/');
        expect((await supertest(server).get(href)).status).toBe(200);
    });

    test('file entries stay slash-less', async () => {
        const res = await supertest(server).get('/sub/');
        expect(hrefOf(res.text, 'file.txt')).toBe('/sub/file.txt');
    });

    test('Parent link from depth 2: canonical /sub/ and a direct 200', async () => {
        const res = await supertest(server).get('/sub/inner/');
        expect(parentHref(res.text)).toBe('/sub/');
        expect((await supertest(server).get('/sub/')).status).toBe(200);
    });

    test('Parent link from depth 1 is exactly "/"', async () => {
        const res = await supertest(server).get('/sub/');
        expect(parentHref(res.text)).toBe('/');
    });
});

describe('#6/#16 — with urlPrefix the canonical forms stay inside the prefix', () => {
    let server;
    beforeAll(() => { server = makeServer({ urlPrefix: '/static' }); });
    afterAll(() => server.close());

    test('directory entry and Parent are path-absolute, slashed, and prefixed', async () => {
        const res = await supertest(server).get('/static/sub/');
        expect(hrefOf(res.text, 'inner')).toBe('/static/sub/inner/');
        expect(parentHref(res.text)).toBe('/static/');
        expect((await supertest(server).get('/static/sub/inner/')).status).toBe(200);
    });
});

describe('#16 — trailingSlash: false keeps working with slashed dir links', () => {
    let server;
    beforeAll(() => { server = makeServer({ dirListing: { trailingSlash: false } }); });
    afterAll(() => server.close());

    test('the /dir/ form serves the listing directly in v3-compat mode too', async () => {
        const res = await supertest(server).get('/sub/');
        const href = hrefOf(res.text, 'inner');
        expect(href).toBe('/sub/inner/');
        expect((await supertest(server).get(href)).status).toBe(200);
    });
});
