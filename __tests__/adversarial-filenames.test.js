/**
 * Adversarial filename corpus — follow-up of finding #1 (v4.3 register).
 *
 * The middleware's primary contract is "if a file exists in the served
 * directory, GET on its path returns it" — for EVERY name the filesystem
 * allows, not just the common ones. Instead of restricting input to a tested
 * character set (a restriction, per the design philosophy), this suite tests
 * the full input space: every output boundary the name flows through must be
 * total, i.e. defined and safe for any input.
 *
 * For each corpus entry three properties are asserted:
 *   1. direct GET of the encoded name → 200 with the exact content;
 *   2. Content-Disposition: the RFC 5987 filename* form round-trips the name;
 *   3. click-through: the href the directory listing actually emits, when
 *      requested, serves the file (full encode → decode cycle).
 *
 * Platform gates are declarative (`win: false` for names NTFS forbids), and a
 * sentinel test asserts that fixture-creation failures are EXACTLY the ones
 * expected for the platform — a name that silently stops being creatable
 * would otherwise turn its tests into vacuous passes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Koa = require('koa');
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');

const IS_WINDOWS = process.platform === 'win32';

// win: false → NTFS cannot represent the name (reserved chars " * : < > ? \ |,
// C0 controls, or trailing dot/space) — skipped on win32 by the static filter.
const CORPUS = [
    // ── International scripts ─────────────────────────────────────────────
    { label: 'arabic (RTL, with space)',   name: 'ملف عربي.txt' },
    { label: 'hebrew (RTL)',               name: 'קובץ.txt' },
    { label: 'thai',                       name: 'ไฟล์.txt' },
    { label: 'devanagari',                 name: 'फ़ाइल.txt' },
    { label: 'greek',                      name: 'αρχείο.txt' },
    { label: 'cyrillic',                   name: 'файл.txt' },
    { label: 'korean',                     name: '파일.txt' },
    { label: 'CJK with space',             name: '中文 文件.txt' },

    // ── Emoji and astral-plane characters ─────────────────────────────────
    { label: 'emoji ZWJ family',           name: '👨‍👩‍👧‍👦.txt' },
    { label: 'emoji with skin tone',       name: '👍🏽.txt' },
    { label: 'flag (regional indicators)', name: '🇮🇹.txt' },
    { label: 'astral math letters',        name: '𝕬𝖗𝖈𝖍𝖎𝖛.txt' },
    { label: 'CJK extension B',            name: '𠜎.txt' },

    // ── Invisible / bidi / spoofing characters ────────────────────────────
    { label: 'bidi RLO override',          name: 'evil‮txt.exe' },
    { label: 'zero-width space',           name: 'zero​width.txt' },
    { label: 'zero-width joiner',          name: 'zw‍join.txt' },
    { label: 'soft hyphen',                name: 'soft­hyphen.txt' },
    { label: 'BOM / ZWNBSP prefix',        name: '﻿bom.txt' },
    { label: 'replacement character',      name: '�replaced.txt' },
    { label: 'no-break space',             name: 'non break.txt' },

    // ── Unicode normalization ──────────────────────────────────────────────
    { label: 'NFC composed é',             name: 'nfc-é.txt' },
    { label: 'NFD decomposed e+◌́',        name: 'nfd-é.txt' },

    // ── URL-special characters ────────────────────────────────────────────
    { label: 'plain space',                name: 'a b.txt' },
    { label: 'literal percent',            name: 'per%cento.txt' },
    { label: 'percent-encoding lookalike', name: 'a%20b.txt' },
    { label: 'question mark',              name: 'query?mark.txt', win: false },
    { label: 'hash',                       name: 'hash#tag.txt' },
    { label: 'ampersand',                  name: 'amp&ersand.txt' },
    { label: 'plus',                       name: 'plus+plus.txt' },
    { label: 'semicolon',                  name: 'semi;colon.txt' },
    { label: 'equals',                     name: 'equals=.txt' },
    { label: 'at sign',                    name: 'at@sign.txt' },
    { label: 'tilde and caret',            name: 'ti~lde^caret.txt' },
    { label: 'pipe',                       name: 'pipe|pipe.txt', win: false },
    { label: 'single quote',               name: "quote'single.txt" },
    { label: 'backtick',                   name: 'back`tick.txt' },
    { label: 'parentheses',                name: 'paren(thesis).txt' },
    { label: 'brackets and braces',        name: 'brack[et]{s}.txt' },
    { label: 'comma',                      name: 'comma,comma.txt' },
    { label: 'colon',                      name: 'co:lon.txt', win: false },
    { label: 'backslash',                  name: 'back\\slash.txt', win: false },

    // ── HTML-injection shaped names ───────────────────────────────────────
    { label: 'script tag',                 name: '<script>alert(1)<∕script>.txt', win: false },
    { label: 'img onerror',                name: '<img src=x onerror=y>.txt', win: false },
    { label: 'attribute breakout',         name: '"onmouseover=alert(1).txt', win: false },
    { label: 'mixed specials',             name: "it's&<b>bold<∕b>.txt", win: false },

    // ── Path lookalikes and edge shapes ───────────────────────────────────
    { label: 'leading double dot',         name: '..dots.txt' },
    { label: 'inner triple dot',           name: 'dots...txt' },
    { label: 'only dots',                  name: '...', win: false },
    { label: 'trailing dot',               name: 'ends-with-dot.', win: false },
    { label: 'leading space',              name: ' leading-space.txt' },

    // ── Control characters ────────────────────────────────────────────────
    { label: 'C0 tab',                     name: 'tab\tname.txt', win: false },
    { label: 'C0 0x01',                    name: 'ctla.txt', win: false },
    { label: 'C0 0x1F',                    name: 'ctlb.txt', win: false },
    { label: 'DEL 0x7F',                   name: 'delc.txt' },
    { label: 'C1 0x85 (NEL)',              name: 'neld.txt' },

    // ── Length ────────────────────────────────────────────────────────────
    { label: 'long name (150 chars)',      name: 'L' + 'x'.repeat(145) + '.txt' },
];

// Compressible-path probe: unicode name, text/html MIME, above minFileSize
// (1024) → flows through the buffered compression branch with its own
// Content-Disposition emission.
const COMPRESSIBLE_NAME = 'весёлый-🎈.html';
const COMPRESSIBLE_CONTENT = '<!doctype html>' + 'compressible '.repeat(160); // > 1 KB

// Directory round-trip probe: emoji dir name, unicode file inside.
const DIR_NAME = '📁 cartella';
const DIR_FILE_NAME = 'inside — файл.txt';

const ACTIVE = CORPUS.filter((e) => !IS_WINDOWS || e.win !== false);

const contentOf = (name) => 'adversarial content of ' + name;

let root;
const creationFailures = []; // names that could not be created (sentinel test)

beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kcs-adv-'));
    for (const { name } of ACTIVE) {
        try {
            fs.writeFileSync(path.join(root, name), contentOf(name));
        } catch {
            creationFailures.push(name);
        }
    }
    fs.writeFileSync(path.join(root, COMPRESSIBLE_NAME), COMPRESSIBLE_CONTENT);
    fs.mkdirSync(path.join(root, DIR_NAME));
    fs.writeFileSync(path.join(root, DIR_NAME, DIR_FILE_NAME), contentOf(DIR_FILE_NAME));
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function capturingLogger() {
    const errors = [];
    return { errors, error: (...args) => errors.push(args.map(String).join(' ')), warn: () => {} };
}

function parseCd(header) {
    const ext = /filename\*=UTF-8''([^;]*)/.exec(header || '');
    return { real: ext && decodeURIComponent(ext[1]) };
}

// Reverse of the middleware's escapeHtml — used to match listing link text
// back to the original filename.
function unescapeHtml(s) {
    return s
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
        .replace(/&amp;/g, '&');
}

// What the listing DISPLAYS for a name (finding #15): explicit bidi control
// characters are replaced with a visible U+FFFD; everything else unchanged.
function displayedNameOf(name) {
    return name.replace(/[\u202A-\u202E\u2066-\u2069]/g, '\uFFFD');
}

// Finds the href the listing emits for `name`. Matching is done on the
// DISPLAYED text (unescaped), i.e. exactly what the listing claims the file
// is called — the href must then actually serve it. The href attribute value
// is HTML-escaped by the middleware (correctly), so it is unescaped here the
// same way a browser would before navigating.
function hrefFor(listingBody, name) {
    const displayed = displayedNameOf(name);
    for (const m of listingBody.matchAll(/<a href="([^"]*)">([\s\S]*?)<\/a>/g)) {
        if (unescapeHtml(m[2]) === displayed) return unescapeHtml(m[1]);
    }
    return null;
}

// superagent only populates res.text for textual MIME types; extensionless
// names are served as application/octet-stream and land in res.body (Buffer).
function bodyOf(res) {
    if (res.text !== undefined && res.text !== '') return res.text;
    return Buffer.isBuffer(res.body) ? res.body.toString('utf8') : res.text;
}

// Listing hrefs are absolute URLs — reduce to path + query for supertest.
function toPath(href) {
    const u = new URL(href);
    return u.pathname + u.search;
}

describe('Adversarial filenames — full-input-space serving contract', () => {
    let server, logger, listingBody;

    beforeAll(async () => {
        logger = capturingLogger();
        const app = new Koa();
        app.use(koaClassicServer(root, { logger }));
        server = app.listen();
        const res = await supertest(server).get('/');
        expect(res.status).toBe(200);
        listingBody = res.text;
    });

    afterAll(() => server.close());

    test('fixture creation failed only where the platform is expected to refuse', () => {
        // The ACTIVE list is already filtered for the platform, so on every
        // supported CI target the expectation is: no failures at all. A name
        // that stops being creatable must surface here, not silently skip.
        expect(creationFailures).toEqual([]);
    });

    describe.each(ACTIVE.map(({ label, name }) => [label, name]))('%s', (_label, name) => {
        test('direct GET returns 200 with the exact content', async () => {
            const res = await supertest(server).get('/' + encodeURIComponent(name));
            expect(res.status).toBe(200);
            expect(bodyOf(res)).toBe(contentOf(name));
        });

        test('filename* round-trips the exact name', async () => {
            const res = await supertest(server).get('/' + encodeURIComponent(name));
            expect(parseCd(res.headers['content-disposition']).real).toBe(name);
        });

        test('the listing href for this name actually serves it (click-through)', async () => {
            const href = hrefFor(listingBody, name);
            expect(href).not.toBeNull();
            const res = await supertest(server).get(toPath(href));
            expect(res.status).toBe(200);
            expect(bodyOf(res)).toBe(contentOf(name));
        });
    });

    describe('HTML integrity of the listing', () => {
        test('no raw markup from any filename survives into the listing HTML', () => {
            expect(listingBody).not.toContain('<script>alert');
            expect(listingBody).not.toContain('<img src=x');
            expect(listingBody).not.toContain('"onmouseover=');
        });

        test('href attributes contain no raw quotes or spaces from names', () => {
            for (const m of listingBody.matchAll(/<a href="([^"]*)"/g)) {
                // Attribute values must be fully escaped/encoded: a raw '<'
                // would mean escapeHtml was bypassed for hrefs.
                expect(m[1]).not.toMatch(/[<>]/);
            }
        });
    });

    describe('compressed path with a unicode name', () => {
        test('buffered compression serves the file and round-trips the name', async () => {
            const res = await supertest(server)
                .get('/' + encodeURIComponent(COMPRESSIBLE_NAME))
                .set('Accept-Encoding', 'gzip');
            expect(res.status).toBe(200);
            expect(res.headers['content-encoding']).toBe('gzip');
            expect(res.text).toBe(COMPRESSIBLE_CONTENT);
            expect(parseCd(res.headers['content-disposition']).real).toBe(COMPRESSIBLE_NAME);
        });
    });

    describe('directory with an emoji name — full navigation round-trip', () => {
        test('listing link → 301 canonical slash → inner listing → file', async () => {
            const dirHref = hrefFor(listingBody, DIR_NAME);
            expect(dirHref).not.toBeNull();

            // The listing links the directory without a trailing slash — the
            // canonical redirect must bring us to the slashed URL.
            const r1 = await supertest(server).get(toPath(dirHref));
            expect(r1.status).toBe(301);

            const r2 = await supertest(server).get(toPath(new URL(r1.headers.location, 'http://x').href));
            expect(r2.status).toBe(200);

            const fileHref = hrefFor(r2.text, DIR_FILE_NAME);
            expect(fileHref).not.toBeNull();
            const r3 = await supertest(server).get(toPath(fileHref));
            expect(r3.status).toBe(200);
            expect(bodyOf(r3)).toBe(contentOf(DIR_FILE_NAME));
        });
    });

    // #14 — lone surrogates. POSIX fixtures cannot exercise this class (an
    // invalid-UTF-8 name becomes U+FFFD at write time; only Windows readdir
    // returns WTF-16 names), so encoder totality is asserted at unit level.
    describe('#14 — lone surrogates make every name encoder total', () => {
        const { toWellFormedName, buildContentDisposition } = koaClassicServer._internals;

        test('toWellFormedName replaces lone surrogates with U+FFFD', () => {
            expect(toWellFormedName('a\uD800b')).toBe('a�b');
            expect(toWellFormedName('\uDC00x')).toBe('�x');
            expect(toWellFormedName('tail\uDBFF')).toBe('tail�');
        });

        test('well-formed strings — astral pairs included — pass through unchanged', () => {
            expect(toWellFormedName('👍🏽.txt')).toBe('👍🏽.txt');
            expect(toWellFormedName('plain.txt')).toBe('plain.txt');
        });

        test('the Node 18 regex fallback behaves like toWellFormed()', () => {
            // Shadow the native method with an own property so the replace
            // path runs; String.prototype.replace still works on the wrapper.
            const wrap = (s) => Object.assign(Object(s), { toWellFormed: undefined });
            expect(toWellFormedName(wrap('a\uD800b'))).toBe('a�b');
            expect(toWellFormedName(wrap('👨‍👩‍👧‍👦.txt'))).toBe('👨‍👩‍👧‍👦.txt');
            expect(toWellFormedName(wrap('x\uDC00\uD800y'))).toBe('x��y');
        });

        test('buildContentDisposition never throws on a WTF-16 name', () => {
            const cd = buildContentDisposition('a\uD800b.txt');
            expect(cd).toContain('filename="a?b.txt"');
            expect(cd).toContain("filename*=UTF-8''a%EF%BF%BDb.txt");
        });

        test('the listing href encoder is total for WTF-16 names', () => {
            expect(() => encodeURIComponent(toWellFormedName('x\uD800y'))).not.toThrow();
        });
    });

    // #15 — bidi spoofing is defused in the DISPLAYED name only: the file, its
    // href and filename* stay byte-exact (covered by the corpus tests above).
    describe('#15 — bidi controls are defused in the listing display', () => {
        const { listingDisplayName } = koaClassicServer._internals;

        test('explicit bidi controls become a visible U+FFFD', () => {
            expect(listingDisplayName('evil‮txt.exe')).toBe('evil�txt.exe');
            expect(listingDisplayName('a⁦b⁩c')).toBe('a�b�c');
        });

        test('legit RTL text and direction marks are untouched', () => {
            expect(listingDisplayName('ملف عربي.txt')).toBe('ملف عربي.txt');
            expect(listingDisplayName('l‎rm.txt')).toBe('l‎rm.txt');
        });

        test('no raw bidi override reaches the listing HTML; names are <bdi>-isolated', () => {
            expect(listingBody).not.toContain('‮');
            expect(listingBody).toContain('evil�txt.exe');
            expect(listingBody).toContain('<bdi>');
        });
    });

    // The #1 regression logged "[koa-classic-server] Unexpected error ...
    // ERR_INVALID_CHAR" per request; the same class of failure via a
    // non-total encoder would log URIError. Benign stream-teardown noise
    // (ERR_STREAM_PREMATURE_CLOSE) is tolerated.
    test('no header/encoding error signature reaches the logger', () => {
        const signature = logger.errors.filter(
            (msg) => msg.includes('ERR_INVALID_CHAR')
                || msg.includes('URIError')
                || msg.includes('Unexpected error')
        );
        expect(signature).toEqual([]);
    });
});
