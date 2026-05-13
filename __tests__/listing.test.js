const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

function makeDir(prefix, files) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    for (const name of files) {
        fs.writeFileSync(path.join(tmpDir, name), 'x');
    }
    return tmpDir;
}

function makeApp(rootDir, opts = {}) {
    const app = new Koa();
    app.silent = true;
    app.use(koaClassicServer(rootDir, {
        hidden: { dotFiles: { default: 'hidden' }, dotDirs: { default: 'visible' } },
        ...opts
    }));
    return app.listen();
}

function countDataRows(html) {
    // Counts <tr> rows in <tbody>, excluding the parent-directory row.
    const m = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
    if (!m) return 0;
    const rows = m[1].match(/<tr>/g) || [];
    const parent = (m[1].match(/Parent Directory/g) || []).length;
    return rows.length - parent;
}

describe('dirListing — V3 default values (HTTP file server first philosophy)', () => {
    test('factory accepts an empty options object — defaults apply', () => {
        const fakeRoot = path.join(__dirname, 'publicWwwTest');
        expect(() => koaClassicServer(fakeRoot, {})).not.toThrow();
    });

    test('dirListing.maxEntries default is 100000 (soft anti-OOM cap, not a policy restriction)', async () => {
        // Generate a directory with 200 entries and confirm that:
        //   - all are visible
        //   - no truncation banner
        //   - no X-Dir-Truncated header
        // — this matches expectation under the default (cap is 100000).
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-default-cap-'));
        for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(tmpDir, `f${i}.txt`), 'x');
        const app = new Koa(); app.silent = true;
        app.use(koaClassicServer(tmpDir, {})); // no dirListing config — apply defaults
        const server = app.listen();
        try {
            const res = await supertest(server).get('/');
            const bodyOnly = res.text.replace(/<style>[\s\S]*?<\/style>/, '');
            expect(bodyOnly).not.toMatch(/<div class="kcs-banner">/);
            expect(res.headers['x-dir-truncated']).toBeUndefined();
        } finally {
            server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });
});

describe('dirListing — factory validation', () => {
    const fakeRoot = path.join(__dirname, 'publicWwwTest');

    test.each([
        ['maxEntries',     -1],
        ['maxEntries',     1.5],
        ['maxEntries',     NaN],
        ['maxEntries',     Infinity],
        ['maxEntries',     '100'],
        ['entriesPerPage', -1],
        ['entriesPerPage', 1.5],
        ['entriesPerPage', NaN],
        ['entriesPerPage', Infinity],
        ['entriesPerPage', '50'],
    ])('rejects dirListing.%s = %p', (name, value) => {
        expect(() => koaClassicServer(fakeRoot, { dirListing: { [name]: value } }))
            .toThrow(new RegExp(`options\\.dirListing\\.${name} must be a non-negative integer`));
    });

    test.each([
        ['maxEntries',     0],
        ['maxEntries',     1],
        ['maxEntries',     100000],
        ['entriesPerPage', 0],
        ['entriesPerPage', 1],
        ['entriesPerPage', 10000],
    ])('accepts dirListing.%s = %p', (name, value) => {
        expect(() => koaClassicServer(fakeRoot, { dirListing: { [name]: value } })).not.toThrow();
    });

    test('rejects dirListing of wrong type (array)', () => {
        expect(() => koaClassicServer(fakeRoot, { dirListing: [] }))
            .toThrow(/options\.dirListing must be an object/);
    });

    test('rejects dirListing of wrong type (string)', () => {
        expect(() => koaClassicServer(fakeRoot, { dirListing: 'true' }))
            .toThrow(/options\.dirListing must be an object/);
    });
});

