/**
 * DT_UNKNOWN filesystem support tests for koa-classic-server
 *
 * Context: On filesystems where readdir({ withFileTypes: true }) returns dirents
 * with DT_UNKNOWN (UV_DIRENT_UNKNOWN = 0), all dirent.is*() methods return false.
 * This occurs on:
 *   - NixOS with buildFHSEnv (chroot-like environment for Playwright e2e tests)
 *   - overlayfs (used by Docker for image layers)
 *   - some FUSE filesystems (sshfs, s3fs, rclone mount)
 *   - NFS (some implementations don't support d_type)
 *   - ecryptfs (encrypted home directories on Linux)
 *
 * The fix adds a stat() fallback in isFileOrSymlinkToFile(), isDirOrSymlinkToDir(),
 * and show_dir() when the dirent type is unknown (type 0).
 *
 * On standard filesystems (ext4, btrfs, xfs, APFS, NTFS), d_type is always filled
 * correctly, so the stat() fallback is never reached — zero overhead.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

describe('DT_UNKNOWN filesystem support (NixOS buildFHSEnv, overlayfs, FUSE)', () => {
    let tmpDir;

    beforeAll(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-dt-unknown-test-'));

        // Create real files and directories that stat() can resolve
        fs.writeFileSync(
            path.join(tmpDir, 'index.html'),
            '<html><head><title>DT_UNKNOWN Index</title></head><body>Hello from DT_UNKNOWN</body></html>'
        );
        fs.writeFileSync(
            path.join(tmpDir, 'index.ejs'),
            '<html><head><title>EJS DT_UNKNOWN</title></head><body><h1>EJS Works</h1></body></html>'
        );
        fs.writeFileSync(
            path.join(tmpDir, 'style.css'),
            'body { color: blue; }'
        );
        fs.writeFileSync(
            path.join(tmpDir, 'readme.txt'),
            'This is a readme file.'
        );
        fs.mkdirSync(path.join(tmpDir, 'subdir'));
        fs.writeFileSync(
            path.join(tmpDir, 'subdir', 'nested.txt'),
            'nested content'
        );
    });

    afterAll(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    /**
     * Helper: create a Dirent with DT_UNKNOWN (type 0).
     * Node.js 18+: new fs.Dirent(name, 0)
     */
    function createUnknownDirent(name) {
        return new fs.Dirent(name, 0);
    }

    /**
     * Helper: mock fs.promises.readdir to return DT_UNKNOWN dirents for a specific directory.
     * stat() continues to work normally, so the fallback can resolve actual types.
     */
    function mockReaddirWithDtUnknown(targetDir, fileNames) {
        const originalReaddir = fs.promises.readdir;
        const spy = jest.spyOn(fs.promises, 'readdir').mockImplementation(async (dirPath, options) => {
            const resolvedTarget = path.resolve(targetDir);
            const resolvedDir = path.resolve(dirPath);
            if (resolvedDir === resolvedTarget && options && options.withFileTypes) {
                // Return DT_UNKNOWN dirents for all entries
                return fileNames.map(name => createUnknownDirent(name));
            }
            // Fall through to original for other directories
            return originalReaddir.call(fs.promises, dirPath, options);
        });
        return spy;
    }

    // =========================================================================
    // 1. isFileOrSymlinkToFile with DT_UNKNOWN
    // =========================================================================
    describe('isFileOrSymlinkToFile with DT_UNKNOWN', () => {
        test('should return true for DT_UNKNOWN entry pointing to a regular file', async () => {
            // Use findIndexFile as a proxy to test isFileOrSymlinkToFile behavior
            // When index.html has type 0, it should still be found via stat() fallback
            const spy = mockReaddirWithDtUnknown(tmpDir, ['index.html', 'style.css', 'subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.html'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                expect(res.text).toContain('DT_UNKNOWN Index');
                expect(res.text).not.toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('should return false for DT_UNKNOWN entry pointing to a directory', async () => {
            // A directory called "subdir" with DT_UNKNOWN should NOT match as an index file
            const spy = mockReaddirWithDtUnknown(tmpDir, ['subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['subdir'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                // Should show directory listing since "subdir" is a directory, not a file
                expect(res.text).toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('should return false for DT_UNKNOWN entry pointing to nothing (broken)', async () => {
            // Mock readdir to include a non-existent file
            const spy = mockReaddirWithDtUnknown(tmpDir, ['nonexistent.html', 'index.html']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['nonexistent.html'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                // nonexistent.html can't be stat'd, so should show directory listing
                expect(res.text).toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });
    });

    // =========================================================================
    // 2. isDirOrSymlinkToDir with DT_UNKNOWN
    // =========================================================================
    describe('isDirOrSymlinkToDir with DT_UNKNOWN', () => {
        test('should return true for DT_UNKNOWN entry pointing to a directory', async () => {
            // Test that isDirOrSymlinkToDir resolves DT_UNKNOWN dirs correctly
            // by checking that findIndexFile does NOT treat a directory as an index file
            const spy = mockReaddirWithDtUnknown(tmpDir, ['subdir', 'index.html']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.html'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                // index.html (file) should be served, not subdir (directory)
                expect(res.text).toContain('DT_UNKNOWN Index');
                expect(res.text).not.toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('should return false for DT_UNKNOWN entry pointing to a regular file', async () => {
            // Files should NOT be treated as directories
            // If only files exist and no index pattern matches, dir listing should show
            const spy = mockReaddirWithDtUnknown(tmpDir, ['style.css', 'readme.txt']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.html'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                // No index.html in the mocked readdir results, so directory listing
                expect(res.text).toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });
    });

    // =========================================================================
    // 3. findIndexFile with DT_UNKNOWN entries
    // =========================================================================
    describe('findIndexFile with DT_UNKNOWN entries', () => {
        test('should find index.html when all dirents have DT_UNKNOWN type', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['style.css', 'index.html', 'readme.txt', 'subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.html'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                expect(res.text).toContain('DT_UNKNOWN Index');
                expect(res.text).not.toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('should find index.ejs via string pattern when type is unknown', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['index.ejs', 'style.css', 'subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.ejs'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                expect(res.text).toContain('EJS DT_UNKNOWN');
                expect(res.text).not.toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('should find index.ejs via RegExp pattern when type is unknown', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['index.ejs', 'style.css', 'subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [/index\.[eE][jJ][sS]/],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                expect(res.text).toContain('EJS DT_UNKNOWN');
                expect(res.text).not.toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('should not find index in directory with only subdirectories (all DT_UNKNOWN)', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.html'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                // No file matches index.html, so directory listing should appear
                expect(res.text).toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });
    });

    // =========================================================================
    // 4. show_dir with DT_UNKNOWN entries
    // =========================================================================
    describe('show_dir with DT_UNKNOWN entries', () => {
        test('should list files with DT_UNKNOWN as their resolved type (FILE/DIR)', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['style.css', 'readme.txt', 'subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                expect(res.text).toContain('Index of');
                // All three entries should appear in the listing
                expect(res.text).toContain('style.css');
                expect(res.text).toContain('readme.txt');
                expect(res.text).toContain('subdir');
                // subdir should be resolved as DIR
                expect(res.text).toMatch(/subdir[\s\S]*?DIR/);
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('should not skip entries or log "Unknown file type: 0"', async () => {
            const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const spy = mockReaddirWithDtUnknown(tmpDir, ['style.css', 'readme.txt', 'subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                // All entries should be present (not skipped)
                expect(res.text).toContain('style.css');
                expect(res.text).toContain('readme.txt');
                expect(res.text).toContain('subdir');
                // Should NOT have logged "Unknown file type: 0"
                const unknownTypeCalls = consoleSpy.mock.calls.filter(
                    call => call[0] === 'Unknown file type:' && call[1] === 0
                );
                expect(unknownTypeCalls).toHaveLength(0);
            } finally {
                server.close();
                spy.mockRestore();
                consoleSpy.mockRestore();
            }
        });

        test('should show correct mime types for DT_UNKNOWN files', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['style.css', 'readme.txt']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                // CSS file should show text/css mime type
                expect(res.text).toMatch(/style\.css[\s\S]*?text\/css/);
                // TXT file should show text/plain mime type
                expect(res.text).toMatch(/readme\.txt[\s\S]*?text\/plain/);
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('should show correct sizes for DT_UNKNOWN files', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['style.css', 'readme.txt']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                // Files should have size values (not '-' which would indicate skipped/broken)
                // style.css is 21 bytes = "21 B"
                expect(res.text).toMatch(/style\.css[\s\S]*?\d+\s*B/);
                // readme.txt is 22 bytes = "22 B"
                expect(res.text).toMatch(/readme\.txt[\s\S]*?\d+\s*B/);
            } finally {
                server.close();
                spy.mockRestore();
            }
        });
    });

    // =========================================================================
    // 5. Integration: full request with DT_UNKNOWN filesystem
    // =========================================================================
    describe('integration: full request with DT_UNKNOWN filesystem', () => {
        test('GET / serves index file instead of directory listing', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['index.html', 'style.css', 'readme.txt', 'subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.html'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                expect(res.text).toContain('DT_UNKNOWN Index');
                expect(res.text).toContain('Hello from DT_UNKNOWN');
                expect(res.text).not.toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('GET /somefile.txt serves the file with 200', async () => {
            // Direct file access uses stat() at the top level, so it works
            // regardless of DT_UNKNOWN — this verifies the direct path still works
            const spy = mockReaddirWithDtUnknown(tmpDir, ['readme.txt', 'style.css', 'subdir']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/readme.txt');
                expect(res.status).toBe(200);
                expect(res.text).toContain('This is a readme file.');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('directory listing shows all entries correctly', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['index.html', 'style.css', 'readme.txt', 'subdir', 'index.ejs']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                expect(res.text).toContain('Index of');

                // All 5 entries should be listed
                expect(res.text).toContain('index.html');
                expect(res.text).toContain('style.css');
                expect(res.text).toContain('readme.txt');
                expect(res.text).toContain('subdir');
                expect(res.text).toContain('index.ejs');

                // subdir should show as DIR
                expect(res.text).toMatch(/subdir[\s\S]*?DIR/);

                // Files should have their correct mime types
                expect(res.text).toMatch(/style\.css[\s\S]*?text\/css/);
                expect(res.text).toMatch(/readme\.txt[\s\S]*?text\/plain/);
                expect(res.text).toMatch(/index\.html[\s\S]*?text\/html/);
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('GET / with EJS template engine and DT_UNKNOWN still serves index', async () => {
            const spy = mockReaddirWithDtUnknown(tmpDir, ['index.ejs', 'style.css', 'subdir']);

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
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                expect(res.headers['content-type']).toMatch(/html/);
                expect(res.text).toContain('EJS DT_UNKNOWN');
                expect(res.text).not.toContain('Index of');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });
    });

    // =========================================================================
    // 6. Edge cases
    // =========================================================================
    describe('edge cases', () => {
        test('mixed regular dirents and DT_UNKNOWN dirents work together', async () => {
            // Only mock readdir for the specific directory, verify normal files
            // still work alongside DT_UNKNOWN entries
            const originalReaddir = fs.promises.readdir;
            const spy = jest.spyOn(fs.promises, 'readdir').mockImplementation(async (dirPath, options) => {
                const resolvedTarget = path.resolve(tmpDir);
                const resolvedDir = path.resolve(dirPath);
                if (resolvedDir === resolvedTarget && options && options.withFileTypes) {
                    // Mix: some regular (type 1), some DT_UNKNOWN (type 0)
                    return [
                        new fs.Dirent('index.html', 1),   // Regular file
                        new fs.Dirent('style.css', 0),     // DT_UNKNOWN
                        new fs.Dirent('subdir', 0),         // DT_UNKNOWN
                    ];
                }
                return originalReaddir.call(fs.promises, dirPath, options);
            });

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: [],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                expect(res.text).toContain('Index of');
                // All entries should appear
                expect(res.text).toContain('index.html');
                expect(res.text).toContain('style.css');
                expect(res.text).toContain('subdir');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });

        test('DT_UNKNOWN Dirent has all is*() methods returning false', () => {
            // Verify our test helper creates correct DT_UNKNOWN dirents
            const d = createUnknownDirent('test.txt');
            expect(d.isFile()).toBe(false);
            expect(d.isDirectory()).toBe(false);
            expect(d.isSymbolicLink()).toBe(false);
            expect(d.isBlockDevice()).toBe(false);
            expect(d.isCharacterDevice()).toBe(false);
            expect(d.isFIFO()).toBe(false);
            expect(d.isSocket()).toBe(false);

            // Verify Symbol(type) is 0
            const syms = Object.getOwnPropertySymbols(d);
            expect(d[syms[0]]).toBe(0);
        });

        test('index priority is preserved with DT_UNKNOWN entries', async () => {
            // When multiple index files exist, the first pattern should win
            const spy = mockReaddirWithDtUnknown(tmpDir, ['index.ejs', 'index.html', 'style.css']);

            const app = new Koa();
            app.use(koaClassicServer(tmpDir, {
                index: ['index.html', 'index.ejs'],
                showDirContents: true
            }));
            const server = app.listen();
            const request = supertest(server);

            try {
                const res = await request.get('/');
                expect(res.status).toBe(200);
                // index.html should win because it's first in the index array
                expect(res.text).toContain('DT_UNKNOWN Index');
                expect(res.text).not.toContain('EJS DT_UNKNOWN');
            } finally {
                server.close();
                spy.mockRestore();
            }
        });
    });
});
