//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  TEST FOR DEPRECATED OPTION NAMES (enableCaching, cacheMaxAge)
//  This test verifies backward compatibility and deprecation warnings
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const path = require('path');

const rootDir = path.join(__dirname, 'publicWwwTest');

describe('Deprecated option names (backward compatibility)', () => {

    describe('Using deprecated enableCaching option', () => {
        let app;
        let server;
        let consoleWarnSpy;

        beforeAll(() => {
            // Spy on console.warn to capture deprecation warnings
            consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            app = new Koa();

            // Use deprecated option name
            app.use(koaClassicServer(rootDir, {
                enableCaching: true  // DEPRECATED: should use browserCacheEnabled
            }));

            server = app.listen();
        });

        afterAll(() => {
            server.close();
            consoleWarnSpy.mockRestore();
        });

        test('should display deprecation warning for enableCaching', () => {
            expect(consoleWarnSpy).toHaveBeenCalled();
            const warningMessage = consoleWarnSpy.mock.calls[0][1];
            expect(warningMessage).toContain('DEPRECATION WARNING');
            expect(warningMessage).toContain('enableCaching');
            expect(warningMessage).toContain('browserCacheEnabled');
        });

        test('should still work with deprecated option', async () => {
            const response = await supertest(server).get('/test-page.html');

            // Should return the file
            expect(response.status).toBe(200);

            // Should have caching headers (because enableCaching: true was set)
            expect(response.headers['etag']).toBeDefined();
            expect(response.headers['last-modified']).toBeDefined();
            expect(response.headers['cache-control']).toContain('public');
        });
    });

    describe('Using deprecated cacheMaxAge option', () => {
        let app;
        let server;
        let consoleWarnSpy;

        beforeAll(() => {
            consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            app = new Koa();

            // Use deprecated option name
            app.use(koaClassicServer(rootDir, {
                enableCaching: true,  // Also deprecated
                cacheMaxAge: 7200     // DEPRECATED: should use browserCacheMaxAge
            }));

            server = app.listen();
        });

        afterAll(() => {
            server.close();
            consoleWarnSpy.mockRestore();
        });

        test('should display deprecation warning for cacheMaxAge', () => {
            const warningCalls = consoleWarnSpy.mock.calls;
            const cacheMaxAgeWarning = warningCalls.find(call =>
                call[1] && call[1].includes('cacheMaxAge')
            );

            expect(cacheMaxAgeWarning).toBeDefined();
            expect(cacheMaxAgeWarning[1]).toContain('DEPRECATION WARNING');
            expect(cacheMaxAgeWarning[1]).toContain('browserCacheMaxAge');
        });

        test('should use the deprecated cacheMaxAge value', async () => {
            const response = await supertest(server).get('/test-page.html');

            expect(response.status).toBe(200);
            expect(response.headers['cache-control']).toContain('max-age=7200');
        });
    });

    describe('Using new option names (no warnings)', () => {
        let app;
        let server;
        let consoleWarnSpy;

        beforeAll(() => {
            consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            app = new Koa();

            // Use NEW option names
            app.use(koaClassicServer(rootDir, {
                browserCacheEnabled: true,
                browserCacheMaxAge: 3600
            }));

            server = app.listen();
        });

        afterAll(() => {
            server.close();
            consoleWarnSpy.mockRestore();
        });

        test('should NOT display deprecation warnings', () => {
            // Filter out warnings from other tests (like index option deprecation)
            const cachingWarnings = consoleWarnSpy.mock.calls.filter(call =>
                call[1] && (call[1].includes('enableCaching') || call[1].includes('cacheMaxAge'))
            );

            expect(cachingWarnings.length).toBe(0);
        });

        test('should work correctly with new option names', async () => {
            const response = await supertest(server).get('/test-page.html');

            expect(response.status).toBe(200);
            expect(response.headers['etag']).toBeDefined();
            expect(response.headers['cache-control']).toContain('max-age=3600');
        });
    });

    describe('Using both old and new names (new takes precedence)', () => {
        let app;
        let server;
        let consoleWarnSpy;

        beforeAll(() => {
            consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            app = new Koa();

            // Use BOTH old and new names - new should take precedence
            app.use(koaClassicServer(rootDir, {
                enableCaching: true,           // OLD (deprecated)
                browserCacheEnabled: false,    // NEW (should take precedence)
                cacheMaxAge: 7200,             // OLD (deprecated)
                browserCacheMaxAge: 9999       // NEW (should take precedence)
            }));

            server = app.listen();
        });

        afterAll(() => {
            server.close();
            consoleWarnSpy.mockRestore();
        });

        test('should NOT display warnings when new names are also provided', () => {
            // When both old and new names are provided, no warning should be shown
            const cachingWarnings = consoleWarnSpy.mock.calls.filter(call =>
                call[1] && (call[1].includes('enableCaching') || call[1].includes('cacheMaxAge'))
            );

            expect(cachingWarnings.length).toBe(0);
        });

        test('new option values should take precedence over old ones', async () => {
            const response = await supertest(server).get('/test-page.html');

            expect(response.status).toBe(200);

            // browserCacheEnabled: false should take precedence over enableCaching: true
            // So there should be NO caching headers
            expect(response.headers['etag']).toBeUndefined();
            expect(response.headers['cache-control']).toContain('no-cache');
        });
    });

    describe('Default behavior (no caching options specified)', () => {
        let app;
        let server;

        beforeAll(() => {
            app = new Koa();
            app.use(koaClassicServer(rootDir));
            server = app.listen();
        });

        afterAll(() => {
            server.close();
        });

        test('should default to browserCacheEnabled: false', async () => {
            const response = await supertest(server).get('/test-page.html');

            expect(response.status).toBe(200);

            // Default is caching disabled
            expect(response.headers['cache-control']).toContain('no-cache');
        });
    });
});