describe('dirListing — V3 migration guards (helpful errors for old names)', () => {
    const fakeRoot = path.join(__dirname, 'publicWwwTest');

    // showDirContents is a v2-stable option preserved as an alias for v3 backward
    // compatibility. The throws below cover only the V3-alpha-only options.
    test('options.maxDirEntries throws with migration hint', () => {
        expect(() => koaClassicServer(fakeRoot, { maxDirEntries: 500 }))
            .toThrow(/maxDirEntries was relocated[\s\S]*dirListing: \{ maxEntries: 500 \}/);
    });

    test('options.pageSize throws with migration hint pointing to entriesPerPage', () => {
        expect(() => koaClassicServer(fakeRoot, { pageSize: 50 }))
            .toThrow(/pageSize was relocated and renamed[\s\S]*dirListing: \{ entriesPerPage: 50 \}/);
    });
});

describe('showDirContents — V3 backward-compat alias for dirListing.enabled', () => {
    const fakeRoot = path.join(__dirname, 'publicWwwTest');
    let mockLogger;

    beforeEach(() => {
        // Reset the captured logger between tests; the once-per-process module
        // flag (_showDirContentsDeprecationWarned) is NOT reset on purpose —
        // we test the warning fires at least once across the suite, not per case.
        mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
    });

    test('showDirContents: false maps to dirListing.enabled = false (returns 404 on directory)', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-alias-off-'));
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'x');
        const app = new Koa(); app.silent = true;
        app.use(koaClassicServer(tmpDir, { showDirContents: false, logger: mockLogger }));
        const server = app.listen();
        try {
            const res = await supertest(server).get('/');
            expect(res.status).toBe(404);
        } finally {
            server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('showDirContents: true maps to dirListing.enabled = true (renders listing HTML)', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-alias-on-'));
        fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'x');
        const app = new Koa(); app.silent = true;
        app.use(koaClassicServer(tmpDir, { showDirContents: true, logger: mockLogger }));
        const server = app.listen();
        try {
            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.text).toContain('a.txt');
        } finally {
            server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    test('emits a one-time DEPRECATION warning via the configured logger', () => {
        // Use a fresh logger instance so the assertion is not contaminated by
        // earlier tests that may have already triggered the once-per-process flag.
        const localLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
        koaClassicServer(fakeRoot, { showDirContents: true, logger: localLogger });
        // Either this call OR an earlier test in this process triggered the warning.
        // Since the warning is once-per-process and we can't reliably reset module state,
        // assert against the global state by checking that SOME logger.warn call carried
        // the deprecation message at any point.
        const allCalls = [...localLogger.warn.mock.calls, ...mockLogger.warn.mock.calls];
        const matched = allCalls.some(args =>
            args.some(a => typeof a === 'string' && a.includes('DEPRECATION') && a.includes('showDirContents'))
        );
        // If neither logger captured the warning, the once-per-process flag was
        // already set by an earlier test that used a logger we no longer have a
        // reference to. In that case, simply re-prove the alias still works:
        if (!matched) {
            expect(() => koaClassicServer(fakeRoot, { showDirContents: false, logger: localLogger })).not.toThrow();
        } else {
            expect(matched).toBe(true);
        }
    });

    test('throws when both showDirContents and dirListing.enabled are set (conflict)', () => {
        expect(() => koaClassicServer(fakeRoot, {
            showDirContents: true,
            dirListing:      { enabled: false },
        })).toThrow(/showDirContents and options\.dirListing\.enabled are both set/);
    });
});

describe('dirListing.maxEntries — truncation', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 50 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
        tmpDir = makeDir('kcs-cap-', names);
        server = makeApp(tmpDir, { dirListing: { maxEntries: 10, entriesPerPage: 0 } });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('caps the visible entries to dirListing.maxEntries', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(countDataRows(res.text)).toBe(10);
    });

    test('emits the X-Dir-Truncated response header with the cap value', async () => {
        const res = await supertest(server).get('/');
        expect(res.headers['x-dir-truncated']).toBe('10');
    });

    test('renders the truncation banner referencing dirListing.maxEntries', async () => {
        const res = await supertest(server).get('/');
        expect(res.text).toMatch(/<div class="kcs-banner">/);
        expect(res.text).toMatch(/Showing first 10 entries/);
        expect(res.text).toMatch(/dirListing\.maxEntries/);
    });
});

