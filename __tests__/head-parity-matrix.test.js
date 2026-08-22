/**
 * HEAD/GET parity matrix — RFC 9110 §9.3.2 as an enforced invariant.
 *
 * WHY THIS FILE EXISTS
 *
 * The project has fixed the same bug twice: a new response branch was added and
 * nobody thought about HEAD, so HEAD answered Koa's default 404 while GET
 * answered 200 (3.0.1: template branch; 4.0.0: streaming-compression branch).
 * Per-branch tests cannot catch that class, because a per-branch HEAD test only
 * exists if someone remembered HEAD — which is exactly what did not happen.
 *
 * This file is the countermeasure: ONE table, one row per response branch, each
 * row annotated with the branch it pins. It is deliberately a visible inventory
 * of the HEAD-relevant branches, so that a newly added branch with no row here
 * is conspicuous in review.
 *
 * Rows are annotated with a grep anchor, not a line number. The first draft of
 * this file used line numbers and they were already wrong at merge time — the
 * same commit added lines above them, so one label pointed at a different branch
 * than the one its row exercises. An inventory that misdirects is worse than one
 * that makes the reader search.
 *
 * WHAT IT PINS BEYOND THE STATUS MIRROR
 *
 * The three compression branches make DIFFERENT — and deliberate — choices about
 * Content-Length on HEAD:
 *
 *   - buffered (compressedFile cache on): runs the full compression so it can
 *     send a real Content-Length. The CPU cost of a cold HEAD is accepted, on
 *     purpose, because the accurate length is the header HEAD clients want most.
 *   - streaming (cache off) and streaming-above-compression.maxFileSize:
 *     short-circuit instead — status 200, no compression, NO Content-Length.
 *     That omission is the derogation RFC 9110 §9.3.2 grants for headers
 *     computable only by generating the content.
 *
 * Until this file existed that asymmetry lived only in code comments. It is now
 * asserted — with one honest limit, established by mutation-testing this file
 * against deliberately broken builds:
 *
 *   CAUGHT — HEAD answering 404 where GET answers 200, on every branch. Both
 *     historical bugs were reproduced (3.0.1: drop the ctx.method masking in
 *     tryRenderTemplate; 4.0.0: drop the explicit HEAD status on the streaming
 *     branch) and both fail here.
 *   CAUGHT — the buffered path losing its real Content-Length: short-circuiting
 *     it like the streaming branches fails the buffered row.
 *   CAUGHT — the default silently reverting to ['GET']: nearly every row fails.
 *   CAUGHT — stripBodyForHead() publishing a Content-Length that GET did not
 *     send. Koa's respond() fills a missing Content-Length in on HEAD from
 *     ctx.response.length, so replacing a STREAM body with an empty Buffer
 *     reports 0 where GET reports the render's declared length, or nothing at
 *     all. The three body-shape rows (stream, sized stream, object) pin it.
 *   NOT CAUGHT — the streaming branches losing their INTERNAL short-circuit,
 *     i.e. running the compression on HEAD and discarding it. That mutation
 *     leaves a byte-identical response: Node strips a HEAD body at the transport
 *     layer, and the abandoned tee never reaches the compressed cache, so the
 *     wasted CPU has no black-box signature. That optimization is guarded by the
 *     code comments at those branches, NOT by this file — a reviewer removing it
 *     will not be stopped here.
 *
 * COLD CACHE PER REQUEST
 *
 * Every row issues its GET and its HEAD against SEPARATE middleware instances.
 * The compressed cache lives inside the factory closure, so a fresh instance is
 * a cold cache. This matters: a GET on the streaming-above-cap path tees its
 * output into the cache, and a HEAD reusing that instance would hit a WARM entry
 * and report a Content-Length — masking the very short-circuit the row exists to
 * pin.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let ROOT;

beforeAll(() => {
    ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-head-parity-'));
    fs.writeFileSync(path.join(ROOT, 'plain.txt'), 'p'.repeat(300));    // < compression.minFileSize (1024)
    fs.writeFileSync(path.join(ROOT, 'asset.txt'), 'A'.repeat(4096));   // > minFileSize → compressible
    fs.writeFileSync(path.join(ROOT, 'big.txt'), 'B'.repeat(60000));    // > the lowered maxFileSize below
    fs.writeFileSync(path.join(ROOT, 'page.tpl'), 'template source');
    fs.mkdirSync(path.join(ROOT, 'dir'));
    fs.writeFileSync(path.join(ROOT, 'dir', 'inner.txt'), 'inner');
});

afterAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
});

// A method-AWARE render: produces a body only on GET. This is the real-world
// pattern that exposed the 3.0.1 bug — on HEAD it never sets ctx.body, so
// without tryRenderTemplate()'s method masking the status stays at Koa's 404.
const methodAwareRender = async (ctx, next, filePath) => {
    if (ctx.method !== 'GET') return;
    ctx.type = 'text/html';
    ctx.body = '<h1>' + path.basename(filePath) + '</h1>';
};

// One request against a FRESH middleware instance (see "COLD CACHE PER REQUEST").
async function once(opts, method, reqPath, headers) {
    const app = new Koa();
    app.on('error', () => {});
    app.use(koaClassicServer(ROOT, opts));
    const server = app.listen();
    try {
        let req = supertest(server)[method](reqPath).redirects(0);
        for (const [k, v] of Object.entries(headers || {})) req = req.set(k, v);
        return await req;
    } finally {
        server.close();
    }
}

// Render body SHAPES. stripBodyForHead() has to report the length GET would have
// reported for each of them — and report none where GET would have been chunked.
const streamRender = async (ctx, next, filePath) => {
    if (ctx.method !== 'GET') return;
    ctx.type = 'text/plain';
    ctx.body = fs.createReadStream(filePath);          // chunked: GET carries no Content-Length
};
const sizedStreamRender = async (ctx, next, filePath) => {
    if (ctx.method !== 'GET') return;
    ctx.type = 'text/plain';
    ctx.body = fs.createReadStream(filePath);
    ctx.length = fs.statSync(filePath).size;           // the render declares its own framing
};
const objectRender = async (ctx) => {
    if (ctx.method !== 'GET') return;
    ctx.body = { hello: 'world', n: 42 };              // Koa JSON-serializes and sizes it
};
const circularRender = async (ctx) => {
    if (ctx.method !== 'GET') return;
    const o = { a: 1 };
    o.self = o;                                        // JSON.stringify throws on it
    ctx.body = o;                                      // GET fails inside Koa's respond() → 500
};

const CACHE_OFF = { serverCache: { compressedFile: { enabled: false } } };
const CAP_LOW = { compression: { maxFileSize: 8192 } };
const TEMPLATE = { template: { ext: ['.tpl'], render: methodAwareRender } };
const ETAGS = { browserCacheEnabled: true };

// ─── The matrix ──────────────────────────────────────────────────────────────
// contentLength: 'mirrors' → HEAD's value must equal GET's (both absent is a pass)
//                'absent'  → neither GET nor HEAD may carry one (§9.3.2 derogation)
const ROWS = [
    {
        branch: 'uncompressed — index.cjs grep: "── Uncompressed response"',
        opts: {}, path: '/plain.txt', headers: { 'Accept-Encoding': 'identity' },
        status: 200, contentLength: 'mirrors',
    },
    {
        branch: 'Range → 206 partial — index.cjs grep: "ctx.status = 206"',
        opts: {}, path: '/big.txt', headers: { 'Accept-Encoding': 'identity', Range: 'bytes=0-99' },
        status: 206, contentLength: 'mirrors',
    },
    {
        branch: 'unsatisfiable Range → 416 — index.cjs grep: "ctx.status = 416"',
        opts: {}, path: '/big.txt', headers: { 'Accept-Encoding': 'identity', Range: 'bytes=999999-' },
        status: 416, contentLength: 'mirrors',
    },
    {
        branch: 'conditional request → 304 (browserCacheEnabled)',
        opts: ETAGS, path: '/plain.txt', headers: { 'Accept-Encoding': 'identity' },
        // If-None-Match is filled in from a priming GET (the ETag is a property
        // of the file, so any instance yields the same validator).
        etagConditional: true,
        status: 304, contentLength: 'mirrors',
    },
    {
        branch: 'compressed BUFFERED (cache on): real Content-Length, compression runs on HEAD — index.cjs grep: "set correct Content-Length; body assignment"',
        opts: {}, path: '/asset.txt', headers: { 'Accept-Encoding': 'gzip' },
        status: 200, contentLength: 'mirrors',
    },
    {
        branch: 'compressed STREAMING (cache off): HEAD short-circuits, no Content-Length — index.cjs grep: "Streaming mode (compressed cache disabled)"',
        opts: CACHE_OFF, path: '/asset.txt', headers: { 'Accept-Encoding': 'gzip' },
        status: 200, contentLength: 'absent',
    },
    {
        branch: 'compressed STREAMING above compression.maxFileSize: HEAD short-circuits — index.cjs grep: "without running"',
        opts: CAP_LOW, path: '/big.txt', headers: { 'Accept-Encoding': 'gzip' },
        status: 200, contentLength: 'absent',
    },
    {
        branch: 'tryRenderTemplate() — template render with a method-AWARE render fn',
        opts: TEMPLATE, path: '/page.tpl', headers: { 'Accept-Encoding': 'identity' },
        status: 200, contentLength: 'mirrors',
    },
    {
        branch: 'stripBodyForHead() — render body is a STREAM with no declared length (GET is chunked)',
        opts: { template: { ext: ['.tpl'], render: streamRender } },
        path: '/page.tpl', headers: { 'Accept-Encoding': 'identity' },
        status: 200, contentLength: 'absent',
    },
    {
        branch: 'stripBodyForHead() — render body is a STREAM with a declared Content-Length',
        opts: { template: { ext: ['.tpl'], render: sizedStreamRender } },
        path: '/page.tpl', headers: { 'Accept-Encoding': 'identity' },
        status: 200, contentLength: 'mirrors',
    },
    {
        branch: 'stripBodyForHead() — render body is a plain OBJECT (Koa JSON-serializes it)',
        opts: { template: { ext: ['.tpl'], render: objectRender } },
        path: '/page.tpl', headers: { 'Accept-Encoding': 'identity' },
        status: 200, contentLength: 'mirrors',
    },
    {
        // Mirroring the FAILURE matters as much as mirroring the success: the body
        // is left in place so Koa fails on HEAD exactly where it fails on GET,
        // instead of HEAD answering a cheerful 200 with no body.
        branch: 'stripBodyForHead() — render body is UNSERIALIZABLE (circular): HEAD mirrors the 500',
        opts: { template: { ext: ['.tpl'], render: circularRender } },
        path: '/page.tpl', headers: { 'Accept-Encoding': 'identity' },
        status: 500, contentLength: 'mirrors',
    },
    {
        branch: 'dirListing.trailingSlash — directory without slash → 301',
        opts: {}, path: '/dir', headers: { 'Accept-Encoding': 'identity' },
        status: 301, contentLength: 'mirrors',
    },
    {
        branch: 'directory listing → 200 HTML',
        opts: {}, path: '/dir/', headers: { 'Accept-Encoding': 'identity' },
        status: 200, contentLength: 'mirrors',
    },
    {
        branch: 'dirListing.trailingSlash — file WITH a trailing slash → 404',
        opts: {}, path: '/plain.txt/', headers: { 'Accept-Encoding': 'identity' },
        status: 404, contentLength: 'mirrors',
    },
    {
        branch: 'non-existent path → 404 error page',
        opts: {}, path: '/missing.txt', headers: { 'Accept-Encoding': 'identity' },
        status: 404, contentLength: 'mirrors',
    },
];

describe('HEAD mirrors GET on every response branch (RFC 9110 §9.3.2)', () => {
    test.each(ROWS.map(r => [r.branch, r]))('%s', async (_label, row) => {
        let headers = row.headers;

        if (row.etagConditional) {
            const priming = await once(row.opts, 'get', row.path, row.headers);
            expect(priming.headers.etag).toBeTruthy();
            headers = { ...row.headers, 'If-None-Match': priming.headers.etag };
        }

        const get = await once(row.opts, 'get', row.path, headers);
        const head = await once(row.opts, 'head', row.path, headers);

        // 1. The core §9.3.2 requirement: the statuses cannot diverge.
        expect(get.status).toBe(row.status);
        expect(head.status).toBe(row.status);

        // 2. HEAD sends no body.
        expect(head.text).toBeFalsy();

        // 3. Content-Length follows the branch's documented policy.
        if (row.contentLength === 'absent') {
            expect(get.headers['content-length']).toBeUndefined();
            expect(head.headers['content-length']).toBeUndefined();
        } else {
            expect(head.headers['content-length']).toBe(get.headers['content-length']);
        }

        // 4. Content-Type mirrors GET wherever GET carries one.
        if (get.headers['content-type']) {
            expect(head.headers['content-type']).toBe(get.headers['content-type']);
        }
    });
});

// The inventory is only worth having if its pointers resolve. The first draft
// used line numbers and they were stale on arrival; grep anchors do not drift
// with unrelated edits, but they DO rot when the comment or statement they quote
// is reworded. This makes that rot a test failure instead of a silent lie.
describe('the branch anchors in this file still resolve', () => {
    test('every "index.cjs grep:" anchor matches exactly once in index.cjs', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'index.cjs'), 'utf8');
        const anchors = [...ROWS.map(r => r.branch).join('\n').matchAll(/index\.cjs grep: "([^"]+)"/g)]
            .map(m => m[1]);

        expect(anchors.length).toBeGreaterThan(0);
        for (const anchor of anchors) {
            expect({ anchor, occurrences: src.split(anchor).length - 1 })
                .toEqual({ anchor, occurrences: 1 });
        }
    });
});

describe('the default configuration is RFC 9110 §9.1 conformant out of the box', () => {
    test('HEAD needs no opt-in: it works with no options at all', async () => {
        const get = await once({}, 'get', '/plain.txt', {});
        const head = await once({}, 'head', '/plain.txt', {});

        expect(get.status).toBe(200);
        expect(head.status).toBe(200);
        expect(head.text).toBeFalsy();
    });

    test('verbs beyond GET/HEAD still fall through to next() — no 405 from the middleware', async () => {
        // Composability contract: the middleware cannot know whether a downstream
        // router handles POST, so it must not answer 405 itself. 405 + Allow is
        // the composed application's responsibility (RFC 9110 §15.5.6).
        const res = await once({}, 'post', '/plain.txt', {});

        expect(res.status).toBe(404);              // Koa's own 404, not the middleware's page
        expect(res.headers['content-security-policy']).toBeUndefined();
        expect(res.headers.allow).toBeUndefined();
    });
});
