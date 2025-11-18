/**
 * Enhanced Index Option Tests
 *
 * Tests for the new index option that supports:
 * - String (backward compatible)
 * - Array of strings
 * - Array of RegExp
 * - Mixed array (strings + RegExp)
 * - Priority handling (first match wins)
 */

const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const path = require('path');
const fs = require('fs');

describe('Enhanced Index Option Tests', () => {
    let app;
    let server;
    let tempDir;

    beforeEach(() => {
        // Create temporary test directory
        tempDir = path.join(__dirname, 'temp-index-test');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    });

    afterEach(() => {
        // Cleanup
        if (server) {
            server.close();
        }
        // Remove temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('Backward Compatibility - String index', () => {
        test('String: "index.html" should work as before', async () => {
            // Create index.html
            fs.writeFileSync(path.join(tempDir, 'index.html'), '<h1>Index HTML</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, { index: 'index.html' }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('Index HTML');
        });

        test('Empty string should show directory listing', async () => {
            fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test');

            app = new Koa();
            app.use(koaClassicServer(tempDir, { index: '' }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('Index of');
            expect(res.text).toContain('test.txt');
        });
    });

    describe('Array of Strings - Priority order', () => {
        test('Priority order - index1.html searched before index2.html', async () => {
            // Create both files with distinctive content
            fs.writeFileSync(path.join(tempDir, 'index1.html'), '<h1>FILE 1 - FIRST PRIORITY</h1>');
            fs.writeFileSync(path.join(tempDir, 'index2.html'), '<h1>FILE 2 - SECOND PRIORITY</h1>');
            fs.writeFileSync(path.join(tempDir, 'index3.html'), '<h1>FILE 3 - THIRD PRIORITY</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index1.html', 'index2.html', 'index3.html']
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            // Must serve index1.html (first in array)
            expect(res.text).toContain('FILE 1 - FIRST PRIORITY');
            // Must NOT serve index2.html or index3.html
            expect(res.text).not.toContain('FILE 2');
            expect(res.text).not.toContain('FILE 3');
        });

        test('Priority order - index2.html served when index1.html missing', async () => {
            // Only create index2.html and index3.html (index1.html missing)
            fs.writeFileSync(path.join(tempDir, 'index2.html'), '<h1>FILE 2 - NOW FIRST AVAILABLE</h1>');
            fs.writeFileSync(path.join(tempDir, 'index3.html'), '<h1>FILE 3 - STILL THIRD</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index1.html', 'index2.html', 'index3.html']
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            // Must serve index2.html (first available in array)
            expect(res.text).toContain('FILE 2 - NOW FIRST AVAILABLE');
            // Must NOT serve index3.html
            expect(res.text).not.toContain('FILE 3');
        });

        test('First match wins - index.html over index.htm', async () => {
            fs.writeFileSync(path.join(tempDir, 'index.html'), '<h1>This is HTML version</h1>');
            fs.writeFileSync(path.join(tempDir, 'index.htm'), '<h1>This is HTM version</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index.html', 'index.htm']
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('This is HTML version');
            expect(res.text).not.toContain('This is HTM version');
        });

        test('First match wins - index.htm when index.html missing', async () => {
            fs.writeFileSync(path.join(tempDir, 'index.htm'), '<h1>HTM</h1>');
            fs.writeFileSync(path.join(tempDir, 'default.html'), '<h1>Default</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index.html', 'index.htm', 'default.html']
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('HTM');
            expect(res.text).not.toContain('Default');
        });

        test('Falls back to directory listing when no match', async () => {
            fs.writeFileSync(path.join(tempDir, 'other.html'), '<h1>Other</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index.html', 'index.htm']
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('Index of');
            expect(res.text).toContain('other.html');
        });
    });

    describe('Array of RegExp - Case insensitive matching', () => {
        test('Priority order - First RegExp pattern searched before second', async () => {
            // Create files that match different patterns
            fs.writeFileSync(path.join(tempDir, 'index1.html'), '<h1>PATTERN 1 MATCH</h1>');
            fs.writeFileSync(path.join(tempDir, 'index2.html'), '<h1>PATTERN 2 MATCH</h1>');
            fs.writeFileSync(path.join(tempDir, 'index3.html'), '<h1>PATTERN 3 MATCH</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [
                    /index1\.html/i,  // First pattern - should match index1.html
                    /index2\.html/i,  // Second pattern - should be skipped
                    /index3\.html/i   // Third pattern - should be skipped
                ]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            // Must serve index1.html (first RegExp match)
            expect(res.text).toContain('PATTERN 1 MATCH');
            // Must NOT serve index2.html or index3.html
            expect(res.text).not.toContain('PATTERN 2');
            expect(res.text).not.toContain('PATTERN 3');
        });

        test('Priority order - Second RegExp when first does not match', async () => {
            // index1.html does NOT exist, so first pattern won't match
            fs.writeFileSync(path.join(tempDir, 'index2.html'), '<h1>PATTERN 2 NOW FIRST</h1>');
            fs.writeFileSync(path.join(tempDir, 'index3.html'), '<h1>PATTERN 3 STILL THIRD</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [
                    /index1\.html/i,  // First pattern - no match (file doesn't exist)
                    /index2\.html/i,  // Second pattern - should match
                    /index3\.html/i   // Third pattern - should be skipped
                ]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            // Must serve index2.html (first available match)
            expect(res.text).toContain('PATTERN 2 NOW FIRST');
            // Must NOT serve index3.html
            expect(res.text).not.toContain('PATTERN 3');
        });

        test('Priority order - Broader pattern searched before narrower pattern', async () => {
            // Create multiple files
            fs.writeFileSync(path.join(tempDir, 'index.html'), '<h1>HTML FILE</h1>');
            fs.writeFileSync(path.join(tempDir, 'index.htm'), '<h1>HTM FILE</h1>');
            fs.writeFileSync(path.join(tempDir, 'default.html'), '<h1>DEFAULT FILE</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [
                    /index\.(html|htm)/i,  // Broader pattern first - matches both .html and .htm
                    /default\.html/i       // Narrower pattern second - should be skipped
                ]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            // Must serve one of: index.html or index.htm (first pattern match)
            expect(res.text).toMatch(/HTML FILE|HTM FILE/);
            // Must NOT serve default.html
            expect(res.text).not.toContain('DEFAULT FILE');
        });

        test('RegExp case-insensitive: /index\\.html/i matches INDEX.HTML', async () => {
            fs.writeFileSync(path.join(tempDir, 'INDEX.HTML'), '<h1>UPPERCASE INDEX</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [/index\.html/i]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('UPPERCASE INDEX');
        });

        test('RegExp case-insensitive: matches index.HTML, Index.html, INDEX.html', async () => {
            fs.writeFileSync(path.join(tempDir, 'Index.Html'), '<h1>Mixed Case Index</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [/index\.html/i]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('Mixed Case Index');
        });

        test('RegExp pattern: /index\\.(html|htm)/i matches both extensions', async () => {
            fs.writeFileSync(path.join(tempDir, 'index.HTM'), '<h1>HTM</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [/index\.(html|htm)/i]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('HTM');
        });

        test('RegExp pattern: /index\\.ejs/i matches INDEX.EJS', async () => {
            fs.writeFileSync(path.join(tempDir, 'INDEX.EJS'), 'EJS content');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [/index\.ejs/i]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('EJS content');
        });
    });

    describe('Mixed Array - Strings + RegExp', () => {
        test('Priority: String before RegExp', async () => {
            fs.writeFileSync(path.join(tempDir, 'index.html'), '<h1>HTML Exact</h1>');
            fs.writeFileSync(path.join(tempDir, 'INDEX.HTML'), '<h1>HTML Uppercase</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index.html', /INDEX\.HTML/]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('HTML Exact');
        });

        test('Falls back to RegExp when string doesn\'t match', async () => {
            fs.writeFileSync(path.join(tempDir, 'INDEX.HTML'), '<h1>HTML Uppercase</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index.html', /INDEX\.HTML/i]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('HTML Uppercase');
        });

        test('Complex example: Mixed priorities', async () => {
            fs.writeFileSync(path.join(tempDir, 'default.html'), '<h1>Default</h1>');
            fs.writeFileSync(path.join(tempDir, 'INDEX.HTML'), '<h1>Uppercase Index</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [
                    'index.html',       // 1. Exact match (case-sensitive)
                    /index\.htm/i,      // 2. Case-insensitive index.htm(l)
                    'default.html'      // 3. default.html
                ]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            // Should match #2 (INDEX.HTML via regex)
            expect(res.text).toContain('Uppercase Index');
        });
    });

    describe('Real-world use cases', () => {
        test('Apache-like: index.html, index.htm, index.php', async () => {
            fs.writeFileSync(path.join(tempDir, 'index.htm'), '<h1>HTM</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index.html', 'index.htm', 'index.php']
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('HTM');
        });

        test('Template engines: index.ejs, index.pug, index.html', async () => {
            fs.writeFileSync(path.join(tempDir, 'index.pug'), 'pug content');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index.ejs', 'index.pug', 'index.html']
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('pug content');
        });

        test('Case-insensitive filesystem (Windows-like): matches any case', async () => {
            fs.writeFileSync(path.join(tempDir, 'InDeX.HtMl'), '<h1>Mixed Case</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [/index\.html/i]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('Mixed Case');
        });
    });

    describe('Edge cases', () => {
        test('Empty array shows directory listing', async () => {
            fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test');

            app = new Koa();
            app.use(koaClassicServer(tempDir, { index: [] }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('Index of');
        });

        test('Invalid array elements are filtered out', async () => {
            fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index.html', 123, null, /notfound/]  // Invalid: 123, null; /notfound/ won't match
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            // Should show directory listing (no valid match)
            expect(res.text).toContain('Index of');
        });

        test('RegExp matches first file when multiple match', async () => {
            fs.writeFileSync(path.join(tempDir, 'index.html'), '<h1>HTML</h1>');
            fs.writeFileSync(path.join(tempDir, 'index.htm'), '<h1>HTM</h1>');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: [/index\.(html|htm)/]
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            // Should match one of them (order depends on readdir)
            expect(res.text).toMatch(/HTML|HTM/);
        });
    });

    describe('Integration with existing index.html tests', () => {
        test('Works with array index option for typical setup', async () => {
            // Create typical index.html setup
            fs.writeFileSync(path.join(tempDir, 'index.html'), '<!DOCTYPE html><html><body><h1>Welcome</h1></body></html>');
            fs.writeFileSync(path.join(tempDir, 'other.txt'), 'other file');

            app = new Koa();
            app.use(koaClassicServer(tempDir, {
                index: ['index.html', 'index.htm', 'default.html']
            }));
            server = app.listen();

            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            // Should find index.html
            expect(res.text).toContain('Welcome');
            expect(res.text).toContain('<!DOCTYPE html>');
        });
    });
});