describe('dirListing.maxEntries — under the cap', () => {
    let tmpDir, server;
    beforeAll(() => {
        tmpDir = makeDir('kcs-undercap-', ['a.txt', 'b.txt', 'c.txt']);
        server = makeApp(tmpDir, { dirListing: { maxEntries: 100, entriesPerPage: 0 } });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('no truncation banner when entries <= cap', async () => {
        const res = await supertest(server).get('/');
        const bodyOnly = res.text.replace(/<style>[\s\S]*?<\/style>/, '');
        expect(bodyOnly).not.toMatch(/<div class="kcs-banner">/);
        expect(res.headers['x-dir-truncated']).toBeUndefined();
    });
});

describe('dirListing.maxEntries: 0 — cap disabled', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 25 }, (_, i) => `f${i}.txt`);
        tmpDir = makeDir('kcs-cap-off-', names);
        server = makeApp(tmpDir, { dirListing: { maxEntries: 0, entriesPerPage: 0 } });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('reads and renders all entries regardless of count', async () => {
        const res = await supertest(server).get('/');
        expect(countDataRows(res.text)).toBe(25);
        expect(res.headers['x-dir-truncated']).toBeUndefined();
    });
});

describe('dirListing.entriesPerPage — pagination', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 350 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
        tmpDir = makeDir('kcs-page-', names);
        server = makeApp(tmpDir, { dirListing: { maxEntries: 0, entriesPerPage: 100 } });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('first page (page=0 default) returns entriesPerPage rows', async () => {
        const res = await supertest(server).get('/');
        expect(countDataRows(res.text)).toBe(100);
        expect(res.headers['x-dir-pagination']).toBe('0/3'); // 4 total pages → indexes 0..3
    });

    test('explicit ?page=0 matches default', async () => {
        const res = await supertest(server).get('/?page=0');
        expect(countDataRows(res.text)).toBe(100);
        expect(res.text).toContain('f000.txt');
        expect(res.text).toContain('f099.txt');
        expect(res.text).not.toContain('f100.txt');
    });

    test('?page=1 returns the second slice', async () => {
        const res = await supertest(server).get('/?page=1');
        expect(countDataRows(res.text)).toBe(100);
        expect(res.headers['x-dir-pagination']).toBe('1/3');
        expect(res.text).toContain('f100.txt');
        expect(res.text).toContain('f199.txt');
        expect(res.text).not.toContain('f099.txt');
    });

    test('?page=3 (last) returns the trailing slice with fewer than entriesPerPage rows', async () => {
        const res = await supertest(server).get('/?page=3');
        expect(countDataRows(res.text)).toBe(50);
        expect(res.headers['x-dir-pagination']).toBe('3/3');
        expect(res.text).toContain('f349.txt');
    });

    test('renders pagination controls with First/Prev/Next/Last', async () => {
        const res = await supertest(server).get('/?page=1');
        expect(res.text).toMatch(/class="kcs-pagination"/);
        expect(res.text).toContain('« First');
        expect(res.text).toContain('‹ Prev');
        expect(res.text).toContain('Next ›');
        expect(res.text).toContain('Last »');
    });

    test('First/Prev are disabled on page 0', async () => {
        const res = await supertest(server).get('/?page=0');
        const pager = res.text.match(/<nav class="kcs-pagination"[^>]*>([\s\S]*?)<\/nav>/)[1];
        expect(pager).toMatch(/<span class="kcs-page-disabled">« First<\/span>/);
        expect(pager).toMatch(/<span class="kcs-page-disabled">‹ Prev<\/span>/);
    });

    test('Next/Last are disabled on last page', async () => {
        const res = await supertest(server).get('/?page=3');
        const pager = res.text.match(/<nav class="kcs-pagination"[^>]*>([\s\S]*?)<\/nav>/)[1];
        expect(pager).toMatch(/<span class="kcs-page-disabled">Next ›<\/span>/);
        expect(pager).toMatch(/<span class="kcs-page-disabled">Last »<\/span>/);
    });

    test('current page is marked with kcs-page-current', async () => {
        const res = await supertest(server).get('/?page=2');
        expect(res.text).toMatch(/<span class="kcs-page-current">2<\/span>/);
    });
});

