/**
 * dirListing.enabled vs index resolution — regression matrix (v5.2.0).
 *
 * `dirListing.enabled` governs the LISTING only. Whether a directory has a
 * servable index file is an INDEPENDENT question, and a directory holding one
 * serves it with the listing on or off. Before 5.2.0 the whole index lookup
 * was nested inside the `enabled` branch, so `enabled:false` answered 404 for
 * a directory containing index.html — while `GET /dir/index.html` returned
 * 200, making the 404 an inconsistency that hid nothing.
 *
 * Two invariants are easy to break when touching this dispatch, and both are
 * pinned below:
 *
 *   1. A hidden index counts as ABSENT, never as servable. With the listing
 *      on it falls through to the listing; with the listing off it 404s. It
 *      must never be served, and its name must never leak.
 *   2. A directory that renders nothing 404s WITHOUT a preceding redirect.
 *      301-then-404 would be two responses where one suffices, and the first
 *      would confirm the directory exists — keeping "nothing to render" and
 *      "does not exist" indistinguishable is deliberate.
 *
 * Full matrix (trailing-slash request, unless noted):
 *
 *   enabled | index            | on disk   | expected
 *   --------+------------------+-----------+---------------------------------
 *   true    | ['index.html']   | present   | 200, serves the index
 *   true    | ['index.html']   | absent    | 200, listing
 *   true    | ['index.html']   | hidden    | 200, listing (index not shown)
 *   true    | []               | —         | 200, listing
 *   false   | ['index.html']   | present   | 200, serves the index
 *   false   | ['index.html']   | absent    | 404
 *   false   | ['index.html']   | hidden    | 404
 *   false   | []               | —         | 404
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-idxres-'));

    // Directory WITH an index file
    fs.mkdirSync(path.join(root, 'withIndex'));
    fs.writeFileSync(path.join(root, 'withIndex', 'index.html'), 'INDEX-BODY');
    fs.writeFileSync(path.join(root, 'withIndex', 'sibling.txt'), 'sibling');

    // Directory WITHOUT an index file
    fs.mkdirSync(path.join(root, 'noIndex'));
    fs.writeFileSync(path.join(root, 'noIndex', 'a.txt'), 'a');

    // Directory whose only index is hidden by config
    fs.mkdirSync(path.join(root, 'hiddenIndex'));
    fs.writeFileSync(path.join(root, 'hiddenIndex', 'index.html'), 'SECRET-INDEX');
    fs.writeFileSync(path.join(root, 'hiddenIndex', 'visible.txt'), 'visible');

    // Empty directory (listing renders, but with no rows)
    fs.mkdirSync(path.join(root, 'emptyDir'));
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

// `hiddenIndex/index.html` hidden by path-aware pattern; the sibling stays visible.
const HIDE_INDEX = { hidden: { alwaysHide: ['hiddenIndex/index.html'] } };

// ─── enabled: true ───────────────────────────────────────────────────────────

describe('dirListing.enabled: true', () => {
    let server;
    beforeAll(() => { server = app({ dirListing: { enabled: true } }); });
    afterAll(() => server.close());

    test('index present → 200, serves the index', async () => {
        const res = await supertest(server).get('/withIndex/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('INDEX-BODY');
    });

    test('index absent → 200, listing', async () => {
        const res = await supertest(server).get('/noIndex/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<!DOCTYPE html>');
        expect(res.text).toContain('a.txt');
    });
});

describe('dirListing.enabled: true, index: []', () => {
    let server;
    beforeAll(() => { server = app({ dirListing: { enabled: true }, index: [] }); });
    afterAll(() => server.close());

    test('no index configured → 200, listing even where index.html exists', async () => {
        const res = await supertest(server).get('/withIndex/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<!DOCTYPE html>');
        expect(res.text).toContain('index.html');
    });
});

// ─── enabled: false — the 5.2.0 fix ──────────────────────────────────────────

describe('dirListing.enabled: false', () => {
    let server;
    beforeAll(() => { server = app({ dirListing: { enabled: false } }); });
    afterAll(() => server.close());

    test('index present → 200, serves the index (regression: was 404)', async () => {
        const res = await supertest(server).get('/withIndex/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('INDEX-BODY');
    });

    test('index absent → 404', async () => {
        const res = await supertest(server).get('/noIndex/');
        expect(res.status).toBe(404);
    });

    test('empty directory → 404', async () => {
        const res = await supertest(server).get('/emptyDir/');
        expect(res.status).toBe(404);
    });

    test('serving the index never leaks the listing', async () => {
        const res = await supertest(server).get('/withIndex/');
        expect(res.text).not.toContain('sibling.txt');
    });

    test('HEAD on a directory with an index → 200', async () => {
        const res = await supertest(server).head('/withIndex/');
        expect(res.status).toBe(200);
    });
});

describe('dirListing.enabled: false, index: []', () => {
    let server;
    beforeAll(() => { server = app({ dirListing: { enabled: false }, index: [] }); });
    afterAll(() => server.close());

    test('no index configured → 404 even where index.html exists', async () => {
        const res = await supertest(server).get('/withIndex/');
        expect(res.status).toBe(404);
    });
});

// ─── Hidden index counts as absent ───────────────────────────────────────────

describe('hidden index is treated as absent, never served', () => {
    let listingOn, listingOff;
    beforeAll(() => {
        listingOn = app({ dirListing: { enabled: true }, ...HIDE_INDEX });
        listingOff = app({ dirListing: { enabled: false }, ...HIDE_INDEX });
    });
    afterAll(() => { listingOn.close(); listingOff.close(); });

    test('listing on → falls through to the listing, index not served nor listed', async () => {
        const res = await supertest(listingOn).get('/hiddenIndex/');
        expect(res.status).toBe(200);
        expect(res.text).not.toContain('SECRET-INDEX');
        expect(res.text).not.toContain('index.html');
        expect(res.text).toContain('visible.txt');
    });

    test('listing off → 404, index not served', async () => {
        const res = await supertest(listingOff).get('/hiddenIndex/');
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('SECRET-INDEX');
    });

    test('listing off → GET /hiddenIndex (no slash) 404s without a redirect', async () => {
        const res = await supertest(listingOff).get('/hiddenIndex').redirects(0);
        expect(res.status).toBe(404);
        expect(res.headers.location).toBeUndefined();
    });

    test('the hidden index stays 404 at its own URL', async () => {
        const res = await supertest(listingOff).get('/hiddenIndex/index.html');
        expect(res.status).toBe(404);
    });
});

// ─── Interaction with the canonical trailing-slash redirect ──────────────────

describe('trailingSlash interaction, listing disabled', () => {
    let server;
    beforeAll(() => { server = app({ dirListing: { enabled: false } }); });
    afterAll(() => server.close());

    test('index present → GET /dir redirects 301 to /dir/', async () => {
        const res = await supertest(server).get('/withIndex').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/withIndex/');
    });

    test('index absent → GET /dir 404s directly, never 301-then-404', async () => {
        const res = await supertest(server).get('/noIndex').redirects(0);
        expect(res.status).toBe(404);
        expect(res.headers.location).toBeUndefined();
    });

    test('a directory with nothing to render is indistinguishable from a missing one', async () => {
        const present = await supertest(server).get('/noIndex').redirects(0);
        const missing = await supertest(server).get('/doesNotExist').redirects(0);
        expect(present.status).toBe(missing.status);
        expect(present.text).toBe(missing.text);
    });

    test('query string is preserved through the redirect', async () => {
        const res = await supertest(server).get('/withIndex?a=1').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/withIndex/?a=1');
    });
});

describe('trailingSlash: false, listing disabled', () => {
    let server;
    beforeAll(() => {
        server = app({ dirListing: { enabled: false, trailingSlash: false } });
    });
    afterAll(() => server.close());

    test('index present → served at /dir (no slash), no redirect', async () => {
        const res = await supertest(server).get('/withIndex').redirects(0);
        expect(res.status).toBe(200);
        expect(res.text).toBe('INDEX-BODY');
    });

    test('index present → served at /dir/ too', async () => {
        const res = await supertest(server).get('/withIndex/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('INDEX-BODY');
    });

    test('index absent → 404 at both forms', async () => {
        expect((await supertest(server).get('/noIndex').redirects(0)).status).toBe(404);
        expect((await supertest(server).get('/noIndex/')).status).toBe(404);
    });
});

// ─── Root directory ──────────────────────────────────────────────────────────

describe('root directory, listing disabled', () => {
    let withRootIndex, withoutRootIndex, rootWithIndex;

    beforeAll(() => {
        rootWithIndex = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-idxroot-'));
        fs.writeFileSync(path.join(rootWithIndex, 'index.html'), 'ROOT-INDEX');

        const a = new Koa();
        a.on('error', () => {});
        a.use(koaClassicServer(rootWithIndex, { index: ['index.html'], dirListing: { enabled: false } }));
        withRootIndex = a.listen();

        withoutRootIndex = app({ dirListing: { enabled: false } }); // fixture root has no index.html
    });
    afterAll(() => {
        withRootIndex.close();
        withoutRootIndex.close();
        fs.rmSync(rootWithIndex, { recursive: true, force: true });
    });

    test('GET / with a root index → 200, serves it', async () => {
        const res = await supertest(withRootIndex).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('ROOT-INDEX');
    });

    test('GET / without a root index → 404', async () => {
        const res = await supertest(withoutRootIndex).get('/');
        expect(res.status).toBe(404);
    });
});

// ─── RegExp index patterns (the readdir path of findIndexFile) ───────────────

describe('RegExp index patterns, listing disabled', () => {
    let server;
    beforeAll(() => {
        server = app({ dirListing: { enabled: false }, index: [/^index\.html$/] });
    });
    afterAll(() => server.close());

    test('RegExp match → 200, serves the index', async () => {
        const res = await supertest(server).get('/withIndex/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('INDEX-BODY');
    });

    test('no RegExp match → 404', async () => {
        const res = await supertest(server).get('/noIndex/');
        expect(res.status).toBe(404);
    });
});
