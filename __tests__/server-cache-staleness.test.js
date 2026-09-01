/**
 * serverCache freshness contracts — 2026-09 coverage review.
 *
 * server-cache.test.js proves the caches WORK (hit, invalidate on a normal
 * edit, expire on maxAge). What it never exercises is the shape of their
 * validator: an entry is considered fresh when `mtime` AND `size` both match
 * the stat of the moment. That is a two-field heuristic, and the cases where it
 * disagrees with the bytes on disk are exactly the ones an operator hits in
 * production — an atomic same-size rewrite, a restore from backup that moves
 * mtime backwards, a file whose permissions are pulled after it was cached.
 *
 * Each of those has a defined outcome today. None of them had a test. They are
 * pinned here as contracts, including the one that is a documented limitation
 * (same mtime + same size ⇒ stale bytes) and the one that is an asymmetry
 * between the two caches:
 *
 *   - a compressedFile cache hit still runs the R_OK readability probe, so a
 *     file made unreadable stops being served;
 *   - a rawFile cache hit does NOT (the probe is skipped whenever a buffer is
 *     in hand, whether it came from this request's readFile or from RAM), so
 *     the same file keeps being served from the cache until mtime or size
 *     moves.
 *
 * If that asymmetry is ever deliberately closed, this file is where the change
 * announces itself.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-cache-stale-'));
});

afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
});

function makeServer(opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, opts));
    return app.callback();
}

// Rewrite a file's content while restoring its previous mtime — the atomic
// same-size overwrite (rsync --inplace, a template writer, an editor that
// preserves timestamps) that the mtime+size validator cannot see.
function rewritePreservingMtime(filePath, content) {
    const before = fs.statSync(filePath);
    fs.writeFileSync(filePath, content);
    fs.utimesSync(filePath, before.atime, before.mtime);
}

const RAW_ON = { serverCache: { rawFile: { enabled: true } }, compression: false };

// ─── the validator's blind spot ──────────────────────────────────────────────

describe('rawFile — same mtime AND same size is treated as unchanged', () => {
    test('a same-size rewrite that preserves mtime keeps serving the CACHED bytes', async () => {
        const file = path.join(root, 'a.txt');
        fs.writeFileSync(file, 'AAAA');
        const server = makeServer(RAW_ON);

        expect((await supertest(server).get('/a.txt')).text).toBe('AAAA');

        rewritePreservingMtime(file, 'ZZZZ'); // same 4 bytes, same timestamp
        expect(fs.readFileSync(file, 'utf8')).toBe('ZZZZ');

        // Documented limitation, not a bug: the validator has nothing to detect.
        expect((await supertest(server).get('/a.txt')).text).toBe('AAAA');
    });

    test('a size change on the same mtime IS detected', async () => {
        const file = path.join(root, 'a.txt');
        fs.writeFileSync(file, 'AAAA');
        const server = makeServer(RAW_ON);

        expect((await supertest(server).get('/a.txt')).text).toBe('AAAA');

        rewritePreservingMtime(file, 'ZZZZZZ'); // 6 bytes now
        expect((await supertest(server).get('/a.txt')).text).toBe('ZZZZZZ');
    });

    test('maxAge is the escape hatch for the same-size, same-mtime case', async () => {
        const file = path.join(root, 'a.txt');
        fs.writeFileSync(file, 'AAAA');
        const server = makeServer({
            serverCache: { rawFile: { enabled: true, maxAge: 30 } },
            compression: false,
        });

        expect((await supertest(server).get('/a.txt')).text).toBe('AAAA');
        rewritePreservingMtime(file, 'ZZZZ');

        await new Promise((r) => setTimeout(r, 60)); // past maxAge
        expect((await supertest(server).get('/a.txt')).text).toBe('ZZZZ');
    });
});

describe('rawFile — mtime moving BACKWARDS invalidates (restore from backup)', () => {
    test('an older mtime is a DIFFERENT version, not a stale-check that passes', async () => {
        const file = path.join(root, 'a.txt');
        fs.writeFileSync(file, 'NEWVERSION');
        const server = makeServer(RAW_ON);

        expect((await supertest(server).get('/a.txt')).text).toBe('NEWVERSION');

        // Restore an older copy: different bytes, and a timestamp in the past.
        fs.writeFileSync(file, 'OLDVERSION');
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        fs.utimesSync(file, yesterday, yesterday);

        expect((await supertest(server).get('/a.txt')).text).toBe('OLDVERSION');
    });

    test('the ETag follows the restored mtime rather than staying on the newer one', async () => {
        const file = path.join(root, 'a.txt');
        fs.writeFileSync(file, 'NEWVERSION');
        const server = makeServer({ ...RAW_ON, browserCacheEnabled: true });

        const fresh = await supertest(server).get('/a.txt');

        fs.writeFileSync(file, 'OLDVERSION');
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
        fs.utimesSync(file, yesterday, yesterday);

        const restored = await supertest(server).get('/a.txt');
        expect(restored.headers.etag).not.toBe(fresh.headers.etag);

        // And the client's old validator no longer matches → full 200, not 304.
        const revalidated = await supertest(server)
            .get('/a.txt')
            .set('If-None-Match', fresh.headers.etag);
        expect(revalidated.status).toBe(200);
    });
});

// ─── readability after caching: the two caches differ ────────────────────────

describe('a file made unreadable AFTER it was cached', () => {
    test('rawFile cache hit: still served from RAM, the R_OK probe is skipped', async () => {
        fs.writeFileSync(path.join(root, 'a.txt'), 'AAAA');
        const server = makeServer(RAW_ON);

        expect((await supertest(server).get('/a.txt')).text).toBe('AAAA');

        const realAccess = fs.promises.access;
        const spy = jest.spyOn(fs.promises, 'access').mockImplementation(async (p, ...rest) => {
            if (String(p).endsWith('a.txt')) {
                const err = new Error('EACCES: permission denied');
                err.code = 'EACCES';
                throw err;
            }
            return realAccess(p, ...rest);
        });

        const res = await supertest(server).get('/a.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('AAAA');
        // The probe was never reached: a buffer was already in hand.
        expect(spy).not.toHaveBeenCalled();
    });

    test('compressedFile cache hit: the R_OK probe still runs → 404', async () => {
        fs.writeFileSync(path.join(root, 'big.txt'), 'B'.repeat(4096));
        const errors = [];
        const server = makeServer({
            serverCache: { compressedFile: { enabled: true } },
            logger: { warn: () => {}, error: (...a) => errors.push(a.map(String).join(' ')) },
        });

        const warm = await supertest(server).get('/big.txt').set('Accept-Encoding', 'gzip');
        expect(warm.status).toBe(200);
        expect(warm.headers['content-encoding']).toBe('gzip');

        const realAccess = fs.promises.access;
        jest.spyOn(fs.promises, 'access').mockImplementation(async (p, ...rest) => {
            if (String(p).endsWith('big.txt')) {
                const err = new Error('EACCES: permission denied');
                err.code = 'EACCES';
                throw err;
            }
            return realAccess(p, ...rest);
        });

        const res = await supertest(server).get('/big.txt').set('Accept-Encoding', 'gzip');
        expect(res.status).toBe(404);
        expect(errors.join('\n')).toMatch(/File access error/);
    });

    test('with no cache at all the probe answers 404 (baseline for the comparison above)', async () => {
        fs.writeFileSync(path.join(root, 'a.txt'), 'AAAA');
        const server = makeServer({ compression: false, logger: { warn: () => {}, error: () => {} } });

        const realAccess = fs.promises.access;
        jest.spyOn(fs.promises, 'access').mockImplementation(async (p, ...rest) => {
            if (String(p).endsWith('a.txt')) {
                const err = new Error('EACCES: permission denied');
                err.code = 'EACCES';
                throw err;
            }
            return realAccess(p, ...rest);
        });

        expect((await supertest(server).get('/a.txt')).status).toBe(404);
    });
});

// ─── a cached file that disappears ───────────────────────────────────────────

describe('a file deleted after it was cached', () => {
    test('rawFile: the stat that precedes the cache lookup 404s — no phantom serving', async () => {
        const file = path.join(root, 'a.txt');
        fs.writeFileSync(file, 'AAAA');
        const server = makeServer({ ...RAW_ON, logger: { warn: () => {}, error: () => {} } });

        expect((await supertest(server).get('/a.txt')).text).toBe('AAAA');

        fs.rmSync(file);
        expect((await supertest(server).get('/a.txt')).status).toBe(404);
    });

    test('recreating it with different bytes serves the new content, not the cached one', async () => {
        const file = path.join(root, 'a.txt');
        fs.writeFileSync(file, 'AAAA');
        const server = makeServer({ ...RAW_ON, logger: { warn: () => {}, error: () => {} } });

        expect((await supertest(server).get('/a.txt')).text).toBe('AAAA');

        fs.rmSync(file);
        expect((await supertest(server).get('/a.txt')).status).toBe(404);

        fs.writeFileSync(file, 'RECREATED');
        expect((await supertest(server).get('/a.txt')).text).toBe('RECREATED');
    });
});

// ─── crossing maxFileSize while cached ───────────────────────────────────────

describe('a cached file that grows past rawFile.maxFileSize', () => {
    test('it leaves the cache path and is served fresh from disk', async () => {
        const file = path.join(root, 'a.txt');
        fs.writeFileSync(file, 'small');
        const server = makeServer({
            serverCache: { rawFile: { enabled: true, maxFileSize: 64 } },
            compression: false,
        });

        expect((await supertest(server).get('/a.txt')).text).toBe('small');

        const big = 'G'.repeat(200); // now above maxFileSize
        fs.writeFileSync(file, big);

        const res = await supertest(server).get('/a.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe(big);
        expect(res.headers['content-length']).toBe(String(big.length));
    });

    test('shrinking back below the cap re-enters the cache with the current bytes', async () => {
        const file = path.join(root, 'a.txt');
        fs.writeFileSync(file, 'G'.repeat(200));
        const server = makeServer({
            serverCache: { rawFile: { enabled: true, maxFileSize: 64 } },
            compression: false,
        });

        expect((await supertest(server).get('/a.txt')).text).toBe('G'.repeat(200));

        fs.writeFileSync(file, 'tiny');
        expect((await supertest(server).get('/a.txt')).text).toBe('tiny');
        expect((await supertest(server).get('/a.txt')).text).toBe('tiny'); // second hit: from RAM
    });
});
