/**
 * Property-based tests for the remaining pure helpers exposed via
 * `module.exports._internals`: formatSize, ifNoneMatchSatisfied,
 * toWellFormedName, escapeHtml, listingDisplayName. AFFIANCANO the example
 * tests — they do not replace them.
 *
 * Each block encodes the invariant the helper must uphold for every input,
 * with fast-check driving the generation and shrinking counterexamples to a
 * minimal, seed-reproducible form. Nothing here touches the network or the
 * filesystem, so it stays microsecond-fast next to the HTTP suite.
 *
 * (normalizeExtSuffix and getDirentType are intentionally NOT covered here:
 * they are not on the _internals surface, and this file stays test-only.)
 *
 * Control characters (bidi controls, direction marks, lone surrogates) are
 * built from code points via String.fromCharCode — never pasted literally —
 * so the source stays readable and reviewable.
 *
 * Un-seeded on purpose: on failure fast-check prints `{ seed, path }` — pass them
 * to that test's fc.assert to replay it. See docs/property-based-testing.md.
 */

const fc = require('fast-check');
const {
    formatSize,
    ifNoneMatchSatisfied,
    toWellFormedName,
    escapeHtml,
    listingDisplayName,
} = require('../index.cjs')._internals;

// A single unpaired UTF-16 surrogate — the WTF-16 case POSIX fixtures can't make.
const loneSurrogate = fc.integer({ min: 0xD800, max: 0xDFFF }).map(cu => String.fromCharCode(cu));
// Strings stitched from ASCII, full UTF-16, and lone surrogates.
const hostileString = fc.array(
    fc.oneof(fc.string(), fc.string({ unit: 'binary' }), loneSurrogate),
    { maxLength: 12 },
).map(parts => parts.join(''));

// ── formatSize ────────────────────────────────────────────────────────────────
describe('formatSize — property based', () => {
    const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
    const KNOWN = new Set(UNITS);

    test('#8 guard: the unit is always a known one — never "N undefined"', () => {
        expect(formatSize(null)).toBe('-');
        expect(formatSize(undefined)).toBe('-');
        fc.assert(fc.property(
            fc.oneof(
                fc.constantFrom(0, 1, 1023, 1024, 1536.5, 1048576,
                    Number.MAX_SAFE_INTEGER, 1e30, 1024 ** 6, 1024 ** 7, Number.MAX_VALUE, Infinity),
                fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
            ),
            x => {
                const out = formatSize(x);
                expect(typeof out).toBe('string');
                if (x === 0) { expect(out).toBe('0 B'); return; }
                expect(KNOWN.has(out.split(' ').pop())).toBe(true); // last token is a real unit
            },
        ), { numRuns: 1500 });
    });

    test('bytes below 1 KiB render as an exact "N B"', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: 1023 }), n => {
            expect(formatSize(n)).toBe(`${n} B`);
        }), { numRuns: 500 });
    });

    test('the displayed value round-trips to the byte count within rounding', () => {
        fc.assert(fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), bytes => {
            const [numStr, unit] = formatSize(bytes).split(' ');
            const idx = UNITS.indexOf(unit);
            expect(idx).toBeGreaterThanOrEqual(0);
            const reconstructed = parseFloat(numStr) * Math.pow(1024, idx);
            // toFixed(2) rounds to 2 decimals of the unit → error <= half of 0.01 units
            expect(Math.abs(reconstructed - bytes)).toBeLessThanOrEqual(0.005 * Math.pow(1024, idx) + 1e-3);
        }), { numRuns: 1500 });
    });
});

// ── ifNoneMatchSatisfied ──────────────────────────────────────────────────────
describe('ifNoneMatchSatisfied — property based', () => {
    // Distinct quoted entity-tags (never '*', never containing a comma).
    const tag = fc.array(fc.constantFrom(...'0123456789abcdef'), { minLength: 1, maxLength: 8 })
        .map(a => `"${a.join('')}"`);
    const distinctTags = min => fc.uniqueArray(tag, { minLength: min, maxLength: 6 });

    test('"*" always matches; empty/undefined never does', () => {
        fc.assert(fc.property(tag, etag => {
            expect(ifNoneMatchSatisfied('*', etag)).toBe(true);
            expect(ifNoneMatchSatisfied('  *  ', etag)).toBe(true); // trimmed
            expect(ifNoneMatchSatisfied('', etag)).toBe(false);
            expect(ifNoneMatchSatisfied(undefined, etag)).toBe(false);
        }), { numRuns: 300 });
    });

    test('an etag present in the list matches, even weakened and padded', () => {
        fc.assert(fc.property(
            distinctTags(1), fc.boolean(), fc.nat({ max: 3 }), fc.nat({ max: 3 }), fc.nat(),
            (tags, useW, padL, padR, idxSeed) => {
                const etag = tags[0];
                const others = tags.slice(1);
                const decorated = ' '.repeat(padL) + (useW ? 'W/' : '') + etag + ' '.repeat(padR);
                const pos = idxSeed % (others.length + 1);
                const parts = others.slice();
                parts.splice(pos, 0, decorated);
                expect(ifNoneMatchSatisfied(parts.join(','), etag)).toBe(true);
            },
        ), { numRuns: 1000 });
    });

    test('an etag absent from the list does not match', () => {
        fc.assert(fc.property(distinctTags(2), fc.boolean(), (tags, useW) => {
            const etag = tags[0];
            const others = tags.slice(1); // all distinct from etag
            const header = others.map(t => (useW ? 'W/' : '') + t).join(', ');
            expect(ifNoneMatchSatisfied(header, etag)).toBe(false);
        }), { numRuns: 1000 });
    });

    test('W/ prefix is ignored on both sides (weak comparison)', () => {
        fc.assert(fc.property(tag, etag => {
            const base = ifNoneMatchSatisfied(etag, etag);
            expect(base).toBe(true);
            expect(ifNoneMatchSatisfied('W/' + etag, etag)).toBe(base);
            expect(ifNoneMatchSatisfied(etag, 'W/' + etag)).toBe(base);
            expect(ifNoneMatchSatisfied('W/' + etag, 'W/' + etag)).toBe(base);
        }), { numRuns: 500 });
    });
});