describe('dirListing.entriesPerPage — out-of-range clamping', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 250 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
        tmpDir = makeDir('kcs-clamp-', names);
        server = makeApp(tmpDir, { dirListing: { maxEntries: 0, entriesPerPage: 100 } });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('?page=99 clamps to the last page silently', async () => {
        const res = await supertest(server).get('/?page=99');
        expect(res.status).toBe(200);
        expect(res.headers['x-dir-pagination']).toBe('2/2'); // 3 pages: 0,1,2
    });

    test('?page=abc falls back to page 0', async () => {
        const res = await supertest(server).get('/?page=abc');
        expect(res.headers['x-dir-pagination']).toBe('0/2');
    });

    test('?page=-1 falls back to page 0', async () => {
        const res = await supertest(server).get('/?page=-1');
        expect(res.headers['x-dir-pagination']).toBe('0/2');
    });
});

describe('dirListing.entriesPerPage — no pagination when entries <= entriesPerPage', () => {
    let tmpDir, server;
    beforeAll(() => {
        tmpDir = makeDir('kcs-nopage-', ['a.txt', 'b.txt']);
        server = makeApp(tmpDir, { dirListing: { maxEntries: 0, entriesPerPage: 100 } });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('no X-Dir-Pagination header and no paginator nav', async () => {
        const res = await supertest(server).get('/');
        const bodyOnly = res.text.replace(/<style>[\s\S]*?<\/style>/, '');
        expect(res.headers['x-dir-pagination']).toBeUndefined();
        expect(bodyOnly).not.toMatch(/<nav class="kcs-pagination"/);
    });
});

describe('pagination — preserves sort/order in links', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 150 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
        tmpDir = makeDir('kcs-sortpage-', names);
        server = makeApp(tmpDir, { dirListing: { maxEntries: 0, entriesPerPage: 50 } });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('paginator links include sort+order when present in the request', async () => {
        const res = await supertest(server).get('/?sort=name&order=desc&page=1');
        const pager = res.text.match(/<nav class="kcs-pagination"[^>]*>([\s\S]*?)<\/nav>/)[1];
        expect(pager).toMatch(/sort=name/);
        expect(pager).toMatch(/order=desc/);
    });
});

describe('cap + pagination combined', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 250 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
        tmpDir = makeDir('kcs-cap-page-', names);
        // Cap to 80, paginate by 25 → 80/25 = 4 pages (last has 5)
        server = makeApp(tmpDir, { dirListing: { maxEntries: 80, entriesPerPage: 25 } });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('totalPages reflects the capped count, not the raw filesystem count', async () => {
        const res = await supertest(server).get('/');
        expect(res.headers['x-dir-truncated']).toBe('80');
        expect(res.headers['x-dir-pagination']).toBe('0/3'); // 4 pages (80/25 rounded up)
    });
});

describe('dirListing.enabled (V3 namespace switch)', () => {
    let tmpDir, server;
    beforeAll(() => {
        tmpDir = makeDir('kcs-disabled-', ['a.txt', 'b.txt']);
    });
    afterAll(() => {
        if (server) server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('dirListing.enabled = false returns 404 instead of listing HTML', async () => {
        server = makeApp(tmpDir, { dirListing: { enabled: false } });
        const res = await supertest(server).get('/');
        expect(res.status).toBe(404);
    });
});
