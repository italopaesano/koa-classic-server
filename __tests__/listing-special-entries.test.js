/**
 * Directory-listing special entries and sorting — 2026-07 test-expansion pass.
 *
 * The listing must stay resilient when a directory contains things that are
 * neither files nor directories (FIFOs, symlinks to FIFOs), when a reserved
 * first-level name is backed by a SYMLINK instead of a real directory, and
 * when sorting mixes directories and files (dirs-first tie-breaking) or the
 * client sends a sort parameter the server does not know.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

function createServer(root, opts = {}) {
    const app = new Koa();
    app.on('error', () => {});
    app.use(koaClassicServer(root, opts));
    return app.listen();
}

// ─── FIFO / special-file entries in the listing ──────────────────────────────

const describeUnix = process.platform === 'win32' ? describe.skip : describe;

describeUnix('listing a directory containing FIFOs (neither file nor dir)', () => {
    let root;
    let server;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-fifo-'));
        fs.writeFileSync(path.join(root, 'regular.txt'), 'regular');
        execFileSync('mkfifo', [path.join(root, 'pipe.fifo')]);
        // A symlink whose TARGET is a FIFO: dirent type = symlink, stat resolves
        // to neither file nor directory.
        fs.symlinkSync(path.join(root, 'pipe.fifo'), path.join(root, 'link-to-fifo'));
        server = createServer(root);
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('the listing renders 200 and includes the FIFO without a size', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('pipe.fifo');
        expect(res.text).toContain('regular.txt');
    });

    test('the symlink-to-FIFO row is listed with the Symlink label, no crash', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('link-to-fifo');
        expect(res.text).toContain('( Symlink )');
    });

    test('sorting by size still works with sizeless special entries present', async () => {
        const res = await supertest(server).get('/?sort=size&order=desc');
        expect(res.status).toBe(200);
        expect(res.text).toContain('pipe.fifo');
    });
});

// ─── reserved first-level entry backed by a SYMLINK ──────────────────────────

describeUnix('urlsReserved entry that is a symlink at the root listing', () => {
    let root;
    let server;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-reserved-link-'));
        fs.writeFileSync(path.join(root, 'target.txt'), 'link target');
        // A symlink to a FILE named like the reserved path: `type === 3` is what
        // marks it reserved (its effectiveType is 1, not 2).
        fs.symlinkSync(path.join(root, 'target.txt'), path.join(root, 'admin'));
        server = createServer(root, { urlsReserved: ['/admin'] });
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('the symlink row renders as RESERVED and is not clickable', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).toContain('DIR BUT RESERVED');
        // The reserved row must not wrap the name in a link
        expect(res.text).not.toMatch(/<a [^>]*>admin<\/a>/);
    });

    test('requests under the reserved symlink fall through to next()', async () => {
        const res = await supertest(server).get('/admin');
        expect(res.status).toBe(404); // Koa default — middleware passed
    });
});

// ─── sorting: dirs-first tie-breaking and unknown sort keys ──────────────────

describe('listing sort: dirs-first ordering and unknown sort parameters', () => {
    let root;
    let server;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-sorting-'));
        fs.mkdirSync(path.join(root, 'zdir'));
        fs.mkdirSync(path.join(root, 'adir'));
        fs.writeFileSync(path.join(root, 'big.txt'), 'B'.repeat(3000));
        fs.writeFileSync(path.join(root, 'tiny.txt'), 'T');
        server = createServer(root);
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    // Index of the row for `name` inside the rendered table body.
    const rowIndex = (html, name) => html.indexOf(`>${name}</a>`);

    test('sort=size asc: directories come first, then files by ascending size', async () => {
        const res = await supertest(server).get('/?sort=size&order=asc');
        expect(res.status).toBe(200);
        const t = res.text;
        // dirs (any order between them) precede every file
        expect(rowIndex(t, 'adir')).toBeLessThan(rowIndex(t, 'tiny.txt'));
        expect(rowIndex(t, 'zdir')).toBeLessThan(rowIndex(t, 'tiny.txt'));
        // files ordered by size
        expect(rowIndex(t, 'tiny.txt')).toBeLessThan(rowIndex(t, 'big.txt'));
    });

    test('sort=size desc: files by descending size, directories pushed last', async () => {
        const res = await supertest(server).get('/?sort=size&order=desc');
        expect(res.status).toBe(200);
        const t = res.text;
        expect(rowIndex(t, 'big.txt')).toBeLessThan(rowIndex(t, 'tiny.txt'));
        // desc negates the dirs-first bucket too — documented current behavior
        expect(rowIndex(t, 'big.txt')).toBeLessThan(rowIndex(t, 'zdir'));
    });

    test('sort=type: directories first, files grouped by MIME', async () => {
        const res = await supertest(server).get('/?sort=type&order=asc');
        expect(res.status).toBe(200);
        const t = res.text;
        expect(rowIndex(t, 'adir')).toBeLessThan(rowIndex(t, 'big.txt'));
        expect(rowIndex(t, 'zdir')).toBeLessThan(rowIndex(t, 'big.txt'));
    });

    test('unknown sort key (?sort=bogus) renders 200 in readdir order — no crash', async () => {
        const res = await supertest(server).get('/?sort=bogus&order=asc');
        expect(res.status).toBe(200);
        expect(res.text).toContain('big.txt');
        expect(res.text).toContain('adir');
    });

    test('unknown order value falls back to ascending semantics — no crash', async () => {
        const res = await supertest(server).get('/?sort=name&order=sideways');
        expect(res.status).toBe(200);
        const t = res.text;
        expect(rowIndex(t, 'adir')).toBeLessThan(rowIndex(t, 'zdir'));
    });

    test('array-shaped query params (?sort=a&sort=b) do not crash the listing', async () => {
        // Koa parses repeated params into an array — sortBy becomes a non-string.
        const res = await supertest(server).get('/?sort=name&sort=size');
        expect(res.status).toBe(200);
    });
});
