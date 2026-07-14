/**
 * compression.buffered / compression.streaming — configurable quality (V4.3+).
 *
 * Contract under test:
 *   - factory-time validation: the two groups must be plain objects; unknown
 *     keys throw (typo protection on a brand-new namespace); brotliQuality is
 *     an integer 0-11 and gzipLevel an integer 0-9, boundaries included
 *   - the BUFFERED path (file <= compression.maxFileSize, output cached)
 *     compresses at compression.buffered quality: the response Content-Length
 *     matches a local one-shot compression at the same settings byte-for-byte
 *   - the STREAMING path (file > compression.maxFileSize) builds its zlib
 *     transform with compression.streaming settings, and the brotli window
 *     stays pinned at LGWIN 19 regardless of configuration
 *   - defaults are unchanged: buffered br Q11 / gzip 9, streaming br Q4 / gzip 6
 *   - bodies round-trip to the original content at every quality
 *
 * Fixtures are created in a temp dir:
 *   repeat.txt — 16 KB of repeated text (compresses well; makes level 0 vs
 *                max-level sizes differ by orders of magnitude)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const REPEAT_CONTENT = 'The quick brown fox jumps over the lazy dog. '.repeat(364); // 16380 B

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-compression-quality-'));
    fs.writeFileSync(path.join(fixturesDir, 'repeat.txt'), REPEAT_CONTENT);
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function createApp(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(fixturesDir, { dirListing: { enabled: false }, ...opts }));
    return app.listen();
}

// ─── factory-time validation ─────────────────────────────────────────────────

describe('compression quality groups — factory validation', () => {
    const factory = (compression) => () => koaClassicServer(fixturesDir, { compression });

    test.each(['buffered', 'streaming'])('%s must be a plain object', (group) => {
        expect(factory({ [group]: 'high' })).toThrow(new RegExp(`compression\\.${group} must be an object`));
        expect(factory({ [group]: [11] })).toThrow(new RegExp(`compression\\.${group} must be an object`));
        expect(factory({ [group]: null })).toThrow(new RegExp(`compression\\.${group} must be an object`));
    });

    test.each(['buffered', 'streaming'])('an unknown key in %s throws naming the valid keys', (group) => {
        expect(factory({ [group]: { brotliQualty: 6 } })) // typo on purpose
            .toThrow(/brotliQualty is not a valid option[\s\S]*Valid keys: brotliQuality, gzipLevel/);
    });

    test.each([
        ['buffered', 12], ['buffered', -1], ['buffered', 5.5], ['buffered', '9'],
        ['streaming', 12], ['streaming', NaN],
    ])('%s.brotliQuality rejects %p', (group, value) => {
        expect(factory({ [group]: { brotliQuality: value } }))
            .toThrow(new RegExp(`compression\\.${group}\\.brotliQuality must be an integer between 0 and 11`));
    });

    test.each([
        ['buffered', 10], ['buffered', -1], ['buffered', 3.3], ['buffered', 'max'],
        ['streaming', 10], ['streaming', true],
    ])('%s.gzipLevel rejects %p', (group, value) => {
        expect(factory({ [group]: { gzipLevel: value } }))
            .toThrow(new RegExp(`compression\\.${group}\\.gzipLevel must be an integer between 0 and 9`));
    });

    test('range boundaries are accepted (brotli 0/11, gzip 0/9)', () => {
        expect(factory({
            buffered: { brotliQuality: 0, gzipLevel: 0 },
            streaming: { brotliQuality: 11, gzipLevel: 9 },
        })).not.toThrow();
    });

    test('a partial group keeps the default for the omitted key', async () => {
        // Only gzipLevel overridden: brotli must still work with its default (Q11).
        const server = createApp({ compression: { buffered: { gzipLevel: 5 } } });
        try {
            const res = await supertest(server).get('/repeat.txt').set('Accept-Encoding', 'br');
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBe('br');
            expect(res.text).toBe(REPEAT_CONTENT);
        } finally {
            server.close();
        }
    });
});

// ─── buffered path: configured quality is what actually runs ─────────────────

describe('compression.buffered — quality reaches the buffered compressor', () => {
    // The buffered path is one-shot zlib over the whole file, so its output is
    // byte-identical to a local one-shot compression with the same settings —
    // Content-Length pins the EXACT configured quality, not just "some effect".
    async function bufferedWireSize(compression, encoding) {
        const server = createApp({ compression });
        try {
            const res = await supertest(server).get('/repeat.txt').set('Accept-Encoding', encoding);
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBe(encoding);
            expect(res.text).toBe(REPEAT_CONTENT); // round-trip at every quality
            return Number(res.headers['content-length']);
        } finally {
            server.close();
        }
    }

    test('gzipLevel: 3 → Content-Length equals a local gzip at level 3', async () => {
        const size = await bufferedWireSize({ buffered: { gzipLevel: 3 } }, 'gzip');
        expect(size).toBe(zlib.gzipSync(Buffer.from(REPEAT_CONTENT), { level: 3 }).length);
    });

    test('brotliQuality: 5 → Content-Length equals a local brotli at Q5', async () => {
        const size = await bufferedWireSize({ buffered: { brotliQuality: 5 } }, 'br');
        expect(size).toBe(zlib.brotliCompressSync(Buffer.from(REPEAT_CONTENT), {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
        }).length);
    });

    test('defaults unchanged: gzip 9 and brotli Q11', async () => {
        const gzipSize = await bufferedWireSize(undefined, 'gzip');
        expect(gzipSize).toBe(zlib.gzipSync(Buffer.from(REPEAT_CONTENT), { level: 9 }).length);

        const brSize = await bufferedWireSize(undefined, 'br');
        expect(brSize).toBe(zlib.brotliCompressSync(Buffer.from(REPEAT_CONTENT), {
            params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
        }).length);
    });

    test('gzipLevel: 0 (stored) is orders of magnitude larger than the default', async () => {
        const stored = await bufferedWireSize({ buffered: { gzipLevel: 0 } }, 'gzip');
        const best = await bufferedWireSize(undefined, 'gzip');
        expect(stored).toBeGreaterThan(REPEAT_CONTENT.length); // level 0 = stored + framing
        expect(best).toBeLessThan(1024);
    });
});

// ─── streaming path: configured quality builds the zlib transform ────────────

// zlib's factory functions are read-only (writable: false) module properties,
// so jest.spyOn cannot wrap them — but they ARE configurable, so a manual
// defineProperty stub works. Wraps the real factory, records the options of
// every call, and restores the original descriptor on restore().
function stubZlibFactory(name) {
    const real = zlib[name];
    const calls = [];
    Object.defineProperty(zlib, name, {
        value: (...args) => { calls.push(args); return real.apply(zlib, args); },
        writable: false, configurable: true, enumerable: true,
    });
    return {
        calls,
        restore: () => Object.defineProperty(zlib, name, {
            value: real, writable: false, configurable: true, enumerable: true,
        }),
    };
}

describe('compression.streaming — quality reaches the stream compressor', () => {
    // Streamed output size is not monotonic in quality (measured: br Q11 can be
    // LARGER than Q7 on repetitive text), so byte-size assertions would be
    // fragile. Instead we intercept the zlib factory calls and assert the exact
    // options the middleware passes (plus a round-trip on the body).
    function streamingApp(compression) {
        return createApp({
            compression: { maxFileSize: 2048, ...(compression || {}) }, // repeat.txt (16 KB) → streaming
            serverCache: { compressedFile: { enabled: false } },        // pure streaming, no tee
        });
    }

    test('gzipLevel: 2 → createGzip receives { level: 2 }; body round-trips', async () => {
        const stub = stubZlibFactory('createGzip');
        const server = streamingApp({ streaming: { gzipLevel: 2 } });
        try {
            const res = await supertest(server).get('/repeat.txt').set('Accept-Encoding', 'gzip');
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBe('gzip');
            expect(res.headers['content-length']).toBeUndefined(); // streamed
            expect(res.text).toBe(REPEAT_CONTENT);
        } finally {
            server.close();
            stub.restore();
        }
        expect(stub.calls).toContainEqual([{ level: 2 }]);
    });

    test('brotliQuality: 7 → createBrotliCompress receives Q7 with LGWIN pinned at 19', async () => {
        const stub = stubZlibFactory('createBrotliCompress');
        const server = streamingApp({ streaming: { brotliQuality: 7 } });
        try {
            const res = await supertest(server).get('/repeat.txt').set('Accept-Encoding', 'br');
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBe('br');
            expect(res.text).toBe(REPEAT_CONTENT);
        } finally {
            server.close();
            stub.restore();
        }
        expect(stub.calls).toContainEqual([{ params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 7,
            [zlib.constants.BROTLI_PARAM_LGWIN]: 19,
        } }]);
    });

    test('defaults unchanged: streaming gzip 6 and brotli Q4 + LGWIN 19', async () => {
        const gzipStub = stubZlibFactory('createGzip');
        const brStub = stubZlibFactory('createBrotliCompress');
        const server = streamingApp();
        try {
            await supertest(server).get('/repeat.txt').set('Accept-Encoding', 'gzip');
            await supertest(server).get('/repeat.txt').set('Accept-Encoding', 'br');
        } finally {
            server.close();
            gzipStub.restore();
            brStub.restore();
        }
        expect(gzipStub.calls).toContainEqual([{ level: 6 }]);
        expect(brStub.calls).toContainEqual([{ params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
            [zlib.constants.BROTLI_PARAM_LGWIN]: 19,
        } }]);
    });

    test('the tee path (cache enabled) uses the same streaming quality', async () => {
        const stub = stubZlibFactory('createGzip');
        const server = createApp({ compression: { maxFileSize: 2048, streaming: { gzipLevel: 1 } } });
        try {
            const res = await supertest(server).get('/repeat.txt').set('Accept-Encoding', 'gzip');
            expect(res.status).toBe(200);
            expect(res.text).toBe(REPEAT_CONTENT);
        } finally {
            server.close();
            stub.restore();
        }
        expect(stub.calls).toContainEqual([{ level: 1 }]);
    });
});