// ── toWellFormedName ──────────────────────────────────────────────────────────
describe('toWellFormedName — property based', () => {
    test('totality: always well-formed, length preserved, never throws', () => {
        fc.assert(fc.property(hostileString, s => {
            let out;
            expect(() => { out = toWellFormedName(s); }).not.toThrow();
            expect(out.isWellFormed()).toBe(true);
            expect(out.length).toBe(s.length); // lone surrogate → one U+FFFD, 1:1
        }), { numRuns: 2000 });
    });

    test('identity on already-well-formed input', () => {
        fc.assert(fc.property(
            fc.string({ unit: 'binary' }).filter(s => s.isWellFormed()),
            s => { expect(toWellFormedName(s)).toBe(s); },
        ), { numRuns: 1000 });
    });

    test('idempotent', () => {
        fc.assert(fc.property(hostileString, s => {
            expect(toWellFormedName(toWellFormedName(s))).toBe(toWellFormedName(s));
        }), { numRuns: 1000 });
    });
});

// ── escapeHtml ────────────────────────────────────────────────────────────────
describe('escapeHtml — property based', () => {
    const SPECIALS = ['&', '<', '>', '"', "'"];
    const anyStr = fc.oneof(
        fc.string(),
        fc.string({ unit: 'binary' }),
        fc.array(fc.constantFrom(...SPECIALS, 'a', '中', '\u{1F600}', ' '), { maxLength: 20 }).map(a => a.join('')),
    );
    // Single left-to-right pass inverts escapeHtml: at any position the actual
    // entity is unambiguous, so the leftmost alternative match is the right one.
    const UNESCAPE = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#039;': "'" };
    const unescapeHtml = s => s.replace(/&amp;|&lt;|&gt;|&quot;|&#039;/g, m => UNESCAPE[m]);

    test('output never contains a raw < > " \' character', () => {
        fc.assert(fc.property(anyStr, s => {
            const out = escapeHtml(s);
            expect(out.includes('<')).toBe(false);
            expect(out.includes('>')).toBe(false);
            expect(out.includes('"')).toBe(false);
            expect(out.includes("'")).toBe(false);
        }), { numRuns: 2000 });
    });

    test('round-trips: unescaping the output returns the original', () => {
        fc.assert(fc.property(anyStr, s => {
            expect(unescapeHtml(escapeHtml(s))).toBe(s);
        }), { numRuns: 2000 });
    });

    test('NOT idempotent: re-escaping a string with specials grows it', () => {
        const withSpecial = fc.array(fc.constantFrom(...SPECIALS), { minLength: 1, maxLength: 5 })
            .chain(specials => fc.string().map(rest => rest + specials.join('')));
        fc.assert(fc.property(withSpecial, s => {
            const once = escapeHtml(s);
            expect(escapeHtml(once).length).toBeGreaterThan(once.length); // the & in entities re-escapes
        }), { numRuns: 500 });
    });

    test('non-strings pass through unchanged; safe alphabet is left as-is', () => {
        fc.assert(fc.property(
            fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
            v => { expect(escapeHtml(v)).toBe(v); },
        ), { numRuns: 200 });
        fc.assert(fc.property(
            fc.array(fc.constantFrom(...'abcXYZ0189 /:._-中'), { maxLength: 20 }).map(a => a.join('')),
            s => { expect(escapeHtml(s)).toBe(s); },
        ), { numRuns: 500 });
    });
});

// ── listingDisplayName ────────────────────────────────────────────────────────
describe('listingDisplayName — property based', () => {
    // Explicit bidi controls (embedding/override/isolate) — spoof display order.
    const bidiChars = [0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]
        .map(c => String.fromCharCode(c));
    const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/;
    // Direction MARKS — legitimate in RTL text, must be left untouched.
    const marks = [0x200E, 0x200F].map(c => String.fromCharCode(c));
    const MARK_RE = /[\u200E\u200F]/g;

    const withBidi = fc.array(
        fc.oneof(
            fc.string({ unit: 'binary' }),
            fc.constantFrom(...bidiChars),
            fc.constantFrom('<', '>', '&', '"', "'"),
        ),
        { maxLength: 15 },
    ).map(a => a.join(''));

    test('scrubs bidi controls and HTML specials; never throws', () => {
        fc.assert(fc.property(withBidi, s => {
            let out;
            expect(() => { out = listingDisplayName(s); }).not.toThrow();
            expect(BIDI_RE.test(out)).toBe(false); // embedding/override/isolate → U+FFFD
            expect(out.includes('<')).toBe(false);
            expect(out.includes('>')).toBe(false);
            expect(out.includes('"')).toBe(false);
            expect(out.includes("'")).toBe(false);
        }), { numRuns: 2000 });
    });

    test('direction MARKS (U+200E/U+200F) are legitimate and preserved', () => {
        // input free of bidi controls and HTML specials → the marks survive verbatim
        fc.assert(fc.property(
            fc.array(fc.constantFrom(...marks, 'a', 'ب', '1'), { maxLength: 15 }).map(a => a.join('')),
            s => {
                const out = listingDisplayName(s);
                const count = str => (str.match(MARK_RE) || []).length;
                expect(count(out)).toBe(count(s));
            },
        ), { numRuns: 500 });
    });
});
