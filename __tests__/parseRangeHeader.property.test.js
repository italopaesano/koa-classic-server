/**
 * Property-based tests for parseRangeHeader (module-private helper exposed via
 * `module.exports._internals`).
 *
 * These tests AFFIANCANO — they do not replace — the example-based coverage in
 * internals-unit.test.js and range.test.js. Where the example tests pin a
 * handful of hand-picked shapes, fast-check drives thousands of generated
 * `Range:` specs against randomly-sized files and asserts the INVARIANTS the
 * parser must uphold for every input, most importantly the bounds invariant:
 *
 *   whenever parseRangeHeader returns a { start, end } range, that range is
 *   guaranteed to sit inside the file — 0 <= start <= end <= fileSize - 1 —
 *   so the caller can never be handed an out-of-range read.
 *
 * fast-check shrinks any failure to a minimal counterexample and prints a seed
 * to reproduce it deterministically; nothing here touches the network or the
 * filesystem, so the suite stays microsecond-fast alongside the HTTP tests.
 *
 * Contract (see the doc-comment on parseRangeHeader in index.cjs):
 *   { start, end }   valid single range (both inclusive, 0-based)
 *   'invalid'        malformed / multi-range        → caller serves full 200
 *   'unsatisfiable'  syntactically ok but off-file  → caller returns 416
 */

const fc = require('fast-check');
const { parseRangeHeader } = require('../index.cjs')._internals;

const RESULT_STRINGS = new Set(['invalid', 'unsatisfiable']);

function isRangeObject(r) {
    return r !== null && typeof r === 'object'
        && Number.isInteger(r.start) && Number.isInteger(r.end);
}

// A "bytes=...-..." header biased toward being parseable, with the numbers
// drawn relative to fileSize so the interesting in-range / off-by-one /
// off-file boundaries are all exercised. Also emits the open and suffix forms.
function rangeHeaderFor(fileSize) {
    const num = fc.nat({ max: fileSize + 5 });
    return fc.oneof(
        fc.tuple(num, num).map(([a, b]) => `bytes=${a}-${b}`), // bytes=a-b
        num.map(a => `bytes=${a}-`),                           // bytes=a-  (open)
        num.map(n => `bytes=-${n}`),                           // bytes=-n  (suffix)
    );
}

