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
    // Discount the optional "..Parent Directory" row.
    const parent = (m[1].match(/Parent Directory/g) || []).length;
    return rows.length - parent;
}

describe('maxDirEntries and pageSize — factory validation', () => {
    const fakeRoot = path.join(__dirname, 'publicWwwTest');

    test.each([
        ['maxDirEntries', -1],
        ['maxDirEntries', 1.5],
        ['maxDirEntries', NaN],
        ['maxDirEntries', Infinity],
        ['maxDirEntries', '100'],
        ['pageSize', -1],
        ['pageSize', 1.5],
        ['pageSize', NaN],
        ['pageSize', Infinity],
        ['pageSize', '50'],
    ])('rejects %s = %p', (name, value) => {
        expect(() => koaClassicServer(fakeRoot, { [name]: value }))
            .toThrow(new RegExp(`options\\.${name} must be a non-negative integer`));
    });

    test.each([
        ['maxDirEntries', 0],
        ['maxDirEntries', 1],
        ['maxDirEntries', 100000],
        ['pageSize', 0],
        ['pageSize', 1],
        ['pageSize', 10000],
    ])('accepts %s = %p', (name, value) => {
        expect(() => koaClassicServer(fakeRoot, { [name]: value })).not.toThrow();
    });
});

describe('maxDirEntries — truncation', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 50 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
        tmpDir = makeDir('kcs-cap-', names);
        server = makeApp(tmpDir, { maxDirEntries: 10, pageSize: 0 });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('caps the visible entries to maxDirEntries', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        expect(countDataRows(res.text)).toBe(10);
    });

    test('emits the X-Dir-Truncated response header with the cap value', async () => {
        const res = await supertest(server).get('/');
        expect(res.headers['x-dir-truncated']).toBe('10');
    });

    test('renders the truncation banner with the kcs-banner class', async () => {
        const res = await supertest(server).get('/');
        expect(res.text).toMatch(/<div class="kcs-banner">/);
        expect(res.text).toMatch(/Showing first 10 entries/);
    });
});

describe('maxDirEntries — under the cap', () => {
    let tmpDir, server;
    beforeAll(() => {
        tmpDir = makeDir('kcs-undercap-', ['a.txt', 'b.txt', 'c.txt']);
        server = makeApp(tmpDir, { maxDirEntries: 100, pageSize: 0 });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('no truncation banner when entries <= cap', async () => {
        const res = await supertest(server).get('/');
        // The "kcs-banner" class always appears in <style>; the banner ELEMENT
        // is only present in the body.
        const bodyOnly = res.text.replace(/<style>[\s\S]*?<\/style>/, '');
        expect(bodyOnly).not.toMatch(/<div class="kcs-banner">/);
        expect(res.headers['x-dir-truncated']).toBeUndefined();
    });
});

describe('maxDirEntries: 0 — cap disabled', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 25 }, (_, i) => `f${i}.txt`);
        tmpDir = makeDir('kcs-cap-off-', names);
        server = makeApp(tmpDir, { maxDirEntries: 0, pageSize: 0 });
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

describe('pageSize — pagination', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 350 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
        tmpDir = makeDir('kcs-page-', names);
        server = makeApp(tmpDir, { maxDirEntries: 0, pageSize: 100 });
    });
    afterAll(() => {
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('first page (page=0 default) returns pageSize rows', async () => {
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

    test('?page=3 (last) returns the trailing slice with fewer than pageSize rows', async () => {
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

describe('pageSize — out-of-range clamping', () => {
    let tmpDir, server;
    beforeAll(() => {
        const names = Array.from({ length: 250 }, (_, i) => `f${String(i).padStart(3, '0')}.txt`);
        tmpDir = makeDir('kcs-clamp-', names);
        server = makeApp(tmpDir, { maxDirEntries: 0, pageSize: 100 });
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

describe('pageSize — no pagination when entries <= pageSize', () => {
    let tmpDir, server;
    beforeAll(() => {
        tmpDir = makeDir('kcs-nopage-', ['a.txt', 'b.txt']);
        server = makeApp(tmpDir, { maxDirEntries: 0, pageSize: 100 });
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
        server = makeApp(tmpDir, { maxDirEntries: 0, pageSize: 50 });
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
        server = makeApp(tmpDir, { maxDirEntries: 80, pageSize: 25 });
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
