/**
 * Listing query parameters — coercion, clamping and link hygiene.
 * 2026-09 coverage review.
 *
 * `?page`, `?sort` and `?order` are the only client-controlled inputs the
 * listing renderer consumes, and they are read with no validation guard:
 *
 *     const rawPage = parseInt(firstQueryValue(ctx.query.page), 10);
 *     const requestedPage = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
 *     currentPage = Math.min(requestedPage, totalPages - 1);   // silent clamp
 *
 * The existing suites only ever send well-formed values (`?page=1`, `?page=3`),
 * so nothing pinned what a hostile or merely sloppy client gets: a float, an
 * exponent, a negative index, a repeated parameter, a non-numeric string. Each
 * of those has a defined outcome today — they are pinned here, because the
 * silent-coercion contract is exactly the kind of thing a refactor changes
 * without noticing.
 *
 * Two further gaps this file closes:
 *   - dirListing.maxEntries × entriesPerPage. Both are tested in isolation in
 *     listing.test.js; their INTERACTION (pagination computed over the
 *     truncated set) was not. It is the configuration an operator actually
 *     lands in when a directory blows past the cap.
 *   - Reflection of unrecognized sort/order values into the paginator hrefs.
 *     buildQueryUrl() echoes the raw parameters back, so they are attacker
 *     reachable; the encoding that makes that safe had no test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

let root;

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-page-params-'));
    fs.mkdirSync(path.join(root, 'many'));
    // 25 files, ascending size, so ordering is observable as well as membership.
    for (let i = 0; i < 25; i++) {
        fs.writeFileSync(path.join(root, 'many', `f${String(i).padStart(2, '0')}.txt`), 'x'.repeat(i + 1));
    }
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function makeServer(dirListing = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, { dirListing }));
    return app.callback();
}

// The file names actually rendered as rows, in order, de-duplicated: each entry
// appears twice in the row markup (link text + href).
function rows(html) {
    const seen = [];
    for (const m of html.matchAll(/f\d\d\.txt/g)) {
        if (seen[seen.length - 1] !== m[0]) seen.push(m[0]);
    }
    return seen;
}

function hrefs(html) {
    return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
}

// ─── ?page coercion ──────────────────────────────────────────────────────────

describe('?page — coercion of values a browser would never send', () => {
    let server;
    beforeAll(() => { server = makeServer({ entriesPerPage: 10 }); });

    // 25 entries / 10 per page → pages 0,1,2 (X-Dir-Pagination "N/2").
    const firstOf = async (query) => {
        const res = await supertest(server).get('/many/' + query);
        expect(res.status).toBe(200);
        return { first: rows(res.text)[0], header: res.headers['x-dir-pagination'] };
    };

    test('no ?page at all → page 0', async () => {
        expect(await firstOf('')).toEqual({ first: 'f00.txt', header: '0/2' });
    });

    test('?page=1 → page 1 (baseline)', async () => {
        expect(await firstOf('?page=1')).toEqual({ first: 'f10.txt', header: '1/2' });
    });

    test('?page= (empty value) → page 0, never NaN', async () => {
        expect(await firstOf('?page=')).toEqual({ first: 'f00.txt', header: '0/2' });
    });

    test('?page=abc (non-numeric) → page 0', async () => {
        expect(await firstOf('?page=abc')).toEqual({ first: 'f00.txt', header: '0/2' });
    });

    test('?page=-1 (negative) → page 0, not a backwards slice', async () => {
        expect(await firstOf('?page=-1')).toEqual({ first: 'f00.txt', header: '0/2' });
    });

    test('?page=1.7 (float) → truncated to page 1', async () => {
        expect(await firstOf('?page=1.7')).toEqual({ first: 'f10.txt', header: '1/2' });
    });

    test('?page=1e2 (exponent) → parseInt stops at the "e" → page 1', async () => {
        expect(await firstOf('?page=1e2')).toEqual({ first: 'f10.txt', header: '1/2' });
    });

    test('?page=99 (beyond the last page) → clamped to the last page, still 200', async () => {
        expect(await firstOf('?page=99')).toEqual({ first: 'f20.txt', header: '2/2' });
    });

    test('?page=99999999999999999999 (beyond MAX_SAFE_INTEGER) → clamped, no crash', async () => {
        expect(await firstOf('?page=99999999999999999999')).toEqual({ first: 'f20.txt', header: '2/2' });
    });

    test('repeated ?page=1&page=2 → the FIRST value wins', async () => {
        expect(await firstOf('?page=1&page=2')).toEqual({ first: 'f10.txt', header: '1/2' });
    });

    test('the clamped last page is a partial slice, not a padded one', async () => {
        const res = await supertest(server).get('/many/?page=99');
        expect(rows(res.text)).toEqual(['f20.txt', 'f21.txt', 'f22.txt', 'f23.txt', 'f24.txt']);
    });
});

describe('?page is inert when pagination cannot apply', () => {
    test('entriesPerPage: 0 (disabled) → every entry on one page, no pagination header', async () => {
        const server = makeServer({ entriesPerPage: 0 });
        const res = await supertest(server).get('/many/?page=3');
        expect(res.status).toBe(200);
        expect(rows(res.text)).toHaveLength(25);
        expect(res.headers['x-dir-pagination']).toBeUndefined();
    });

    test('entries fit in one page → ?page=5 is ignored, no paginator emitted', async () => {
        const server = makeServer({ entriesPerPage: 100 });
        const res = await supertest(server).get('/many/?page=5');
        expect(res.status).toBe(200);
        expect(rows(res.text)).toHaveLength(25);
        expect(res.headers['x-dir-pagination']).toBeUndefined();
        expect(hrefs(res.text).some((h) => h.includes('page='))).toBe(false);
    });
});

// ─── link hygiene ────────────────────────────────────────────────────────────

describe('paginator and sort links carry the right state', () => {
    let server;
    beforeAll(() => { server = makeServer({ entriesPerPage: 10 }); });

    test('paginator links preserve the active sort and order', async () => {
        const res = await supertest(server).get('/many/?sort=size&order=desc&page=1');
        const pageLinks = hrefs(res.text).filter((h) => h.includes('page='));
        expect(pageLinks.length).toBeGreaterThan(0);
        for (const href of pageLinks) {
            expect(href).toContain('sort=size');
            expect(href).toContain('order=desc');
        }
    });

    test('page 0 is linked without a redundant page=0 parameter', async () => {
        const res = await supertest(server).get('/many/?page=2');
        // "‹ Prev" / "« First" from page 2 lead back through page 1 to page 0.
        expect(hrefs(res.text)).toContain('/many/');
        expect(hrefs(res.text).some((h) => h.includes('page=0'))).toBe(false);
    });

    test('sort header links RESET the page — a sorted listing restarts at page 0', async () => {
        const res = await supertest(server).get('/many/?page=2&sort=size&order=asc');
        const sortLinks = hrefs(res.text).filter((h) => h.includes('sort=') && !h.includes('page='));
        expect(sortLinks).toEqual(expect.arrayContaining([
            '/many/?sort=name&order=asc',
            '/many/?sort=size&order=desc',
        ]));
        // No sort header link drags page=2 along into a differently ordered set.
        expect(hrefs(res.text).filter((h) => h.includes('sort=') && h.includes('page=2'))).toEqual([]);
    });

    test('an unrecognized ?order is normalized to ascending in BOTH the rows and the arrow', async () => {
        const res = await supertest(server).get('/many/?sort=size&order=BOGUS');
        expect(rows(res.text)[0]).toBe('f00.txt');   // smallest first → ascending
        expect(res.text).toContain('Size ↑');         // arrow agrees with the rows
    });

    test('an unrecognized ?sort falls back to name order', async () => {
        const res = await supertest(server).get('/many/?sort=bogus');
        expect(rows(res.text)[0]).toBe('f00.txt');
    });
});

describe('hostile sort/order values reflected into the paginator stay inert', () => {
    let server;
    beforeAll(() => { server = makeServer({ entriesPerPage: 10 }); });

    test('a script payload in ?sort is percent-encoded in the href and never breaks out', async () => {
        const res = await supertest(server)
            .get('/many/?sort=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E&page=1');
        expect(res.status).toBe(200);
        expect(res.text).not.toContain('<script>alert(1)</script>');
        const reflected = hrefs(res.text).filter((h) => h.includes('sort=%22'));
        expect(reflected.length).toBeGreaterThan(0);
        for (const href of reflected) {
            expect(href).not.toContain('<');
            expect(href).not.toContain('"');
        }
    });

    test('a quote in ?order cannot terminate the href attribute', async () => {
        const res = await supertest(server).get('/many/?order=%22onmouseover%3D%22x&page=1');
        expect(res.status).toBe(200);
        expect(res.text).not.toMatch(/href="[^"]*"\s*onmouseover/);
    });
});

// ─── maxEntries × entriesPerPage ─────────────────────────────────────────────

describe('dirListing.maxEntries × entriesPerPage — pagination over the truncated set', () => {
    let server;
    beforeAll(() => { server = makeServer({ maxEntries: 12, entriesPerPage: 5 }); });

    test('total pages are computed from the CAP, not from the directory size', async () => {
        // 25 files on disk, capped at 12, 5 per page → 3 pages (0..2), not 5.
        const res = await supertest(server).get('/many/');
        expect(res.headers['x-dir-pagination']).toBe('0/2');
    });

    test('the truncation header and banner appear on EVERY page, not just the first', async () => {
        for (const query of ['', '?page=1', '?page=2']) {
            const res = await supertest(server).get('/many/' + query);
            expect(res.headers['x-dir-truncated']).toBe('12');
            expect(res.text).toContain('Showing first 12 entries');
        }
    });

    test('the last page of a truncated listing holds the remainder of the cap', async () => {
        const res = await supertest(server).get('/many/?page=2');
        expect(rows(res.text)).toEqual(['f10.txt', 'f11.txt']);
        expect(res.headers['x-dir-pagination']).toBe('2/2');
    });

    test('a page beyond the truncated set clamps to the last page', async () => {
        const res = await supertest(server).get('/many/?page=9');
        expect(res.status).toBe(200);
        expect(res.headers['x-dir-pagination']).toBe('2/2');
        expect(rows(res.text)).toEqual(['f10.txt', 'f11.txt']);
    });

    test('no entry beyond the cap is reachable through any page', async () => {
        const seen = new Set();
        for (const query of ['', '?page=1', '?page=2']) {
            const res = await supertest(server).get('/many/' + query);
            for (const name of rows(res.text)) seen.add(name);
        }
        expect(seen.size).toBe(12);
        expect(seen.has('f12.txt')).toBe(false);
    });

    test('the capped entries are still SERVABLE — truncation bounds the listing, not access', async () => {
        // The cap is a rendering safety net, not a restriction on the tree.
        const res = await supertest(server).get('/many/f24.txt');
        expect(res.status).toBe(200);
    });

    test('maxEntries with pagination disabled → one page holding exactly the cap', async () => {
        const s = makeServer({ maxEntries: 12, entriesPerPage: 0 });
        const res = await supertest(s).get('/many/');
        expect(rows(res.text)).toHaveLength(12);
        expect(res.headers['x-dir-truncated']).toBe('12');
        expect(res.headers['x-dir-pagination']).toBeUndefined();
    });
});
