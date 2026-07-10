/**
 * Symlink-escape to a SIBLING directory sharing the rootDir prefix — 2026-07
 * coverage review.
 *
 * The root-boundary helper (_isWithinRoot) is deliberately boundary-aware: it
 * matches rootDir exactly or rootDir + path separator, never a sibling. The
 * code comment calls out the exact trap: with root /srv/www, a naive
 * startsWith() would accept /srv/wwwsecret. That sibling-prefix case was
 * never exercised — existing symlink-policy tests escape to unrelated
 * targets (/tmp, /etc), which any prefix check would catch.
 *
 * These tests build the trap for real: root `www` next to `wwwsecret`, with a
 * symlink escaping from one to the other, and assert that the protected
 * policies block it while 'follow' (the operator-transparency default) does
 * not.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let baseDir;
let rootDir;    // <base>/www          — the served root
let siblingDir; // <base>/wwwsecret    — same prefix, OUTSIDE the root

beforeAll(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-sibling-'));
    rootDir = path.join(baseDir, 'www');
    siblingDir = path.join(baseDir, 'wwwsecret');
    fs.mkdirSync(rootDir);
    fs.mkdirSync(siblingDir);

    fs.writeFileSync(path.join(siblingDir, 'secret.txt'), 'sibling secret');
    fs.writeFileSync(path.join(rootDir, 'inside.txt'), 'inside content');

    // Escaping link: www/leak.txt → ../wwwsecret/secret.txt
    fs.symlinkSync(path.join(siblingDir, 'secret.txt'), path.join(rootDir, 'leak.txt'));
    // Control link: www/safe.txt → inside.txt (stays within the root)
    fs.symlinkSync(path.join(rootDir, 'inside.txt'), path.join(rootDir, 'safe.txt'));
});

afterAll(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
});

function createServer(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(rootDir, { ...opts }));
    return app.listen();
}

describe("symlinks: 'follow-within-root' — sibling with shared prefix is OUTSIDE the root", () => {
    let server;
    beforeAll(() => { server = createServer({ symlinks: 'follow-within-root' }); });
    afterAll(() => server.close());

    test('GET /leak.txt → 404 (…/wwwsecret must not pass as inside …/www)', async () => {
        const res = await supertest(server).get('/leak.txt');
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('sibling secret');
    });

    test('control: GET /safe.txt → 200 (within-root symlink still follows)', async () => {
        const res = await supertest(server).get('/safe.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('inside content');
    });

    test('listing marks the escaping link as blocked and non-clickable', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toMatch(/leak\.txt[\s\S]*?Blocked Symlink/);
        expect(res.text).not.toMatch(/<a href="[^"]*leak\.txt/);
    });
});

describe("symlinks: 'deny' — the sibling escape is equally blocked", () => {
    let server;
    beforeAll(() => { server = createServer({ symlinks: 'deny' }); });
    afterAll(() => server.close());

    test('GET /leak.txt → 404', async () => {
        const res = await supertest(server).get('/leak.txt');
        expect(res.status).toBe(404);
        expect(res.text).not.toContain('sibling secret');
    });
});

describe("symlinks: 'follow' (default) — operator transparency preserved", () => {
    let server;
    beforeAll(() => { server = createServer({ symlinks: 'follow' }); });
    afterAll(() => server.close());

    test('GET /leak.txt → 200 (the default follows symlinks anywhere, by design)', async () => {
        const res = await supertest(server).get('/leak.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('sibling secret');
    });
});
