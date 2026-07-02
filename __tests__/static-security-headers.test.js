/**
 * Opt-in static security headers (V-4) — koa-classic-server
 *
 * `staticSecurityHeaders.nosniff` adds `X-Content-Type-Options: nosniff` to static
 * file responses (200 / 206 / 304). Off by default (design philosophy: hardening
 * is opt-in). Template-rendered output is intentionally unaffected. Generated pages
 * (listing / errors) always carry nosniff regardless of this option.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

describe('static security headers (V-4)', () => {
    let root;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-v4-'));
        fs.writeFileSync(path.join(root, 'ok.txt'), 'x'.repeat(2048));
        fs.writeFileSync(path.join(root, 'page.ejs'), '<p>tpl</p>');
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    function makeServer(opts) {
        const app = new Koa();
        app.use(koaClassicServer(root, opts));
        return app.listen();
    }

    describe('factory validation', () => {
        test('non-object staticSecurityHeaders throws', () => {
            expect(() => koaClassicServer(root, { staticSecurityHeaders: 'yes' }))
                .toThrow(/staticSecurityHeaders must be an object/);
        });
    });

    describe('default (off)', () => {
        let server;
        beforeAll(() => { server = makeServer({ dirListing: { enabled: true } }); });
        afterAll(() => server.close());

        test('static file 200 has NO nosniff by default', async () => {
            const res = await supertest(server).get('/ok.txt');
            expect(res.status).toBe(200);
            expect(res.headers['x-content-type-options']).toBeUndefined();
        });
    });

    describe('enabled (nosniff: true)', () => {
        let server;
        beforeAll(() => {
            server = makeServer({
                dirListing: { enabled: true },
                browserCacheEnabled: true,
                staticSecurityHeaders: { nosniff: true },
            });
        });
        afterAll(() => server.close());

        test('static file 200 has nosniff', async () => {
            const res = await supertest(server).get('/ok.txt');
            expect(res.status).toBe(200);
            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });

        test('range 206 response has nosniff', async () => {
            const res = await supertest(server).get('/ok.txt').set('Range', 'bytes=0-99');
            expect(res.status).toBe(206);
            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });

        test('304 Not Modified response has nosniff', async () => {
            const first = await supertest(server).get('/ok.txt');
            const etag = first.headers['etag'];
            expect(etag).toBeDefined();
            const res = await supertest(server).get('/ok.txt').set('If-None-Match', etag);
            expect(res.status).toBe(304);
            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });
    });

    describe('scope', () => {
        test('generated pages keep nosniff even when option is off (unchanged)', async () => {
            const server = makeServer({ dirListing: { enabled: true } });
            try {
                const listing = await supertest(server).get('/');
                expect(listing.status).toBe(200);
                expect(listing.headers['x-content-type-options']).toBe('nosniff');
                const notFound = await supertest(server).get('/nope-xyz');
                expect(notFound.status).toBe(404);
                expect(notFound.headers['x-content-type-options']).toBe('nosniff');
            } finally { server.close(); }
        });

        test('template-rendered output is NOT given nosniff by this option', async () => {
            const server = makeServer({
                staticSecurityHeaders: { nosniff: true },
                template: {
                    ext: ['ejs'],
                    render: async (ctx, next, filePath) => {
                        ctx.type = 'text/html';
                        ctx.body = await fs.promises.readFile(filePath, 'utf8');
                    },
                },
            });
            try {
                const res = await supertest(server).get('/page.ejs');
                expect(res.status).toBe(200);
                // The middleware does not add nosniff to template output — operator's responsibility
                expect(res.headers['x-content-type-options']).toBeUndefined();
            } finally { server.close(); }
        });
    });
});
