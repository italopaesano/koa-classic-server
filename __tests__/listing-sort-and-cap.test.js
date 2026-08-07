/**
 * Directory-listing sort state, the maxEntries/hidden interaction, and href
 * escaping for URL-significant filenames — 2026-08 coverage review.
 *
 *   1. Sort ORDER normalization. The listing renders three things from the
 *      `order` query parameter — the comparator, the ▲/▼ indicator, and the
 *      toggle target of each column link. They used to test the raw parameter
 *      with opposite polarity (`=== 'desc'` for the comparator, `=== 'asc'`
 *      for the other two), so `?order=DESC` sorted ASCENDING while rendering a
 *      DESCENDING arrow and a link that re-requested ascending. The value is
 *      now normalized once to 'asc' | 'desc'; these tests pin all three
 *      renderings against the actual row order.
 *   2. dirListing.maxEntries is applied to the RAW readdir() result, BEFORE
 *      hidden-entry filtering. So the cap counts entries the client will never
 *      see, and a directory whose first `maxEntries` entries are all hidden
 *      renders as an empty folder even though visible entries exist further
 *      down. That is a deliberate consequence of the cap being a process
 *      safety net (it bounds the stat()/sort/render work) rather than a
 *      display policy — pinned here so it is a choice, not an accident.
 *   3. Filenames containing characters that are significant in a URL (#, ?, &,
 *      %) or in HTML (', ") must be percent-encoded in the href and
 *      HTML-escaped in the text, and the resulting link must resolve.
 *   4. Content-Disposition for a latin1-representable name keeps the real
 *      character in the quoted-string fallback (no '?' mangling) — the '?'
 *      substitution is reserved for what a header value cannot carry.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

function createServer(root, opts = {}) {
    const app = new Koa();
    app.use(koaClassicServer(root, opts));
    return app.listen();
}

// Entry names in render order, as they appear inside the <bdi> wrapper
// (clickable rows carry an <a>, non-clickable ones do not).
function listedNames(html) {
    return [...html.matchAll(/<bdi>(?:<a[^>]*>)?([^<]+)/g)].map((m) => m[1]);
}

// ─── 1. Sort order normalization ─────────────────────────────────────────────

describe('listing sort order — comparator, indicator and toggle link agree', () => {
    let root;
    let server;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-sort-order-'));
        // Sizes chosen so name order and size order differ.
        fs.writeFileSync(path.join(root, 'b.txt'), 'x');       // 1 B
        fs.writeFileSync(path.join(root, 'a.txt'), 'xxx');     // 3 B
        fs.writeFileSync(path.join(root, 'c.txt'), 'xxxxx');   // 5 B
        fs.mkdirSync(path.join(root, 'zdir'));
        server = createServer(root);
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    const get = (qs) => supertest(server).get('/' + qs);

    test('?sort=size&order=asc — directories first, then files ascending, ▲ on Size', async () => {
        const res = await get('?sort=size&order=asc');
        expect(res.status).toBe(200);
        expect(listedNames(res.text)).toEqual(['zdir', 'b.txt', 'a.txt', 'c.txt']);
        expect(res.text).toMatch(/Size ↑<\/a>/);
    });

    test('?sort=size&order=desc — files descending, directories pushed last, ▼ on Size', async () => {
        const res = await get('?sort=size&order=desc');
        expect(listedNames(res.text)).toEqual(['c.txt', 'a.txt', 'b.txt', 'zdir']);
        expect(res.text).toMatch(/Size ↓<\/a>/);
    });

    test('?order=DESC (wrong case) sorts ascending AND renders the ascending arrow', async () => {
        // The rendered state must describe the rows actually shown. Before the
        // normalization this answered ascending rows under a ▼ arrow.
        const res = await get('?sort=size&order=DESC');
        expect(listedNames(res.text)).toEqual(['zdir', 'b.txt', 'a.txt', 'c.txt']);
        expect(res.text).toMatch(/Size ↑<\/a>/);
        expect(res.text).not.toMatch(/Size ↓<\/a>/);
    });

    test('an unknown order value behaves exactly like the wrong-case one', async () => {
        const res = await get('?sort=name&order=bogus');
        expect(listedNames(res.text)).toEqual(['a.txt', 'b.txt', 'c.txt', 'zdir']);
        expect(res.text).toMatch(/Name ↑<\/a>/);
    });

    test('the active column toggles to desc; an unknown order still offers desc', async () => {
        const asc = await get('?sort=name&order=asc');
        expect(asc.text).toContain('?sort=name&amp;order=desc');

        // With a garbage order the listing is ascending, so the Name link must
        // offer the *other* direction — otherwise clicking it is a no-op.
        const bogus = await get('?sort=name&order=bogus');
        expect(bogus.text).toContain('?sort=name&amp;order=desc');
    });

    test('a descending listing toggles the active column back to asc', async () => {
        const res = await get('?sort=name&order=desc');
        expect(res.text).toContain('?sort=name&amp;order=asc');
    });

    test('inactive columns always link to asc and show no arrow', async () => {
        const res = await get('?sort=name&order=desc');
        expect(res.text).toContain('?sort=size&amp;order=asc');
        expect(res.text).toContain('?sort=type&amp;order=asc');
        expect(res.text).toMatch(/Size<\/a>/);
        expect(res.text).toMatch(/Type<\/a>/);
    });

    test('no order parameter at all → ascending, ▲ on the default Name column', async () => {
        const res = await get('');
        expect(listedNames(res.text)).toEqual(['a.txt', 'b.txt', 'c.txt', 'zdir']);
        expect(res.text).toMatch(/Name ↑<\/a>/);
    });

    test('dirs-first applies to the type and size columns only, NOT to name', async () => {
        // compareDirsFirst() is wired into the `type` and `size` comparators;
        // `name` is a plain localeCompare over every entry, so a directory
        // sorts purely by its name. Asserted explicitly because the difference
        // is invisible until a directory name sorts after a file name.
        const byName = await get('?sort=name&order=asc');
        expect(listedNames(byName.text)).toEqual(['a.txt', 'b.txt', 'c.txt', 'zdir']);

        const bySize = await get('?sort=size&order=asc');
        expect(listedNames(bySize.text)[0]).toBe('zdir');
    });

    test('?sort=type groups directories first, then files by MIME, ▲ on Type', async () => {
        const res = await get('?sort=type&order=asc');
        expect(listedNames(res.text)[0]).toBe('zdir');
        expect(res.text).toMatch(/Type ↑<\/a>/);
    });
});

// ─── 2. maxEntries is applied before hidden filtering ────────────────────────

describe('dirListing.maxEntries counts RAW readdir entries, hidden ones included', () => {
    let root;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-cap-hidden-'));
        for (const name of ['.h1', '.h2', '.h3', 'visible1.txt', 'visible2.txt']) {
            fs.writeFileSync(path.join(root, name), 'x');
        }
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // readdir order is filesystem-defined (creation order on tmpfs, hash order
    // on ext4), so the "which entries survive the slice" cases pin it via a
    // spy instead of trusting the platform.
    function orderReaddir(compare) {
        const real = fs.promises.readdir;
        jest.spyOn(fs.promises, 'readdir').mockImplementation(async (dir, opts) => {
            const entries = await real(dir, opts);
            return entries.sort(compare);
        });
    }

    const dotFirst = (a, b) =>
        Number(b.name.startsWith('.')) - Number(a.name.startsWith('.'));

    test('with the cap above the entry count everything visible is listed', async () => {
        const server = createServer(root, {
            dirListing: { maxEntries: 10 },
            hidden: { dotFiles: { default: 'hidden' } },
        });
        try {
            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.headers['x-dir-truncated']).toBeUndefined();
            expect(listedNames(res.text).sort()).toEqual(['visible1.txt', 'visible2.txt']);
        } finally {
            server.close();
        }
    });

    test('truncation fires on the RAW count even though fewer entries are visible', async () => {
        // 5 entries on disk, 2 of them visible, cap 3. If the cap were applied
        // AFTER hidden filtering, 2 <= 3 would mean no truncation at all — so
        // this assertion alone proves the ordering of the two steps, without
        // depending on which entries readdir happens to return first.
        const server = createServer(root, {
            dirListing: { maxEntries: 3 },
            hidden: { dotFiles: { default: 'hidden' } },
        });
        try {
            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.headers['x-dir-truncated']).toBe('3');
            expect(res.text).toContain('kcs-banner');
            expect(res.text).toContain('Showing first 3 entries');
            // At most the two visible names can survive a 3-entry slice.
            expect(listedNames(res.text).length).toBeLessThanOrEqual(2);
        } finally {
            server.close();
        }
    });

    test('a cap consumed entirely by hidden entries yields the empty-folder row', async () => {
        orderReaddir(dotFirst); // the three dot-files fill the cap of 3
        const server = createServer(root, {
            dirListing: { maxEntries: 3 },
            hidden: { dotFiles: { default: 'hidden' } },
        });
        try {
            const res = await supertest(server).get('/');
            expect(res.status).toBe(200);
            expect(res.headers['x-dir-truncated']).toBe('3');
            // Same row a physically empty directory renders — the listing never
            // hints that hidden entries exist.
            expect(res.text).toContain('empty folder');
            expect(listedNames(res.text)).toEqual([]);
            expect(res.text).not.toContain('.h1');
        } finally {
            server.close();
        }
    });

    test('with the visible entries first, the same cap shows them', async () => {
        orderReaddir((a, b) => -dotFirst(a, b)); // visible entries first
        const server = createServer(root, {
            dirListing: { maxEntries: 3 },
            hidden: { dotFiles: { default: 'hidden' } },
        });
        try {
            const res = await supertest(server).get('/');
            expect(res.headers['x-dir-truncated']).toBe('3');
            expect(listedNames(res.text).sort()).toEqual(['visible1.txt', 'visible2.txt']);
        } finally {
            server.close();
        }
    });

    test('the capped-away files are still SERVABLE at their own URLs', async () => {
        // The cap bounds listing work only — it is not an access policy.
        const server = createServer(root, { dirListing: { maxEntries: 1 } });
        try {
            const res = await supertest(server).get('/visible2.txt');
            expect(res.status).toBe(200);
            expect(res.text).toBe('x');
        } finally {
            server.close();
        }
    });
});

// ─── 3. URL-significant characters in entry names ────────────────────────────

describe('listing links for URL-significant and HTML-significant filenames', () => {
    let root;
    let server;

    const NAMES = [
        'hash#tag.txt',
        'query?a=b.txt',
        'amp&ersand.txt',
        'percent%20.txt',
        "quote'and\".txt",
        'plus+space .txt',
    ];

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-url-chars-'));
        for (const n of NAMES) fs.writeFileSync(path.join(root, n), n);
        server = createServer(root);
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('every generated href round-trips back to its own file (200 + exact bytes)', async () => {
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);

        const hrefs = [...res.text.matchAll(/<bdi><a href="([^"]+)"/g)].map((m) =>
            m[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"'));
        expect(hrefs).toHaveLength(NAMES.length);

        for (const href of hrefs) {
            const hit = await supertest(server).get(href);
            expect(hit.status).toBe(200);
            expect(NAMES).toContain(hit.text);
        }
    });

    test('the URL delimiters # ? & % are percent-encoded in the href', async () => {
        const res = await supertest(server).get('/');
        expect(res.text).toContain('href="/hash%23tag.txt"');
        expect(res.text).toContain('href="/query%3Fa%3Db.txt"');
        expect(res.text).toContain('href="/amp%26ersand.txt"');
        expect(res.text).toContain('href="/percent%2520.txt"');
    });

    test("quotes are HTML-escaped in both the href and the displayed name", async () => {
        const res = await supertest(server).get('/');
        // An unescaped " would terminate the href attribute early.
        expect(res.text).toContain('href="/quote&#039;and%22.txt"');
        expect(res.text).toContain('quote&#039;and&quot;.txt</a>');
        expect(res.text).not.toMatch(/href="[^"]*'[^"]*"/);
    });
});

// ─── 4. Content-Disposition keeps latin1 characters verbatim ─────────────────

describe('Content-Disposition — latin1 names are not mangled to "?"', () => {
    let root;
    let server;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-cd-latin1-'));
        fs.writeFileSync(path.join(root, 'caffè-über.txt'), 'ok');   // latin1-representable
        fs.writeFileSync(path.join(root, '日本語.txt'), 'ok');        // outside latin1
        server = createServer(root, { dirListing: { enabled: false } });
    });

    afterAll(() => {
        server.close();
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('latin1 characters survive in the quoted-string fallback', async () => {
        const res = await supertest(server).get('/' + encodeURIComponent('caffè-über.txt'));
        expect(res.status).toBe(200);
        // Node accepts latin1 in a header value, so no substitution is needed.
        expect(res.headers['content-disposition']).toContain('filename="caffè-über.txt"');
        expect(res.headers['content-disposition']).toContain(
            "filename*=UTF-8''" + encodeURIComponent('caffè-über.txt'));
    });

    test('characters outside latin1 fall back to "?" but round-trip via RFC 5987', async () => {
        const res = await supertest(server).get('/' + encodeURIComponent('日本語.txt'));
        expect(res.status).toBe(200);
        expect(res.headers['content-disposition']).toContain('filename="???.txt"');
        expect(res.headers['content-disposition']).toContain(
            "filename*=UTF-8''" + encodeURIComponent('日本語.txt'));
    });
});