describe('parseRangeHeader — property based', () => {
    test('totality & shape: never throws, always returns a legal result', () => {
        fc.assert(fc.property(
            // ASCII-ish, full UTF-16 (surrogates/controls), and range-like garbage
            fc.oneof(
                fc.string(),
                fc.string({ unit: 'binary' }),
                fc.tuple(fc.string(), fc.string()).map(([a, b]) => `bytes=${a}-${b}`),
            ),
            fc.nat({ max: 10_000_000 }),
            (header, fileSize) => {
                const r = parseRangeHeader(header, fileSize);
                const legal = (typeof r === 'string' && RESULT_STRINGS.has(r)) || isRangeObject(r);
                expect(legal).toBe(true);
            },
        ), { numRuns: 2000 });
    });

    test('bounds invariant: any returned range sits inside the file', () => {
        fc.assert(fc.property(
            fc.nat({ max: 1_000_000 }).chain(fileSize =>
                fc.tuple(fc.constant(fileSize), rangeHeaderFor(fileSize))),
            ([fileSize, header]) => {
                const r = parseRangeHeader(header, fileSize);
                if (isRangeObject(r)) {
                    expect(r.start).toBeGreaterThanOrEqual(0);
                    expect(r.end).toBeGreaterThanOrEqual(r.start);
                    expect(r.end).toBeLessThanOrEqual(fileSize - 1);
                    // an object result is only reachable for a non-empty file
                    expect(fileSize).toBeGreaterThanOrEqual(1);
                }
            },
        ), { numRuns: 2000 });
    });

    test('normal range bytes=a-b: round-trips, end clamped to fileSize-1', () => {
        fc.assert(fc.property(
            // fileSize >= 1, 0 <= start <= fileSize-1, end >= start (may exceed file)
            fc.integer({ min: 1, max: 1_000_000 }).chain(fileSize =>
                fc.tuple(
                    fc.constant(fileSize),
                    fc.integer({ min: 0, max: fileSize - 1 }),
                    fc.integer({ min: 0, max: fileSize + 1000 }),
                )),
            ([fileSize, start, endRaw]) => {
                const end = Math.max(start, endRaw);
                const r = parseRangeHeader(`bytes=${start}-${end}`, fileSize);
                expect(r).toEqual({ start, end: Math.min(end, fileSize - 1) });
            },
        ), { numRuns: 1000 });
    });

    test('open range bytes=a-: extends to end of file', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 1_000_000 }).chain(fileSize =>
                fc.tuple(fc.constant(fileSize), fc.integer({ min: 0, max: fileSize - 1 }))),
            ([fileSize, start]) => {
                const r = parseRangeHeader(`bytes=${start}-`, fileSize);
                expect(r).toEqual({ start, end: fileSize - 1 });
            },
        ), { numRuns: 1000 });
    });

    test('suffix range bytes=-n: last min(n, fileSize) bytes', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 1_000_000 }), // fileSize
            fc.integer({ min: 1, max: 2_000_000 }), // n >= 1
            (fileSize, n) => {
                const r = parseRangeHeader(`bytes=-${n}`, fileSize);
                expect(r).toEqual({ start: Math.max(0, fileSize - n), end: fileSize - 1 });
                expect(r.end - r.start + 1).toBe(Math.min(n, fileSize)); // covered length
            },
        ), { numRuns: 1000 });
    });

    test('unsatisfiable: start at or past EOF → 416 signal', () => {
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 1_000_000 }).chain(fileSize =>
                fc.tuple(
                    fc.constant(fileSize),
                    fc.integer({ min: fileSize, max: fileSize + 1_000_000 }), // start >= fileSize
                )),
            ([fileSize, start]) => {
                expect(parseRangeHeader(`bytes=${start}-`, fileSize)).toBe('unsatisfiable');
                expect(parseRangeHeader(`bytes=${start}-${start + 10}`, fileSize)).toBe('unsatisfiable');
            },
        ), { numRuns: 1000 });
    });

    test('empty file: no range is satisfiable', () => {
        fc.assert(fc.property(rangeHeaderFor(0), header => {
            const r = parseRangeHeader(header, 0);
            expect(r === 'unsatisfiable' || r === 'invalid').toBe(true);
            expect(isRangeObject(r)).toBe(false);
        }), { numRuns: 500 });
    });

    test('strict-digit conformance (#11): a non-digit in either bound → invalid', () => {
        const nonDigit = fc.constantFrom('a', 'b', 'x', 'z', 'g', 'f', 'A', 'Z', '+', '_', ' ');
        // garbage in the start token (no fileSize dependency: fails before numeric checks)
        fc.assert(fc.property(fc.nat(), fc.nat(), nonDigit, (a, b, g) => {
            expect(parseRangeHeader(`bytes=${a}${g}-${b}`, 1_000_000)).toBe('invalid');
        }), { numRuns: 500 });
        // garbage in the end token (needs start < fileSize to reach the end check)
        fc.assert(fc.property(
            fc.integer({ min: 1, max: 1_000_000 }).chain(fileSize =>
                fc.tuple(
                    fc.constant(fileSize),
                    fc.integer({ min: 0, max: fileSize - 1 }),
                    fc.nat(),
                    nonDigit,
                )),
            ([fileSize, a, b, g]) => {
                expect(parseRangeHeader(`bytes=${a}-${b}${g}`, fileSize)).toBe('invalid');
            },
        ), { numRuns: 500 });
    });

    test('start > end → invalid', () => {
        fc.assert(fc.property(
            // fileSize > start > end >= 0, so we pass the unsatisfiable gate and hit start>end
            fc.integer({ min: 2, max: 1_000_000 }).chain(fileSize =>
                fc.tuple(
                    fc.constant(fileSize),
                    fc.integer({ min: 1, max: fileSize - 1 }), // start
                )).chain(([fileSize, start]) =>
                fc.tuple(fc.constant(fileSize), fc.constant(start), fc.integer({ min: 0, max: start - 1 }))),
            ([fileSize, start, end]) => {
                expect(parseRangeHeader(`bytes=${start}-${end}`, fileSize)).toBe('invalid');
            },
        ), { numRuns: 500 });
    });

    test('wrong unit prefix or multi-range → invalid', () => {
        // anything not starting with exactly "bytes="
        fc.assert(fc.property(
            fc.constantFrom('bytez=', 'byte=', 'items=', 'Bytes=', 'BYTES=', 'bytes', ''),
            fc.nat(), fc.nat(),
            (prefix, a, b) => {
                expect(parseRangeHeader(`${prefix}${a}-${b}`, 1_000_000)).toBe('invalid');
            },
        ), { numRuns: 300 });
        // multi-range (comma-separated) is explicitly unsupported
        fc.assert(fc.property(fc.nat(), fc.nat(), fc.nat(), fc.nat(), (a, b, c, d) => {
            expect(parseRangeHeader(`bytes=${a}-${b},${c}-${d}`, 1_000_000)).toBe('invalid');
        }), { numRuns: 300 });
    });
});
