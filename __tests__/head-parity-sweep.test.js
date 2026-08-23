/**
 * HEAD/GET parity SWEEP — the systematic complement to head-parity-matrix.test.js.
 *
 * The matrix is a curated inventory: one row per response branch, hand-written,
 * and therefore limited to the branches somebody thought to list. This file is the
 * other half — a cross-product of configurations and requests, asserting parity on
 * every combination without anyone deciding in advance which combinations matter.
 * It is to the matrix what the property tests are to the example tests.
 *
 * The value is in what it does NOT need to know. It found no defects when it was
 * written — after three review passes that each found several — which is the point:
 * it converts "we reviewed the branches we could think of" into "we compared every
 * combination in the grid".
 *
 * TWO EXEMPTIONS, and only two. Anything else diverging is a failure.
 *
 *   1. Koa's own fall-through 404. When the middleware declines a request
 *      (urlPrefix miss, reserved path, unlisted verb) it calls next(), and with
 *      nothing downstream Koa answers its own "Not Found". Koa does not synthesize
 *      that status-message body on HEAD, so it cannot size it: GET carries
 *      Content-Length/Content-Type, HEAD carries neither. Reproduced on bare Koa
 *      with no middleware at all — not this middleware's response, and not its bug.
 *      Detected by the absence of the CSP header that every generated page of this
 *      middleware carries.
 *
 *   2. Transfer-Encoding on the streaming-compression branches. GET is chunked;
 *      HEAD, having no body, has no framing to describe and sends neither
 *      Transfer-Encoding nor Content-Length. That is the RFC 9110 §9.3.2 derogation
 *      for headers determined only while generating the content.
 *
 * Both exemptions are narrow on purpose: each names the exact header it forgives
 * and the exact condition under which it applies, so a genuine regression cannot
 * hide inside one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let ROOT;

beforeAll(() => {
    ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-head-sweep-'));
    fs.writeFileSync(path.join(ROOT, 'small.txt'), 's'.repeat(300));    // below compression.minFileSize
    fs.writeFileSync(path.join(ROOT, 'asset.txt'), 'A'.repeat(4096));   // compressible
    fs.writeFileSync(path.join(ROOT, 'big.txt'), 'B'.repeat(60000));    // above the lowered maxFileSize
    fs.writeFileSync(path.join(ROOT, 'zero.txt'), '');                  // zero-length edge
    fs.writeFileSync(path.join(ROOT, '.secret'), 'hidden');             // dot-file
    fs.writeFileSync(path.join(ROOT, 'page.html'), '<h1>p</h1>');
    fs.writeFileSync(path.join(ROOT, 'page.tpl'), 'template source');
    fs.mkdirSync(path.join(ROOT, 'dir'));
    for (let i = 0; i < 150; i++) {                                     // enough to paginate
        fs.writeFileSync(path.join(ROOT, 'dir', `f${i}.txt`), 'x');
    }
});

afterAll(() => {
    fs.rmSync(ROOT, { recursive: true, force: true });
});

// A method-AWARE render: it produces a body only on GET. This is the pattern that
// exposed the 3.0.1 bug, and without it the grid cannot reach the template branch
// at all — verified by mutation: removing tryRenderTemplate()'s method masking
// left this sweep entirely green until this config existed.
const methodAwareRender = async (ctx, next, filePath) => {
    if (ctx.method !== 'GET') return;
    ctx.type = 'text/html';
    ctx.body = '<h1>' + path.basename(filePath) + '</h1>';
};

const CONFIGS = {
    'default': {},
    'template engine': { template: { ext: ['.tpl'], render: methodAwareRender } },
    'template + index': { template: { ext: ['.tpl'], render: methodAwareRender }, index: ['page.tpl'] },
    'rawFile cache on': { serverCache: { rawFile: { enabled: true } } },
    'compressed cache off': { serverCache: { compressedFile: { enabled: false } } },
    'low compression.maxFileSize': { compression: { maxFileSize: 8192 } },
    'browserCache on': { browserCacheEnabled: true },
    'rawFile + browserCache': { serverCache: { rawFile: { enabled: true } }, browserCacheEnabled: true },
    'custom error page': { errorPages: { 404: path.join(__dirname, '..', 'README.md') } },
    'hideExtension .html': { hideExtension: { ext: '.html' } },
    'dirListing off': { dirListing: { enabled: false } },
    'dot-files hidden': { hidden: { dotFiles: { default: 'hidden' } } },
    'symlinks deny': { symlinks: 'deny' },
    'urlPrefix /p': { urlPrefix: '/p' },
    'index configured': { index: ['page.html'] },
};

const REQUESTS = [
    ['/small.txt', { 'Accept-Encoding': 'identity' }],
    ['/small.txt', { 'Accept-Encoding': 'gzip' }],
    ['/asset.txt', { 'Accept-Encoding': 'gzip' }],
    ['/asset.txt', { 'Accept-Encoding': 'br' }],
    ['/big.txt', { 'Accept-Encoding': 'gzip' }],
    ['/big.txt', { 'Accept-Encoding': 'identity', Range: 'bytes=0-99' }],
    ['/big.txt', { 'Accept-Encoding': 'gzip', Range: 'bytes=0-99' }],
    ['/big.txt', { 'Accept-Encoding': 'identity', Range: 'bytes=-50' }],
    ['/big.txt', { 'Accept-Encoding': 'identity', Range: 'bytes=999999-' }],
    ['/big.txt', { 'Accept-Encoding': 'identity', Range: 'not-a-range' }],
    ['/zero.txt', { 'Accept-Encoding': 'identity' }],
    ['/zero.txt', { 'Accept-Encoding': 'identity', Range: 'bytes=0-10' }],
    ['/.secret', { 'Accept-Encoding': 'identity' }],
    ['/dir', { 'Accept-Encoding': 'identity' }],
    ['/dir/', { 'Accept-Encoding': 'identity' }],
    ['/dir/?page=1', { 'Accept-Encoding': 'identity' }],
    ['/dir/?sort=size&order=desc', { 'Accept-Encoding': 'identity' }],
    ['/dir/', { 'Accept-Encoding': 'gzip' }],
    ['/', { 'Accept-Encoding': 'identity' }],
    ['/missing.txt', { 'Accept-Encoding': 'identity' }],
    ['/small.txt/', { 'Accept-Encoding': 'identity' }],
    ['/page', { 'Accept-Encoding': 'identity' }],
    ['/page.html', { 'Accept-Encoding': 'identity' }],
    ['/page.tpl', { 'Accept-Encoding': 'identity' }],
    ['/page.tpl', { 'Accept-Encoding': 'gzip' }],
    ['/missing.tpl', { 'Accept-Encoding': 'identity' }],
    ['/../etc/passwd', { 'Accept-Encoding': 'identity' }],
    ['/p/small.txt', { 'Accept-Encoding': 'identity' }],
];

const COMPARED_HEADERS = [
    'content-length', 'content-type', 'content-encoding', 'content-range',
    'accept-ranges', 'vary', 'etag', 'last-modified', 'cache-control',
    'content-disposition', 'location', 'transfer-encoding', 'x-dir-truncated',
    'content-security-policy', 'x-content-type-options',
];

// Fresh instance per request: every cache in the middleware lives in the factory
// closure, so this keeps each comparison independent of the ones before it.
async function once(opts, method, reqPath, headers) {
    const app = new Koa();
    app.on('error', () => {});
    app.use(koaClassicServer(ROOT, opts));
    const server = app.listen();
    try {
        let req = supertest(server)[method](reqPath).redirects(0);
        for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
        return await req;
    } finally {
        server.close();
    }
}

// Exemption 1: the middleware declined the request and Koa answered. Every page
// this middleware generates carries a CSP header; Koa's default 404 does not.
const isKoaFallthrough = (get) => get.status === 404 && !get.headers['content-security-policy'];

function unexplainedDiffs(get, head) {
    const diffs = [];
    if (get.status !== head.status) diffs.push(`status: GET=${get.status} HEAD=${head.status}`);

    for (const key of COMPARED_HEADERS) {
        const g = get.headers[key];
        const h = head.headers[key];
        if (g === h) continue;

        // 1. Koa's own fall-through 404 body, which it never sizes for HEAD.
        if (isKoaFallthrough(get) && (key === 'content-length' || key === 'content-type') && h === undefined) continue;

        // 2. Streaming compression: GET is chunked, HEAD describes no framing.
        if (key === 'transfer-encoding' && g === 'chunked' && h === undefined) continue;

        diffs.push(`${key}: GET=${g ?? '-'} HEAD=${h ?? '-'}`);
    }
    return diffs;
}

describe('HEAD/GET parity across the configuration × request grid', () => {
    for (const [configName, opts] of Object.entries(CONFIGS)) {
        test(`${configName}`, async () => {
            const failures = [];

            for (const [reqPath, baseHeaders] of REQUESTS) {
                // Conditional variants need a real validator, so they are derived
                // from a priming GET rather than hardcoded.
                const variants = [baseHeaders];
                if (opts.browserCacheEnabled) {
                    const primed = await once(opts, 'get', reqPath, baseHeaders);
                    if (primed.headers.etag) {
                        variants.push({ ...baseHeaders, 'If-None-Match': primed.headers.etag });
                        variants.push({ ...baseHeaders, 'If-Range': primed.headers.etag, Range: 'bytes=0-9' });
                    }
                    if (primed.headers['last-modified']) {
                        variants.push({ ...baseHeaders, 'If-Modified-Since': primed.headers['last-modified'] });
                    }
                }

                for (const headers of variants) {
                    const get = await once(opts, 'get', reqPath, headers);
                    const head = await once(opts, 'head', reqPath, headers);
                    const diffs = unexplainedDiffs(get, head);
                    if (diffs.length) {
                        failures.push(`${reqPath} ${JSON.stringify(headers)}\n      ${diffs.join('\n      ')}`);
                    }
                }
            }

            expect(failures).toEqual([]);
        }, 30000);
    }
});
