//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  TEST FOR hideExtension OPTION
//  This test verifies that the hideExtension option works correctly:
//  - Clean URL resolution (URL without extension → file with extension)
//  - Redirect from URL with extension to clean URL
//  - Query string preservation
//  - Conflict resolution (directory vs file, extensionless vs extension)
//  - Input validation
//  - Interaction with existing options (urlsReserved, useOriginalUrl, template)
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ejs = require('ejs');

const rootDir = path.join(__dirname, 'publicWwwTest', 'hideext-test');

// Case-sensitivity probe (same pattern as symlinkSupported in symlink.test.js).
// about.EJS and about.ejs can only coexist on a case-sensitive filesystem:
// committing both breaks `git checkout` reliability on Windows/macOS, so the
// pair is created at runtime and the test skipped where the premise is
// impossible.
function detectCaseSensitiveFs() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-case-probe-'));
    try {
        fs.writeFileSync(path.join(d, 'A.tmp'), '');
        return !fs.existsSync(path.join(d, 'a.tmp'));
    } finally {
        fs.rmSync(d, { recursive: true, force: true });
    }
}
const fsIsCaseSensitive = detectCaseSensitiveFs();
const testIfCaseSensitive = fsIsCaseSensitive ? test : test.skip;

describe('hideExtension option tests', () => {

    // ==========================================
    // Clean URL Resolution
    // ==========================================
    describe('Clean URL resolution', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                index: ['index.ejs'],
                hideExtension: { ext: '.ejs' },
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        const content = await fs.promises.readFile(filePath, 'utf-8');
                        ctx.type = 'text/html';
                        ctx.body = content;
                    }
                }
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('/about serves about.ejs', async () => {
            const response = await request.get('/about');
            expect(response.status).toBe(200);
            expect(response.text).toContain('About Page');
        });

        test('/blog/articolo serves blog/articolo.ejs (multi-level path)', async () => {
            const response = await request.get('/blog/articolo');
            expect(response.status).toBe(200);
            expect(response.text).toContain('Blog Article');
        });

        test('/style.css serves style.css (no interference with other extensions)', async () => {
            const response = await request.get('/style.css');
            expect(response.status).toBe(200);
            expect(response.text).toContain('body { color: red; }');
        });

        test('/ serves the index file via existing index flow', async () => {
            const response = await request.get('/');
            expect(response.status).toBe(200);
            expect(response.text).toContain('Home Page');
        });
    });

    // ==========================================
    // Redirect URL with extension → clean URL
    // ==========================================
    describe('Redirect URL with extension to clean URL', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                index: ['index.ejs'],
                hideExtension: { ext: '.ejs' },
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        const content = await fs.promises.readFile(filePath, 'utf-8');
                        ctx.type = 'text/html';
                        ctx.body = content;
                    }
                }
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('/about.ejs → redirect 301 to /about', async () => {
            const response = await request.get('/about.ejs');
            expect(response.status).toBe(301);
            expect(response.headers.location).toBe('/about');
        });

        test('/blog/articolo.ejs → redirect 301 to /blog/articolo', async () => {
            const response = await request.get('/blog/articolo.ejs');
            expect(response.status).toBe(301);
            expect(response.headers.location).toBe('/blog/articolo');
        });

        test('/about.ejs?lang=it → redirect 301 to /about?lang=it (preserves query string)', async () => {
            const response = await request.get('/about.ejs?lang=it');
            expect(response.status).toBe(301);
            expect(response.headers.location).toBe('/about?lang=it');
        });

        test('/index.ejs → redirect to /', async () => {
            const response = await request.get('/index.ejs');
            expect(response.status).toBe(301);
            expect(response.headers.location).toBe('/');
        });

        test('/sezione/index.ejs → redirect to /sezione/', async () => {
            const response = await request.get('/sezione/index.ejs');
            expect(response.status).toBe(301);
            expect(response.headers.location).toBe('/sezione/');
        });
    });

    // ==========================================
    // Custom redirect code (302)
    // ==========================================
    describe('Custom redirect code', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                index: ['index.ejs'],
                hideExtension: { ext: '.ejs', redirect: 302 }
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('/about.ejs → redirect 302 to /about', async () => {
            const response = await request.get('/about.ejs');
            expect(response.status).toBe(302);
            expect(response.headers.location).toBe('/about');
        });
    });

    // ==========================================
    // Directory/file conflict (dirListing: { enabled: true })
    // ==========================================
    describe('Directory/file conflict with dirListing: { enabled: true }', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                index: ['index.html'],
                hideExtension: { ext: '.ejs' },
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        const content = await fs.promises.readFile(filePath, 'utf-8');
                        ctx.type = 'text/html';
                        ctx.body = content;
                    }
                }
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('/about serves about.ejs (file wins over directory)', async () => {
            const response = await request.get('/about');
            expect(response.status).toBe(200);
            expect(response.text).toContain('About Page');
        });

        test('/about/ shows the directory index or directory contents', async () => {
            const response = await request.get('/about/');
            expect(response.status).toBe(200);
            // The about/ directory has index.html, so it's served as the index file
            expect(response.text).toContain('About Directory Index');
        });
    });

    // ==========================================
    // Trailing slash without directory → 404
    // ==========================================
    describe('Trailing slash without directory', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                hideExtension: { ext: '.ejs' }
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('/nonexistent/ returns 404', async () => {
            const response = await request.get('/nonexistent/');
            expect(response.status).toBe(404);
        });
    });

    // ==========================================
    // File without extension vs .ejs conflict
    // ==========================================
    describe('File without extension vs .ejs conflict', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                hideExtension: { ext: '.ejs' },
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        const content = await fs.promises.readFile(filePath, 'utf-8');
                        ctx.type = 'text/html';
                        ctx.body = content;
                    }
                }
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('/conflict-test/pagina serves pagina.ejs (ejs wins over extensionless file)', async () => {
            const response = await request.get('/conflict-test/pagina');
            expect(response.status).toBe(200);
            expect(response.text).toContain('Pagina EJS');
        });
    });

    // ==========================================
    // Interaction with urlsReserved
    // ==========================================
    describe('Interaction with urlsReserved', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();

            // Add a "next" middleware to catch reserved URLs
            app.use(async (ctx, next) => {
                await next();
                if (ctx.status === 404 && ctx._passedToNext) {
                    ctx.status = 200;
                    ctx.body = 'RESERVED';
                }
            });

            const middleware = koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                index: ['index.ejs'],
                urlsReserved: ['/blog'],
                hideExtension: { ext: '.ejs' },
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        const content = await fs.promises.readFile(filePath, 'utf-8');
                        ctx.type = 'text/html';
                        ctx.body = content;
                    }
                }
            });

            // Wrap middleware to track next() calls
            app.use(async (ctx, next) => {
                const originalNext = next;
                await middleware(ctx, async () => {
                    ctx._passedToNext = true;
                    await originalNext();
                });
            });

            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('/blog is reserved (passed to next middleware)', async () => {
            const response = await request.get('/blog');
            // blog is a directory and is reserved, so it passes to next
            expect(response.text).toBe('RESERVED');
        });

        test('/about still resolves about.ejs normally', async () => {
            const response = await request.get('/about');
            expect(response.status).toBe(200);
            expect(response.text).toContain('About Page');
        });
    });

    // ==========================================
    // Interaction with useOriginalUrl
    // ==========================================
    describe('Interaction with useOriginalUrl', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();

            // i18n middleware that rewrites URLs
            app.use(async (ctx, next) => {
                if (ctx.path.match(/^\/it\//)) {
                    ctx.url = ctx.path.replace(/^\/it/, '');
                }
                await next();
            });

            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                useOriginalUrl: false,
                hideExtension: { ext: '.ejs' },
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        const content = await fs.promises.readFile(filePath, 'utf-8');
                        ctx.type = 'text/html';
                        ctx.body = content;
                    }
                }
            }));

            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('redirect uses ctx.originalUrl (preserves /it/ prefix)', async () => {
            const response = await request.get('/it/about.ejs');
            expect(response.status).toBe(301);
            // Redirect should use originalUrl: /it/about (not /about)
            expect(response.headers.location).toBe('/it/about');
        });

        test('clean URL resolves through rewritten URL', async () => {
            const response = await request.get('/it/about');
            expect(response.status).toBe(200);
            expect(response.text).toContain('About Page');
        });
    });

    // ==========================================
    // Case-sensitive extension matching
    // ==========================================
    describe('Case-sensitive extension matching', () => {
        let app, server, request;
        let caseDir;

        beforeAll(() => {
            // Runtime fixture pair: about.ejs + about.EJS in the same dir —
            // impossible to commit (case-insensitive checkout collision).
            caseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-case-ext-'));
            fs.writeFileSync(path.join(caseDir, 'about.ejs'), '<h1>About Page</h1>');
            if (fsIsCaseSensitive) {
                fs.writeFileSync(path.join(caseDir, 'about.EJS'), '<h1>About UPPERCASE</h1>');
            }
            app = new Koa();
            app.use(koaClassicServer(caseDir, {
                dirListing: { enabled: true },
                hideExtension: { ext: '.ejs' }
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => {
            server.close();
            fs.rmSync(caseDir, { recursive: true, force: true });
        });

        testIfCaseSensitive('/about.EJS is not handled by hideExtension (case-sensitive)', async () => {
            const response = await request.get('/about.EJS');
            // The file about.EJS exists, should be served normally (not redirected)
            expect(response.status).toBe(200);
            // Should NOT be a redirect
            expect(response.status).not.toBe(301);
        });
    });

    // ==========================================
    // URLs with different extensions (no interference)
    // ==========================================
    describe('URLs with different extensions', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                hideExtension: { ext: '.ejs' }
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('/file.ejs.bak is not interfered with', async () => {
            const response = await request.get('/file.ejs.bak');
            // .bak is the extension, not .ejs - should be served normally
            expect(response.status).toBe(200);
            expect(response.status).not.toBe(301);
        });

        test('/photo.txt is not interfered with', async () => {
            const response = await request.get('/photo.txt');
            expect(response.status).toBe(200);
            expect(response.status).not.toBe(301);
        });

        test('/style.css is not interfered with', async () => {
            const response = await request.get('/style.css');
            expect(response.status).toBe(200);
            expect(response.status).not.toBe(301);
        });
    });

    // ==========================================
    // Template engine integration
    // ==========================================
    describe('Template engine integration', () => {
        let app, server, request;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                index: ['index.ejs'],
                hideExtension: { ext: '.ejs' },
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        const templateContent = await fs.promises.readFile(filePath, 'utf-8');
                        const html = ejs.render(templateContent, { title: 'Test Title' });
                        ctx.type = 'text/html';
                        ctx.body = html;
                    }
                }
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server.close(); });

        test('file resolved via hideExtension passes correctly to template engine', async () => {
            const response = await request.get('/about');
            expect(response.status).toBe(200);
            expect(response.type).toBe('text/html');
            expect(response.text).toContain('About Page');
        });
    });

    // ==========================================
    // Input Validation
    // ==========================================
    describe('Input validation', () => {

        test('hideExtension: true → throws Error', () => {
            expect(() => {
                koaClassicServer(rootDir, {
                    hideExtension: true
                });
            }).toThrow();
        });

        test('hideExtension: {} → throws Error (missing ext)', () => {
            expect(() => {
                koaClassicServer(rootDir, {
                    hideExtension: {}
                });
            }).toThrow();
        });

        test('hideExtension: { ext: "" } → throws Error (empty ext)', () => {
            expect(() => {
                koaClassicServer(rootDir, {
                    hideExtension: { ext: '' }
                });
            }).toThrow();
        });

        test('hideExtension: { ext: "ejs" } → EQUIVALENT to ".ejs", no warning (V5, #10)', () => {
            const originalWarn = console.warn;
            const warnings = [];
            console.warn = (...args) => { warnings.push(args); };

            try {
                const middleware = koaClassicServer(rootDir, {
                    hideExtension: { ext: 'ejs' }
                });
                expect(middleware).toBeDefined();
                // The leading dot is optional decoration since V5: both forms
                // are legal, so the old "should start with a dot" nag is gone.
                expect(warnings.length).toBe(0);
            } finally {
                console.warn = originalWarn;
            }
        });

        test('hideExtension: { ext: ".ejs", redirect: "abc" } → throws Error (redirect not numeric)', () => {
            expect(() => {
                koaClassicServer(rootDir, {
                    hideExtension: { ext: '.ejs', redirect: 'abc' }
                });
            }).toThrow();
        });

        test('hideExtension: { ext: ".ejs" } → valid, default redirect 301', () => {
            expect(() => {
                koaClassicServer(rootDir, {
                    hideExtension: { ext: '.ejs' }
                });
            }).not.toThrow();
        });

        test('hideExtension: { ext: ".ejs", redirect: 302 } → valid', () => {
            expect(() => {
                koaClassicServer(rootDir, {
                    hideExtension: { ext: '.ejs', redirect: 302 }
                });
            }).not.toThrow();
        });

        test('hideExtension: undefined → feature disabled (no error)', () => {
            expect(() => {
                koaClassicServer(rootDir, {});
            }).not.toThrow();
        });
    });

    // ==========================================
    // Security: open-redirect via protocol-relative URL
    // ==========================================
    describe('Open-redirect guard on hideExtension Location header', () => {
        let app, server, port;

        beforeAll((done) => {
            app = new Koa();
            app.use(koaClassicServer(rootDir, {
                dirListing: { enabled: true },
                hideExtension: { ext: '.ejs' }
            }));
            server = app.listen(0, () => {
                port = server.address().port;
                done();
            });
        });

        afterAll(() => { server.close(); });

        // Send the request path as raw bytes so the leading "//" survives any
        // client-side URL normalization. supertest/url.parse would collapse it.
        function rawGet(path) {
            const http = require('http');
            return new Promise((resolve, reject) => {
                const req = http.request({
                    host: '127.0.0.1',
                    port,
                    method: 'GET',
                    path
                }, (res) => {
                    res.resume();
                    resolve({ status: res.statusCode, location: res.headers.location });
                });
                req.on('error', reject);
                req.end();
            });
        }

        test('GET //evil.com/foo.ejs → Location must not be protocol-relative', async () => {
            const res = await rawGet('//evil.com/foo.ejs');
            expect(res.status).toBe(301);
            expect(res.location).toBeDefined();
            // The Location must not start with "//" or "/\" (would navigate off-origin)
            expect(res.location.startsWith('//')).toBe(false);
            expect(res.location.startsWith('/\\')).toBe(false);
            expect(res.location).toBe('/evil.com/foo');
        });

        test('GET ///a/b.ejs → leading slashes collapsed in Location', async () => {
            const res = await rawGet('///a/b.ejs');
            expect(res.status).toBe(301);
            expect(res.location.startsWith('//')).toBe(false);
            expect(res.location).toBe('/a/b');
        });
    });
});

