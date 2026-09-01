/**
 * template.render — the response contract. 2026-09 coverage review.
 *
 * template-timeout.test.js covers the render's LIFECYCLE (argument order, the
 * AbortSignal, timeouts, throws, late rejections) and ejs.test.js covers a real
 * engine producing real HTML. Neither covers the contract in between: what the
 * middleware does with whatever the render leaves on `ctx`, and what the
 * middleware stops doing once a render has run.
 *
 * Two halves, both currently unasserted:
 *
 *   1. `tryRenderTemplate` returns true as soon as the extension matches, so
 *      the response is whatever the render made it — including "nothing", which
 *      is Koa's default 404 rather than a fallback to serving the file raw. An
 *      explicit 404, a 204, a redirect, an object body, a stream body and a
 *      call to next() are all honored as-is.
 *
 *   2. The whole static-response machinery is BYPASSED. A rendered page gets no
 *      compression, no Vary, no ETag / Last-Modified, no Cache-Control, no
 *      Accept-Ranges, no Content-Disposition and no staticSecurityHeaders —
 *      even when those options are switched on. Range and If-None-Match are
 *      inert on a template URL. That is the intended division of labour (the
 *      render owns its response), and an operator who turns on
 *      browserCacheEnabled or compression could reasonably expect otherwise,
 *      so the boundary is pinned here.
 *
 * Gatekeeping that runs BEFORE the render (hidden, canonical trailing slash) is
 * asserted to still apply, with the render proved un-invoked.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-tpl-contract-'));
    fs.writeFileSync(path.join(root, 'page.ejs'), 'RAW SOURCE ON DISK');
    fs.writeFileSync(path.join(root, 'plain.txt'), 'PLAIN');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

// A server whose template renderer is `render`; a downstream middleware answers
// 599 so "the render called next()" is distinguishable from everything else.
function makeServer(render, opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, {
        index: [],
        logger: { warn: () => {}, error: () => {} },
        ...opts,
        template: { ext: ['.ejs'], render, ...(opts.template || {}) },
    }));
    app.use(async (ctx) => { ctx.status = 599; ctx.body = 'DOWNSTREAM'; });
    return app.callback();
}

const html = (body) => async (ctx) => { ctx.type = 'text/html'; ctx.body = body; };

// ─── whatever the render leaves on ctx is the response ───────────────────────

describe('the render owns the response', () => {
    test('a render that sets NOTHING yields Koa\'s 404 — the file is not served raw as a fallback', async () => {
        const server = makeServer(async () => { /* no-op */ });
        const res = await supertest(server).get('/page.ejs');
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('RAW SOURCE ON DISK');
    });

    test('a status with no body is honored (204, empty)', async () => {
        const server = makeServer(async (ctx) => { ctx.status = 204; });
        const res = await supertest(server).get('/page.ejs');
        expect(res.status).toBe(204);
        expect(res.text).toBe('');
    });

    test('a redirect set by the render is emitted as-is', async () => {
        const server = makeServer(async (ctx) => { ctx.redirect('/elsewhere'); });
        const res = await supertest(server).get('/page.ejs').redirects(0);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/elsewhere');
    });

    test('an explicit 404 from the render is NOT replaced by the built-in error page', async () => {
        const server = makeServer(async (ctx) => {
            ctx.status = 404;
            ctx.type = 'text/plain';
            ctx.body = 'the template says no';
        });
        const res = await supertest(server).get('/page.ejs');
        expect(res.status).toBe(404);
        expect(res.text).toBe('the template says no');
        expect(res.headers['content-security-policy']).toBeUndefined();
    });

    test('an object body is serialized by Koa as JSON', async () => {
        const server = makeServer(async (ctx) => { ctx.body = { rendered: true }; });
        const res = await supertest(server).get('/page.ejs');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/json');
        expect(res.body).toEqual({ rendered: true });
    });

    test('a stream body is streamed', async () => {
        const server = makeServer(async (ctx) => {
            ctx.type = 'text/plain';
            ctx.body = fs.createReadStream(path.join(root, 'plain.txt'));
        });
        const res = await supertest(server).get('/page.ejs');
        expect(res.status).toBe(200);
        expect(res.text).toBe('PLAIN');
    });

    test('a return value from the render is ignored — only ctx matters', async () => {
        const server = makeServer((ctx) => {
            ctx.type = 'text/plain';
            ctx.body = 'FROM CTX';
            return 'this return value goes nowhere';
        });
        const res = await supertest(server).get('/page.ejs');
        expect(res.text).toBe('FROM CTX');
    });

    test('a render that calls next() hands the request to downstream middleware', async () => {
        const server = makeServer(async (_ctx, next) => { await next(); });
        const res = await supertest(server).get('/page.ejs');
        expect(res.status).toBe(599);
        expect(res.text).toBe('DOWNSTREAM');
    });

    test('a non-matching extension never reaches the render at all', async () => {
        let called = 0;
        const server = makeServer(async (ctx) => { called++; ctx.body = 'x'; });
        const res = await supertest(server).get('/plain.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('PLAIN');
        expect(called).toBe(0);
    });
});

