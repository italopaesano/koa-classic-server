/**
 * Property-based tests for the LFUCache (module-private, exposed via
 * `module.exports._internals`). These AFFIANCANO the example-based tests in
 * internals-unit.test.js — they do not replace them.
 *
 * Two complementary strategies:
 *
 * 1. MODEL-BASED (fc.commands / fc.modelRun): drives long random sequences of
 *    set/get/peek/delete against a fresh cache and checks, after EVERY command,
 *    the invariants that must hold no matter which entries eviction chose:
 *      - capacity:     currentSize <= maxSize;
 *      - accounting:   currentSize === Σ live buffer.length, size === live count;
 *      - admission:    no live entry exceeds maxSize or maxEntrySize;
 *      - integrity:    every live entry still holds the exact buffer last set()
 *                      for that key (reference identity — catches any swap);
 *      - freq buckets: every live key sits in exactly one _freqMap bucket whose
 *                      key equals its freq, and no key is ever in two buckets
 *                      (the "ghost" that would make _evictOne destructure
 *                      undefined — the bug the set()-on-live guard prevents).
 *
 * 2. EVICTION ORDERING: pure-LFU (distinct frequencies) and FIFO-within-a-bucket
 *    (equal frequencies), generalized over the number of entries. Correct
 *    eviction order is a stated design goal — popular files must survive
 *    maxAge refreshes — so it is asserted directly rather than by example alone.
 *
 * Un-seeded on purpose: on failure fast-check prints `{ seed, path }` — pass them
 * to that test's fc.assert to replay it. See docs/property-based-testing.md.
 */

const fc = require('fast-check');
const { LFUCache } = require('../index.cjs')._internals;

function silentLogger() {
    return { warn: () => {}, error: () => {} };
}

function sizedEntry(size) {
    return { buffer: Buffer.alloc(size), mtime: 0, size, insertedAt: 0 };
}

// ── Shared invariant checker (reads the real cache; cross-checks the shadow) ──
function checkInvariants(real, shadow, maxSize, maxEntrySize) {
    // capacity
    expect(real.currentSize).toBeLessThanOrEqual(maxSize);

    let sum = 0;
    let count = 0;
    for (const [key, entry] of real._keyMap) {
        count++;
        sum += entry.buffer.length;
        // admission: a live entry can never exceed either cap
        expect(entry.buffer.length).toBeLessThanOrEqual(maxSize);
        expect(entry.buffer.length).toBeLessThanOrEqual(maxEntrySize);
        // integrity: the live buffer is exactly the one last set for this key
        expect(shadow.has(key)).toBe(true);
        expect(entry.buffer).toBe(shadow.get(key)); // reference identity
    }
    // accounting
    expect(real.currentSize).toBe(sum);
    expect(real.size).toBe(count);

    // frequency-bucket consistency
    let bucketTotal = 0;
    const seen = new Set();
    for (const [freq, bucket] of real._freqMap) {
        for (const key of bucket) {
            expect(seen.has(key)).toBe(false);      // never in two buckets
            seen.add(key);
            expect(real._keyMap.has(key)).toBe(true);
            expect(real._keyMap.get(key).freq).toBe(freq); // bucket key == entry freq
            bucketTotal++;
        }
    }
    expect(bucketTotal).toBe(real.size);            // every live key bucketed once
    for (const key of real._keyMap.keys()) expect(seen.has(key)).toBe(true);
}

// ── Commands ─────────────────────────────────────────────────────────────────
class SetCommand {
    constructor(key, size) { this.key = key; this.size = size; }
    check() { return true; }
    run(m, real) {
        const buf = Buffer.alloc(this.size);
        real.set(this.key, { buffer: buf, mtime: 0, size: this.size, insertedAt: 0 });
        // mirror admission in the shadow: set() deletes an existing key first,
        // then refuses entries larger than either cap (still not cached).
        m.shadow.delete(this.key);
        if (this.size <= m.maxSize && this.size <= m.maxEntrySize) m.shadow.set(this.key, buf);
        checkInvariants(real, m.shadow, m.maxSize, m.maxEntrySize);
    }
    toString() { return `set(${this.key}, ${this.size}B)`; }
}

