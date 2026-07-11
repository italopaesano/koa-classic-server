/**
 * Config-normalization edge cases — 2026-07 test-expansion pass.
 *
 * Each test pins the OBSERVABLE behavior of a factory-time coercion that was
 * previously untested: what warning the operator sees and what the middleware
 * actually does afterwards. These are resilience contracts — a bad config value
 * must degrade predictably (warn + safe fallback, or throw with a hint), never
 * turn into a per-request 500 or a silent behavior change.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-config-norm-'));
    fs.writeFileSync(path.join(fixturesDir, 'file.txt'), 'plain content');
    fs.writeFileSync(path.join(fixturesDir, 'page.ejs'), '<h1><%= not.rendered %></h1>');
    // Large enough to clear the default compression.minFileSize (1024)
    fs.writeFileSync(path.join(fixturesDir, 'large.txt'), 'L'.repeat(4096));
    // Small file BELOW the default minFileSize but above 0
    fs.writeFileSync(path.join(fixturesDir, 'small.txt'), 'S'.repeat(128));
    fs.mkdirSync(path.join(fixturesDir, 'sub'));
    fs.writeFileSync(path.join(fixturesDir, 'sub', 'inner.txt'), 'inner');
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function capturingLogger() {
    const warns = [];
    const errors = [];
    return {
        warns,
        errors,
        warn: (...args) => warns.push(args.map(String).join(' ')),
        error: (...args) => errors.push(args.map(String).join(' ')),
    };
}

function createServer(opts = {}) {
    const app = new Koa();
    app.on('error', () => {});
    app.use(koaClassicServer(fixturesDir, opts));
    return app.listen();
}

// ─── urlsReserved: null / null entries ───────────────────────────────────────

describe('urlsReserved null-shaped values', () => {
    test('urlsReserved: null → warned as "null" (not "object"), coerced to []', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger, urlsReserved: null });
        try {
            const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
            expect(res.status).toBe(200); // nothing reserved — file served normally
        } finally {
            server.close();
        }
        // The warning must say "null", not typeof null === 'object'
        expect(logger.warns.some(w => /urlsReserved should be an array.*got null/.test(w))).toBe(true);
    });

    test('a null ENTRY is dropped with a warning naming "null"', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger, urlsReserved: ['/sub', null] });
        try {
            // The valid entry still reserves; the null one is dropped, not crashed on
            const reserved = await supertest(server).get('/sub/inner.txt');
            const normal = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
            expect(reserved.status).toBe(404); // fell through to Koa default
            expect(normal.status).toBe(200);
        } finally {
            server.close();
        }
        expect(logger.warns.some(w => /dropping a non-string \(null\) entry/.test(w))).toBe(true);
    });
});

// ─── template.render that is not a function ──────────────────────────────────

describe('template.render non-function', () => {
    test('render: "string" is discarded — matching ext files are served as static content', async () => {
        const server = createServer({
            template: { ext: ['ejs'], render: 'this is not a function' },
        });
        try {
            const res = await supertest(server).get('/page.ejs').set('Accept-Encoding', 'identity');
            // Served raw from disk (no render attempt, no 500).
            // .ejs has no known MIME → application/octet-stream → supertest
            // exposes the payload as a Buffer body, not res.text.
            expect(res.status).toBe(200);
            const payload = res.text || (res.body && res.body.toString());
            expect(payload).toBe('<h1><%= not.rendered %></h1>');
        } finally {
            server.close();
        }
    });
});

// ─── compression.enabled coercions ───────────────────────────────────────────

describe('compression.enabled coercion', () => {
    test('non-boolean enabled ("yes") is treated as enabled', async () => {
        const server = createServer({ compression: { enabled: 'yes' } });
        try {
            const res = await supertest(server).get('/large.txt').set('Accept-Encoding', 'gzip');
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBe('gzip');
        } finally {
            server.close();
        }
    });

    test('enabled: false inside the object disables compression entirely', async () => {
        const server = createServer({ compression: { enabled: false } });
        try {
            const res = await supertest(server).get('/large.txt').set('Accept-Encoding', 'gzip, br');
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBeUndefined();
            expect(res.headers['vary']).toBeUndefined(); // never negotiates when off
        } finally {
            server.close();
        }
    });
});

// ─── compression.minFileSize invalid values fall back to the 1024 default ────

describe('compression.minFileSize invalid values', () => {
    test.each([
        ['negative number', -5],
        ['string', '2048'],
        ['NaN', NaN],
    ])('%s → default 1024 applies (128-byte file NOT compressed, 4 KB file compressed)', async (_label, bad) => {
        const server = createServer({ compression: { minFileSize: bad } });
        try {
            const small = await supertest(server).get('/small.txt').set('Accept-Encoding', 'gzip');
            const large = await supertest(server).get('/large.txt').set('Accept-Encoding', 'gzip');
            expect(small.status).toBe(200);
            expect(small.headers['content-encoding']).toBeUndefined(); // below default threshold
            expect(large.status).toBe(200);
            expect(large.headers['content-encoding']).toBe('gzip');    // above default threshold
        } finally {
            server.close();
        }
    });
});

// ─── compression.encodings: unknown tokens filtered out ─────────────────────

describe('compression.encodings filtering', () => {
    test('unsupported tokens (deflate, zstd) are dropped; the valid one still works', async () => {
        const server = createServer({ compression: { encodings: ['deflate', 'zstd', 'gzip'] } });
        try {
            const res = await supertest(server).get('/large.txt').set('Accept-Encoding', 'deflate, gzip, br');
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBe('gzip'); // 'br' was not configured, deflate dropped
        } finally {
            server.close();
        }
    });

    test('encodings: [] (everything filtered) → compression effectively off, no Vary', async () => {
        const server = createServer({ compression: { encodings: ['deflate'] } });
        try {
            const res = await supertest(server).get('/large.txt').set('Accept-Encoding', 'gzip, br');
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBeUndefined();
            expect(res.headers['vary']).toBeUndefined();
        } finally {
            server.close();
        }
    });
});

// ─── serverCache.rawFile.enabled non-boolean → stays DISABLED (safe default) ─

describe('serverCache.rawFile.enabled coercion', () => {
    test('enabled: "true" (string) does NOT enable the cache — files are streamed, not readFile()d', async () => {
        const server = createServer({
            serverCache: { rawFile: { enabled: 'true' } },
            compression: false, // keep the request on the plain static path
        });
        const readFileSpy = jest.spyOn(fs.promises, 'readFile');
        try {
            const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
            expect(res.status).toBe(200);
            expect(res.text).toBe('plain content');
            // rawFile cache population is the only readFile on this path — with the
            // cache correctly OFF, the file must have been streamed from disk.
            const cachedReads = readFileSpy.mock.calls
                .filter(c => String(c[0]).endsWith('file.txt'));
            expect(cachedReads.length).toBe(0);
        } finally {
            server.close();
        }
    });
});

// ─── urlPrefix: null gets the "null" wording too ─────────────────────────────

describe('urlPrefix: null', () => {
    test('warned as "null" and coerced to "" (serves from root)', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger, urlPrefix: null });
        try {
            const res = await supertest(server).get('/file.txt').set('Accept-Encoding', 'identity');
            expect(res.status).toBe(200);
        } finally {
            server.close();
        }
        expect(logger.warns.some(w => /urlPrefix should be a string.*got null/.test(w))).toBe(true);
    });
});
