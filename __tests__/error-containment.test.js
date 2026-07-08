/**
 * Error-containment tests — findings B3 and B2 of
 * docs/analisi_robustezza_v3.1.md (register #18 / #19).
 *
 * B3 — last-resort catch: an unexpected failure while the middleware OWNS the
 * request must produce the middleware's own 500 page (security headers +
 * operator logger), not leak to Koa's default handler (plain-text 500, no
 * headers, logged outside `logger`). Errors thrown by DOWNSTREAM middleware
 * (via next()) must NOT be masked.
 *
 * B2 — hideExtension redirect builds `new URL(_origin + ctx.originalUrl)`.
 * With useOriginalUrl: false the URL prologue validates ctx.url (rewritten),
 * not originalUrl: a malformed originalUrl (absolute-form request target,
 * legal in HTTP/1.1) made the constructor throw → unhandled error. It must be
 * a 400 like every other malformed client input.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-error-containment-'));
    fs.writeFileSync(path.join(fixturesDir, 'file.txt'), 'plain content');
    fs.writeFileSync(path.join(fixturesDir, 'about.ejs'), '<h1>About Page</h1>');
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function capturingLogger() {
    const errors = [];
    return { errors, error: (...args) => errors.push(args.join(' ')), warn: () => {} };
}

// ─── B3: last-resort catch ───────────────────────────────────────────────────

describe('last-resort catch (B3 / #18)', () => {
    test('an unexpected throw while serving produces the middleware 500 page + logger', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.use(koaClassicServer(fixturesDir, {
            dirListing: { enabled: false },
            compression: false,
            logger,
        }));
        const server = app.listen();

        // Simulate an unforeseen failure on a path with no dedicated guard:
        // the uncompressed serving path calls fs.createReadStream synchronously.
        jest.spyOn(fs, 'createReadStream').mockImplementation(() => {
            throw new Error('injected unexpected failure');
        });

        const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(res.status).toBe(500);
        // The middleware's own page, not Koa's plain-text default:
        expect(res.headers['content-security-policy']).toBeDefined();
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.text).toContain('unexpected condition');
        // ...and the error reached the operator's logger.
        expect(logger.errors.some(e => e.includes('Unexpected error while serving'))).toBe(true);
        // Headers set by the partially-built response must be scrubbed: the
        // throw happened AFTER Content-Type/Disposition/Accept-Ranges were set.
        expect(res.headers['content-type']).toContain('text/html');
        expect(res.headers['content-disposition']).toBeUndefined();
        expect(res.headers['accept-ranges']).toBeUndefined();
        expect(res.headers['cache-control']).toBe('no-store');
    });

    test('errors thrown by DOWNSTREAM middleware are not masked', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.on('error', () => {}); // silence Koa's default stderr logging
        app.use(koaClassicServer(fixturesDir, {
            dirListing: { enabled: false },
            method: ['GET'], // POST falls through to next()
            logger,
        }));
        app.use(() => { throw new Error('downstream boom'); });
        const server = app.listen();

        const res = await supertest(server).post('/whatever');
        server.close();

        // Koa's default handling, untouched by the middleware's net:
        expect(res.status).toBe(500);
        expect(res.headers['content-security-policy']).toBeUndefined();
        expect(logger.errors.length).toBe(0);
    });

    test('normal requests are unaffected by the net', async () => {
        const app = new Koa();
        app.use(koaClassicServer(fixturesDir, { dirListing: { enabled: false } }));
        const server = app.listen();
        const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        server.close();
        expect(res.status).toBe(200);
        expect(res.text).toBe('plain content');
    });
});

// ─── B2: malformed originalUrl in the hideExtension redirect ────────────────

describe('hideExtension with malformed originalUrl (B2 / #19)', () => {
    let server;
    let port;

    beforeAll(() => {
        const app = new Koa();
        // URL-rewrite middleware: the middleware validates ctx.url (rewritten),
        // while hideExtension later reconstructs from the raw originalUrl.
        app.use((ctx, next) => { ctx.url = '/about.ejs'; return next(); });
        app.use(koaClassicServer(fixturesDir, {
            dirListing: { enabled: false },
            useOriginalUrl: false,
            hideExtension: { ext: '.ejs' },
        }));
        server = app.listen();
        port = server.address().port;
    });

    afterAll(() => server.close());

    test('absolute-form request target → 400, not an unhandled 500', async () => {
        // supertest can't send an absolute-form request-target; raw client can.
        const res = await new Promise((resolve, reject) => {
            const req = http.request(
                { port, method: 'GET', path: 'http://evil.example/about.ejs' },
                r => {
                    let body = '';
                    r.on('data', c => { body += c; });
                    r.on('end', () => resolve({ status: r.statusCode, body }));
                }
            );
            req.on('error', reject);
            req.end();
        });

        expect(res.status).toBe(400); // was an unhandled throw before the fix
        expect(res.body).toBe('Bad Request');
    });

    test('well-formed request still gets the clean-URL redirect', async () => {
        const res = await supertest(server).get('/about.ejs').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/about');
    });
});