class GetCommand {
    constructor(key) { this.key = key; }
    check() { return true; }
    run(m, real) {
        const before = real.peek(this.key);
        // capture freq as a primitive first: peek/get return the SAME entry
        // object and get() mutates entry.freq in place, so before.freq would
        // already be bumped by the time we assert.
        const freqBefore = before ? before.freq : undefined;
        const ret = real.get(this.key);
        if (before === undefined) {
            expect(ret).toBeUndefined();
        } else {
            expect(ret).toBe(before);                // same entry object
            expect(ret.freq).toBe(freqBefore + 1);   // get bumps frequency by one
            expect(ret.buffer).toBe(m.shadow.get(this.key));
        }
        checkInvariants(real, m.shadow, m.maxSize, m.maxEntrySize);
    }
    toString() { return `get(${this.key})`; }
}

class PeekCommand {
    constructor(key) { this.key = key; }
    check() { return true; }
    run(m, real) {
        const before = real.peek(this.key);
        const freqBefore = before ? before.freq : undefined;
        const ret = real.peek(this.key);
        if (before === undefined) {
            expect(ret).toBeUndefined();
        } else {
            expect(ret).toBe(before);
            expect(ret.freq).toBe(freqBefore);       // peek never touches frequency
        }
        checkInvariants(real, m.shadow, m.maxSize, m.maxEntrySize);
    }
    toString() { return `peek(${this.key})`; }
}

class DeleteCommand {
    constructor(key) { this.key = key; }
    check() { return true; }
    run(m, real) {
        real.delete(this.key);
        m.shadow.delete(this.key);
        expect(real.peek(this.key)).toBeUndefined();
        checkInvariants(real, m.shadow, m.maxSize, m.maxEntrySize);
    }
    toString() { return `delete(${this.key})`; }
}

describe('LFUCache — property based', () => {
    test('model-based: invariants hold across random set/get/peek/delete sequences', () => {
        const key = fc.constantFrom('a', 'b', 'c', 'd', 'e');
        const allCommands = [
            fc.tuple(key, fc.integer({ min: 1, max: 48 })).map(([k, s]) => new SetCommand(k, s)),
            key.map(k => new GetCommand(k)),
            key.map(k => new PeekCommand(k)),
            key.map(k => new DeleteCommand(k)),
        ];
        fc.assert(fc.property(
            fc.integer({ min: 4, max: 40 }),                                  // maxSize
            fc.oneof(fc.constant(Infinity), fc.integer({ min: 1, max: 40 })), // maxEntrySize
            fc.commands(allCommands, { maxCommands: 120 }),
            (maxSize, maxEntrySize, cmds) => {
                const setup = () => ({
                    model: { shadow: new Map(), maxSize, maxEntrySize },
                    real: new LFUCache(maxSize, false, 'rawFile', silentLogger(), maxEntrySize),
                });
                fc.modelRun(setup, cmds);
            },
        ), { numRuns: 300 });
    });

    test('eviction victim is the least-frequently-used entry (distinct freqs)', () => {
        fc.assert(fc.property(
            // distinct extra-access counts → all frequencies distinct → unique LFU victim
            fc.uniqueArray(fc.integer({ min: 0, max: 25 }), { minLength: 2, maxLength: 6 }),
            accessCounts => {
                const n = accessCounts.length;
                const s = 4;
                const cache = new LFUCache(n * s, false, 'rawFile', silentLogger());
                for (let i = 0; i < n; i++) cache.set('k' + i, sizedEntry(s));   // all fit, freq 1
                for (let i = 0; i < n; i++) {
                    for (let j = 0; j < accessCounts[i]; j++) cache.get('k' + i); // freq = 1 + count
                }
                const minIdx = accessCounts.indexOf(Math.min(...accessCounts));
                cache.set('X', sizedEntry(s)); // full → exactly one eviction

                expect(cache.peek('k' + minIdx)).toBeUndefined();  // lowest freq evicted
                expect(cache.peek('X')).toBeDefined();
                for (let i = 0; i < n; i++) {
                    if (i !== minIdx) expect(cache.peek('k' + i)).toBeDefined();
                }
            },
        ), { numRuns: 500 });
    });

    test('within one frequency bucket, eviction is FIFO (oldest inserted first)', () => {
        fc.assert(fc.property(fc.integer({ min: 2, max: 8 }), n => {
            const s = 4;
            const cache = new LFUCache(n * s, false, 'rawFile', silentLogger());
            for (let i = 0; i < n; i++) cache.set('k' + i, sizedEntry(s)); // all freq 1
            cache.set('X', sizedEntry(s)); // evicts the oldest freq-1 entry

            expect(cache.peek('k0')).toBeUndefined();
            expect(cache.peek('X')).toBeDefined();
            for (let i = 1; i < n; i++) expect(cache.peek('k' + i)).toBeDefined();
        }), { numRuns: 200 });
    });
});
