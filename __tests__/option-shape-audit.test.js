/**
 * Option-shape audit — docs/revisione_codice_v5.0.md finding #11.
 *
 * #11 is still open: `method` was closed in 5.3.0 (lowercase entries are
 * upper-cased, unusable entries dropped, both reported on the logger), but the
 * register explicitly leaves behind "l'audit sulle opzioni a forma libera" —
 * the sweep over every OTHER option that accepts a free-form value and quietly
 * does something else when the shape is wrong.
 *
 * This file is that sweep, executable. For each option it pins two things:
 *   1. what the middleware actually SERVES under the malformed value, and
 *   2. whether the operator is told anything about it.
 *
 * (1) is unchanged everywhere and stays that way: these are v2-stable options,
 * and changing what they SERVE on a minor upgrade is the breaking change #11
 * exists to avoid.
 *
 * (2) is where this file has already paid off. It started as "nothing at all"
 * for every case below; the `hidden` block flipped in 5.3.1 (register #14),
 * because that namespace is the one whose wrong shape fails OPEN — the
 * discarded intent leaves a file SERVED that the operator meant to hide, and
 * nothing reveals it until someone requests the file. Those cases now warn,
 * and each message announces the 6.0.0 throw; the message contract itself is
 * pinned in __tests__/hidden-shape-warnings.test.js, this file keeps asserting
 * that the SERVED behaviour did not move.
 *
 * Everything else here is still silent, deliberately — including
 * compression.mimeTypes (#15) and the two opposite boolean conventions (#16),
 * which remain open in the register. When 6.0.0 promotes them, this file is
 * the inventory of what has to change, and each failing assertion names the
 * option — exactly how the `hidden` flip announced itself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');

// The config-warning dedup is module-level (once per process per distinct
// message), so a second server built with the same malformed value would warn
// nothing and make these assertions order-dependent. Same remedy as
// url-prefix-reserved-validation.test.js: a fresh module per test.
let koaClassicServer;
beforeEach(() => {
    jest.resetModules();
    koaClassicServer = require('../index.cjs');
});

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-shape-audit-'));
    fs.writeFileSync(path.join(root, 'index.html'), 'ROOT INDEX');
    fs.writeFileSync(path.join(root, '.env'), 'DB_PASSWORD=hunter2');
    fs.writeFileSync(path.join(root, 'secret.key'), 'PRIVATE KEY');
    fs.writeFileSync(path.join(root, 'note.txt'), 'z'.repeat(4000)); // compressible, above minFileSize
    fs.mkdirSync(path.join(root, 'sub'));
    fs.writeFileSync(path.join(root, 'sub', 'inner.txt'), 'inner');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function capturingLogger() {
    const warns = [];
    const errors = [];
    return {
        warns,
        errors,
        warn: (...a) => warns.push(a.map(String).join(' ')),
        error: (...a) => errors.push(a.map(String).join(' ')),
    };
}

// Extension-less fixtures come back as application/octet-stream, which
// supertest delivers as a Buffer in res.body rather than as res.text.
function bodyText(res) {
    if (typeof res.text === 'string' && res.text.length) return res.text;
    return Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body);
}

// Builds a server AND returns the logger, so every case can assert both the
// served behavior and what the operator was (not) told.
function makeServer(opts = {}) {
    const logger = capturingLogger();
    const app = new Koa();
    app.use(koaClassicServer(root, { logger, ...opts }));
    app.use(async (ctx) => { ctx.status = 599; ctx.body = 'NEXT'; });
    return { server: app.callback(), logger };
}

// ─── hidden: the shapes that leave a secret served ───────────────────────────

describe('hidden — a wrong shape fails OPEN, and now says so (#14, 5.3.1)', () => {
    test('baseline: the correct shape hides the dot-file', async () => {
        const { server } = makeServer({ hidden: { dotFiles: { default: 'hidden' } } });
        expect((await supertest(server).get('/.env')).status).toBe(404);
    });

    test('hidden.dotFiles: "hidden" (string instead of { default }) → .env STAYS SERVED, reported', async () => {
        // normalizeCategory() rejects any non-object and falls back to the
        // system default ('visible'). The operator's intent is lost entirely.
        const { server, logger } = makeServer({ hidden: { dotFiles: 'hidden' } });
        const res = await supertest(server).get('/.env');
        expect(res.status).toBe(200);
        // .env has no extension → application/octet-stream, so the payload
        // arrives as a Buffer rather than res.text.
        expect(bodyText(res)).toContain('hunter2');
        // Behaviour is deliberately UNCHANGED (hidden is v2-stable); what
        // changed in 5.3.1 is that the discarded intent is now reported, and
        // the message names the 6.0.0 throw. Full message contract:
        // __tests__/hidden-shape-warnings.test.js
        expect(logger.warns.join('\n')).toMatch(/hidden\.dotFiles must be an object/);
        expect(logger.warns.join('\n')).toMatch(/WILL throw in a future major version/);
    });

    test('hidden.dotFiles.blacklist: ".env" (string instead of array) → .env STAYS SERVED, reported', async () => {
        // filterPatternList() returns [] for anything that is not an array.
        const { server, logger } = makeServer({ hidden: { dotFiles: { blacklist: '.env' } } });
        expect((await supertest(server).get('/.env')).status).toBe(200);
        expect(logger.warns.join('\n')).toMatch(/hidden\.dotFiles\.blacklist must be an ARRAY/);
    });

    test('hidden.alwaysHide: "*.key" (string instead of array) → secret.key STAYS SERVED, reported', async () => {
        const { server, logger } = makeServer({ hidden: { alwaysHide: '*.key' } });
        expect((await supertest(server).get('/secret.key')).status).toBe(200);
        expect(logger.warns.join('\n')).toMatch(/hidden\.alwaysHide must be an ARRAY/);
    });

    test('hidden: "yes" (not an object) → the whole namespace is discarded, reported', async () => {
        const { server, logger } = makeServer({ hidden: 'yes' });
        expect((await supertest(server).get('/.env')).status).toBe(200);
        expect(logger.warns.join('\n')).toMatch(/hidden must be an object/);
    });

    test('invalid ENTRIES inside a valid list are dropped; the valid ones still apply', async () => {
        const { server } = makeServer({ hidden: { alwaysHide: [123, null, {}, '*.key'] } });
        expect((await supertest(server).get('/secret.key')).status).toBe(404);
        expect((await supertest(server).get('/note.txt')).status).toBe(200);
    });

    test('hidden.dotFiles.default with an unknown value DOES throw (the one guarded field)', () => {
        expect(() => koaClassicServer(root, { hidden: { dotFiles: { default: 'maybe' } } }))
            .toThrow(/must be "hidden" or "visible"/);
    });
});

// ─── compression.mimeTypes: an empty-vs-garbage asymmetry ────────────────────

describe('compression.mimeTypes — empty falls back, garbage replaces', () => {
    const gz = (server) => supertest(server).get('/note.txt').set('Accept-Encoding', 'gzip');

    test('baseline: text/plain is compressible under the default list', async () => {
        const { server } = makeServer({});
        expect((await gz(server)).headers['content-encoding']).toBe('gzip');
    });

    test('[] (empty array) → the DEFAULT list is kept, not an empty one', async () => {
        const { server } = makeServer({ compression: { mimeTypes: [] } });
        expect((await gz(server)).headers['content-encoding']).toBe('gzip');
    });

    test('a non-array value → the default list is kept', async () => {
        for (const value of ['text/plain', null, {}]) {
            const { server } = makeServer({ compression: { mimeTypes: value } });
            expect((await gz(server)).headers['content-encoding']).toBe('gzip');
        }
    });

    test('a non-empty list of GARBAGE replaces the defaults → compression silently off', async () => {
        // The asymmetry: [] is treated as "unset", but [123] is treated as a
        // deliberate list that happens to match no MIME type. A typo'd list
        // therefore disables compression for the whole deployment with no
        // warning, and without even a Vary to hint that negotiation happened.
        const { server, logger } = makeServer({ compression: { mimeTypes: [123] } });
        const res = await gz(server);
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBeUndefined();
        expect(res.headers.vary).toBeUndefined();
        expect(logger.warns).toEqual([]);
    });

    test('a valid custom list replaces the defaults — that part is intentional', async () => {
        const { server } = makeServer({ compression: { mimeTypes: ['application/json'] } });
        expect((await gz(server)).headers['content-encoding']).toBeUndefined();
    });
});

// ─── index: invalid entries are skipped, never fatal ─────────────────────────

describe('index — entries that are neither string nor RegExp', () => {
    test('invalid entries are skipped; a valid one further down the array still wins', async () => {
        const { server, logger } = makeServer({ index: [42, null, {}, 'index.html'] });
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toBe('ROOT INDEX');
        expect(logger.warns).toEqual([]);
    });

    test('an array of ONLY invalid entries behaves as "no index configured"', async () => {
        const { server } = makeServer({ index: [42, {}] });
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('<!DOCTYPE html>'); // the listing, not the index file
    });

    test('with the listing off, an all-invalid index array 404s rather than throwing', async () => {
        const { server } = makeServer({ index: [42, {}], dirListing: { enabled: false } });
        expect((await supertest(server).get('/')).status).toBe(404);
    });

    test('a non-empty STRING still throws with the v3 migration hint (guarded)', () => {
        expect(() => koaClassicServer(root, { index: 'index.html' }))
            .toThrow(/no longer accepts a string/);
    });
});

// ─── boolean options: truthiness, not validation ─────────────────────────────

describe('boolean options coerce by truthiness — the classic "false" string trap', () => {
    test('dirListing.enabled: "false" is TRUTHY → the listing is ENABLED', async () => {
        const { server, logger } = makeServer({ dirListing: { enabled: 'false' }, index: [] });
        const res = await supertest(server).get('/sub/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('inner.txt');
        expect(logger.warns).toEqual([]);
    });

    test('dirListing.enabled: 0 is falsy → the listing is disabled', async () => {
        const { server } = makeServer({ dirListing: { enabled: 0 }, index: [] });
        expect((await supertest(server).get('/sub/')).status).toBe(404);
    });

    test('dirListing.trailingSlash: "no" is TRUTHY → the 301 stays on', async () => {
        const { server } = makeServer({ dirListing: { trailingSlash: 'no' }, index: [] });
        const res = await supertest(server).get('/sub').redirects(0);
        expect(res.status).toBe(301);
        expect(res.headers.location).toBe('/sub/');
    });

    test('dirListing.trailingSlash: 0 is falsy → the directory is served without the redirect', async () => {
        const { server } = makeServer({ dirListing: { trailingSlash: 0 }, index: [] });
        const res = await supertest(server).get('/sub').redirects(0);
        expect(res.status).toBe(200);
    });

    test('browserCacheEnabled uses the OPPOSITE rule: non-boolean → false, not truthiness', async () => {
        // `typeof x === 'boolean' ? x : false`. So browserCacheEnabled: "yes"
        // — which reads as "on" and is truthy — turns caching OFF, while
        // dirListing.enabled: "false" turns the listing ON. Two booleans, two
        // coercion conventions, neither reported: #11 material.
        const { server, logger } = makeServer({ browserCacheEnabled: 'yes' });
        const res = await supertest(server).get('/note.txt');
        expect(res.headers.etag).toBeUndefined();
        expect(res.headers['cache-control']).toContain('no-store');
        expect(logger.warns).toEqual([]);
    });

    test('browserCacheEnabled: true (a real boolean) does enable the validators', async () => {
        const { server } = makeServer({ browserCacheEnabled: true });
        const res = await supertest(server).get('/note.txt');
        expect(res.headers.etag).toBeDefined();
        expect(res.headers['cache-control']).toMatch(/max-age=/);
    });

    test('browserCacheEnabled: 0 keeps the no-store headers', async () => {
        const { server } = makeServer({ browserCacheEnabled: 0 });
        const res = await supertest(server).get('/note.txt');
        expect(res.headers.etag).toBeUndefined();
        expect(res.headers['cache-control']).toContain('no-store');
    });

    test('serverCache.rawFile.enabled uses the strict rule too — "true" does NOT enable it', async () => {
        // Pinned in config-normalization-more.test.js from the cache side;
        // repeated here so the audit table is complete in one place.
        const { server } = makeServer({ serverCache: { rawFile: { enabled: 'true' } } });
        expect((await supertest(server).get('/note.txt')).status).toBe(200);
    });
});

// ─── template.ext: the one free-form list that DOES report ───────────────────

describe('template.ext — the shape audit is already done here', () => {
    test('a non-array value disables template matching silently', async () => {
        let called = false;
        const { server, logger } = makeServer({
            template: { render: async () => { called = true; }, ext: '.txt' },
        });
        const res = await supertest(server).get('/note.txt');
        expect(res.status).toBe(200);
        expect(called).toBe(false); // served as static content
        expect(logger.warns).toEqual([]);
    });

    test('an invalid ENTRY inside the array IS reported (the #10 precedent)', () => {
        const logger = capturingLogger();
        koaClassicServer(root, { logger, template: { render: async () => {}, ext: [42] } });
        expect(logger.warns.join('\n')).toMatch(/template\.ext entries/);
    });
});

// ─── logger: fully guarded, for contrast ─────────────────────────────────────

describe('logger — the shape that is validated properly (reference behavior)', () => {
    test.each([
        ['null', null],
        ['an array', []],
        ['a function', function noop() {}],
    ])('%s throws at factory time', (_label, value) => {
        expect(() => koaClassicServer(root, { logger: value }))
            .toThrow(/must be an object exposing error\(\) and warn\(\)/);
    });

    test('an object missing error() throws', () => {
        expect(() => koaClassicServer(root, { logger: { warn() {} } }))
            .toThrow(/must implement both error\(\) and warn\(\)/);
    });

    test('an object missing warn() throws', () => {
        expect(() => koaClassicServer(root, { logger: { error() {} } }))
            .toThrow(/must implement both error\(\) and warn\(\)/);
    });
});