// ─── HEAD parity across the render ───────────────────────────────────────────

describe('HEAD on a template URL', () => {
    // The render observes ctx.method as GET (RFC 9110 §9.3.2: HEAD must produce
    // the same status and headers as GET), then the body is stripped.
    const echoMethod = async (ctx) => {
        ctx.set('X-Seen-Method', ctx.method);
        ctx.type = 'text/html';
        ctx.body = '<h1>rendered</h1>';
    };

    test('the render sees GET, so it takes exactly the GET path', async () => {
        const server = makeServer(echoMethod);
        const res = await supertest(server).head('/page.ejs');
        expect(res.status).toBe(200);
        expect(res.headers['x-seen-method']).toBe('GET');
    });

    test('the status and Content-Type mirror the GET response, and no body is sent', async () => {
        const server = makeServer(echoMethod);
        const get = await supertest(server).get('/page.ejs');
        const head = await supertest(server).head('/page.ejs');
        expect(head.status).toBe(get.status);
        expect(head.headers['content-type']).toBe(get.headers['content-type']);
        expect(head.text).toBeFalsy();
    });

    test('the GET disguise does not leak: an UPSTREAM middleware sees HEAD again afterwards', async () => {
        // The render runs with ctx.method temporarily set to 'GET'. A middleware
        // wrapping this one must observe the real verb once the render is done,
        // otherwise every logger, metric and CORS layer above would mis-record
        // every template request as a GET.
        let methodAfter = null;
        const app = new Koa();
        app.use(async (ctx, next) => {
            await next();
            methodAfter = ctx.method;
        });
        app.use(koaClassicServer(root, {
            index: [],
            logger: { warn: () => {}, error: () => {} },
            template: { ext: ['.ejs'], render: echoMethod },
        }));

        const res = await supertest(app.callback()).head('/page.ejs');
        expect(res.headers['x-seen-method']).toBe('GET'); // inside the render
        expect(methodAfter).toBe('HEAD');                  // outside it
    });

    test('the disguise is restored even when the render throws', async () => {
        let methodAfter = null;
        const app = new Koa();
        app.use(async (ctx, next) => {
            await next();
            methodAfter = ctx.method;
        });
        app.use(koaClassicServer(root, {
            index: [],
            logger: { warn: () => {}, error: () => {} },
            template: { ext: ['.ejs'], render: async () => { throw new Error('boom'); } },
        }));

        const res = await supertest(app.callback()).head('/page.ejs');
        expect(res.status).toBe(500);
        expect(methodAfter).toBe('HEAD');
    });

    test('a render that sets nothing gives HEAD the same 404 GET gets', async () => {
        const server = makeServer(async () => {});
        const get = await supertest(server).get('/page.ejs');
        const head = await supertest(server).head('/page.ejs');
        expect(head.status).toBe(get.status);
        expect(head.status).toBe(404);
    });
});

// ─── the static machinery does not apply to rendered output ──────────────────

