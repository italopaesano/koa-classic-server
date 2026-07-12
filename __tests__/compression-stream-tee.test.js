/**
 * Streamed-compression tee — caching the streamed output above
 * compression.maxFileSize (performance follow-up to finding #4 of
 * docs/revisione_codice_v3.1.md).
 *
 * Contract under test:
 *   - a file above compression.maxFileSize is streamed on the first request
 *     (no Content-Length), and its compressed OUTPUT is teed into the
 *     compressed cache when it fits in a quarter of that cache's maxSize
 *   - the second request is a RAM hit: Content-Length known, identical bytes,
 *     no disk read
 *   - br and gzip populate independent entries
 *   - an output above the per-entry cap (maxSize / 4) is never cached
 *   - a modified file (mtime/size) is never served stale from the teed entry
 *   - a client abort mid-stream never inserts a (truncated) entry
 *   - concurrent cold requests all receive valid responses; the cache ends up
 *     populated once
 *   - serverCache.compressedFile.enabled: false keeps the pure streaming
 *     behavior (nothing cached)
 *
 * Fixtures are created in a temp dir:
 *   big.txt    — 16 KB of repeated text (compresses to ~a hundred bytes)
 *   random.txt — 8192 chars of random hex (gzip output well above 1 KB)
 *   huge.txt   — ~4 MB of random hex (big enough to abort mid-stream)
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const BIG_CONTENT = 'The quick brown fox jumps over the lazy dog. '.repeat(364); // 16380 B
const RANDOM_CONTENT = crypto.randomBytes(4096).toString('hex'); // 8192 chars, high entropy
const HUGE_CONTENT = crypto.randomBytes(2 * 1024 * 1024).toString('hex'); // 4 MiB

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-stream-tee-'));
    fs.writeFileSync(path.join(fixturesDir, 'big.txt'), BIG_CONTENT);
    fs.writeFileSync(path.join(fixturesDir, 'random.txt'), RANDOM_CONTENT);
    fs.writeFileSync(path.join(fixturesDir, 'huge.txt'), HUGE_CONTENT);
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

// Every file in these tests sits above this cap → streaming mode.
function createApp(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(fixturesDir, {
        dirListing: { enabled: false },
        compression: { maxFileSize: 2048, ...(opts.compression || {}) },
        ...opts,
    }));
    return app.listen();
}

// Collects the response body as a Buffer. NOTE: superagent transparently
// inflates br/gzip at the stream level, so this receives the PLAIN bytes —
// content assertions compare directly against the fixture, while the
// Content-Length header (when present) still describes the compressed wire size.
const binaryParser = (res, cb) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
};

function getRaw(server, urlPath, encoding) {
    return supertest(server)
        .get(urlPath)
        .set('Accept-Encoding', encoding)
        .buffer(true)
        .parse(binaryParser);
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

// ─── miss → tee → hit ─────────────────────────────────────────────────────────

describe('stream tee — the streamed output is cached and reused', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('first request streams (no Content-Length), bytes decompress to the file', async () => {
        const res = await getRaw(server, '/big.txt', 'br');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('br');
        expect(res.headers['content-length']).toBeUndefined();
        expect(res.body.toString()).toBe(BIG_CONTENT);
    });

    test('second request is a RAM hit: Content-Length, same bytes, no disk read', async () => {
        const calls = instrumentReadStream();
        const res = await getRaw(server, '/big.txt', 'br');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('br');
        expect(res.headers['content-length']).toBeDefined(); // compressed size, now known
        expect(res.body.toString()).toBe(BIG_CONTENT);
        expect(calls.filter((p) => p.includes('big.txt')).length).toBe(0);
    });

    test('gzip populates its own entry, independent from br', async () => {
        const first = await getRaw(server, '/big.txt', 'gzip');
        expect(first.headers['content-encoding']).toBe('gzip');
        expect(first.headers['content-length']).toBeUndefined(); // separate entry: first gzip request streams

        const second = await getRaw(server, '/big.txt', 'gzip');
        expect(second.headers['content-encoding']).toBe('gzip');
        expect(second.headers['content-length']).toBeDefined();
        expect(second.body.toString()).toBe(BIG_CONTENT);
    });
});

// ─── per-entry cap: maxSize / 4 ───────────────────────────────────────────────

describe('stream tee — an output above a quarter of the cache is never cached', () => {
    let server;
    beforeAll(() => {
        // entryCap = 8000 / 4 = 2000 B; random.txt's gzip output is ~4 KB.
        server = createApp({
            serverCache: { compressedFile: { maxSize: 8000 } },
        });
    });
    afterAll(() => server.close());

    test('every request keeps streaming; nothing is inserted', async () => {
        const first = await getRaw(server, '/random.txt', 'gzip');
        expect(first.status).toBe(200);
        // Sanity on the fixture: the gzip output really exceeds the 2000 B cap.
        expect(zlib.gzipSync(RANDOM_CONTENT).length).toBeGreaterThan(2000);

        const calls = instrumentReadStream();
        const second = await getRaw(server, '/random.txt', 'gzip');
        expect(second.status).toBe(200);
        expect(second.headers['content-length']).toBeUndefined();
        expect(second.body.toString()).toBe(RANDOM_CONTENT);
        expect(calls.filter((p) => p.includes('random.txt')).length).toBe(1); // read from disk again
    });
});

// ─── staleness: a modified file is never served from the old entry ───────────

describe('stream tee — cache entry is invalidated when the file changes', () => {
    test('after a rewrite, the new content is served (and re-cached)', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-stream-tee-stale-'));
        const filePath = path.join(dir, 'data.txt');
        const before = 'aaaa'.repeat(1024); // 4096 B
        const after = 'bbbbbb'.repeat(1024); // 6144 B — different size AND mtime
        fs.writeFileSync(filePath, before);

        const app = new Koa();
        app.use(koaClassicServer(dir, {
            dirListing: { enabled: false },
            compression: { maxFileSize: 2048 },
        }));
        const server = app.listen();
        try {
            await getRaw(server, '/data.txt', 'gzip'); // stream + tee
            const cachedRes = await getRaw(server, '/data.txt', 'gzip');
            expect(cachedRes.headers['content-length']).toBeDefined(); // entry in place
            expect(cachedRes.body.toString()).toBe(before);

            fs.writeFileSync(filePath, after);

            const freshRes = await getRaw(server, '/data.txt', 'gzip');
            expect(freshRes.status).toBe(200);
            expect(freshRes.body.toString()).toBe(after); // never the stale bytes

            const recached = await getRaw(server, '/data.txt', 'gzip');
            expect(recached.headers['content-length']).toBeDefined();
            expect(recached.body.toString()).toBe(after);
        } finally {
            server.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ─── client abort: no truncated entry ────────────────────────────────────────

describe('stream tee — a client abort mid-stream never poisons the cache', () => {
    test('after an abort, the next request streams from scratch and gets full bytes', async () => {
        const server = createApp();
        try {
            const { port } = server.address();

            // Abort as soon as the first compressed chunk arrives.
            await new Promise((resolve, reject) => {
                const req = http.get(
                    { port, path: '/huge.txt', headers: { 'accept-encoding': 'gzip' } },
                    (res) => {
                        res.once('data', () => {
                            req.destroy();
                            resolve();
                        });
                    }
                );
                req.on('error', reject);
            });
            // Let the server-side pipeline observe the premature close.
            await new Promise((r) => setTimeout(r, 200));

            // Nothing was cached: this request streams again (no Content-Length)
            // and the bytes are the COMPLETE file — a truncated cached entry
            // would surface here as short/corrupt content with a Content-Length.
            const res = await getRaw(server, '/huge.txt', 'gzip');
            expect(res.status).toBe(200);
            expect(res.headers['content-length']).toBeUndefined();
            expect(res.body.toString()).toBe(HUGE_CONTENT);

            // ...and that clean completion DID cache.
            const cachedRes = await getRaw(server, '/huge.txt', 'gzip');
            expect(cachedRes.headers['content-length']).toBeDefined();
            expect(cachedRes.body.toString()).toBe(HUGE_CONTENT);
        } finally {
            server.close();
        }
    });
});

// ─── concurrent cold requests (leader/follower) ──────────────────────────────

describe('stream tee — concurrent cold requests are all valid, cache populated once', () => {
    test('5 simultaneous first requests, then a RAM hit', async () => {
        const server = createApp();
        try {
            const results = await Promise.all(
                Array.from({ length: 5 }, () => getRaw(server, '/big.txt', 'gzip'))
            );
            for (const res of results) {
                expect(res.status).toBe(200);
                expect(res.headers['content-encoding']).toBe('gzip');
                expect(res.body.toString()).toBe(BIG_CONTENT);
            }
            const afterHerd = await getRaw(server, '/big.txt', 'gzip');
            expect(afterHerd.headers['content-length']).toBeDefined();
            expect(afterHerd.body.toString()).toBe(BIG_CONTENT);
        } finally {
            server.close();
        }
    });
});

// ─── read error mid-pipeline: 500, no insert ─────────────────────────────────

describe('stream tee — a source read error never inserts an entry', () => {
    test('failed stream → surfaced error + log; next request streams the real bytes', async () => {
        const errors = [];
        const logger = { error: (...a) => errors.push(a.join(' ')), warn: () => {} };
        const app = new Koa();
        app.on('error', () => {}); // silence Koa's default stderr logging
        app.use(koaClassicServer(fixturesDir, {
            dirListing: { enabled: false },
            compression: { maxFileSize: 2048 },
            logger,
        }));
        const server = app.listen();
        try {
            const { Readable } = require('stream');
            jest.spyOn(fs, 'createReadStream').mockImplementationOnce(() =>
                new Readable({
                    read() { this.destroy(new Error('forced read failure')); },
                })
            );
            // Koa 3 tears the socket down on mid-stream errors, so the client
            // may observe an exception rather than a 500 status.
            let surfaced = false;
            try {
                const failed = await getRaw(server, '/big.txt', 'gzip');
                surfaced = failed.status >= 500;
            } catch (_clientErr) {
                surfaced = true;
            }
            expect(surfaced).toBe(true);
            expect(errors.some((e) => e.includes('forced read failure'))).toBe(true);

            jest.restoreAllMocks();
            // Nothing was cached by the failed attempt: this request streams
            // from scratch (no Content-Length) and serves the complete file.
            const res = await getRaw(server, '/big.txt', 'gzip');
            expect(res.status).toBe(200);
            expect(res.headers['content-length']).toBeUndefined();
            expect(res.body.toString()).toBe(BIG_CONTENT);
        } finally {
            server.close();
        }
    });
});

// ─── compressed cache disabled: pure streaming, tee not reachable ────────────

describe('stream tee — compressed cache disabled keeps pure streaming', () => {
    test('no request ever gets a Content-Length', async () => {
        const server = createApp({
            serverCache: { compressedFile: { enabled: false } },
        });
        try {
            const first = await getRaw(server, '/big.txt', 'gzip');
            const second = await getRaw(server, '/big.txt', 'gzip');
            expect(first.headers['content-length']).toBeUndefined();
            expect(second.headers['content-length']).toBeUndefined();
            expect(second.body.toString()).toBe(BIG_CONTENT);
        } finally {
            server.close();
        }
    });
});
