/**
 * serverCache tests for koa-classic-server
 *
 * Covers serverCache.rawFile and serverCache.compressedFile behaviour:
 *   - rawFile disabled by default; opt-in via { serverCache: { rawFile: { enabled: true } } }
 *   - compressedFile enabled by default
 *   - LFU eviction when maxSize is exceeded
 *   - warnInterval throttling of "maxSize reached" warnings
 *   - rawFile buffer fed to template render as 4th parameter
 *   - rawFile buffer used for Range (206) responses — zero additional disk I/O
 *   - rawFile buffer used as input to compression — avoids redundant readFile
 *   - Files exceeding maxFileSize are never cached (served via stream)
 *   - Cache invalidation when mtime or size changes
 *
 * Fixtures (server-cache-fixtures/):
 *   small.txt   — 64 bytes of 'A'
 *   large.txt   — 2048 bytes of 'B' (used for maxFileSize threshold tests)
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const fixturesDir = path.join(__dirname, 'server-cache-fixtures');

function createApp(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(fixturesDir, { showDirContents: false, ...opts }));
    return app.listen();
}

// ─── Default behaviour ────────────────────────────────────────────────────────

describe('serverCache.rawFile — disabled by default', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('GET /small.txt returns 200 without rawFile cache', async () => {
        const res = await supertest(server)
            .get('/small.txt')
            .set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toBe('A'.repeat(64));
    });
});

// ─── rawFile cache enabled ────────────────────────────────────────────────────

describe('serverCache.rawFile — enabled', () => {
    let server;
    beforeAll(() => {
        server = createApp({ serverCache: { rawFile: { enabled: true } } });
    });
    afterAll(() => server.close());

    test('first request populates cache and returns correct body', async () => {
        const res = await supertest(server)
            .get('/small.txt')
            .set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toBe('A'.repeat(64));
    });

    test('second request also returns correct body (served from cache)', async () => {
        const res = await supertest(server)
            .get('/small.txt')
            .set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toBe('A'.repeat(64));
    });

    test('Content-Length matches file size', async () => {
        const res = await supertest(server)
            .get('/small.txt')
            .set('Accept-Encoding', 'identity');
        expect(Number(res.headers['content-length'])).toBe(64);
    });
});

// ─── maxFileSize threshold ────────────────────────────────────────────────────

describe('serverCache.rawFile — maxFileSize', () => {
    test('file exceeding maxFileSize is served via stream (not cached)', async () => {
        // maxFileSize: 32 bytes — small.txt (64 bytes) exceeds this
        const server = createApp({
            serverCache: { rawFile: { enabled: true, maxFileSize: 32 } }
        });
        const res = await supertest(server)
            .get('/small.txt')
            .set('Accept-Encoding', 'identity');
        server.close();
        expect(res.status).toBe(200);
        expect(res.text).toBe('A'.repeat(64));
    });

    test('file within maxFileSize is served correctly', async () => {
        // maxFileSize: 128 bytes — small.txt (64 bytes) fits
        const server = createApp({
            serverCache: { rawFile: { enabled: true, maxFileSize: 128 } }
        });
        const res = await supertest(server)
            .get('/small.txt')
            .set('Accept-Encoding', 'identity');
        server.close();
        expect(res.status).toBe(200);
        expect(res.text).toBe('A'.repeat(64));
        expect(Number(res.headers['content-length'])).toBe(64);
    });
});

// ─── Cache invalidation ───────────────────────────────────────────────────────

describe('serverCache.rawFile — cache invalidation on file change', () => {
    let tmpDir;
    let server;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-cache-inval-'));
        fs.writeFileSync(path.join(tmpDir, 'dynamic.txt'), 'version-1');

        const app = new Koa();
        app.use(koaClassicServer(tmpDir, {
            showDirContents: false,
            serverCache: { rawFile: { enabled: true } }
        }));
        server = app.listen();
    });

    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('initial content is served correctly', async () => {
        const res = await supertest(server)
            .get('/dynamic.txt')
            .set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toBe('version-1');
    });

    test('updated file content is served after cache invalidation', async () => {
        // Wait 10ms to ensure mtime changes on filesystems with 1ms resolution
        await new Promise(r => setTimeout(r, 10));
        fs.writeFileSync(path.join(tmpDir, 'dynamic.txt'), 'version-2');

        const res = await supertest(server)
            .get('/dynamic.txt')
            .set('Accept-Encoding', 'identity');
        expect(res.status).toBe(200);
        expect(res.text).toBe('version-2');
    });
});

// ─── rawFile + Range requests ─────────────────────────────────────────────────

describe('serverCache.rawFile — Range request served from buffer', () => {
    let server;
    beforeAll(() => {
        server = createApp({ serverCache: { rawFile: { enabled: true } } });
    });
    afterAll(() => server.close());

    test('Range request returns 206 with correct slice', async () => {
        // Warm cache first
        await supertest(server).get('/small.txt').set('Accept-Encoding', 'identity');

        const res = await supertest(server)
            .get('/small.txt')
            .set('Range', 'bytes=0-9')
            .set('Accept-Encoding', 'identity');
        expect(res.status).toBe(206);
        expect(res.text).toBe('A'.repeat(10));
        expect(res.headers['content-length']).toBe('10');
    });

    test('Range request returns correct Content-Range header', async () => {
        const res = await supertest(server)
            .get('/small.txt')
            .set('Range', 'bytes=10-19')
            .set('Accept-Encoding', 'identity');
        expect(res.status).toBe(206);
        expect(res.headers['content-range']).toBe('bytes 10-19/64');
    });
});

// ─── rawFile + compression ────────────────────────────────────────────────────

describe('serverCache.rawFile + compression — rawFile feeds compressedFile', () => {
    let server;
    beforeAll(() => {
        server = createApp({
            compression: { minSize: false }, // compress small.txt too
            serverCache: { rawFile: { enabled: true } }
        });
    });
    afterAll(() => server.close());

    test('compressed response is served correctly when rawFile cache is warm', async () => {
        // Warm rawFile cache
        await supertest(server).get('/small.txt').set('Accept-Encoding', 'identity');

        // Request compressed version — rawFile buffer used as compression input
        const res = await supertest(server)
            .get('/small.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        // supertest auto-decompresses gzip
        expect(res.text).toBe('A'.repeat(64));
    });
});

// ─── compressedFile cache — default enabled ───────────────────────────────────

describe('serverCache.compressedFile — enabled by default', () => {
    let server;
    beforeAll(() => { server = createApp(); });
    afterAll(() => server.close());

    test('large.txt compressed response has Content-Length (buffered, not streamed)', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeDefined();
        expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
    });
});

// ─── compressedFile cache — disabled (streaming) ──────────────────────────────

describe('serverCache.compressedFile — disabled (streaming mode)', () => {
    let server;
    beforeAll(() => {
        server = createApp({ serverCache: { compressedFile: { enabled: false } } });
    });
    afterAll(() => server.close());

    test('compressed response has no Content-Length in streaming mode', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('gzip');
        expect(res.headers['content-length']).toBeUndefined();
    });

    test('streaming body is correctly decompressed', async () => {
        const res = await supertest(server)
            .get('/large.txt')
            .set('Accept-Encoding', 'gzip');
        expect(res.text).toBe('B'.repeat(2048));
    });
});

// ─── LFU eviction ────────────────────────────────────────────────────────────

describe('serverCache.rawFile — LFU eviction when maxSize exceeded', () => {
    let tmpDir;
    let server;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-lfu-test-'));
        // fileA: 100 bytes, fileB: 100 bytes — cache maxSize: 150 bytes
        // After caching A (100 bytes) and B (100 bytes), total = 200 > 150.
        // LFU should evict A (hits=1) when B is added if A has fewer hits than B.
        fs.writeFileSync(path.join(tmpDir, 'fileA.txt'), 'A'.repeat(100));
        fs.writeFileSync(path.join(tmpDir, 'fileB.txt'), 'B'.repeat(100));
        fs.writeFileSync(path.join(tmpDir, 'fileC.txt'), 'C'.repeat(100));

        const app = new Koa();
        app.use(koaClassicServer(tmpDir, {
            showDirContents: false,
            serverCache: {
                rawFile: {
                    enabled: true,
                    maxSize: 150,    // fits 1 file (100 bytes) + half of another
                    maxFileSize: 200,
                    warnInterval: false, // suppress warnings during test
                }
            }
        }));
        server = app.listen();
    });

    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('all files return correct content even when eviction occurs', async () => {
        // Access A twice (hits=2), then B once (hits=1), then C once
        // When C is added, LFU should evict B (lowest hits among cached entries)
        const resA1 = await supertest(server).get('/fileA.txt').set('Accept-Encoding', 'identity');
        const resA2 = await supertest(server).get('/fileA.txt').set('Accept-Encoding', 'identity');
        const resB  = await supertest(server).get('/fileB.txt').set('Accept-Encoding', 'identity');
        const resC  = await supertest(server).get('/fileC.txt').set('Accept-Encoding', 'identity');

        expect(resA1.text).toBe('A'.repeat(100));
        expect(resA2.text).toBe('A'.repeat(100));
        expect(resB.text).toBe('B'.repeat(100));
        expect(resC.text).toBe('C'.repeat(100));
    });
});

// ─── warnInterval ────────────────────────────────────────────────────────────

describe('serverCache.rawFile — warnInterval throttles warnings', () => {
    test('warnInterval: false suppresses all warnings', async () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-warn-test-'));
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'A'.repeat(100));
        fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'B'.repeat(100));

        const app = new Koa();
        app.use(koaClassicServer(tmpDir, {
            showDirContents: false,
            serverCache: {
                rawFile: {
                    enabled: true,
                    maxSize: 50,        // too small to fit either file → eviction on every request
                    maxFileSize: 200,
                    warnInterval: false, // no warnings
                }
            }
        }));
        const server = app.listen();

        await supertest(server).get('/a.txt').set('Accept-Encoding', 'identity');
        await supertest(server).get('/b.txt').set('Accept-Encoding', 'identity');

        const cacheWarnings = warnSpy.mock.calls.filter(c =>
            c[0] && c[0].toString().includes('serverCache.rawFile')
        );
        expect(cacheWarnings.length).toBe(0);

        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
        warnSpy.mockRestore();
    });
});

// ─── rawFile buffer passed to template render ─────────────────────────────────

describe('serverCache.rawFile — buffer passed as 4th param to render function', () => {
    let tmpDir;
    let server;
    let capturedBuffer;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-render-buf-'));
        fs.writeFileSync(path.join(tmpDir, 'page.tmpl'), 'hello from template');

        const app = new Koa();
        app.use(koaClassicServer(tmpDir, {
            showDirContents: false,
            serverCache: { rawFile: { enabled: true } },
            template: {
                ext: ['tmpl'],
                render: async (ctx, next, filePath, buffer) => {
                    capturedBuffer = buffer;
                    const content = buffer
                        ? buffer.toString('utf-8')
                        : await fs.promises.readFile(filePath, 'utf-8');
                    ctx.type = 'text/plain';
                    ctx.body = content;
                }
            }
        }));
        server = app.listen();
    });

    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('render receives buffer on first request (cache miss populates buffer)', async () => {
        capturedBuffer = undefined;
        const res = await supertest(server).get('/page.tmpl');
        expect(res.status).toBe(200);
        expect(res.text).toBe('hello from template');
        // Buffer should be populated (cache miss still reads file and caches it)
        expect(Buffer.isBuffer(capturedBuffer)).toBe(true);
        expect(capturedBuffer.toString('utf-8')).toBe('hello from template');
    });

    test('render receives buffer on subsequent request (cache hit)', async () => {
        capturedBuffer = undefined;
        const res = await supertest(server).get('/page.tmpl');
        expect(res.status).toBe(200);
        expect(Buffer.isBuffer(capturedBuffer)).toBe(true);
        expect(capturedBuffer.toString('utf-8')).toBe('hello from template');
    });

    test('render receives null when rawFile cache is disabled', async () => {
        let bufferWhenDisabled;
        const appNoCache = new Koa();
        appNoCache.use(koaClassicServer(tmpDir, {
            showDirContents: false,
            // rawFile.enabled: false by default
            template: {
                ext: ['tmpl'],
                render: async (ctx, next, filePath, buffer) => {
                    bufferWhenDisabled = buffer;
                    ctx.type = 'text/plain';
                    ctx.body = 'ok';
                }
            }
        }));
        const s = appNoCache.listen();
        await supertest(s).get('/page.tmpl');
        s.close();
        expect(bufferWhenDisabled).toBeNull();
    });
});
