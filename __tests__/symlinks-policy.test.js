/**
 * Symlinks policy tests (V-1) — koa-classic-server v3.1.0
 *
 * Covers the opt-in `symlinks` option that protects against symlink escape:
 *   - 'follow'             (default) : historical behavior, escaping links served
 *   - 'follow-within-root'           : escaping links return 404, in-root links OK
 *   - 'deny'                         : any symlink resolved below rootDir returns 404
 *
 * A key scenario is rootDir being ITSELF a symlink (atomic-deploy / Capistrano /
 * Nix style): this must keep working in every mode, because the boundary check is
 * pinned to realpath(rootDir) at factory init.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

// Detect symlink support (Windows without dev mode may not have it)
let symlinkSupported = true;
try {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-check-'));
    fs.writeFileSync(path.join(d, 't'), 'x');
    fs.symlinkSync(path.join(d, 't'), path.join(d, 'l'));
    fs.rmSync(d, { recursive: true, force: true });
} catch {
    symlinkSupported = false;
}
const describeIfSymlinks = symlinkSupported ? describe : describe.skip;

function body(res) {
    return res.text !== undefined ? res.text : res.body.toString('utf8');
}

describeIfSymlinks('symlinks policy (V-1)', () => {
    let root;       // served directory
    let outside;    // secret directory OUTSIDE root

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-symp-root-'));
        outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-symp-out-'));

        fs.writeFileSync(path.join(outside, 'secret.txt'), 'TOP-SECRET-DATA');
        fs.writeFileSync(path.join(root, 'normal.txt'), 'normal content');

        // Escaping symlinks (point outside root)
        fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'escape-file.txt'));
        fs.symlinkSync(outside, path.join(root, 'escape-dir'));

        // In-root symlink (points to a real file inside root)
        fs.symlinkSync(path.join(root, 'normal.txt'), path.join(root, 'inroot-link.txt'));
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    // ── Factory validation ───────────────────────────────────────────────────
    describe('factory validation', () => {
        test('invalid symlinks value throws', () => {
            expect(() => koaClassicServer(root, { symlinks: 'nope' })).toThrow(/symlinks must be one of/);
        });

        test('protected mode throws when rootDir does not exist', () => {
            const missing = path.join(os.tmpdir(), 'kcs-does-not-exist-' + Date.now());
            expect(() => koaClassicServer(missing, { symlinks: 'follow-within-root' })).toThrow(/rootDir must exist/);
        });

        test('follow mode does NOT require rootDir to exist (historical behavior)', () => {
            const missing = path.join(os.tmpdir(), 'kcs-does-not-exist-' + Date.now());
            expect(() => koaClassicServer(missing, { symlinks: 'follow' })).not.toThrow();
            expect(() => koaClassicServer(missing)).not.toThrow(); // default
        });
    });

    // ── Default: follow (backward compatible) ─────────────────────────────────
    describe("mode 'follow' (default)", () => {
        let server, request;
        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(root, { dirListing: { enabled: true } })); // default symlinks
            server = app.listen();
            request = supertest(server);
        });
        afterAll(() => server?.close());

        test('escaping file symlink is served (200)', async () => {
            const res = await request.get('/escape-file.txt');
            expect(res.status).toBe(200);
            expect(body(res)).toContain('TOP-SECRET-DATA');
        });

        test('escaping dir symlink lists outside contents (200)', async () => {
            const res = await request.get('/escape-dir/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('secret.txt');
        });
    });

    // ── follow-within-root ────────────────────────────────────────────────────
    describe("mode 'follow-within-root'", () => {
        let server, request;
        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(root, { dirListing: { enabled: true }, symlinks: 'follow-within-root' }));
            server = app.listen();
            request = supertest(server);
        });
        afterAll(() => server?.close());

        test('escaping file symlink returns 404', async () => {
            const res = await request.get('/escape-file.txt');
            expect(res.status).toBe(404);
            expect(body(res)).not.toContain('TOP-SECRET-DATA');
        });

        test('escaping dir symlink listing returns 404', async () => {
            const res = await request.get('/escape-dir/');
            expect(res.status).toBe(404);
        });

        test('file inside escaping dir symlink returns 404', async () => {
            const res = await request.get('/escape-dir/secret.txt');
            expect(res.status).toBe(404);
            expect(body(res)).not.toContain('TOP-SECRET-DATA');
        });

        test('regular file still served (200)', async () => {
            const res = await request.get('/normal.txt');
            expect(res.status).toBe(200);
            expect(body(res)).toContain('normal content');
        });

        test('in-root symlink is followed (200)', async () => {
            const res = await request.get('/inroot-link.txt');
            expect(res.status).toBe(200);
            expect(body(res)).toContain('normal content');
        });

        test('listing shows escaping symlink as Blocked and non-clickable, without leaking size', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('escape-file.txt');
            expect(res.text).toContain('( Blocked Symlink )');
            // Not wrapped in a link
            expect(res.text).not.toMatch(/<a[^>]*>escape-file\.txt<\/a>/);
            // Must not leak the secret's byte size — the outside file is 15 bytes
            expect(res.text).not.toMatch(/escape-file\.txt[\s\S]*?15 B/);
        });
    });

    // ── deny ───────────────────────────────────────────────────────────────────
    describe("mode 'deny'", () => {
        let server, request;
        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(root, { dirListing: { enabled: true }, symlinks: 'deny' }));
            server = app.listen();
            request = supertest(server);
        });
        afterAll(() => server?.close());

        test('escaping symlink returns 404', async () => {
            const res = await request.get('/escape-file.txt');
            expect(res.status).toBe(404);
        });

        test('in-root symlink is ALSO denied (404)', async () => {
            const res = await request.get('/inroot-link.txt');
            expect(res.status).toBe(404);
        });

        test('regular file still served (200)', async () => {
            const res = await request.get('/normal.txt');
            expect(res.status).toBe(200);
            expect(body(res)).toContain('normal content');
        });

        test('listing marks in-root symlink as Blocked, non-clickable', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('inroot-link.txt');
            expect(res.text).not.toMatch(/<a[^>]*>inroot-link\.txt<\/a>/);
        });
    });

    // ── rootDir is itself a symlink (must work in every mode) ────────────────────
    describe('rootDir is itself a symlink', () => {
        let realTarget, rootLink, escapeTargetDir;

        beforeAll(() => {
            realTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-realtgt-'));
            escapeTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-esc-'));
            fs.writeFileSync(path.join(realTarget, 'index.txt'), 'INSIDE-REAL-TARGET');
            fs.writeFileSync(path.join(escapeTargetDir, 'x.txt'), 'ESCAPED');
            // A symlink INSIDE the real target that escapes it
            fs.symlinkSync(path.join(escapeTargetDir, 'x.txt'), path.join(realTarget, 'escape.txt'));
            rootLink = path.join(os.tmpdir(), 'kcs-rootlink-' + Date.now());
            fs.symlinkSync(realTarget, rootLink); // rootDir passed to middleware IS a symlink
        });
        afterAll(() => {
            fs.rmSync(realTarget, { recursive: true, force: true });
            fs.rmSync(escapeTargetDir, { recursive: true, force: true });
            fs.rmSync(rootLink, { force: true });
        });

        test('follow-within-root: normal file inside the symlinked rootDir is served (200)', async () => {
            const app = new Koa();
            app.use(koaClassicServer(rootLink, { dirListing: { enabled: true }, symlinks: 'follow-within-root' }));
            const server = app.listen();
            try {
                const res = await supertest(server).get('/index.txt');
                expect(res.status).toBe(200);
                expect(body(res)).toContain('INSIDE-REAL-TARGET');
            } finally { server.close(); }
        });

        test('follow-within-root: symlink escaping the real target is still blocked (404)', async () => {
            const app = new Koa();
            app.use(koaClassicServer(rootLink, { dirListing: { enabled: true }, symlinks: 'follow-within-root' }));
            const server = app.listen();
            try {
                const res = await supertest(server).get('/escape.txt');
                expect(res.status).toBe(404);
                expect(body(res)).not.toContain('ESCAPED');
            } finally { server.close(); }
        });

        test('deny: normal file inside the symlinked rootDir is served (200)', async () => {
            const app = new Koa();
            app.use(koaClassicServer(rootLink, { dirListing: { enabled: true }, symlinks: 'deny' }));
            const server = app.listen();
            try {
                const res = await supertest(server).get('/index.txt');
                expect(res.status).toBe(200);
                expect(body(res)).toContain('INSIDE-REAL-TARGET');
            } finally { server.close(); }
        });
    });

    // ── escaping index file ──────────────────────────────────────────────────────
    describe('index file that is an escaping symlink', () => {
        let idxRoot, idxOutside;
        beforeAll(() => {
            idxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-idx-root-'));
            idxOutside = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-idx-out-'));
            fs.writeFileSync(path.join(idxOutside, 'evil.html'), '<h1>EVIL INDEX</h1>');
            fs.symlinkSync(path.join(idxOutside, 'evil.html'), path.join(idxRoot, 'index.html'));
        });
        afterAll(() => {
            fs.rmSync(idxRoot, { recursive: true, force: true });
            fs.rmSync(idxOutside, { recursive: true, force: true });
        });

        test('follow-within-root: escaping index symlink is not served', async () => {
            const app = new Koa();
            app.use(koaClassicServer(idxRoot, { index: ['index.html'], dirListing: { enabled: true }, symlinks: 'follow-within-root' }));
            const server = app.listen();
            try {
                const res = await supertest(server).get('/');
                // index is rejected → falls through to listing (or 404), never serves EVIL
                expect(body(res)).not.toContain('EVIL INDEX');
            } finally { server.close(); }
        });
    });
});