// ==========================================
// #9 (v4.3 register) — redirect code strict validation (V5 breaking change)
// ==========================================
describe('hideExtension.redirect strict validation (#9, v5.0.0)', () => {
    test.each([
        ['non-redirect 200', 200],
        ['non-redirect 404', 404],
        ['304 (not a redirect for ctx.redirect)', 304],
        ['out-of-set 999', 999],
        ['float 3.14', 3.14],
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['out-of-range 50', 50],
    ])('%s → throws at factory time with the valid list', (_label, code) => {
        expect(() => {
            koaClassicServer(rootDir, { hideExtension: { ext: '.ejs', redirect: code } });
        }).toThrow(/must be one of: 300, 301, 302, 303, 305, 307, 308/);
    });

    // 300 and 305 are exotic/deprecated but valid: Koa emits them as-is
    // (maintainer decision — amended after the first cut of #9).
    test.each([[300], [301], [302], [303], [305], [307], [308]])('%d is accepted', (code) => {
        expect(() => {
            koaClassicServer(rootDir, { hideExtension: { ext: '.ejs', redirect: code } });
        }).not.toThrow();
    });

    describe('runtime: an accepted non-default code is emitted as-is', () => {
        let server;
        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(rootDir, { hideExtension: { ext: '.ejs', redirect: 307 } }));
            server = app.listen();
        });
        afterAll(() => server.close());

        test('/about.ejs → 307 to /about', async () => {
            const response = await supertest(server).get('/about.ejs');
            expect(response.status).toBe(307);
            expect(response.headers.location).toBe('/about');
        });
    });

    describe('runtime: deprecated-but-valid 305 is emitted as-is (not rewritten to 302)', () => {
        let server;
        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(rootDir, { hideExtension: { ext: '.ejs', redirect: 305 } }));
            server = app.listen();
        });
        afterAll(() => server.close());

        test('/about.ejs → 305 to /about', async () => {
            const response = await supertest(server).get('/about.ejs');
            expect(response.status).toBe(305);
            expect(response.headers.location).toBe('/about');
        });
    });
});
