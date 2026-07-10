/**
 * browserCacheMaxAge validation — finding #12 of docs/revisione_codice_v3.1.md.
 *
 * An invalid value (negative, NaN, non-integer, Infinity, or a string) previously
 * fell back to 3600 SILENTLY. Consistent with #11, the factory now emits a
 * once-per-process DEPRECATION warning and keeps the 3600 fallback (a future major
 * will throw with validateNonNegativeInt semantics — so what warns here is exactly
 * what will throw then). The deprecation dedup is module-level (once per process),
 * so each test gets a fresh module via jest.resetModules().
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
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-bcma-'));
    fs.writeFileSync(path.join(root, 'file.txt'), 'hi');
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function cacheControl(server) {
    return supertest(server).get('/file.txt').then(r => r.headers['cache-control']);
}

describe('browserCacheMaxAge validation (#12)', () => {
    test('never throws on an invalid value', () => {
        for (const bad of [-5, 1.5, Infinity, NaN, '3600', null]) {
            expect(() => koaClassicServer(root, { browserCacheMaxAge: bad, logger: capturingLogger() }))
                .not.toThrow();
        }
    });

    test.each([
        ['negative', -5],
        ['non-integer', 1.5],
        ['Infinity', Infinity],
        ['NaN', NaN],
        ['string', '7200'],
    ])('invalid (%s) → warns and falls back to max-age=3600', async (label, bad) => {
        const logger = capturingLogger();
        const app = new Koa();
        app.silent = true;
        app.use(koaClassicServer(root, { browserCacheEnabled: true, browserCacheMaxAge: bad, logger }));
        const server = app.listen();
        try {
            expect(logger.warns.join('\n')).toMatch(/DEPRECATION:.*browserCacheMaxAge must be a non-negative integer/);
            expect(await cacheControl(server)).toBe('public, max-age=3600, must-revalidate');
        } finally { server.close(); }
    });

    test('valid value is used and does NOT warn', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.silent = true;
        app.use(koaClassicServer(root, { browserCacheEnabled: true, browserCacheMaxAge: 7200, logger }));
        const server = app.listen();
        try {
            expect(logger.warns.join('\n')).not.toMatch(/browserCacheMaxAge/);
            expect(await cacheControl(server)).toBe('public, max-age=7200, must-revalidate');
        } finally { server.close(); }
    });

    test('0 is valid (no browser cache window) — used, no warn', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.silent = true;
        app.use(koaClassicServer(root, { browserCacheEnabled: true, browserCacheMaxAge: 0, logger }));
        const server = app.listen();
        try {
            expect(logger.warns.join('\n')).not.toMatch(/browserCacheMaxAge/);
            expect(await cacheControl(server)).toBe('public, max-age=0, must-revalidate');
        } finally { server.close(); }
    });

    test('undefined → default 3600, no warn', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.silent = true;
        app.use(koaClassicServer(root, { browserCacheEnabled: true, logger }));
        const server = app.listen();
        try {
            expect(logger.warns.join('\n')).not.toMatch(/browserCacheMaxAge/);
            expect(await cacheControl(server)).toBe('public, max-age=3600, must-revalidate');
        } finally { server.close(); }
    });

    test('warning is deduped once-per-process for the same message', () => {
        const logger = capturingLogger();
        koaClassicServer(root, { browserCacheMaxAge: -5, logger });
        koaClassicServer(root, { browserCacheMaxAge: -5, logger });
        const count = logger.warns.filter(w => /browserCacheMaxAge must be/.test(w)).length;
        expect(count).toBe(1);
    });

    test('the caller options object is not mutated', () => {
        const cfg = { browserCacheMaxAge: -5, logger: capturingLogger() };
        koaClassicServer(root, cfg);
        expect(cfg.browserCacheMaxAge).toBe(-5); // internal copy coerced, caller intact
    });
});
