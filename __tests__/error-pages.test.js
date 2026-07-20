/**
 * options.errorPages — operator-supplied custom error pages (V4.2).
 *
 * Contract under test:
 *  - factory-time validation: unsupported status keys, non-string / empty
 *    values, missing or unreadable files all throw with a helpful hint;
 *  - a configured status serves the operator's .html file (from a path that
 *    may live OUTSIDE rootDir) with text/html, the generated-page security
 *    headers, and NO Content-Security-Policy (custom pages are
 *    operator-authored: the built-in pages' default-src 'none' would block
 *    their inline styles);
 *  - unconfigured statuses keep the built-in pages byte-for-byte (CSP incl.);
 *  - the page file is re-read when its mtime/size changes (editable without a
 *    restart) and falls back to the built-in page — with a logger warning —
 *    when it becomes unreadable at request time;
 *  - every error branch goes through the same writer: template 500/504, the
 *    last-resort catch, and the stream-failure branches (which previously
 *    replied a plain-text 'Error reading file', possibly with a stale
 *    Content-Encoding that corrupted the response);
 *  - 400 replies to malformed requests stay minimal and are not customizable.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const { writeErrorPage } = require('../index.cjs')._internals;

let fixturesDir; // served rootDir
let pagesDir;    // custom pages live OUTSIDE rootDir

const CUSTOM_404 = '<!DOCTYPE html><html><head><style>h1{color:#c00}</style></head><body><h1>Custom Not Found</h1></body></html>';
const CUSTOM_500 = '<!DOCTYPE html><html><body><h1>Custom Server Error</h1></body></html>';
const CUSTOM_504 = '<!DOCTYPE html><html><body><h1>Custom Timeout</h1></body></html>';

let page404, page500, page504;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-error-pages-root-'));
    pagesDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-error-pages-pages-'));

    fs.writeFileSync(path.join(fixturesDir, 'file.txt'), 'plain content');
    fs.writeFileSync(path.join(fixturesDir, 'big.txt'), 'B'.repeat(4096)); // clears compression.minFileSize
    fs.writeFileSync(path.join(fixturesDir, 'page.ejs'), '<h1>template</h1>');
    fs.writeFileSync(path.join(fixturesDir, 'secret.txt'), 'hidden content');

    page404 = path.join(pagesDir, '404.html');
    page500 = path.join(pagesDir, '500.html');
    page504 = path.join(pagesDir, '504.html');
    fs.writeFileSync(page404, CUSTOM_404);
    fs.writeFileSync(page500, CUSTOM_500);
    fs.writeFileSync(page504, CUSTOM_504);
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
    fs.rmSync(pagesDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function capturingLogger() {
    const errors = [];
    const warns = [];
    return {
        errors,
        warns,
        error: (...args) => errors.push(args.map(String).join(' ')),
        warn: (...args) => warns.push(args.map(String).join(' ')),
    };
}

function createServer(opts = {}) {
    const app = new Koa();
    app.on('error', () => {}); // silence Koa's default stderr logging
    app.use(koaClassicServer(fixturesDir, opts));
    return app.listen();
}

// Returns a Readable already destroyed with `err`: the 'error' event fires on
// the next tick, BEFORE Koa's respond() flushes headers — deterministically
// exercising the "stream failed before headers were sent" branch.
function immediatelyBrokenStream(err) {
    const s = new PassThrough();
    s.destroy(err);
    return s;
}

function mockBrokenReadStream(targetPath) {
    const original = fs.createReadStream;
    return jest.spyOn(fs, 'createReadStream').mockImplementation((p, ...args) => {
        if (path.resolve(String(p)) === path.resolve(targetPath)) {
            return immediatelyBrokenStream(Object.assign(new Error('injected EIO'), { code: 'EIO' }));
        }
        return original.call(fs, p, ...args);
    });
}

// ─── Factory-time validation ─────────────────────────────────────────────────

describe('errorPages factory validation', () => {
    test('non-object errorPages → throws', () => {
        for (const bad of [[], 'x', 42, null]) {
            expect(() => koaClassicServer(fixturesDir, { errorPages: bad }))
                .toThrow(/errorPages must be an object/);
        }
    });

    test('unsupported status key → throws listing the supported statuses', () => {
        expect(() => koaClassicServer(fixturesDir, { errorPages: { 403: page404 } }))
            .toThrow(/unsupported status "403".*404, 500, 504/s);
    });

    test('400 is deliberately not customizable', () => {
        expect(() => koaClassicServer(fixturesDir, { errorPages: { 400: page404 } }))
            .toThrow(/400 is deliberately not customizable/);
    });

    test('non-string / empty values → throw', () => {
        expect(() => koaClassicServer(fixturesDir, { errorPages: { 404: 42 } }))
            .toThrow(/errorPages\[404\] must be a non-empty string path/);
        expect(() => koaClassicServer(fixturesDir, { errorPages: { 404: '' } }))
            .toThrow(/an empty string/);
    });

    test('missing file → throws at startup, not on the first 404', () => {
        expect(() => koaClassicServer(fixturesDir, { errorPages: { 404: path.join(pagesDir, 'nope.html') } }))
            .toThrow(/cannot read.*must exist and be readable at startup/s);
    });

    test('directory instead of a file → throws', () => {
        expect(() => koaClassicServer(fixturesDir, { errorPages: { 404: pagesDir } }))
            .toThrow(/cannot read/);
    });
});

// ─── Custom 404 ──────────────────────────────────────────────────────────────

describe('custom 404 page', () => {
    test('missing path → custom body, text/html, security headers, NO CSP', async () => {
        const server = createServer({ errorPages: { 404: page404 } });
        const res = await supertest(server).get('/missing.txt');
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toBe(CUSTOM_404);
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.headers['content-security-policy']).toBeUndefined(); // operator-authored page
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('DENY');
    });

    test('a relative path resolves from process.cwd()', async () => {
        const server = createServer({ errorPages: { 404: path.relative(process.cwd(), page404) } });
        const res = await supertest(server).get('/missing.txt');
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toBe(CUSTOM_404);
    });

    test('without errorPages the built-in page (with CSP) is unchanged', async () => {
        const server = createServer({});
        const res = await supertest(server).get('/missing.txt');
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toContain('was not found on this server');
        expect(res.headers['content-security-policy']).toBeDefined();
    });

    test('hidden entry → same custom 404 (indistinguishable from not-found)', async () => {
        const server = createServer({
            errorPages: { 404: page404 },
            hidden: { alwaysHide: ['secret.txt'] },
        });
        const res = await supertest(server).get('/secret.txt');
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toBe(CUSTOM_404);
    });

    test('dirListing disabled → custom 404 on directory requests', async () => {
        const server = createServer({
            errorPages: { 404: page404 },
            dirListing: { enabled: false },
        });
        const res = await supertest(server).get('/');
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toBe(CUSTOM_404);
    });

    test('HEAD → 404 with empty body and the custom page Content-Length', async () => {
        const server = createServer({ errorPages: { 404: page404 }, method: ['GET', 'HEAD'] });
        const res = await supertest(server).head('/missing.txt');
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toBeUndefined();
        expect(res.headers['content-length']).toBe(String(Buffer.byteLength(CUSTOM_404)));
    });

    test('malformed request stays a minimal 400 even with errorPages configured', async () => {
        const server = createServer({ errorPages: { 404: page404, 500: page500 } });
        const res = await supertest(server).get('/%zz');
        server.close();

        expect(res.status).toBe(400);
        expect(res.text).toBe('Bad Request');
    });
});

// ─── Live reload + runtime fallback ─────────────────────────────────────────

describe('page file lifecycle', () => {
    test('edited page file (mtime/size changed) is re-read without a restart', async () => {
        const editPage = path.join(pagesDir, 'edit-404.html');
        fs.writeFileSync(editPage, '<h1>v1</h1>');
        const server = createServer({ errorPages: { 404: editPage } });

        const before = await supertest(server).get('/missing.txt');
        expect(before.text).toBe('<h1>v1</h1>');

        fs.writeFileSync(editPage, '<h1>v2 — updated</h1>');
        const bumped = new Date(Date.now() + 5000);
        fs.utimesSync(editPage, bumped, bumped); // force an mtime change even on coarse filesystems

        const after = await supertest(server).get('/missing.txt');
        server.close();
        expect(after.text).toBe('<h1>v2 — updated</h1>');
    });

    test('page file deleted after startup → built-in page + throttled warning', async () => {
        const doomedPage = path.join(pagesDir, 'doomed-404.html');
        fs.writeFileSync(doomedPage, '<h1>doomed</h1>');
        const logger = capturingLogger();
        const server = createServer({ errorPages: { 404: doomedPage }, logger });

        fs.rmSync(doomedPage);
        const res = await supertest(server).get('/missing.txt');
        const res2 = await supertest(server).get('/missing.txt'); // second failure inside the throttle window
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toContain('was not found on this server'); // built-in fallback
        expect(res2.text).toContain('was not found on this server');
        const pageWarns = logger.warns.filter(w => w.includes('errorPages[404]'));
        expect(pageWarns.length).toBe(1); // throttled: one warning, not one per request
        expect(pageWarns[0]).toContain('serving the built-in page instead');
    });
});

// ─── Template 500 / 504 ──────────────────────────────────────────────────────

describe('template error statuses', () => {
    test('render failure → custom 500 page', async () => {
        const logger = capturingLogger();
        const server = createServer({
            errorPages: { 500: page500 },
            logger,
            template: { ext: ['ejs'], render: () => { throw new Error('render boom'); } },
        });
        const res = await supertest(server).get('/page.ejs');
        server.close();

        expect(res.status).toBe(500);
        expect(res.text).toBe(CUSTOM_500);
        expect(res.headers['content-security-policy']).toBeUndefined();
        expect(res.headers['cache-control']).toBe('no-store');
        expect(logger.errors.some(e => e.includes('Template rendering error'))).toBe(true);
    });

    test('render timeout → custom 504 page', async () => {
        const server = createServer({
            errorPages: { 504: page504 },
            logger: capturingLogger(),
            template: { ext: ['ejs'], render: () => new Promise(() => {}), renderTimeout: 50 },
        });
        const res = await supertest(server).get('/page.ejs');
        server.close();

        expect(res.status).toBe(504);
        expect(res.text).toBe(CUSTOM_504);
    });

    test('render failure with only 504 configured keeps the template-specific built-in 500', async () => {
        const server = createServer({
            errorPages: { 504: page504 },
            logger: capturingLogger(),
            template: { ext: ['ejs'], render: () => { throw new Error('render boom'); } },
        });
        const res = await supertest(server).get('/page.ejs');
        server.close();

        expect(res.status).toBe(500);
        expect(res.text).toContain('Template rendering failed');
        expect(res.headers['content-security-policy']).toBeDefined(); // built-in page keeps its CSP
    });
});

// ─── Last-resort catch and stream-failure branches ───────────────────────────

describe('500 branches unified through the error-page writer', () => {
    test('unexpected throw (last-resort catch) → custom 500 page', async () => {
        const logger = capturingLogger();
        const server = createServer({
            errorPages: { 500: page500 },
            dirListing: { enabled: false },
            compression: false,
            logger,
        });
        jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
            throw new Error('injected unexpected failure');
        });

        const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(res.status).toBe(500);
        expect(res.text).toBe(CUSTOM_500);
        expect(res.headers['content-security-policy']).toBeUndefined();
        expect(res.headers['cache-control']).toBe('no-store');
        expect(logger.errors.some(e => e.includes('Unexpected error while serving'))).toBe(true);
    });

    // NOTE (both stream tests): Koa 3 answers a stream-body error by tearing the
    // socket down — the middleware's write (previously the plain-text 'Error
    // reading file', now the unified error page) is best-effort and typically
    // never reaches the client (verified identical on the pre-change code). The
    // deterministic contract is the operator log; when a response DOES land, it
    // must be the unified page with no stale representation headers.
    test('uncompressed stream failure → logged; any delivered reply is the unified page', async () => {
        const logger = capturingLogger();
        const server = createServer({
            errorPages: { 500: page500 },
            compression: false,
            logger,
        });
        mockBrokenReadStream(path.join(fixturesDir, 'file.txt'));

        let outcome;
        try {
            const res = await supertest(server)
                .get('/file.txt').set('Accept-Encoding', 'identity').ok(() => true);
            outcome = { status: res.status, text: res.text, headers: res.headers };
        } catch (err) {
            outcome = { clientError: err }; // Koa 3 destroyed the socket
        } finally {
            server.close();
        }

        expect(logger.errors.some(e => e.includes('Stream error'))).toBe(true);
        if (outcome.status !== undefined) {
            expect(outcome.status).toBe(500);
            expect(outcome.text).toBe(CUSTOM_500);
            expect(outcome.headers['content-type']).toContain('text/html');
        } else {
            expect(outcome.clientError).toBeDefined();
        }
    });

    test('streamed-compression failure → logged; any delivered reply has no stale Content-Encoding', async () => {
        const logger = capturingLogger();
        const server = createServer({
            // compressed cache off → streaming compression path (pipeline branch)
            serverCache: { compressedFile: { enabled: false } },
            logger,
        });
        mockBrokenReadStream(path.join(fixturesDir, 'big.txt'));

        let outcome;
        try {
            const res = await supertest(server)
                .get('/big.txt').set('Accept-Encoding', 'gzip').ok(() => true);
            outcome = { status: res.status, text: res.text, headers: res.headers };
        } catch (err) {
            outcome = { clientError: err }; // Koa 3 destroyed the socket
        } finally {
            server.close();
        }

        expect(logger.errors.some(e => e.includes('Stream error'))).toBe(true);
        if (outcome.status !== undefined) {
            expect(outcome.status).toBe(500);
            // Pre-unification this branch replied plain text still labeled
            // Content-Encoding: gzip — undecodable. The writer scrubs it.
            expect(outcome.headers['content-encoding']).toBeUndefined();
            expect(outcome.text).toContain('unexpected condition'); // built-in page (no custom 500 here)
        } else {
            expect(outcome.clientError).toBeDefined();
        }
    });

    test('access failure with browser caching on → 404 with no-store (public Cache-Control replaced)', async () => {
        const logger = capturingLogger();
        const server = createServer({
            errorPages: { 404: page404 },
            browserCacheEnabled: true,
            logger,
        });
        jest.spyOn(fs.promises, 'access').mockRejectedValue(
            Object.assign(new Error('injected EACCES'), { code: 'EACCES' })
        );

        const res = await supertest(server).get('/file.txt').ok(() => true);
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toBe(CUSTOM_404);
        // Previously this branch leaked `public, max-age=...` onto the 404; then
        // it was scrubbed to nothing. Now every error page is no-store (v5.0 #1),
        // so the 404 is not heuristically cacheable by a shared cache either.
        expect(res.headers['cache-control']).toBe('no-store');
    });
});

// ─── writeErrorPage output contract (deterministic) ──────────────────────────
//
// The stream-failure branches above route through sendErrorPageSync → the
// module-level writeErrorPage, but their delivered output can't be asserted:
// Koa 3 tears the socket down on a mid-stream body error, so the client always
// sees ECONNRESET (the response never arrives). These tests exercise the SAME
// writeErrorPage through a normal Koa response — a middleware pre-sets the
// "dirty" headers a partially-built response would have left behind, then calls
// writeErrorPage — so the exact scrub / no-store / Content-Type / body / CSP
// contract is verified end-to-end without depending on the socket surviving.

describe('writeErrorPage output contract', () => {
    // Headers a partial file response typically set before an error is detected.
    const DIRTY_HEADERS = {
        'Content-Encoding': 'gzip',                 // the compressed-stream corruption vector
        'Content-Type': 'image/png',                // must be overwritten to text/html
        'Cache-Control': 'public, max-age=3600',    // must not survive onto an error
        'ETag': '"123-456-gz"',
        'Last-Modified': 'Mon, 13 Jul 2026 00:00:00 GMT',
        'Vary': 'Accept-Encoding',
        'Content-Range': 'bytes 0-9/100',
        'Accept-Ranges': 'bytes',
        'Content-Disposition': 'attachment; filename="x.png"',
        'Pragma': 'no-cache',
        'Expires': '0',
    };
    const SCRUBBED = Object.keys(DIRTY_HEADERS)
        .map(h => h.toLowerCase())
        .filter(h => h !== 'content-type' && h !== 'cache-control'); // these two are re-set, not just removed

    // Spins up a one-shot Koa server whose sole middleware dirties the response
    // then calls writeErrorPage(status, customBuffer, builtinHtml).
    function serveViaWriter(status, customBuffer, builtinHtml) {
        const app = new Koa();
        app.on('error', () => {});
        app.use((ctx) => {
            for (const [k, v] of Object.entries(DIRTY_HEADERS)) ctx.set(k, v);
            writeErrorPage(ctx, status, customBuffer, builtinHtml);
        });
        return app.listen();
    }

    test('built-in 500: dirty headers scrubbed, text/html, no-store, CSP present', async () => {
        const server = serveViaWriter(500, null, '<html>BUILTIN 500</html>');
        const res = await supertest(server).get('/').ok(() => true);
        server.close();

        expect(res.status).toBe(500);
        expect(res.text).toBe('<html>BUILTIN 500</html>');
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['content-security-policy']).toBeDefined(); // built-in page keeps its CSP
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        for (const h of SCRUBBED) expect(res.headers[h]).toBeUndefined();
    });

    test('custom-buffer 500: serves the buffer, NO CSP, still scrubbed + no-store', async () => {
        const buf = Buffer.from('<html>CUSTOM 500 BODY</html>');
        const server = serveViaWriter(500, buf, '<html>BUILTIN 500</html>');
        const res = await supertest(server).get('/').ok(() => true);
        server.close();

        expect(res.status).toBe(500);
        expect(res.text).toBe('<html>CUSTOM 500 BODY</html>'); // operator's page, not the built-in
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.headers['content-length']).toBe(String(buf.length));
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['content-security-policy']).toBeUndefined(); // operator-authored → no CSP
        expect(res.headers['content-encoding']).toBeUndefined();        // the corruption vector, gone
        for (const h of SCRUBBED) expect(res.headers[h]).toBeUndefined();
    });

    test('built-in 404: dirty Cache-Control scrubbed then replaced with no-store (v5.0 #1), CSP present', async () => {
        const server = serveViaWriter(404, null, '<html>BUILTIN 404</html>');
        const res = await supertest(server).get('/').ok(() => true);
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toBe('<html>BUILTIN 404</html>');
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.headers['cache-control']).toBe('no-store'); // now no-store on all statuses, not just >= 500
        // no-store, NOT the listing's no-cache trio: Pragma/Expires stay scrubbed.
        expect(res.headers['pragma']).toBeUndefined();
        expect(res.headers['expires']).toBeUndefined();
        expect(res.headers['content-security-policy']).toBeDefined();
        for (const h of SCRUBBED) expect(res.headers[h]).toBeUndefined();
    });

    test('custom-buffer 404: serves the buffer with no CSP', async () => {
        const buf = Buffer.from('<html>CUSTOM 404 BODY</html>');
        const server = serveViaWriter(404, buf, '<html>BUILTIN 404</html>');
        const res = await supertest(server).get('/').ok(() => true);
        server.close();

        expect(res.status).toBe(404);
        expect(res.text).toBe('<html>CUSTOM 404 BODY</html>');
        expect(res.headers['content-security-policy']).toBeUndefined();
        expect(res.headers['content-encoding']).toBeUndefined();
    });
});

// ─── v5.0 register #1: error pages are never (heuristically) cacheable ────────
// A 404 is heuristically cacheable by default (RFC 9110 §15.1 / RFC 7231 §6.1):
// without an explicit directive a shared cache could keep serving a stale
// "not found" after the file is created. Every generated error page now carries
// Cache-Control: no-store — regardless of browserCacheEnabled — closing the last
// gap where the middleware left a caching decision to a proxy's heuristic
// (the file branch and the listing #5 already defeat it explicitly).
describe('#1 error pages carry no-store on every handled status', () => {
    for (const browserCacheEnabled of [false, true]) {
        test(`missing file → 404 no-store (browserCacheEnabled: ${browserCacheEnabled})`, async () => {
            const server = createServer({ browserCacheEnabled });
            const res = await supertest(server).get('/does-not-exist.txt').ok(() => true);
            server.close();

            expect(res.status).toBe(404);
            expect(res.headers['cache-control']).toBe('no-store');
        });
    }

    test('path traversal → 404 no-store', async () => {
        const server = createServer({ browserCacheEnabled: true });
        const res = await supertest(server).get('/../../etc/passwd').ok(() => true);
        server.close();

        expect(res.status).toBe(404);
        expect(res.headers['cache-control']).toBe('no-store');
    });

    test('directory with dirListing.enabled:false → 404 no-store', async () => {
        const server = createServer({ dirListing: { enabled: false }, browserCacheEnabled: true });
        const res = await supertest(server).get('/').ok(() => true);
        server.close();

        expect(res.status).toBe(404);
        expect(res.headers['cache-control']).toBe('no-store');
    });

    test('500 (directory read failure) still no-store — unchanged', async () => {
        const server = createServer({ browserCacheEnabled: true });
        jest.spyOn(fs.promises, 'readdir').mockRejectedValue(
            Object.assign(new Error('injected EIO'), { code: 'EIO' })
        );
        const res = await supertest(server).get('/').ok(() => true);
        server.close();

        expect(res.status).toBe(500);
        expect(res.headers['cache-control']).toBe('no-store');
    });
});
