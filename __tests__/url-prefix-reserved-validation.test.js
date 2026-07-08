/**
 * urlPrefix / urlsReserved validation — finding #11 of
 * docs/revisione_codice_v3.1.md.
 *
 * Both options had an implicit format the request-time matcher depended on;
 * a malformed value failed SILENTLY (middleware served nothing, or a
 * reservation never matched, or a non-string entry crashed at request time).
 * They now throw a helpful [koa-classic-server] error at factory time.
 *
 * Covers:
 *   - urlPrefix: trailing slash, missing leading slash, non-string → throw;
 *     "/static", "" and omitted → accepted and still route correctly
 *   - urlsReserved: missing leading slash, multi-segment, non-string entry,
 *     non-array → throw; valid first-level paths → accepted and still reserve
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const silentLogger = { error: () => {}, warn: () => {} };

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

// ─── urlPrefix: rejected forms ───────────────────────────────────────────────

describe('urlPrefix validation (#11)', () => {
    test('trailing slash throws (used to silently serve nothing)', () => {
        expect(() => koaClassicServer(root, { urlPrefix: '/static/' }))
            .toThrow(/urlPrefix must start with "\/" and must not end with "\/"/);
    });

    test('missing leading slash throws', () => {
        expect(() => koaClassicServer(root, { urlPrefix: 'static' }))
            .toThrow(/urlPrefix must start with "\/"/);
    });

    test('bare "/" throws (use "" instead)', () => {
        expect(() => koaClassicServer(root, { urlPrefix: '/' }))
            .toThrow(/urlPrefix must start with "\/" and must not end with "\/"/);
    });

    test('non-string throws with a helpful message', () => {
        expect(() => koaClassicServer(root, { urlPrefix: 42 }))
            .toThrow(/urlPrefix must be a string/);
    });

    test('valid "/static" is accepted and routes files under the prefix', async () => {
        const app = new Koa();
        app.use(koaClassicServer(root, { urlPrefix: '/static', dirListing: { enabled: false } }));
        const server = app.listen();
        const res = await supertest(server).get('/static/sub/file.txt').set('Accept-Encoding', 'identity');
        server.close();
        expect(res.status).toBe(200);
        expect(res.text).toBe('under prefix');
    });

    test('"" (empty) and omitted are both accepted', async () => {
        for (const opts of [{ urlPrefix: '' }, {}]) {
            const app = new Koa();
            app.use(koaClassicServer(root, { ...opts, dirListing: { enabled: false } }));
            const server = app.listen();
            const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
            server.close();
            expect(res.status).toBe(200);
            expect(res.text).toBe('top level');
        }
    });
});

// ─── urlsReserved: rejected forms ────────────────────────────────────────────

describe('urlsReserved validation (#11)', () => {
    test('missing leading slash throws (used to silently never match)', () => {
        expect(() => koaClassicServer(root, { urlsReserved: ['admin'] }))
            .toThrow(/urlsReserved entry must be a single first-level path/);
    });

    test('multi-segment entry throws (matching is first-level only)', () => {
        expect(() => koaClassicServer(root, { urlsReserved: ['/admin/panel'] }))
            .toThrow(/first-level only/);
    });

    test('trailing slash on an entry throws', () => {
        expect(() => koaClassicServer(root, { urlsReserved: ['/admin/'] }))
            .toThrow(/urlsReserved entry must be a single first-level path/);
    });

    test('non-string entry throws (used to crash at request time)', () => {
        expect(() => koaClassicServer(root, { urlsReserved: [42] }))
            .toThrow(/urlsReserved entry must be a non-empty string/);
    });

    test('empty-string entry throws', () => {
        expect(() => koaClassicServer(root, { urlsReserved: [''] }))
            .toThrow(/urlsReserved entry must be a non-empty string/);
    });

    test('non-array throws', () => {
        expect(() => koaClassicServer(root, { urlsReserved: '/admin' }))
            .toThrow(/urlsReserved must be an array/);
    });

    test('valid entries are accepted and actually reserve the path', async () => {
        const app = new Koa();
        app.use(koaClassicServer(root, {
            logger: silentLogger,
            urlsReserved: ['/sub'],
            dirListing: { enabled: false },
        }));
        // Downstream middleware proves the reserved path was passed through:
        app.use((ctx) => { ctx.status = 418; ctx.body = 'reserved'; });
        const server = app.listen();

        const reserved = await supertest(server).get('/sub/file.txt').set('Accept-Encoding', 'identity');
        const normal = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        server.close();

        expect(reserved.status).toBe(418);        // passed through to next()
        expect(normal.status).toBe(200);          // served normally
        expect(normal.text).toBe('top level');
    });

    test('empty array and omitted are both accepted', () => {
        expect(() => koaClassicServer(root, { urlsReserved: [] })).not.toThrow();
        expect(() => koaClassicServer(root, {})).not.toThrow();
    });
});
