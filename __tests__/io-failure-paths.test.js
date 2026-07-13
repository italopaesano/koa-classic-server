/**
 * I/O failure-path tests — 2026-07 coverage review.
 *
 * Every test here exercises an error handler that protects the process from
 * real-world filesystem races and I/O faults: files deleted or chmod'd between
 * syscalls, read streams failing mid-flight, directories becoming unreadable,
 * and responses already in flight when something breaks. These paths were
 * previously uncovered because no test ever injected a failure.
 *
 * Techniques:
 *  - jest.spyOn on the specific fs API, scoped to the target path (or to the
 *    first call), so the rest of the request flow keeps using the real
 *    filesystem; every spy is restored in afterEach.
 *  - Servers are always closed in `finally`: Koa 3 answers a mid-stream error
 *    by destroying the socket, which rejects the supertest promise — without
 *    the finally the listening server would leak and hang Jest.
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let fixturesDir;

beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-io-failure-'));
    fs.writeFileSync(path.join(fixturesDir, 'file.txt'), 'stream me please'); // 16 bytes
    fs.writeFileSync(path.join(fixturesDir, 'idx.html'), '<h1>idx</h1>');
    fs.writeFileSync(path.join(fixturesDir, 'page.ejs'), '<h1>template</h1>');
    fs.mkdirSync(path.join(fixturesDir, 'sub'));
    fs.writeFileSync(path.join(fixturesDir, 'sub', 'inner.txt'), 'inner');
    // Large enough to clear compression.minFileSize (1024) for streaming-compression tests
    fs.writeFileSync(path.join(fixturesDir, 'big.txt'), 'B'.repeat(4096));
});

afterAll(() => {
    fs.rmSync(fixturesDir, { recursive: true, force: true });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function capturingLogger() {
    const errors = [];
    const warns = [];
    return {
        errors,
        warns,
        error: (...args) => errors.push(args.map(String).join(' ')),
        warn: (...args) => warns.push(args.map(String).join(' ')),
    };
}

function createServer(opts = {}) {
    const app = new Koa();
    app.on('error', () => {}); // silence Koa's default stderr logging
    app.use(koaClassicServer(fixturesDir, { ...opts }));
    return app.listen();
}

// Runs `request` (a supertest chain) with the server guaranteed closed after,
// normalizing the outcome: Koa 3 destroys the socket on mid-stream errors, so
// the client may see an exception instead of a status code.
async function outcomeOf(server, request) {
    try {
        const res = await request;
        return { status: res.status, text: res.text };
    } catch (err) {
        return { clientError: err };
    } finally {
        server.close();
    }
}

// Asserts the exchange did NOT produce a clean 2xx: either an error status
// arrived, or the connection was torn down client-side.
function expectSurfacedError(outcome) {
    if (outcome.status !== undefined) {
        expect(outcome.status).toBeGreaterThanOrEqual(500);
    } else {
        expect(outcome.clientError).toBeDefined();
    }
}

// Returns a Readable that emits `err` shortly after being consumed, without
// ever producing data — models a file whose read fails after open (EIO,
// deletion on a networked FS, ...).
function brokenStream(err) {
    const s = new PassThrough();
    setImmediate(() => s.destroy(err));
    return s;
}

// Mocks fs.createReadStream so reads of `targetPath` fail mid-flight while
// every other read (fixtures, other tests' I/O) uses the real implementation.
function mockBrokenReadStream(targetPath) {
    const original = fs.createReadStream;
    return jest.spyOn(fs, 'createReadStream').mockImplementation((p, ...args) => {
        if (path.resolve(String(p)) === path.resolve(targetPath)) {
            return brokenStream(Object.assign(new Error('injected EIO'), { code: 'EIO' }));
        }
        return original.call(fs, p, ...args);
    });
}

// ─── show_dir: readdir failure → middleware 500 error page ──────────────────

describe('directory read failure', () => {
    test('readdir error while listing → 500 error page + operator log', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger });
        const original = fs.promises.readdir;
        jest.spyOn(fs.promises, 'readdir').mockImplementation(async (p, o) => {
            if (path.resolve(String(p)) === path.resolve(path.join(fixturesDir, 'sub'))) {
                throw Object.assign(new Error('injected EACCES'), { code: 'EACCES' });
            }
            return original.call(fs.promises, p, o);
        });

        const outcome = await outcomeOf(server, supertest(server).get('/sub/').ok(() => true));

        expect(outcome.status).toBe(500);
        // Routed through the unified error writer: generic 500 body (like every
        // other 500), security headers, no-store — no longer a bespoke page.
        expect(outcome.text).toContain('unexpected condition');
        expect(logger.errors.some(e => e.includes('Directory read error'))).toBe(true);
    });

    test('readdir error with a custom errorPages[500] → serves the custom page', async () => {
        const custom = path.join(fixturesDir, 'custom-500.html');
        fs.writeFileSync(custom, '<!DOCTYPE html><html><body><h1>Custom Dir 500</h1></body></html>');
        const logger = capturingLogger();
        const server = createServer({ logger, errorPages: { 500: custom } });
        const original = fs.promises.readdir;
        jest.spyOn(fs.promises, 'readdir').mockImplementation(async (p, o) => {
            if (path.resolve(String(p)) === path.resolve(path.join(fixturesDir, 'sub'))) {
                throw Object.assign(new Error('injected EACCES'), { code: 'EACCES' });
            }
            return original.call(fs.promises, p, o);
        });

        const outcome = await outcomeOf(server, supertest(server).get('/sub/').ok(() => true));

        expect(outcome.status).toBe(500);
        expect(outcome.text).toContain('Custom Dir 500');           // operator's page, not the built-in
        expect(outcome.text).not.toContain('unexpected condition');
        fs.rmSync(custom, { force: true });
    });
});

// ─── findIndexFile: failures on the RegExp (readdir-based) slow path ─────────

describe('findIndexFile failures', () => {
    test('readdir error during index lookup → logged, listing still served', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger, index: [/^idx/] });

        // Reject only the FIRST readdir (findIndexFile's); the second one
        // (show_dir's) goes through so the listing can render.
        const original = fs.promises.readdir;
        let first = true;
        jest.spyOn(fs.promises, 'readdir').mockImplementation(async (p, o) => {
            if (first) {
                first = false;
                throw Object.assign(new Error('injected EACCES'), { code: 'EACCES' });
            }
            return original.call(fs.promises, p, o);
        });

        const outcome = await outcomeOf(server, supertest(server).get('/'));

        expect(outcome.status).toBe(200);
        expect(outcome.text).toContain('Index of'); // graceful fallback to the listing
        expect(logger.errors.some(e => e.includes('Error finding index file'))).toBe(true);
    });

    test('DT_UNKNOWN dirent whose stat fails during index lookup → skipped, listing served', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger, index: [/ghost/] });

        // A DT_UNKNOWN dirent (d_type not reported: overlayfs/NFS/FUSE) forces
        // the stat() fallback in isFileOrSymlinkToFile; the entry vanished in
        // the meantime, so the stat fails and the entry must count as
        // not-a-file — no crash, no index match.
        const original = fs.promises.readdir;
        let first = true;
        jest.spyOn(fs.promises, 'readdir').mockImplementation(async (p, o) => {
            if (first && o && o.withFileTypes) {
                first = false;
                return [new fs.Dirent('ghost.html', 0)]; // 0 = UV_DIRENT_UNKNOWN, no file on disk
            }
            return original.call(fs.promises, p, o);
        });

        const outcome = await outcomeOf(server, supertest(server).get('/'));

        expect(outcome.status).toBe(200);
        expect(outcome.text).toContain('Index of');
    });

    test('index file deleted between readdir and stat → skipped, listing served', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger, index: [/^idx/] });

        // findIndexFile's readdir sees idx.html, then its stat() races a delete.
        const original = fs.promises.stat;
        jest.spyOn(fs.promises, 'stat').mockImplementation(async (p, ...args) => {
            if (String(p).endsWith('idx.html')) {
                throw Object.assign(new Error('injected ENOENT'), { code: 'ENOENT' });
            }
            return original.call(fs.promises, p, ...args);
        });

        const outcome = await outcomeOf(server, supertest(server).get('/'));

        expect(outcome.status).toBe(200);
        expect(outcome.text).toContain('Index of'); // no index match → listing, not a 500
    });
});

// ─── loadFile: access / readFile race protection ─────────────────────────────

describe('file readability races', () => {
    test('fs.access failure (file became unreadable) → 404 + operator log', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger });
        jest.spyOn(fs.promises, 'access').mockRejectedValue(
            Object.assign(new Error('injected EACCES'), { code: 'EACCES' })
        );

        const outcome = await outcomeOf(server, supertest(server).get('/file.txt').ok(() => true));

        expect(outcome.status).toBe(404);
        expect(logger.errors.some(e => e.includes('File access error'))).toBe(true);
    });

    test('readFile failure with rawFile cache enabled → falls through to disk streaming', async () => {
        const logger = capturingLogger();
        const server = createServer({
            logger,
            serverCache: { rawFile: { enabled: true } },
        });
        // The cache-population readFile fails once; the request must still be
        // served (via access + createReadStream), not turn into a 500.
        jest.spyOn(fs.promises, 'readFile').mockRejectedValueOnce(
            Object.assign(new Error('injected EIO'), { code: 'EIO' })
        );

        const outcome = await outcomeOf(
            server,
            supertest(server).get('/file.txt').set('Accept-Encoding', 'identity')
        );

        expect(outcome.status).toBe(200);
        expect(outcome.text).toBe('stream me please');
    });
});

// ─── Read-stream failures on each streaming branch ───────────────────────────

describe('read-stream failures', () => {
    test('Range request: stream error → logged, no 206 payload leaks', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger }); // rawFile cache off → range served from stream
        mockBrokenReadStream(path.join(fixturesDir, 'file.txt'));

        const outcome = await outcomeOf(
            server,
            supertest(server).get('/file.txt').set('Range', 'bytes=0-4').ok(() => true)
        );

        expect(logger.errors.some(e => e.includes('Stream error'))).toBe(true);
        expectSurfacedError(outcome);
    });

    test('uncompressed streaming: stream error → logged, error surfaced', async () => {
        const logger = capturingLogger();
        const server = createServer({ logger });
        mockBrokenReadStream(path.join(fixturesDir, 'file.txt'));

        const outcome = await outcomeOf(
            server,
            supertest(server).get('/file.txt').set('Accept-Encoding', 'identity').ok(() => true)
        );

        expect(logger.errors.some(e => e.includes('Stream error'))).toBe(true);
        expectSurfacedError(outcome);
    });

    test('streaming compression (pipeline): source error → logged, not swallowed', async () => {
        const logger = capturingLogger();
        // compressedFile cache disabled → compression runs in streaming mode
        const server = createServer({
            logger,
            serverCache: { compressedFile: { enabled: false } },
        });
        mockBrokenReadStream(path.join(fixturesDir, 'big.txt'));

        const outcome = await outcomeOf(
            server,
            supertest(server).get('/big.txt').set('Accept-Encoding', 'gzip').ok(() => true)
        );

        expect(logger.errors.some(e => e.includes('Stream error'))).toBe(true);
        expectSurfacedError(outcome);
    });
});

// ─── symlinkAllowed: realpath failure in protected modes ─────────────────────

describe('symlink policy: realpath failure', () => {
    test("symlinks: 'deny' + realpath error → 404 (treated as not found)", async () => {
        const logger = capturingLogger();
        const server = createServer({ symlinks: 'deny', logger });

        // Models a broken/circular link or a target deleted between stat and
        // realpath — the protected mode must fail CLOSED (404), never serve.
        jest.spyOn(fs.promises, 'realpath').mockRejectedValue(
            Object.assign(new Error('injected ELOOP'), { code: 'ELOOP' })
        );

        const outcome = await outcomeOf(server, supertest(server).get('/file.txt').ok(() => true));

        expect(outcome.status).toBe(404);
    });
});

// ─── Responses already in flight when the failure hits ───────────────────────

// Sends a raw GET and resolves with what the wire produced: either a parse/
// reset error or { status, body, complete }. agent: false → no keep-alive
// pooling, so no socket outlives the test (Jest would hang on it).
function rawGet(port, urlPath, headers = {}) {
    return new Promise(resolve => {
        const req = http.request(
            { port, method: 'GET', path: urlPath, headers, agent: false },
            res => {
                let body = '';
                res.on('data', c => { body += c; });
                res.on('end', () => resolve({ status: res.statusCode, body, complete: res.complete }));
                res.on('aborted', () => resolve({ aborted: true, status: res.statusCode, body }));
                res.on('error', err => resolve({ clientError: err }));
            }
        );
        req.on('error', err => resolve({ clientError: err }));
        req.end();
    });
}

describe('failures after headers are already sent', () => {
    test('last-resort catch: throw after flushHeaders → socket destroyed, no 500 page', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.on('error', () => {});
        // Sabotage middleware: the first ctx.set() call inside the middleware
        // flushes the response head and then throws — modeling an unexpected
        // failure that hits while the response is already in flight.
        app.use((ctx, nextMw) => {
            const originalSet = ctx.set.bind(ctx);
            let armed = true;
            ctx.set = (...args) => {
                if (armed) {
                    armed = false;
                    ctx.res.flushHeaders();
                    throw new Error('injected post-flush failure');
                }
                return originalSet(...args);
            };
            return nextMw();
        });
        app.use(koaClassicServer(fixturesDir, { logger }));
        const server = app.listen();
        const port = server.address().port;

        let outcome;
        try {
            outcome = await rawGet(port, '/file.txt');
        } finally {
            server.close();
        }

        // The error reached the operator's logger through the last-resort catch…
        expect(logger.errors.some(e => e.includes('Unexpected error while serving'))).toBe(true);
        // …and the middleware did NOT try to write its 500 page onto a flushed
        // response: the client sees a terminated/incomplete exchange instead.
        const terminated =
            outcome.clientError !== undefined ||
            outcome.aborted === true ||
            outcome.complete === false;
        expect(terminated).toBe(true);
        if (outcome.body !== undefined) {
            expect(outcome.body).not.toContain('unexpected condition'); // the 500 page's text
        }
    });

    test('template render writes partial output then throws → socket destroyed, logged', async () => {
        const logger = capturingLogger();
        const app = new Koa();
        app.on('error', () => {});
        app.use(koaClassicServer(fixturesDir, {
            logger,
            template: {
                ext: ['ejs'],
                render: async (ctx) => {
                    ctx.status = 200;
                    ctx.res.write('<partial>'); // flushes status + headers
                    throw new Error('render exploded mid-stream');
                },
            },
        }));
        const server = app.listen();
        const port = server.address().port;

        let outcome;
        try {
            outcome = await rawGet(port, '/page.ejs');
        } finally {
            server.close();
        }

        expect(logger.errors.some(e => e.includes('Template rendering error'))).toBe(true);
        // sendTemplateError cannot rewrite a flushed response: it must destroy
        // the socket, not append a 500 page after the partial body.
        const terminated =
            outcome.clientError !== undefined ||
            outcome.aborted === true ||
            outcome.complete === false;
        expect(terminated).toBe(true);
        if (outcome.body !== undefined) {
            expect(outcome.body).not.toContain('Internal Server Error');
        }
    });
});

// ─── method fall-through completes next() normally ──────────────────────────

describe('non-matching method falls through to downstream middleware', () => {
    test('POST completes via next() and the downstream response is untouched', async () => {
        const app = new Koa();
        app.use(koaClassicServer(fixturesDir, {})); // method defaults to ['GET']
        app.use(ctx => {
            ctx.status = 200;
            ctx.body = 'downstream handled it';
        });
        const server = app.listen();

        const outcome = await outcomeOf(server, supertest(server).post('/file.txt'));

        expect(outcome.status).toBe(200);
        expect(outcome.text).toBe('downstream handled it');
    });
});
