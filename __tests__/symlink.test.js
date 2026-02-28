/**
 * Symlink support tests for koa-classic-server
 *
 * Context: On NixOS with buildFHSEnv (chroot-like environment used for Playwright tests),
 * files in the www/ directory appear as symlinks to the Nix store instead of regular files.
 * This caused two failures:
 *   - GET / returned a directory listing ("Index of /") instead of rendering index.ejs
 *   - GET /index.ejs returned 404 instead of 200
 *
 * Root cause: fs.readdir({ withFileTypes: true }) classifies symlinks as
 * isSymbolicLink()=true, isFile()=false. The findIndexFile() function filtered
 * with dirent.isFile(), excluding all symlinks from index file discovery.
 *
 * The fix introduces isFileOrSymlinkToFile() / isDirOrSymlinkToDir() helpers
 * that follow symlinks via fs.promises.stat() only when dirent.isSymbolicLink()
 * is true, adding zero overhead for regular files.
 *
 * These tests also cover: Docker bind mounts, npm link, Capistrano-style deploys,
 * and any other scenario where files are served through symbolic links.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

// Detect if the OS supports symlinks (Windows without dev mode may not)
let symlinkSupported = true;
try {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symlink-check-'));
    const testFile = path.join(testDir, 'target');
    const testLink = path.join(testDir, 'link');
    fs.writeFileSync(testFile, 'test');
    fs.symlinkSync(testFile, testLink);
    fs.rmSync(testDir, { recursive: true, force: true });
} catch {
    symlinkSupported = false;
}

const describeIfSymlinks = symlinkSupported ? describe : describe.skip;

describeIfSymlinks('koa-classic-server - symlink support', () => {
    let tmpDir;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-symlink-test-'));

        // --- Regular files ---
        fs.writeFileSync(
            path.join(tmpDir, 'index.html'),
            '<html><head><title>Regular Index</title></head><body>Hello</body></html>'
        );
        fs.writeFileSync(
            path.join(tmpDir, 'style.css'),
            'body { color: red; }'
        );

        // --- Real file that will be the symlink target for index.ejs ---
        fs.writeFileSync(
            path.join(tmpDir, 'real-index.ejs'),
            '<html><head><title>EJS via Symlink</title></head><body><h1>Works</h1></body></html>'
        );

        // --- Symlink to file (the core bug scenario) ---
        fs.symlinkSync(
            path.join(tmpDir, 'real-index.ejs'),
            path.join(tmpDir, 'index.ejs')
        );

        // --- Symlink to regular file (non-index) ---
        fs.symlinkSync(
            path.join(tmpDir, 'style.css'),
            path.join(tmpDir, 'linked-style.css')
        );

        // --- Real subdirectory with a file ---
        const realSubdir = path.join(tmpDir, 'real-subdir');
        fs.mkdirSync(realSubdir);
        fs.writeFileSync(
            path.join(realSubdir, 'file.txt'),
            'content inside real-subdir'
        );

        // --- Symlink to directory ---
        fs.symlinkSync(
            realSubdir,
            path.join(tmpDir, 'linked-subdir')
        );

        // --- Broken symlink (target does not exist) ---
        fs.symlinkSync(
            path.join(tmpDir, 'non-existent-file.html'),
            path.join(tmpDir, 'broken-link.html')
        );

        // --- Circular symlinks ---
        try {
            fs.symlinkSync(
                path.join(tmpDir, 'circular-b'),
                path.join(tmpDir, 'circular-a')
            );
            fs.symlinkSync(
                path.join(tmpDir, 'circular-a'),
                path.join(tmpDir, 'circular-b')
            );
        } catch {
            // Some systems may not support circular symlinks creation
        }
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    // =========================================================================
    // 1. REGRESSION - Regular file as index
    // =========================================================================
    describe('regular file as index (regression)', () => {
        let server, request;

        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.html'],
                showDirContents: true
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server?.close(); });

        test('GET / serves regular index.html, not directory listing', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('Regular Index');
            expect(res.text).not.toContain('Index of');
        });
    });

    // =========================================================================
    // 2. BUG FIX - Symlink to file as index
    // =========================================================================
    describe('symlink to file as index (bug fix)', () => {
        let server, request;

        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.ejs'],
                showDirContents: true
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server?.close(); });

        test('GET / serves symlinked index.ejs, not directory listing', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('EJS via Symlink');
            expect(res.text).not.toContain('Index of');
        });
    });

    // =========================================================================
    // 3. BUG FIX - Direct GET to symlinked file returns 200
    // =========================================================================
    describe('direct GET to symlinked file (bug fix)', () => {
        let server, request;

        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server?.close(); });

        test('GET /index.ejs via symlink returns 200', async () => {
            const res = await request.get('/index.ejs');
            expect(res.status).toBe(200);
            expect(res.text).toContain('EJS via Symlink');
        });

        test('GET /linked-style.css via symlink returns 200 with correct mime', async () => {
            const res = await request.get('/linked-style.css');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/css/);
            expect(res.text).toContain('body { color: red; }');
        });
    });

    // =========================================================================
    // 4. BUG FIX - Symlink to file with template engine
    // =========================================================================
    describe('EJS template via symlink (bug fix)', () => {
        let server, request;

        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.ejs'],
                showDirContents: true,
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

        afterAll(() => { server?.close(); });

        test('GET / renders EJS template through symlink', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/html/);
            expect(res.text).toContain('EJS via Symlink');
        });
    });

    // =========================================================================
    // 5. Directory as symlink
    // =========================================================================
    describe('symlink to directory', () => {
        let server, request;

        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server?.close(); });

        test('GET /linked-subdir/ lists directory contents', async () => {
            const res = await request.get('/linked-subdir/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('file.txt');
        });

        test('GET /linked-subdir/file.txt serves file inside symlinked dir', async () => {
            const res = await request.get('/linked-subdir/file.txt');
            expect(res.status).toBe(200);
            expect(res.text).toContain('content inside real-subdir');
        });
    });

    // =========================================================================
    // 6. Broken symlink
    // =========================================================================
    describe('broken symlink', () => {
        let server, request;

        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server?.close(); });

        test('GET /broken-link.html returns 404, not crash', async () => {
            const res = await request.get('/broken-link.html');
            expect(res.status).toBe(404);
        });
    });

    // =========================================================================
    // 7. Circular symlink
    // =========================================================================
    describe('circular symlink', () => {
        let server, request;
        let circularExists = false;

        beforeAll(() => {
            circularExists = fs.existsSync(path.join(tmpDir, 'circular-a'));
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server?.close(); });

        test('GET /circular-a does not cause infinite loop', async () => {
            if (!circularExists) {
                // Skip if circular symlinks could not be created on this OS
                return;
            }
            const res = await request.get('/circular-a');
            // Should return an error status, not hang
            expect([404, 500]).toContain(res.status);
        });
    });

    // =========================================================================
    // 8. REGRESSION - Regular non-index file unchanged
    // =========================================================================
    describe('regular non-index file (regression)', () => {
        let server, request;

        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.html'],
                showDirContents: true
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server?.close(); });

        test('GET /style.css serves regular file correctly', async () => {
            const res = await request.get('/style.css');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/css/);
            expect(res.text).toContain('body { color: red; }');
        });
    });

    // =========================================================================
    // 9. Directory listing shows symlink indicators
    // =========================================================================
    describe('directory listing symlink indicators', () => {
        let server, request;

        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server?.close(); });

        test('symlink to file shows ( Symlink ) indicator', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            // index.ejs is a symlink to a file
            expect(res.text).toContain('index.ejs');
            expect(res.text).toMatch(/index\.ejs<\/a>\s*\( Symlink \)/);
        });

        test('symlink to directory shows ( Symlink ) indicator', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('linked-subdir');
            expect(res.text).toMatch(/linked-subdir<\/a>\s*\( Symlink \)/);
        });

        test('broken symlink shows ( Broken Symlink ) indicator without link', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('broken-link.html');
            expect(res.text).toContain('( Broken Symlink )');
            // Broken symlink name should NOT be wrapped in <a> tag
            expect(res.text).not.toMatch(/<a[^>]*>broken-link\.html<\/a>/);
        });

        test('regular file does NOT show symlink indicator', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('style.css');
            // style.css (not linked-style.css) should not have any symlink indicator
            expect(res.text).not.toMatch(/>style\.css<\/a>\s*\( Symlink \)/);
            expect(res.text).not.toMatch(/>style\.css<\/a>\s*\( Broken Symlink \)/);
        });

        test('symlink to file shows target mime type, not "unknown"', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            // linked-style.css is a symlink to style.css - should show text/css mime
            expect(res.text).toMatch(/linked-style\.css[\s\S]*?text\/css/);
        });

        test('symlink to directory shows DIR type', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            // linked-subdir is a symlink to a directory - should show DIR
            expect(res.text).toMatch(/linked-subdir[\s\S]*?DIR/);
        });
    });

    // =========================================================================
    // 10. Symlink as index with RegExp pattern
    // =========================================================================
    describe('symlink as index with RegExp pattern', () => {
        let server, request;

        beforeAll(() => {
            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [/index\.[eE][jJ][sS]/],
                showDirContents: true
            }));
            server = app.listen();
            request = supertest(server);
        });

        afterAll(() => { server?.close(); });

        test('GET / finds symlinked index.ejs via RegExp pattern', async () => {
            const res = await request.get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('EJS via Symlink');
            expect(res.text).not.toContain('Index of');
        });
    });
});
