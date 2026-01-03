//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  TEST FOR useOriginalUrl OPTION
//  This test verifies that the useOriginalUrl option works correctly with URL rewriting middleware
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, 'publicWwwTest');

// Create a simple test file if it doesn't exist
const testFilePath = path.join(rootDir, 'test-page.html');
const testFileContent = '<!DOCTYPE html><html><head><title>Test Page</title></head><body><h1>Test Page</h1></body></html>';

beforeAll(() => {
    // Ensure test directory exists
    if (!fs.existsSync(rootDir)) {
        fs.mkdirSync(rootDir, { recursive: true });
    }

    // Create test file
    if (!fs.existsSync(testFilePath)) {
        fs.writeFileSync(testFilePath, testFileContent, 'utf-8');
    }
});

describe('useOriginalUrl option tests', () => {

    describe('Default behavior (useOriginalUrl: true)', () => {
        let app;
        let server;

        beforeAll(() => {
            app = new Koa();

            // i18n middleware that rewrites URLs
            app.use(async (ctx, next) => {
                if (ctx.path.match(/^\/it\//)) {
                    // Rewrite /it/page.html to /page.html
                    ctx.url = ctx.path.replace(/^\/it/, '');
                }
                await next();
            });

            // Serve files with default useOriginalUrl: true
            app.use(koaClassicServer(rootDir, {
                useOriginalUrl: true  // Default behavior
            }));

            server = app.listen();
        });

        afterAll(() => {
            server.close();
        });

        test('should use ctx.originalUrl (original request path)', async () => {
            // Request /it/test-page.html
            // ctx.originalUrl = /it/test-page.html (unchanged)
            // ctx.url = /test-page.html (rewritten by middleware)
            // With useOriginalUrl: true, server looks for /it/test-page.html (which doesn't exist)
            const response = await supertest(server).get('/it/test-page.html');

            // Should return 404 because /it/test-page.html doesn't exist
            expect(response.status).toBe(404);
        });

        test('should serve file without rewriting', async () => {
            // Request /test-page.html directly (no rewriting)
            const response = await supertest(server).get('/test-page.html');

            // Should return 200 and the file content
            expect(response.status).toBe(200);
            expect(response.text).toContain('Test Page');
        });
    });

    describe('URL rewriting support (useOriginalUrl: false)', () => {
        let app;
        let server;

        beforeAll(() => {
            app = new Koa();

            // i18n middleware that rewrites URLs
            app.use(async (ctx, next) => {
                if (ctx.path.match(/^\/it\//)) {
                    // Rewrite /it/page.html to /page.html
                    ctx.url = ctx.path.replace(/^\/it/, '');
                }
                await next();
            });

            // Serve files with useOriginalUrl: false to use rewritten URL
            app.use(koaClassicServer(rootDir, {
                useOriginalUrl: false  // Use ctx.url (rewritten)
            }));

            server = app.listen();
        });

        afterAll(() => {
            server.close();
        });

        test('should use ctx.url (rewritten path)', async () => {
            // Request /it/test-page.html
            // ctx.originalUrl = /it/test-page.html (unchanged)
            // ctx.url = /test-page.html (rewritten by middleware)
            // With useOriginalUrl: false, server looks for /test-page.html (which exists)
            const response = await supertest(server).get('/it/test-page.html');

            // Should return 200 and the file content
            expect(response.status).toBe(200);
            expect(response.text).toContain('Test Page');
        });

        test('should still serve file without rewriting', async () => {
            // Request /test-page.html directly (no rewriting)
            const response = await supertest(server).get('/test-page.html');

            // Should return 200 and the file content
            expect(response.status).toBe(200);
            expect(response.text).toContain('Test Page');
        });
    });

    describe('Complex i18n routing scenario', () => {
        let app;
        let server;

        beforeAll(() => {
            app = new Koa();

            // More complex i18n middleware
            app.use(async (ctx, next) => {
                const langPattern = /^\/(it|fr|de|es)\//;
                const match = ctx.path.match(langPattern);
                if (match) {
                    // Store language in state
                    ctx.state.lang = match[1];
                    // Strip language prefix
                    ctx.url = ctx.path.replace(langPattern, '/');
                }
                await next();
            });

            app.use(koaClassicServer(rootDir, {
                useOriginalUrl: false
            }));

            server = app.listen();
        });

        afterAll(() => {
            server.close();
        });

        test('should work with Italian locale (/it/)', async () => {
            const response = await supertest(server).get('/it/test-page.html');
            expect(response.status).toBe(200);
            expect(response.text).toContain('Test Page');
        });

        test('should work with French locale (/fr/)', async () => {
            const response = await supertest(server).get('/fr/test-page.html');
            expect(response.status).toBe(200);
            expect(response.text).toContain('Test Page');
        });

        test('should work with German locale (/de/)', async () => {
            const response = await supertest(server).get('/de/test-page.html');
            expect(response.status).toBe(200);
            expect(response.text).toContain('Test Page');
        });

        test('should work with Spanish locale (/es/)', async () => {
            const response = await supertest(server).get('/es/test-page.html');
            expect(response.status).toBe(200);
            expect(response.text).toContain('Test Page');
        });
    });

    describe('Backward compatibility', () => {
        let app;
        let server;

        beforeAll(() => {
            app = new Koa();

            // No URL rewriting middleware
            // Default useOriginalUrl (should be true)
            app.use(koaClassicServer(rootDir));

            server = app.listen();
        });

        afterAll(() => {
            server.close();
        });

        test('should work with default options (backward compatible)', async () => {
            const response = await supertest(server).get('/test-page.html');
            expect(response.status).toBe(200);
            expect(response.text).toContain('Test Page');
        });
    });
});
