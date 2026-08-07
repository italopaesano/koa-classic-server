/**
 * Canonicalization × URL rewriting × urlPrefix — 2026-08 coverage review.
 *
 * Two V4 features build their `Location` from `ctx.originalUrl` REGARDLESS of
 * useOriginalUrl (the code comments call this out as an open-redirect defense:
 * re-parsing originalUrl forces an origin-relative target). useOriginalUrl.test.js
 * only exercises rewriting onto plain files, so nothing asserted what happens
 * when the redirects and the rewriting meet. This file pins that contract:
 *
 *   1. Redirect targets live in ORIGINAL URL space. Under a prefix-stripping
 *      rewriter, GET /it/dir must redirect to /it/dir/ (not to the rewritten
 *      /dir/, which the client cannot resolve), and the hideExtension redirect
 *      must land on /it/page (not /page). Same for a urlPrefix deployment.
 *   2. The trailing-slash decision is keyed on ctx.originalUrl, while path
 *      RESOLUTION uses ctx.url. A rewriter that changes the slash-ness of the
 *      path makes the two disagree — three observable consequences, pinned
 *      here so a future refactor of _pathEndsWithSlash cannot change them
 *      silently.
 *   3. urlPrefix without a trailing slash (GET /static) is the middleware's
 *      logical root and canonicalizes to /static/.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-rewrite-canon-'));
    fs.mkdirSync(path.join(root, 'dir'));
    fs.writeFileSync(path.join(root, 'dir', 'inner.txt'), 'inner');
    fs.writeFileSync(path.join(root, 'file.txt'), 'plain');
    fs.writeFileSync(path.join(root, 'page.ejs'), 'template source');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

// A typical i18n / mount-point rewriter: strips a leading segment from ctx.url
// and leaves ctx.originalUrl untouched.
function stripPrefix(prefix) {
    return async (ctx, next) => {
        if (ctx.url === prefix || ctx.url.startsWith(prefix + '/')) {
            ctx.url = ctx.url.slice(prefix.length) || '/';
        }
        await next();
    };
}

// Rewrites one exact URL onto another — used to force a slash-ness mismatch
// between ctx.originalUrl and ctx.url.
function rewriteExact(from, to) {
    return async (ctx, next) => {
        if (ctx.url === from) ctx.url = to;
        await next();
    };
}

function createApp(opts = {}, upstream) {
    const app = new Koa();
    if (upstream) app.use(upstream);
    app.use(koaClassicServer(root, opts));
    return app.listen();
}

// ─── 1. Redirect targets stay in original-URL space ──────────────────────────

describe('useOriginalUrl:false — redirects target the ORIGINAL url, not the rewritten one', () => {
    let server;
    beforeAll(() => {
        server = createApp(
            { useOriginalUrl: false, hideExtension: { ext: '.ejs' } },
            stripPrefix('/it')
        );
    });
    afterAll(() => server.close());

    test('directory canonicalization: GET /it/dir → 301 /it/dir/ (client-resolvable)', async () => {
        const res = await supertest(server).get('/it/dir');
        expect(res.status).toBe(301);
        // A Location of "/dir/" would point outside the rewriter's mount and
        // 404 on the follow-up request.
        expect(res.headers['location']).toBe('/it/dir/');
    });

    test('the redirect target actually resolves (301 → 200 listing)', async () => {
        const res = await supertest(server).get('/it/dir/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('inner.txt');
    });

    test('hideExtension canonicalization: GET /it/page.ejs → 301 /it/page', async () => {
        const res = await supertest(server).get('/it/page.ejs');
        expect(res.status).toBe(301);
        expect(res.headers['location']).toBe('/it/page');
    });

    test('the clean URL then serves the file (301 → 200)', async () => {
        const res = await supertest(server).get('/it/page');
        expect(res.status).toBe(200);
        // .ejs has no registered MIME type → served as application/octet-stream,
        // so supertest hands the body back as a Buffer rather than res.text.
        expect(res.body.toString()).toBe('template source');
    });
});

describe('urlPrefix — redirects keep the prefix', () => {
    let server;
    beforeAll(() => {
        server = createApp({ urlPrefix: '/static', hideExtension: { ext: '.ejs' } });
    });
    afterAll(() => server.close());

    test('GET /static/dir → 301 /static/dir/', async () => {
        const res = await supertest(server).get('/static/dir');
        expect(res.status).toBe(301);
        expect(res.headers['location']).toBe('/static/dir/');
    });

    test('GET /static/page.ejs → 301 /static/page', async () => {
        const res = await supertest(server).get('/static/page.ejs');
        expect(res.status).toBe(301);
        expect(res.headers['location']).toBe('/static/page');
    });

    // ─── 3. The prefix itself is the logical root ────────────────────────────

    test('GET /static (the bare prefix) → 301 /static/', async () => {
        // The bare prefix resolves to the middleware's logical root directory,
        // so it takes the same canonical trailing-slash redirect any other
        // directory URL takes.
        const res = await supertest(server).get('/static');
        expect(res.status).toBe(301);
        expect(res.headers['location']).toBe('/static/');
    });

    test('GET /static/ serves the root listing', async () => {
        const res = await supertest(server).get('/static/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('Index of /');
    });

    test('a sibling path that merely shares the prefix string falls through', async () => {
        // "/staticky" is NOT under "/static" — segment-wise comparison, not
        // string-prefix comparison.
        const res = await supertest(server).get('/staticky/file.txt');
        expect(res.status).toBe(404); // Koa's own 404: the middleware called next()
        expect(res.headers['content-security-policy']).toBeUndefined();
    });
});

// ─── 2. originalUrl drives the slash decision, ctx.url drives resolution ─────

describe('useOriginalUrl:false — a rewriter that changes slash-ness', () => {
    // These three cases document a real asymmetry: _pathEndsWithSlash is read
    // from ctx.originalUrl (so the redirect it emits is client-resolvable),
    // while the path is resolved from ctx.url. A rewriter that adds or removes
    // a trailing slash therefore drives the canonicalization from the CLIENT's
    // spelling, not from the rewritten one.

    test('rewrite ADDS the slash (/mount → /dir/): still redirects, in client space', async () => {
        const server = createApp({ useOriginalUrl: false }, rewriteExact('/mount', '/dir/'));
        try {
            const res = await supertest(server).get('/mount');
            // ctx.url is already canonical, but the CLIENT's URL is not, and
            // the client's URL is what its relative links resolve against.
            expect(res.status).toBe(301);
            expect(res.headers['location']).toBe('/mount/');
        } finally {
            server.close();
        }
    });

    test('rewrite REMOVES the slash (/mount/ → /dir): served directly, no redirect', async () => {
        const server = createApp({ useOriginalUrl: false }, rewriteExact('/mount/', '/dir'));
        try {
            const res = await supertest(server).get('/mount/');
            // The client's URL already ends in "/", so it is canonical from the
            // browser's point of view — no redirect is owed even though the
            // rewritten path lacks the slash.
            expect(res.status).toBe(200);
            expect(res.text).toContain('inner.txt');
        } finally {
            server.close();
        }
    });

    test('rewrite points a slash-URL at a FILE (/mount/ → /file.txt): 404', async () => {
        const server = createApp({ useOriginalUrl: false }, rewriteExact('/mount/', '/file.txt'));
        try {
            const res = await supertest(server).get('/mount/');
            // The "a file is only reachable without a trailing slash" rule is
            // evaluated against the client's URL: /mount/ reads as directory
            // intent, so the file is not served there.
            expect(res.status).toBe(404);
        } finally {
            server.close();
        }
    });

    test('dirListing.trailingSlash:false disables the whole interaction', async () => {
        const server = createApp(
            { useOriginalUrl: false, dirListing: { trailingSlash: false } },
            rewriteExact('/mount/', '/file.txt')
        );
        try {
            const res = await supertest(server).get('/mount/');
            expect(res.status).toBe(200);
            expect(res.text).toBe('plain');
        } finally {
            server.close();
        }
    });
});
