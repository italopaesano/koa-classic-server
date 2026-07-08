/**
 * urlPrefix / urlsReserved validation — finding #11 of
 * docs/revisione_codice_v3.1.md.
 *
 * Both options have an implicit format the request-time matcher depends on;
 * a malformed value fails SILENTLY (middleware serves nothing, or a reservation
 * never matches, or a non-string entry 500s at request time). Because both are
 * v2-stable options, a malformed value is NOT thrown — throwing on a stable
 * option is a breaking change on a minor upgrade, and a mis-slashed value that
 * "worked" only by falling through to a downstream handler would change
 * behavior. Instead the factory emits a once-per-process DEPRECATION warning
 * and leaves the runtime behavior exactly as it is today (the next major will
 * turn these into throws). The single exception: a non-string urlsReserved
 * entry is dropped, because it would 500 on every request.
 *
 * These tests assert BOTH the warning and the unchanged runtime behavior.
 * The deprecation dedup is module-level (once per process), so each test gets a
 * fresh module via jest.resetModules() to keep warn assertions order-independent.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');

let koaClassicServer;
beforeEach(() => {
    jest.resetModules();               // fresh module → fresh once-per-process dedup Set
    koaClassicServer = require('../index.cjs');
});

function capturingLogger() {
    const warns = [];
    return { warns, error: () => {}, warn: (...a) => warns.push(a.join(' ')) };
}

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-url-validation-'));
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'file.txt'), 'under prefix');
    fs.writeFileSync(path.join(root, 'file.txt'), 'top level');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

// ─── urlPrefix ───────────────────────────────────────────────────────────────

describe('urlPrefix deprecation-warn (#11)', () => {
    test('never throws on a malformed value', () => {
        for (const bad of ['/static/', 'static', '/', 42, null]) {
            expect(() => koaClassicServer(root, { urlPrefix: bad, logger: capturingLogger() }))
                .not.toThrow();
        }
    });

    test('trailing slash warns and leaves behavior unchanged (still falls through)', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.use(koaClassicServer(root, { urlPrefix: '/static/', logger, dirListing: { enabled: false } }));
        app.use((ctx) => { ctx.status = 204; }); // proves the request fell through to next()
        const server = app.listen();
        const res = await supertest(server).get('/static/sub/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(res.status).toBe(204); // unchanged: served nothing, passed on
        expect(logger.warns.some(w => /DEPRECATION.*urlPrefix should start with/.test(w))).toBe(true);
    });

    test('non-string warns and is coerced to "" (unchanged behavior)', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.use(koaClassicServer(root, { urlPrefix: true, logger, dirListing: { enabled: false } }));
        const server = app.listen();
        const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(res.status).toBe(200);          // "" prefix → serves from root as today
        expect(res.text).toBe('top level');
        expect(logger.warns.some(w => /DEPRECATION.*urlPrefix should be a string/.test(w))).toBe(true);
    });

    test('valid "/static" is accepted with no warning and routes correctly', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.use(koaClassicServer(root, { urlPrefix: '/static', logger, dirListing: { enabled: false } }));
        const server = app.listen();
        const res = await supertest(server).get('/static/sub/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(res.status).toBe(200);
        expect(res.text).toBe('under prefix');
        expect(logger.warns.length).toBe(0);
    });
});

// ─── urlsReserved ────────────────────────────────────────────────────────────

describe('urlsReserved deprecation-warn (#11)', () => {
    test('never throws on a malformed value', () => {
        for (const bad of [['admin'], ['/admin/panel'], ['/admin/'], [42], [''], '/admin']) {
            expect(() => koaClassicServer(root, { urlsReserved: bad, logger: capturingLogger() }))
                .not.toThrow();
        }
    });

    test('missing leading slash warns and still does not match (unchanged)', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.use(koaClassicServer(root, { urlsReserved: ['sub'], logger, dirListing: { enabled: false } }));
        app.use((ctx) => { ctx.status = 418; }); // would fire only if the path were reserved
        const server = app.listen();
        const res = await supertest(server).get('/sub/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(res.status).toBe(200);          // unchanged: 'sub' never matched → served
        expect(res.text).toBe('under prefix');
        expect(logger.warns.some(w => /DEPRECATION.*single first-level path/.test(w))).toBe(true);
    });

    test('non-string entry warns and is DROPPED (no per-request 500)', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        // A valid entry alongside the bad one proves only the bad one is dropped.
        app.use(koaClassicServer(root, { urlsReserved: ['/sub', 42], logger, dirListing: { enabled: false } }));
        app.use((ctx) => { ctx.status = 418; ctx.body = 'reserved'; });
        const server = app.listen();

        const reserved = await supertest(server).get('/sub/file.txt').set('Accept-Encoding', 'identity');
        const normal = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(reserved.status).toBe(418);     // '/sub' still reserved → passed through
        expect(normal.status).toBe(200);       // no 500 anywhere from the dropped 42
        expect(logger.warns.some(w => /DEPRECATION.*dropping a non-string/.test(w))).toBe(true);
    });

    test('non-array warns and is coerced to [] (unchanged behavior)', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.use(koaClassicServer(root, { urlsReserved: 'notanarray', logger, dirListing: { enabled: false } }));
        const server = app.listen();
        const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(res.status).toBe(200);
        expect(logger.warns.some(w => /DEPRECATION.*urlsReserved should be an array/.test(w))).toBe(true);
    });

    test('valid entries are accepted with no warning and still reserve', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.use(koaClassicServer(root, { urlsReserved: ['/sub'], logger, dirListing: { enabled: false } }));
        app.use((ctx) => { ctx.status = 418; });
        const server = app.listen();

        const reserved = await supertest(server).get('/sub/file.txt').set('Accept-Encoding', 'identity');
        const normal = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(reserved.status).toBe(418);
        expect(normal.status).toBe(200);
        expect(logger.warns.length).toBe(0);
    });

    test('the caller\'s reserved array is not mutated', () => {
        const cfg = ['/sub', 42];
        koaClassicServer(root, { urlsReserved: cfg, logger: capturingLogger() });
        expect(cfg).toEqual(['/sub', 42]); // dropping happened on an internal copy
    });
});
