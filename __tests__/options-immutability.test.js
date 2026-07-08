/**
 * Factory options validation + caller-config immutability — finding #10 of
 * docs/revisione_codice_v3.1.md.
 *
 * Covers:
 *   - opts: null (and any other non-object) → helpful [koa-classic-server]
 *     error at factory time, not a raw TypeError deep inside normalization
 *   - opts omitted (undefined) → defaults, unchanged behavior
 *   - the factory never mutates the caller's configuration object (it used to
 *     rewrite index/dirListing/template.renderTimeout/hideExtension.ext in
 *     place on the caller's own object)
 *   - the same config object can be reused for two instances — including with
 *     the v2 `showDirContents` alias, which used to make the SECOND instance
 *     throw ("both set") because the first call wrote dirListing into the
 *     caller's object
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const silentLogger = { error: () => {}, warn: () => {} };

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-opts-immut-'));
    fs.writeFileSync(path.join(fixturesDir, 'file.txt'), 'content');
    fs.writeFileSync(path.join(fixturesDir, 'about.ejs'), '<h1>About</h1>');
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

// ─── Invalid opts → helpful factory-time error ───────────────────────────────

describe('factory rejects non-object options (#10)', () => {
    test.each([
        ['null', null],
        ['a string', 'options'],
        ['a number', 42],
        ['an array', []],
        ['a boolean', true],
    ])('opts = %s throws a [koa-classic-server] error', (_label, bad) => {
        expect(() => koaClassicServer(fixturesDir, bad))
            .toThrow(/\[koa-classic-server\] options must be a plain object/);
    });

    test('opts omitted entirely still gives working defaults', async () => {
        const app = new Koa();
        app.use(koaClassicServer(fixturesDir));
        const server = app.listen();
        const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
        server.close();
        expect(res.status).toBe(200);
        expect(res.text).toBe('content');
    });
});

// ─── Caller's config object is never mutated ─────────────────────────────────

describe('factory does not mutate the caller config (#10)', () => {
    test('normalization happens on a copy, not on the caller object', () => {
        const cfg = {
            logger: silentLogger,
            index: ['index.html'],
            hideExtension: { ext: 'ejs' },     // missing dot → normalized internally
            template: { ext: ['ejs'] },        // renderTimeout default applied internally
            showDirContents: true,             // v2 alias → dirListing built internally
        };

        koaClassicServer(fixturesDir, cfg);

        // Every value the factory used to rewrite in place must be untouched:
        expect(cfg.hideExtension.ext).toBe('ejs');            // was rewritten to '.ejs'
        expect(cfg.hideExtension.redirect).toBeUndefined();   // was defaulted to 301
        expect(cfg.template.renderTimeout).toBeUndefined();   // was defaulted to 30000
        expect(cfg.template.render).toBeUndefined();
        expect(cfg.dirListing).toBeUndefined();               // was written by the alias
        expect(cfg.method).toBeUndefined();                   // was defaulted to ['GET']
        expect(cfg.urlPrefix).toBeUndefined();
        expect(cfg.urlsReserved).toBeUndefined();
        expect(cfg.browserCacheMaxAge).toBeUndefined();
        expect(cfg.index).toEqual(['index.html']);
    });

    test('the same config object works for two instances (showDirContents alias included)', async () => {
        const cfg = {
            logger: silentLogger,
            showDirContents: true,   // 2nd instance used to throw: "both set"
            hideExtension: { ext: 'ejs' },
        };

        const app1 = new Koa();
        app1.use(koaClassicServer(fixturesDir, cfg));
        const app2 = new Koa();
        app2.use(koaClassicServer(fixturesDir, cfg)); // used to throw here

        const s1 = app1.listen();
        const s2 = app2.listen();
        const [r1, r2] = await Promise.all([
            supertest(s1).get('/file.txt').set('Accept-Encoding', 'identity'),
            supertest(s2).get('/file.txt').set('Accept-Encoding', 'identity'),
        ]);
        s1.close();
        s2.close();

        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
    });
});
