/**
 * rootDir boundary check hardening (V-3) — koa-classic-server
 *
 * The resolved path must stay within rootDir. The check now uses the shared
 * _isWithinRoot() helper (matches rootDir exactly or rootDir + path.sep), which
 * is boundary-aware and cannot be satisfied by a sibling directory such as
 * "<root>secret". Outside-root requests return 404 (aligned with symlink-escape
 * and hidden entries), never a sibling's contents.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

describe('rootDir boundary check (V-3)', () => {
    let parent, root, sibling, server, request;

    beforeAll(() => {
        // parent/
        //   www/         <- rootDir
        //     ok.txt
        //   wwwsecret/   <- sibling that shares the "www" prefix
        //     secret.txt
        parent = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-v3-'));
        root = path.join(parent, 'www');
        sibling = path.join(parent, 'wwwsecret');
        fs.mkdirSync(root);
        fs.mkdirSync(sibling);
        fs.writeFileSync(path.join(root, 'ok.txt'), 'ok content');
        fs.writeFileSync(path.join(sibling, 'secret.txt'), 'SIBLING-SECRET');

        const app = new Koa();
        app.use(koaClassicServer(root, { dirListing: { enabled: true } }));
        server = app.listen();
        request = supertest(server);
    });

    afterAll(() => {
        server?.close();
        fs.rmSync(parent, { recursive: true, force: true });
    });

    describe('traversal now returns 404 (not 403)', () => {
        test.each([
            '/../package.json',
            '/%2e%2e%2f%2e%2e%2fpackage.json',
            '/../../../etc/hosts',
        ])('%s → 404, never file content', async (urlPath) => {
            const res = await request.get(urlPath);
            expect(res.status).toBe(404);
            expect(res.text).not.toContain('"name"');
        });
    });

    describe('sibling directory sharing the root name prefix is unreachable', () => {
        test.each([
            '/../wwwsecret/secret.txt',
            '/%2e%2e/wwwsecret/secret.txt',
            '/..%2fwwwsecret%2fsecret.txt',
        ])('%s never serves the sibling secret', async (urlPath) => {
            const res = await request.get(urlPath);
            expect(res.status).toBe(404);
            expect(res.text).not.toContain('SIBLING-SECRET');
        });
    });

    describe('legitimate requests unaffected', () => {
        test('root directory listing works (fullPath === rootDir)', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('ok.txt');
        });

        test('normal file served', async () => {
            const res = await request.get('/ok.txt');
            expect(res.status).toBe(200);
            expect(res.text).toContain('ok content');
        });
    });

    describe('hideExtension boundary is also hardened', () => {
        let root2, server2, request2;
        beforeAll(() => {
            root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-v3h-'));
            fs.writeFileSync(path.join(root2, 'page.ejs'), '<p>page</p>');
            const app = new Koa();
            app.use(koaClassicServer(root2, {
                dirListing: { enabled: true },
                hideExtension: { ext: '.ejs' },
            }));
            server2 = app.listen();
            request2 = supertest(server2);
        });
        afterAll(() => {
            server2?.close();
            fs.rmSync(root2, { recursive: true, force: true });
        });

        test('clean URL resolves the in-root .ejs file (200)', async () => {
            const res = await request2.get('/page');
            expect(res.status).toBe(200);
            const out = res.text !== undefined ? res.text : res.body.toString('utf8');
            expect(out).toContain('page');
        });
    });
});
