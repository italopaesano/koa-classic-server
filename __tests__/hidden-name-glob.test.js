/**
 * Wildcard name-globs in hidden.dotFiles / hidden.dotDirs lists — 2026-07
 * coverage review.
 *
 * hidden-option.test.js exercises wildcards only in `alwaysHide` (the
 * path-aware matcher). The whitelist/blacklist of dotFiles/dotDirs go through
 * a DIFFERENT matcher (nameGlobMatch: bare-name globs, `*` / `?`, no path
 * semantics) whose wildcard branch was never exercised — every existing test
 * used exact names there. These tests pin down the documented glob semantics
 * for both wildcard characters, the exact-name fast path, and RegExp entries.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-name-glob-'));
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
    fs.writeFileSync(path.join(root, '.env.production'), 'SECRET=2');
    fs.writeFileSync(path.join(root, '.envelope'), 'not a secret, just a name');
    fs.writeFileSync(path.join(root, '.rc1'), 'release candidate');
    fs.writeFileSync(path.join(root, '.rc22'), 'two-digit release candidate');
    fs.writeFileSync(path.join(root, 'visible.txt'), 'plain');
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main');
    fs.mkdirSync(path.join(root, '.cache-http'));
    fs.mkdirSync(path.join(root, '.well-known'));
    fs.writeFileSync(path.join(root, '.well-known', 'security.txt'), 'Contact: x');
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function createServer(hiddenOpts) {
    const app = new Koa();
    app.use(koaClassicServer(root, { dirListing: { enabled: true }, hidden: hiddenOpts }));
    return app.listen();
}

// ─── dotFiles.blacklist with '*' ─────────────────────────────────────────────

describe('dotFiles.blacklist glob (".env*")', () => {
    let server;
    beforeAll(() => { server = createServer({ dotFiles: { blacklist: ['.env*'] } }); });
    afterAll(() => server.close());

    test.each(['/.env', '/.env.production', '/.envelope'])(
        'GET %s → 404 (matched by .env*)',
        async url => {
            const res = await supertest(server).get(url);
            expect(res.status).toBe(404);
        }
    );

    test('non-matching dot-file stays visible (default is visible)', async () => {
        const res = await supertest(server).get('/.rc1');
        expect(res.status).toBe(200);
    });

    test('listing omits the blacklisted names but shows the rest', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(res.text).not.toContain('.env');       // covers .env* variants
        expect(res.text).toContain('.rc1');
        expect(res.text).toContain('visible.txt');
    });
});

// ─── dotFiles lists with '?' ─────────────────────────────────────────────────

describe('dotFiles.blacklist glob with "?" (".rc?" matches exactly one character)', () => {
    let server;
    beforeAll(() => { server = createServer({ dotFiles: { blacklist: ['.rc?'] } }); });
    afterAll(() => server.close());

    test('GET /.rc1 → 404 (one character after .rc)', async () => {
        const res = await supertest(server).get('/.rc1');
        expect(res.status).toBe(404);
    });

    test('GET /.rc22 → 200 ("?" must not match two characters)', async () => {
        const res = await supertest(server).get('/.rc22');
        expect(res.status).toBe(200);
    });
});

// ─── dotFiles.whitelist glob overrides default: 'hidden' ─────────────────────

describe('dotFiles.whitelist glob overrides default: hidden', () => {
    let server;
    beforeAll(() => {
        server = createServer({ dotFiles: { default: 'hidden', whitelist: ['.env*'] } });
    });
    afterAll(() => server.close());

    test('whitelisted glob stays visible', async () => {
        const res = await supertest(server).get('/.env.production');
        expect(res.status).toBe(200);
        // '.production' is not a known extension → served as octet-stream →
        // superagent buffers it in res.body instead of res.text
        const body = res.text !== undefined ? res.text : res.body.toString('utf8');
        expect(body).toBe('SECRET=2');
    });

    test('non-whitelisted dot-file follows the hidden default', async () => {
        const res = await supertest(server).get('/.rc1');
        expect(res.status).toBe(404);
    });
});

// ─── blacklist beats whitelist with globs too ────────────────────────────────

describe('priority: blacklist glob beats whitelist glob', () => {
    let server;
    beforeAll(() => {
        server = createServer({
            dotFiles: { whitelist: ['.env*'], blacklist: ['.env.produc*'] },
        });
    });
    afterAll(() => server.close());

    test('entry matching both lists is hidden (blacklist wins)', async () => {
        const res = await supertest(server).get('/.env.production');
        expect(res.status).toBe(404);
    });

    test('entry matching only the whitelist is visible', async () => {
        const res = await supertest(server).get('/.env');
        expect(res.status).toBe(200);
    });
});

// ─── dotDirs glob + traversal blocking ───────────────────────────────────────

describe('dotDirs.blacklist glob (".cache*", ".git")', () => {
    let server;
    beforeAll(() => {
        server = createServer({ dotDirs: { blacklist: ['.cache*', '.git'] } });
    });
    afterAll(() => server.close());

    test('GET /.cache-http/ → 404 (glob on a directory name)', async () => {
        const res = await supertest(server).get('/.cache-http/');
        expect(res.status).toBe(404);
    });

    test('files under a blacklisted dot-dir are unreachable', async () => {
        const res = await supertest(server).get('/.git/HEAD');
        expect(res.status).toBe(404);
    });

    test('non-matching dot-dir stays reachable', async () => {
        const res = await supertest(server).get('/.well-known/security.txt');
        expect(res.status).toBe(200);
        expect(res.text).toBe('Contact: x');
    });
});

// ─── RegExp entries in the name lists ────────────────────────────────────────

describe('RegExp entries in dotFiles.blacklist', () => {
    let server;
    beforeAll(() => { server = createServer({ dotFiles: { blacklist: [/^\.env(\.|$)/] } }); });
    afterAll(() => server.close());

    test('RegExp matches .env and .env.production but not .envelope', async () => {
        expect((await supertest(server).get('/.env')).status).toBe(404);
        expect((await supertest(server).get('/.env.production')).status).toBe(404);
        expect((await supertest(server).get('/.envelope')).status).toBe(200);
    });
});
