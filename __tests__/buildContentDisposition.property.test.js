/**
 * Property-based tests for buildContentDisposition (module-private helper
 * exposed via `module.exports._internals`).
 *
 * These AFFIANCANO the example-based tests — they do not replace them. The
 * reason buildContentDisposition exists is TOTALITY on hostile input: a single
 * awkward filename must never turn a file response into a 500. The two failure
 * modes it guards are:
 *   - encodeURIComponent() throws URIError on lone (unpaired) surrogates, so the
 *     name is normalized with String.prototype.toWellFormed() first;
 *   - a non-latin1 / control character in the quoted-string fallback would make
 *     Node's ctx.set() throw ERR_INVALID_CHAR, so those chars become '?'.
 *
 * Lone surrogates are WTF-16 Windows filenames that readdir() can return but
 * that POSIX CANNOT store — no HTTP/filesystem fixture can produce them, which
 * is exactly why this lives at the unit/property level. fast-check generates
 * them explicitly and shrinks any failure to a minimal, seed-reproducible case.
 *
 * Invariants asserted for EVERY input string:
 *   1. never throws;
 *   2. the result is a valid HTTP header value (checked against Node's own
 *      http.validateHeaderValue, plus the intended latin1 charset);
 *   3. it has the RFC 6266 shape  inline; filename="..."; filename*=UTF-8''...
 *   4. the RFC 5987 extended value round-trips: it decodes back to the
 *      well-formed filename losslessly, even when the ASCII fallback mangles it.
 *
 * Un-seeded on purpose: on failure fast-check prints `{ seed, path }` — pass them
 * to that test's fc.assert to replay it. See docs/property-based-testing.md.
 */

const http = require('node:http');
const fc = require('fast-check');
const { buildContentDisposition, toWellFormedName } = require('../index.cjs')._internals;

// Node rejects header values matching /[^\t\x20-\x7e\x80-\xff]/. This helper
// only ever emits printable latin1 (0x20-0x7e and 0xa0-0xff), a strict subset —
// so the intended charset is even tighter than Node's minimum.
const HEADER_CHARSET_RE = /^[\x20-\x7e\xa0-\xff]*$/;

const RFC5987_MARKER = "UTF-8''";

// Pull the RFC 5987 extended value out of the finished header. It always sits
// after the LAST "UTF-8''": the percent-encoded tail escapes every quote to
// %27, so it can never itself contain the two literal single-quotes of the
// marker, whereas the ASCII fallback (which precedes it) might.
function extendedValueOf(header) {
    return header.slice(header.lastIndexOf(RFC5987_MARKER) + RFC5987_MARKER.length);
}

// ── Generators ───────────────────────────────────────────────────────────────

// A single unpaired UTF-16 surrogate code unit (the WTF-16 case fixtures can't create).
const loneSurrogate = fc.integer({ min: 0xD800, max: 0xDFFF }).map(cu => String.fromCharCode(cu));

// Individually nasty fragments: quotes/backslashes (break the quoted string),
// controls (ERR_INVALID_CHAR), high-latin1, astral emoji, CJK, RFC5987 specials.
const hostileFragment = fc.oneof(
    fc.string(),
    fc.string({ unit: 'binary' }),        // full UTF-16, incl. controls & astral pairs
    loneSurrogate,
    fc.constantFrom(
        '"', '\\', '\n', '\r', '\t', '\x00', '\x1f', '\x7f', '\x80', ' ',
        '™', '😀', '中', "'", '(', ')', '%', "UTF-8''", 'filename', ';', '=',
    ),
);

// A filename stitched from several fragments, so surrogate pairs get formed or
// broken across boundaries and delimiter-like substrings land at odd offsets.
const hostileFilename = fc.array(hostileFragment, { maxLength: 14 }).map(parts => parts.join(''));

// Names made only of chars that survive BOTH encoders unchanged.
const asciiSafeName = fc.array(fc.constantFrom(...'abcXYZ0189._-'), { minLength: 1, maxLength: 20 })
    .map(a => a.join(''));

describe('buildContentDisposition — property based', () => {
    test('totality: never throws for any (even lone-surrogate) filename', () => {
        fc.assert(fc.property(hostileFilename, name => {
            expect(() => buildContentDisposition(name)).not.toThrow();
        }), { numRuns: 3000 });
    });

    test('header safety: output is always a legal HTTP header value', () => {
        fc.assert(fc.property(hostileFilename, name => {
            const out = buildContentDisposition(name);
            // authoritative check: Node's own header validator must accept it
            expect(() => http.validateHeaderValue('Content-Disposition', out)).not.toThrow();
            // intended charset: printable latin1 only (stricter than Node's minimum)
            expect(HEADER_CHARSET_RE.test(out)).toBe(true);
        }), { numRuns: 3000 });
    });

    test('structure: RFC 6266 inline; filename="..."; filename*=UTF-8\'\'... shape', () => {
        fc.assert(fc.property(hostileFilename, name => {
            const out = buildContentDisposition(name);
            expect(out.startsWith('inline; filename="')).toBe(true);
            expect(out.includes(`"; filename*=${RFC5987_MARKER}`)).toBe(true);
        }), { numRuns: 1500 });
    });

    test('RFC 5987 round-trip: the extended value decodes to the well-formed name', () => {
        fc.assert(fc.property(hostileFilename, name => {
            const out = buildContentDisposition(name);
            const decoded = decodeURIComponent(extendedValueOf(out));
            expect(decoded).toBe(toWellFormedName(name));
        }), { numRuns: 3000 });
    });

    test('idempotent under pre-normalization: normalizing the input first changes nothing', () => {
        // The helper normalizes with toWellFormed() internally, so feeding it an
        // already-normalized name must yield an identical header.
        fc.assert(fc.property(hostileFilename, name => {
            expect(buildContentDisposition(name)).toBe(buildContentDisposition(toWellFormedName(name)));
        }), { numRuns: 1500 });
    });

    test('ascii-safe names pass through both fields unchanged', () => {
        fc.assert(fc.property(asciiSafeName, name => {
            expect(buildContentDisposition(name))
                .toBe(`inline; filename="${name}"; filename*=${RFC5987_MARKER}${name}`);
        }), { numRuns: 1000 });
    });
});
