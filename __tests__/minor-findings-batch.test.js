/**
 * Minor-findings batch — regression tests for #5, #7, #8, #11, #12, #13 of
 * docs/revisione_codice_v4.3.md.
 *
 *  #5  listing always sends an explicit no-cache policy
 *  #7  Vary is appended via ctx.vary(), never overwritten
 *  #8  formatSize covers PB/EB and clamps instead of "N undefined"
 *  #11 parseRangeHeader is digit-strict (RFC 9110 §14.2 on malformed specs)
 *  #12 repeated query parameters degrade deterministically (first wins)
 *  #13 serverCache/compression numeric fields warn on invalid values
 *      (behavior unchanged: same silent-era fallback, throw in next major)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const { parseRangeHeader, formatSize } = require('../index.cjs')._internals;

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-minor-'));
    fs.writeFileSync(path.join(root, 'alpha.txt'), 'alpha');
    fs.writeFileSync(path.join(root, 'beta.txt'), 'beta-longer');
    fs.writeFileSync(path.join(root, 'big.html'), '<!doctype html>' + 'x'.repeat(2048));
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function capturingLogger() {
    const warns = [];
    return { warns, warn: (...args) => warns.push(args.map(String).join(' ')), error: () => {} };
}

function makeServer(opts = {}, preMiddleware = null) {
    const app = new Koa();
    if (preMiddleware) app.use(preMiddleware);
    app.use(koaClassicServer(root, opts));
    return app.listen();
}

// ─── #5 — listing always carries an explicit no-cache policy ─────────────────

describe('#5 — listing Cache-Control', () => {
    test.each([
        ['browserCacheEnabled: false', { browserCacheEnabled: false }],
        ['browserCacheEnabled: true',  { browserCacheEnabled: true }],
    ])('listing sends the no-cache trio with %s', async (_label, opts) => {
        const server = makeServer(opts);
        try {
            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
            expect(res.headers['pragma']).toBe('no-cache');
            expect(res.headers['expires']).toBe('0');
        } finally {
            server.close();
        }
    });

    test('file responses keep their own policy (public with browserCacheEnabled)', async () => {
        const server = makeServer({ browserCacheEnabled: true });
        try {
            const res = await supertest(server).get('/alpha.txt');
            expect(res.headers['cache-control']).toMatch(/^public, max-age=/);
        } finally {
            server.close();
        }
    });
});

// ─── #7 — Vary appends instead of overwriting ────────────────────────────────

describe('#7 — Vary from upstream middleware survives', () => {
    test('a pre-set Vary: Origin is merged with Accept-Encoding', async () => {
        const server = makeServer({}, (ctx, next) => { ctx.vary('Origin'); return next(); });
        try {
            const res = await supertest(server).get('/big.html').set('Accept-Encoding', 'gzip');
            expect(res.status).toBe(200);
            const vary = res.headers['vary'];
            expect(vary).toContain('Origin');
            expect(vary).toContain('Accept-Encoding');
        } finally {
            server.close();
        }
    });
});

// ─── #8 — formatSize beyond TB ───────────────────────────────────────────────

describe('#8 — formatSize PB/EB and clamping', () => {
    test('petabytes and exabytes get real unit labels', () => {
        expect(formatSize(2 * 1024 ** 5)).toBe('2 PB');
        expect(formatSize(3 * 1024 ** 6)).toBe('3 EB');
    });

    test('off-scale sizes clamp to the last unit instead of "N undefined"', () => {
        const out = formatSize(1024 ** 8); // beyond EB
        expect(out).not.toContain('undefined');
        expect(out.endsWith(' EB')).toBe(true);
    });

    test('existing units are untouched', () => {
        expect(formatSize(1536)).toBe('1.5 KB');
        expect(formatSize(1024 ** 4)).toBe('1 TB');
    });
});

// ─── #11 — strict Range digit validation ────────────────────────────────────

describe('#11 — parseRangeHeader rejects garbage digits', () => {
    const SIZE = 100;

    test.each([
        ['garbage after start', 'bytes=1x-5'],
        ['garbage after end', 'bytes=0-5y'],
        ['garbage both sides', 'bytes=1x-5y'],
        ['leading space in start', 'bytes= 0-5'],
        ['plus sign', 'bytes=+1-5'],
        ['double dash suffix', 'bytes=--5'],
        ['hex-looking start', 'bytes=0x10-20'],
    ])('%s → invalid (full 200), not a guessed 206', (_label, spec) => {
        expect(parseRangeHeader(spec, SIZE)).toBe('invalid');
    });

    test('valid specs are untouched by the tightening', () => {
        expect(parseRangeHeader('bytes=0-4', SIZE)).toEqual({ start: 0, end: 4 });
        expect(parseRangeHeader('bytes=90-', SIZE)).toEqual({ start: 90, end: 99 });
        expect(parseRangeHeader('bytes=-10', SIZE)).toEqual({ start: 90, end: 99 });
    });

    test('HTTP level: a garbage Range answers 200 with the full body', async () => {
        const server = makeServer();
        try {
            const res = await supertest(server).get('/alpha.txt').set('Range', 'bytes=1x-3y');
            expect(res.status).toBe(200);
            expect(res.text).toBe('alpha');
        } finally {
            server.close();
        }
    });
});

// ─── #12 — repeated query parameters ─────────────────────────────────────────

describe('#12 — repeated sort/order/page parameters take the first value', () => {
    let server;
    beforeAll(() => { server = makeServer({ dirListing: { entriesPerPage: 2 } }); });
    afterAll(() => server.close());

    test('?sort=name&sort=size sorts by name and links stay clean', async () => {
        const res = await supertest(server).get('/?sort=name&sort=size&order=asc');
        expect(res.status).toBe(200);
        // Deterministic name-ascending order: alpha before beta before big.
        expect(res.text.indexOf('alpha.txt')).toBeLessThan(res.text.indexOf('beta.txt'));
        // Regenerated links carry the first value only — never "name,size".
        expect(res.text).not.toContain('name%2Csize');
        expect(res.text).toContain('sort=name');
    });

    test('?page=0&page=1 lands deterministically on page 0', async () => {
        const res = await supertest(server).get('/?page=0&page=1');
        expect(res.status).toBe(200);
        expect(res.headers['x-dir-pagination']).toMatch(/^0\//);
    });
});

// ─── #13 — invalid numeric config values warn instead of silent fallback ─────

describe('#13 — serverCache/compression invalid sizes warn (behavior unchanged)', () => {
    test.each([
        ['serverCache.rawFile.maxSize', { serverCache: { rawFile: { maxSize: -1 } } }, 'rawFile.maxSize'],
        ['serverCache.rawFile.maxFileSize', { serverCache: { rawFile: { maxFileSize: '1mb' } } }, 'rawFile.maxFileSize'],
        ['serverCache.compressedFile.maxSize', { serverCache: { compressedFile: { maxSize: 0 } } }, 'compressedFile.maxSize'],
        ['compression.minFileSize', { compression: { minFileSize: -7 } }, 'compression.minFileSize'],
        ['compression.maxFileSize', { compression: { maxFileSize: '10MB' } }, 'compression.maxFileSize'],
    ])('%s: invalid value → one DEPRECATION warn, factory still builds', (_label, opts, fieldName) => {
        const logger = capturingLogger();
        expect(() => koaClassicServer(root, { ...opts, logger })).not.toThrow();
        const hits = logger.warns.filter((w) => w.includes('DEPRECATION') && w.includes(fieldName));
        expect(hits.length).toBe(1);
    });

    test('valid values — including false where allowed — do not warn', () => {
        const logger = capturingLogger();
        koaClassicServer(root, {
            logger,
            serverCache: { rawFile: { maxSize: 1000, maxFileSize: 500 }, compressedFile: { maxSize: 2000 } },
            compression: { minFileSize: false, maxFileSize: false },
        });
        expect(logger.warns.filter((w) => w.includes('DEPRECATION'))).toEqual([]);
    });

    test('the fallback behavior itself is unchanged (invalid value still serves)', async () => {
        const logger = capturingLogger();
        const server = makeServer({ serverCache: { rawFile: { enabled: true, maxSize: -99 } }, logger });
        try {
            const res = await supertest(server).get('/alpha.txt');
            expect(res.status).toBe(200);
            expect(res.text).toBe('alpha');
        } finally {
            server.close();
        }
    });
});
