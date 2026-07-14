/**
 * serverCache.compressedFile.maxEntrySize — per-entry admission cap (V4.3+).
 *
 * Contract under test:
 *   - factory-time validation: positive integer (bytes) or false; anything
 *     else throws; a value above maxSize throws (config contradiction — the
 *     hint points to false)
 *   - default unchanged: maxSize / 4 (the historical tee-path cap, existing
 *     coverage in compression-stream-tee.test.js still asserts it)
 *   - TEE path: an explicit maxEntrySize overrides the 25% default in both
 *     directions (admit an output the default would refuse; refuse an output
 *     the default would admit); false lifts the per-entry cap entirely
 *   - BUFFERED path: the cap now applies to every insertion — an oversized
 *     compressed output is still served (with Content-Length) but never
 *     cached, with a throttled warning naming maxEntrySize
 *
 * Fixtures are created in a temp dir:
 *   random.txt — 8192 chars of random hex (gzip output ~4 KB, incompressible
 *                enough to sit between the caps used below)
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const RANDOM_CONTENT = crypto.randomBytes(4096).toString('hex'); // 8192 chars, high entropy

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-max-entry-size-'));
    fs.writeFileSync(path.join(fixturesDir, 'random.txt'), RANDOM_CONTENT);
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

function capturingLogger() {
    const warns = [];
    return {
        warns,
        warn: (...args) => warns.push(args.map(String).join(' ')),
        error: () => {},
    };
}

// Counts fs.createReadStream calls (the streaming path opens the file with it;
// a cache hit never touches the disk).
function instrumentReadStream() {
    const real = fs.createReadStream;
    const calls = [];
    jest.spyOn(fs, 'createReadStream').mockImplementation((...args) => {
        calls.push(String(args[0]));
        return real.apply(fs, args);
    });
    return calls;
}

// Counts fs.promises.readFile calls (the buffered compression path reads the
// whole file with it on every cache miss; a cache hit never touches the disk).
function instrumentReadFile() {
    const real = fs.promises.readFile;
    const calls = [];
    jest.spyOn(fs.promises, 'readFile').mockImplementation((...args) => {
        calls.push(String(args[0]));
        return real.apply(fs.promises, args);
    });
    return calls;
}

// ─── factory-time validation ─────────────────────────────────────────────────

describe('maxEntrySize — factory validation', () => {
    const factory = (compressedFile) => () =>
        koaClassicServer(fixturesDir, { serverCache: { compressedFile } });

    test.each([0, -5, 1.5, '1000', null, NaN, Infinity])('rejects %p', (value) => {
        expect(factory({ maxEntrySize: value }))
            .toThrow(/maxEntrySize must be a positive integer \(bytes\) or false/);
    });

    test('a value above maxSize throws and the hint points to false', () => {
        expect(factory({ maxSize: 1000, maxEntrySize: 2000 }))
            .toThrow(/maxEntrySize \(2000\) exceeds maxSize \(1000\)[\s\S]*Use false/);
    });

    test('a value equal to maxSize is accepted; so is false', () => {
        expect(factory({ maxSize: 1000, maxEntrySize: 1000 })).not.toThrow();
        expect(factory({ maxEntrySize: false })).not.toThrow();
    });
});

// ─── tee path (file > compression.maxFileSize) ───────────────────────────────
// random.txt's gzip output (~4 KB) sits above the default cap for
// maxSize: 8000 (25% → 2000 B) but below the explicit caps used here.

describe('maxEntrySize — tee path overrides the 25% default', () => {
    test('explicit cap above the output admits an entry the default would refuse', async () => {
        const server = createApp({
            compression: { maxFileSize: 2048 },
            serverCache: { compressedFile: { maxSize: 8000, maxEntrySize: 7000 } },
        });
        try {
            // Sanity: the output really is above the 25% default (2000) and below 7000.
            const gzSize = zlib.gzipSync(RANDOM_CONTENT).length;
            expect(gzSize).toBeGreaterThan(2000);
            expect(gzSize).toBeLessThan(7000);

            const first = await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            expect(first.status).toBe(200);
            expect(first.headers['content-length']).toBeUndefined(); // cold: streamed

            const calls = instrumentReadStream();
            const second = await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            expect(second.status).toBe(200);
            expect(second.headers['content-length']).toBeDefined(); // RAM hit
            expect(second.text).toBe(RANDOM_CONTENT);
            expect(calls.filter((p) => p.includes('random.txt')).length).toBe(0); // no disk read
        } finally {
            server.close();
        }
    });

    test('false lifts the per-entry cap: the entry is admitted up to maxSize', async () => {
        const server = createApp({
            compression: { maxFileSize: 2048 },
            serverCache: { compressedFile: { maxSize: 8000, maxEntrySize: false } },
        });
        try {
            await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            const second = await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            expect(second.headers['content-length']).toBeDefined(); // cached despite > maxSize/4
            expect(second.text).toBe(RANDOM_CONTENT);
        } finally {
            server.close();
        }
    });

    test('an explicit cap below the output keeps every request streaming', async () => {
        const server = createApp({
            compression: { maxFileSize: 2048 },
            serverCache: { compressedFile: { maxSize: 1024 * 1024, maxEntrySize: 1000 } },
        });
        try {
            await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            const calls = instrumentReadStream();
            const second = await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            expect(second.status).toBe(200);
            expect(second.headers['content-length']).toBeUndefined(); // never cached
            expect(second.text).toBe(RANDOM_CONTENT);
            expect(calls.filter((p) => p.includes('random.txt')).length).toBe(1); // disk again
        } finally {
            server.close();
        }
    });
});

// ─── buffered path (file <= compression.maxFileSize) ─────────────────────────

describe('maxEntrySize — buffered path: oversized output served but not cached', () => {
    test('every request recompresses; a throttled warning names maxEntrySize', async () => {
        const logger = capturingLogger();
        const server = createApp({
            logger,
            // default compression.maxFileSize (10 MB) → random.txt goes buffered
            serverCache: { compressedFile: { maxSize: 8000, maxEntrySize: 1000 } },
        });
        try {
            const calls = instrumentReadFile();

            const first = await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            expect(first.status).toBe(200);
            expect(first.headers['content-encoding']).toBe('gzip');
            expect(first.headers['content-length']).toBeDefined(); // buffered: size known
            expect(first.text).toBe(RANDOM_CONTENT);

            const second = await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            expect(second.status).toBe(200);
            expect(second.text).toBe(RANDOM_CONTENT);

            // Refused by the cache → both requests re-read the file from disk.
            expect(calls.filter((p) => p.includes('random.txt')).length).toBe(2);
        } finally {
            server.close();
        }
        expect(logger.warns.some((w) => /exceeds maxEntrySize \(1000 bytes\)/.test(w))).toBe(true);
        expect(logger.warns.some((w) => /serverCache\.compressedFile\.maxEntrySize/.test(w))).toBe(true);
    });

    test('with maxEntrySize: false the same entry IS cached (control case)', async () => {
        const server = createApp({
            serverCache: { compressedFile: { maxSize: 8000, maxEntrySize: false } },
        });
        try {
            await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            const calls = instrumentReadFile();
            const second = await supertest(server).get('/random.txt').set('Accept-Encoding', 'gzip');
            expect(second.status).toBe(200);
            expect(second.text).toBe(RANDOM_CONTENT);
            expect(calls.filter((p) => p.includes('random.txt')).length).toBe(0); // RAM hit
        } finally {
            server.close();
        }
    });
});