describe('rendered output bypasses the static-response machinery', () => {
    // Every static-side option below is switched ON, so each absent header is a
    // deliberate bypass rather than an unset default.
    const OPTS = {
        browserCacheEnabled: true,
        staticSecurityHeaders: { nosniff: true },
        compression: { minFileSize: 0 },
    };
    const BIG = '<h1>' + 'R'.repeat(4000) + '</h1>'; // well past any compression threshold

    let server;
    beforeAll(() => { server = makeServer(html(BIG), OPTS); });

    test('no compression and no Vary, even with a large compressible body', async () => {
        const res = await supertest(server).get('/page.ejs').set('Accept-Encoding', 'gzip, br');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers.vary).toBeUndefined();
    });

    test('no ETag / Last-Modified / Cache-Control, even with browserCacheEnabled', async () => {
        const res = await supertest(server).get('/page.ejs');
        expect(res.headers.etag).toBeUndefined();
        expect(res.headers['last-modified']).toBeUndefined();
        expect(res.headers['cache-control']).toBeUndefined();
    });

    test('no Accept-Ranges and no Content-Disposition', async () => {
        const res = await supertest(server).get('/page.ejs');
        expect(res.headers['accept-ranges']).toBeUndefined();
        expect(res.headers['content-disposition']).toBeUndefined();
    });

    test('staticSecurityHeaders.nosniff does NOT reach template output', async () => {
        // Documented: hardening a rendered page is the render function's job.
        const res = await supertest(server).get('/page.ejs');
        expect(res.headers['x-content-type-options']).toBeUndefined();
    });

    test('a Range request is inert — full 200, no 206, no Content-Range', async () => {
        const res = await supertest(server).get('/page.ejs').set('Range', 'bytes=0-4');
        expect(res.status).toBe(200);
        expect(res.headers['content-range']).toBeUndefined();
        expect(res.text).toBe(BIG);
    });

    test('If-None-Match is inert — the render always runs', async () => {
        let renders = 0;
        const s = makeServer(async (ctx) => { renders++; ctx.type = 'text/html'; ctx.body = 'x'; }, OPTS);
        await supertest(s).get('/page.ejs');
        const res = await supertest(s).get('/page.ejs').set('If-None-Match', '*');
        expect(res.status).toBe(200);
        expect(renders).toBe(2);
    });

    test('the render is free to set those headers itself', async () => {
        const s = makeServer(async (ctx) => {
            ctx.set('Cache-Control', 'public, max-age=60');
            ctx.set('X-Content-Type-Options', 'nosniff');
            ctx.type = 'text/html';
            ctx.body = 'ok';
        }, OPTS);
        const res = await supertest(s).get('/page.ejs');
        expect(res.headers['cache-control']).toBe('public, max-age=60');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
});

// ─── gatekeeping that runs before the render ─────────────────────────────────

describe('checks that precede the render still apply', () => {
    test('a hidden template is a 404 and the render is never invoked', async () => {
        let called = 0;
        const server = makeServer(
            async (ctx) => { called++; ctx.body = 'LEAKED'; },
            { hidden: { alwaysHide: ['page.ejs'] } },
        );
        const res = await supertest(server).get('/page.ejs');
        expect(res.status).toBe(404);
        expect(called).toBe(0);
    });

    test('the canonical trailing-slash 404 precedes the render', async () => {
        let called = 0;
        const server = makeServer(async (ctx) => { called++; ctx.body = 'x'; });
        const res = await supertest(server).get('/page.ejs/').redirects(0);
        expect(res.status).toBe(404);
        expect(called).toBe(0);
    });

    test('a path outside rootDir never reaches the render', async () => {
        let called = 0;
        const server = makeServer(async (ctx) => { called++; ctx.body = 'x'; });
        const res = await supertest(server).get('/../../etc/passwd.ejs');
        expect(res.status).toBe(404);
        expect(called).toBe(0);
    });

    test('a urlsReserved path falls through before the render', async () => {
        let called = 0;
        const server = makeServer(
            async (ctx) => { called++; ctx.body = 'x'; },
            { urlsReserved: ['/page.ejs'] },
        );
        const res = await supertest(server).get('/page.ejs');
        expect(res.status).toBe(599);
        expect(called).toBe(0);
    });
});
