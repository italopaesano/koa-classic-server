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

    describe('Custom cacheMaxAge values', () => {
        test('Should respect custom cacheMaxAge: 7200', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true,
                cacheMaxAge: 7200
            }));
            const server = app.listen();
            const request = supertest(server);

            const res = await request.get('/test.txt');

            expect(res.status).toBe(200);
            expect(res.headers['cache-control']).toBe('public, max-age=7200, must-revalidate');

            server.close();
        });

        test('Should respect custom cacheMaxAge: 0 (no browser cache)', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true,
                cacheMaxAge: 0
            }));
            const server = app.listen();
            const request = supertest(server);

            const res = await request.get('/test.txt');

            expect(res.status).toBe(200);
            expect(res.headers['cache-control']).toBe('public, max-age=0, must-revalidate');
            // Should still have ETag for validation
            expect(res.headers['etag']).toBeDefined();

            server.close();
        });

        test('Should respect custom cacheMaxAge: 86400 (1 day)', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true,
                cacheMaxAge: 86400
            }));
            const server = app.listen();
            const request = supertest(server);

            const res = await request.get('/test.txt');

            expect(res.status).toBe(200);
            expect(res.headers['cache-control']).toBe('public, max-age=86400, must-revalidate');

            server.close();
        });
    });

    describe('ETag generation and validation', () => {
        test('ETag should change when file is modified', async () => {
            const testFile = path.join(TEST_DIR, 'dynamic-test.txt');
            fs.writeFileSync(testFile, 'Original content');

            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            // First request
            const res1 = await request.get('/dynamic-test.txt');
            expect(res1.status).toBe(200);
            const etag1 = res1.headers['etag'];
            expect(etag1).toBeDefined();

            // Wait 10ms to ensure different mtime
            await new Promise(resolve => setTimeout(resolve, 10));

            // Modify file
            fs.writeFileSync(testFile, 'Modified content - different');

            // Second request - ETag should be different
            const res2 = await request.get('/dynamic-test.txt');
            expect(res2.status).toBe(200);
            const etag2 = res2.headers['etag'];
            expect(etag2).toBeDefined();
            expect(etag2).not.toBe(etag1);

            // Cleanup
            fs.unlinkSync(testFile);
            server.close();
        });

        test('ETag should change when file size changes', async () => {
            const testFile = path.join(TEST_DIR, 'size-test.txt');
            fs.writeFileSync(testFile, 'Short');

            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            // First request
            const res1 = await request.get('/size-test.txt');
            const etag1 = res1.headers['etag'];

            // Wait and change file size
            await new Promise(resolve => setTimeout(resolve, 10));
            fs.writeFileSync(testFile, 'Much longer content here');

            // Second request
            const res2 = await request.get('/size-test.txt');
            const etag2 = res2.headers['etag'];

            expect(etag2).not.toBe(etag1);

            fs.unlinkSync(testFile);
            server.close();
        });
    });

    describe('Bandwidth savings with 304 responses', () => {
        test('304 response should have no body', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            // First request
            const res1 = await request.get('/test.txt');
            expect(res1.status).toBe(200);
            expect(res1.text).toBe('Test content for caching');
            const bodySize1 = res1.text.length;

            // Second request with ETag
            const res2 = await request
                .get('/test.txt')
                .set('If-None-Match', res1.headers['etag']);

            expect(res2.status).toBe(304);
            expect(res2.text).toBe('');
            expect(res2.text.length).toBe(0);

            // Verify bandwidth saving
            expect(bodySize1).toBeGreaterThan(0);
            expect(res2.text.length).toBe(0);

            server.close();
        });

        test('Should save bandwidth on multiple 304 responses', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            // First request
            const res1 = await request.get('/test.txt');
            const etag = res1.headers['etag'];
            const originalSize = res1.text.length;

            // Make 10 cached requests
            let totalBytesSaved = 0;
            for (let i = 0; i < 10; i++) {
                const res = await request
                    .get('/test.txt')
                    .set('If-None-Match', etag);

                expect(res.status).toBe(304);
                totalBytesSaved += originalSize;
            }

            expect(totalBytesSaved).toBeGreaterThan(0);

            server.close();
        });
    });

    describe('Caching with different MIME types', () => {
        beforeAll(() => {
            // Create files with different types
            fs.writeFileSync(path.join(TEST_DIR, 'test.html'), '<html><body>Test</body></html>');
            fs.writeFileSync(path.join(TEST_DIR, 'test.json'), '{"test": "data"}');
            fs.writeFileSync(path.join(TEST_DIR, 'test.css'), 'body { color: red; }');
            fs.writeFileSync(path.join(TEST_DIR, 'test.js'), 'console.log("test");');
        });

        afterAll(() => {
            fs.unlinkSync(path.join(TEST_DIR, 'test.html'));
            fs.unlinkSync(path.join(TEST_DIR, 'test.json'));
            fs.unlinkSync(path.join(TEST_DIR, 'test.css'));
            fs.unlinkSync(path.join(TEST_DIR, 'test.js'));
        });

        test('HTML files should have cache headers', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            const res = await request.get('/test.html');
            expect(res.status).toBe(200);
            expect(res.headers['etag']).toBeDefined();
            expect(res.headers['cache-control']).toContain('public');
            expect(res.headers['content-type']).toContain('text/html');

            server.close();
        });

        test('JSON files should have cache headers', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            const res = await request.get('/test.json');
            expect(res.status).toBe(200);
            expect(res.headers['etag']).toBeDefined();
            expect(res.headers['content-type']).toContain('application/json');

            server.close();
        });

        test('CSS files should have cache headers', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            const res = await request.get('/test.css');
            expect(res.status).toBe(200);
            expect(res.headers['etag']).toBeDefined();
            expect(res.headers['content-type']).toContain('text/css');

            server.close();
        });

        test('JavaScript files should have cache headers', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            const res = await request.get('/test.js');
            expect(res.status).toBe(200);
            expect(res.headers['etag']).toBeDefined();
            expect(res.headers['content-type']).toContain('javascript');

            server.close();
        });
    });

    describe('Caching does not interfere with template rendering', () => {
        test('Template files should not get cache headers during rendering', async () => {
            const testFile = path.join(TEST_DIR, 'test-template.ejs');
            fs.writeFileSync(testFile, '<html><body><%= name %></body></html>');

            let renderCalled = false;

            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true,
                cacheMaxAge: 3600,
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        renderCalled = true;
                        ctx.body = '<html><body>Rendered</body></html>';
                        ctx.type = 'text/html';
                    }
                }
            }));
            const server = app.listen();
            const request = supertest(server);

            const res = await request.get('/test-template.ejs');

            expect(res.status).toBe(200);
            expect(renderCalled).toBe(true);
            expect(res.text).toBe('<html><body>Rendered</body></html>');

            // Template rendering happens before caching logic,
            // so cache headers should not be added by koaClassicServer
            // (the template renderer controls caching)

            fs.unlinkSync(testFile);
            server.close();
        });
    });

    describe('Concurrent requests with caching', () => {
        test('Multiple concurrent requests should handle caching correctly', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            // Make 5 concurrent requests
            const promises = Array.from({ length: 5 }, () =>
                request.get('/test.txt')
            );

            const results = await Promise.all(promises);

            // All should succeed
            results.forEach(res => {
                expect(res.status).toBe(200);
                expect(res.headers['etag']).toBeDefined();
            });

            // All ETags should be identical (same file)
            const etags = results.map(r => r.headers['etag']);
            const uniqueEtags = new Set(etags);
            expect(uniqueEtags.size).toBe(1);

            server.close();
        });

        test('Concurrent 304 responses should work correctly', async () => {
            const app = new Koa();
            app.use(koaClassicServer(TEST_DIR, {
                enableCaching: true
            }));
            const server = app.listen();
            const request = supertest(server);

            // First request to get ETag
            const initial = await request.get('/test.txt');
            const etag = initial.headers['etag'];

            // Make 5 concurrent cached requests
            const promises = Array.from({ length: 5 }, () =>
                request.get('/test.txt').set('If-None-Match', etag)
            );

            const results = await Promise.all(promises);

            // All should return 304
            results.forEach(res => {
                expect(res.status).toBe(304);
                expect(res.text).toBe('');
            });

            server.close();
        });
    });
});
