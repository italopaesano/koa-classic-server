//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
//  TEST FOR REMOVED OPTION NAMES (enableCaching, cacheMaxAge)
//  These options were removed in v3.0.0 — passing them must throw an Error.
//
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const koaClassicServer = require('../index.cjs');
const Koa = require('koa');
const path = require('path');

const rootDir = path.join(__dirname, 'publicWwwTest');

describe('Removed option names (v3.0.0 breaking changes)', () => {

    test('should throw when "enableCaching" is passed', () => {
        expect(() => {
            const app = new Koa();
            app.use(koaClassicServer(rootDir, { enableCaching: true }));
        }).toThrow('"enableCaching" option was removed in v3.0.0');
    });

    test('should throw when "cacheMaxAge" is passed', () => {
        expect(() => {
            const app = new Koa();
            app.use(koaClassicServer(rootDir, { cacheMaxAge: 3600 }));
        }).toThrow('"cacheMaxAge" option was removed in v3.0.0');
    });

    test('should throw even when new option is also provided alongside "cacheMaxAge"', () => {
        expect(() => {
            const app = new Koa();
            app.use(koaClassicServer(rootDir, { cacheMaxAge: 3600, browserCacheMaxAge: 3600 }));
        }).toThrow('"cacheMaxAge" option was removed in v3.0.0');
    });

    test('should throw even when new option is also provided alongside "enableCaching"', () => {
        expect(() => {
            const app = new Koa();
            app.use(koaClassicServer(rootDir, { enableCaching: false, browserCacheEnabled: false }));
        }).toThrow('"enableCaching" option was removed in v3.0.0');
    });
});

describe('New option names (browserCacheEnabled / browserCacheMaxAge)', () => {
    const supertest = require('supertest');
    let app;
    let server;
    let consoleWarnSpy;

    beforeAll(() => {
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        app = new Koa();
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

    test('should not warn about removed options', () => {
        const removedWarnings = consoleWarnSpy.mock.calls.filter(call =>
            call[1] && (call[1].includes('enableCaching') || call[1].includes('cacheMaxAge'))
        );
        expect(removedWarnings.length).toBe(0);
    });

    test('should work correctly with new option names', async () => {
        const response = await supertest(server).get('/test-page.html');

        expect(response.status).toBe(200);
        expect(response.headers['etag']).toBeDefined();
        expect(response.headers['cache-control']).toContain('max-age=3600');
    });
});

describe('Default behavior (no caching options specified)', () => {
    const supertest = require('supertest');
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
        expect(response.headers['cache-control']).toContain('no-cache');
    });
});
