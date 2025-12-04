/**
 * HTTP Caching Headers Test
 *
 * Tests to verify correct caching behavior:
 * - When enableCaching: true -> proper cache headers
 * - When enableCaching: false -> anti-cache headers
 */

const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const path = require('path');
const fs = require('fs');

const TEST_DIR = path.join(__dirname, 'test-caching-headers');

describe('HTTP Caching Headers', () => {
    beforeAll(() => {
        // Create test directory and file
        if (!fs.existsSync(TEST_DIR)) {
            fs.mkdirSync(TEST_DIR, { recursive: true });
        }
        fs.writeFileSync(path.join(TEST_DIR, 'test.txt'), 'Test content for caching');
    });

    afterAll(() => {
        // Cleanup
        if (fs.existsSync(TEST_DIR)) {
            fs.rmSync(TEST_DIR, { recursive: true, force: true });
        }
    });

    describe('When caching is DISABLED (enableCaching: false)', () => {
        let app;
        let server;
        let request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: false
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => {
            server.close();
        });

        test('Should return anti-cache headers', async () => {
            const res = await request.get('/test.txt');

            expect(res.status).toBe(200);

            // Verify anti-cache headers are present
            expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
            expect(res.headers['pragma']).toBe('no-cache');
            expect(res.headers['expires']).toBe('0');

            // Verify caching headers are NOT present
            expect(res.headers['etag']).toBeUndefined();
            expect(res.headers['last-modified']).toBeUndefined();
        });

        test('Should NOT return 304 even with If-None-Match header', async () => {
            // First request to get potential ETag (should not exist)
            const res1 = await request.get('/test.txt');
            expect(res1.status).toBe(200);

            // Second request with If-None-Match (should still return 200)
            const res2 = await request
                .get('/test.txt')
                .set('If-None-Match', '"fake-etag"');

            expect(res2.status).toBe(200);
            expect(res2.text).toBe('Test content for caching');
        });

        test('Should NOT return 304 even with If-Modified-Since header', async () => {
            const futureDate = new Date(Date.now() + 86400000).toUTCString();

            const res = await request
                .get('/test.txt')
                .set('If-Modified-Since', futureDate);

            expect(res.status).toBe(200);
            expect(res.text).toBe('Test content for caching');
        });
    });

    describe('When caching is ENABLED (enableCaching: true)', () => {
        let app;
        let server;
        let request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true,
                cacheMaxAge: 3600
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => {
            server.close();
        });

        test('Should return proper cache headers', async () => {
            const res = await request.get('/test.txt');

            expect(res.status).toBe(200);

            // Verify cache headers are present
            expect(res.headers['cache-control']).toBe('public, max-age=3600, must-revalidate');
            expect(res.headers['etag']).toBeDefined();
            expect(res.headers['last-modified']).toBeDefined();

            // Verify anti-cache headers are NOT present
            expect(res.headers['pragma']).toBeUndefined();
            expect(res.headers['expires']).not.toBe('0');
        });

        test('Should return 304 with matching ETag', async () => {
            // First request to get ETag
            const res1 = await request.get('/test.txt');
            expect(res1.status).toBe(200);
            const etag = res1.headers['etag'];
            expect(etag).toBeDefined();

            // Second request with If-None-Match
            const res2 = await request
                .get('/test.txt')
                .set('If-None-Match', etag);

            expect(res2.status).toBe(304);
            expect(res2.text).toBe('');
        });

        test('Should return 304 with If-Modified-Since (not modified)', async () => {
            // Get file stats and add 1 second to ensure it's after file mtime
            const stats = fs.statSync(path.join(TEST_DIR, 'test.txt'));
            const futureDate = new Date(stats.mtime.getTime() + 1000).toUTCString();

            // Request with If-Modified-Since header (1 second in future)
            const res = await request
                .get('/test.txt')
                .set('If-Modified-Since', futureDate);

            expect(res.status).toBe(304);
            expect(res.text).toBe('');
        });

        test('Should return 200 with If-Modified-Since (file modified)', async () => {
            // Use a date in the past
            const pastDate = new Date(Date.now() - 86400000).toUTCString();

            const res = await request
                .get('/test.txt')
                .set('If-Modified-Since', pastDate);

            expect(res.status).toBe(200);
            expect(res.text).toBe('Test content for caching');
        });
    });

    describe('Default behavior (caching disabled by default)', () => {
        let app;
        let server;
        let request;

        beforeAll(() => {
            app = new Koa();
            // No options provided - should default to enableCaching: false
            app.use(koaClassicServer(TEST_DIR));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => {
            server.close();
        });

        test('Should have anti-cache headers by default', async () => {
            const res = await request.get('/test.txt');

            expect(res.status).toBe(200);
            expect(res.headers['cache-control']).toBe('no-cache, no-store, must-revalidate');
            expect(res.headers['pragma']).toBe('no-cache');
            expect(res.headers['expires']).toBe('0');
        });
    });
});
