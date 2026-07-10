/**
 * Direct unit tests for the module-private helpers exposed via
 * `module.exports._internals` (test-only surface, no stability guarantee).
 *
 * Rationale (2026-07 coverage review): these components were previously tested
 * only through full HTTP round-trips, which left their trickier internals
 * unreachable — the LFU stale-_minFreq recovery loop, refresh() fallbacks,
 * eviction ordering, and several parseRangeHeader / ifNoneMatchSatisfied edge
 * shapes. Correctness of eviction order and frequency preservation is a stated
 * design goal (popular files must survive maxAge refreshes), so it deserves
 * direct assertions that a refactor cannot silently break.
 */

const {
    LFUCache,
    parseRangeHeader,
    ifNoneMatchSatisfied,
    formatSize,
    singleFlight,
    refreshOrInsert,
    escapeHtml,
} = require('../index.cjs')._internals;

function entry(content, extra = {}) {
    return { buffer: Buffer.from(content), mtime: 1000, size: content.length, insertedAt: 0, ...extra };
}

function silentLogger() {
    const warns = [];
    return { warns, warn: (...args) => warns.push(args.join(' ')), error: () => {} };
}

// ─── LFUCache ────────────────────────────────────────────────────────────────

describe('LFUCache', () => {
    test('set + get round-trip; size getter counts entries', () => {
        const cache = new LFUCache(1024, false, 'rawFile', silentLogger());
        expect(cache.size).toBe(0);
        cache.set('a', entry('AAAA'));
        cache.set('b', entry('BB'));
        expect(cache.size).toBe(2);
        expect(cache.get('a').buffer.toString()).toBe('AAAA');
        expect(cache.get('missing')).toBeUndefined();
        expect(cache.currentSize).toBe(6);
    });

    test('peek() does not increment frequency, get() does', () => {
        const cache = new LFUCache(1024, false, 'rawFile', silentLogger());
        cache.set('a', entry('AAAA'));
        cache.peek('a');
        cache.peek('a');
        expect(cache.peek('a').freq).toBe(1); // untouched by peek
        cache.get('a');
        expect(cache.peek('a').freq).toBe(2);
    });

    test('eviction removes the least-frequently-used entry first', () => {
        const cache = new LFUCache(12, false, 'rawFile', silentLogger());
        cache.set('hot', entry('AAAA'));  // 4 bytes
        cache.set('cold', entry('BBBB')); // 4 bytes
        cache.get('hot'); // hot: freq 2, cold: freq 1
        cache.set('new', entry('CCCCCCCC')); // 8 bytes → must evict 4 bytes → cold goes
        expect(cache.peek('hot')).toBeDefined();
        expect(cache.peek('cold')).toBeUndefined();
        expect(cache.peek('new')).toBeDefined();
    });

    test('eviction is FIFO within the same frequency bucket', () => {
        const cache = new LFUCache(12, false, 'rawFile', silentLogger());
        cache.set('first', entry('AAAA'));
        cache.set('second', entry('BBBB'));
        // both freq 1 → the older insertion is evicted first
        cache.set('third', entry('CCCCCCCC'));
        expect(cache.peek('first')).toBeUndefined();
        expect(cache.peek('second')).toBeDefined();
    });

    test('an entry larger than maxSize is rejected WITHOUT flushing the cache', () => {
        const logger = silentLogger();
        const cache = new LFUCache(10, 0, 'compressedFile', logger);
        cache.set('small', entry('AAAA'));
        cache.set('huge', entry('X'.repeat(50))); // > maxSize → early return
        expect(cache.peek('huge')).toBeUndefined();
        expect(cache.peek('small')).toBeDefined(); // other entries survived
        expect(logger.warns.some(w => w.includes('exceeds maxSize'))).toBe(true);
    });

    test('delete() releases bytes and forgets the key', () => {
        const cache = new LFUCache(1024, false, 'rawFile', silentLogger());
        cache.set('a', entry('AAAA'));
        cache.delete('a');
        expect(cache.peek('a')).toBeUndefined();
        expect(cache.currentSize).toBe(0);
        cache.delete('a'); // idempotent on a missing key
        expect(cache.currentSize).toBe(0);
    });

    test('eviction recovers from a stale _minFreq left by an external delete()', () => {
        const cache = new LFUCache(12, false, 'rawFile', silentLogger());
        cache.set('a', entry('AAAA'));
        cache.set('b', entry('BBBB'));
        cache.get('a');    // a: freq 2 — bucket 1 holds only b
        cache.delete('b'); // bucket 1 is now gone but _minFreq still points at 1
        // Inserting 12 bytes forces eviction: _evictOne must skip the missing
        // bucket 1 and find 'a' in bucket 2 instead of crashing or evicting nothing.
        cache.set('c', entry('CCCCCCCCCCCC'));
        expect(cache.peek('a')).toBeUndefined();
        expect(cache.peek('c')).toBeDefined();
        expect(cache.currentSize).toBe(12);
    });

    test('refresh() swaps the buffer in place and PRESERVES the frequency', () => {
        const cache = new LFUCache(1024, false, 'rawFile', silentLogger());
        cache.set('a', entry('AAAA'));
        cache.get('a');
        cache.get('a'); // freq 3
        const ok = cache.refresh('a', { buffer: Buffer.from('BBBBBBBB'), mtime: 2000, size: 8, insertedAt: 5 });
        expect(ok).toBe(true);
        const e = cache.peek('a');
        expect(e.freq).toBe(3); // popularity survived the refresh
        expect(e.buffer.toString()).toBe('BBBBBBBB');
        expect(e.mtime).toBe(2000);
        expect(e.size).toBe(8);
        expect(e.insertedAt).toBe(5);
        expect(cache.currentSize).toBe(8); // size delta applied
    });

    test('refresh() returns false when the new buffer does not fit in maxSize', () => {
        const cache = new LFUCache(10, false, 'rawFile', silentLogger());
        cache.set('a', entry('AAAA'));
        expect(cache.refresh('a', { buffer: Buffer.from('X'.repeat(11)) })).toBe(false);
        expect(cache.peek('a').buffer.toString()).toBe('AAAA'); // untouched
    });

    test('refresh() returns false for a missing key', () => {
        const cache = new LFUCache(10, false, 'rawFile', silentLogger());
        expect(cache.refresh('nope', { buffer: Buffer.from('A') })).toBe(false);
    });

    test('warnInterval: false silences eviction warnings entirely', () => {
        const logger = silentLogger();
        const cache = new LFUCache(4, false, 'rawFile', logger);
        cache.set('a', entry('AAAA'));
        cache.set('b', entry('BBBB')); // evicts a
        expect(logger.warns.length).toBe(0);
    });

    test('warnInterval: 0 warns on every eviction; a positive interval throttles', () => {
        const always = silentLogger();
        const cacheAlways = new LFUCache(4, 0, 'rawFile', always);
        cacheAlways.set('a', entry('AAAA'));
        cacheAlways.set('b', entry('BBBB'));
        cacheAlways.set('c', entry('CCCC'));
        expect(always.warns.length).toBe(2);

        const throttled = silentLogger();
        const cacheThrottled = new LFUCache(4, 60000, 'rawFile', throttled);
        cacheThrottled.set('a', entry('AAAA'));
        cacheThrottled.set('b', entry('BBBB'));
        cacheThrottled.set('c', entry('CCCC'));
        expect(throttled.warns.length).toBe(1); // second eviction inside the interval
    });
});

// ─── parseRangeHeader ────────────────────────────────────────────────────────

describe('parseRangeHeader', () => {
    const SIZE = 100;

    test.each([
        ['missing bytes= prefix', 'octets=0-5'],
        ['multi-range (commas)', 'bytes=0-5,10-20'],
        ['no dash', 'bytes=5'],
        ['empty spec', 'bytes=-'],
        ['non-numeric start', 'bytes=abc-5'],
        ['non-numeric end', 'bytes=0-xyz'],
        ['start after end', 'bytes=50-10'],
        ['suffix of zero', 'bytes=-0'],
    ])('%s → invalid (caller serves full 200)', (_label, header) => {
        expect(parseRangeHeader(header, SIZE)).toBe('invalid');
    });

    test('plain range bytes=10-19', () => {
        expect(parseRangeHeader('bytes=10-19', SIZE)).toEqual({ start: 10, end: 19 });
    });

    test('open range bytes=90- reaches end of file', () => {
        expect(parseRangeHeader('bytes=90-', SIZE)).toEqual({ start: 90, end: 99 });
    });

    test('end is clamped to fileSize - 1', () => {
        expect(parseRangeHeader('bytes=90-500', SIZE)).toEqual({ start: 90, end: 99 });
    });

    test('suffix range bytes=-10 returns the last 10 bytes', () => {
        expect(parseRangeHeader('bytes=-10', SIZE)).toEqual({ start: 90, end: 99 });
    });

    test('suffix larger than the file returns the whole file', () => {
        expect(parseRangeHeader('bytes=-500', SIZE)).toEqual({ start: 0, end: 99 });
    });

    test('start beyond EOF → unsatisfiable (416)', () => {
        expect(parseRangeHeader('bytes=100-', SIZE)).toBe('unsatisfiable');
        expect(parseRangeHeader('bytes=150-200', SIZE)).toBe('unsatisfiable');
    });

    test('any range on an empty file → unsatisfiable', () => {
        expect(parseRangeHeader('bytes=0-5', 0)).toBe('unsatisfiable');
        expect(parseRangeHeader('bytes=-5', 0)).toBe('unsatisfiable');
    });

    test('single-byte range bytes=0-0', () => {
        expect(parseRangeHeader('bytes=0-0', SIZE)).toEqual({ start: 0, end: 0 });
    });

    // Documented lenience, not an endorsement: parseInt() ignores trailing
    // garbage, so "bytes=-5-10" parses as the suffix "-5" (last 5 bytes)
    // instead of being rejected as malformed. Serving a 206 for it is harmless
    // (the client sent a Range it shouldn't have), but if the parser is ever
    // tightened this test should flip to expecting 'invalid'.
    test('trailing garbage after a suffix is tolerated by parseInt (current behavior)', () => {
        expect(parseRangeHeader('bytes=-5-10', SIZE)).toEqual({ start: 95, end: 99 });
    });
});

// ─── ifNoneMatchSatisfied ────────────────────────────────────────────────────

describe('ifNoneMatchSatisfied', () => {
    const ETAG = '"1000-42"';

    test('empty / missing header → false', () => {
        expect(ifNoneMatchSatisfied('', ETAG)).toBe(false);
        expect(ifNoneMatchSatisfied(undefined, ETAG)).toBe(false);
    });

    test('"*" matches any representation', () => {
        expect(ifNoneMatchSatisfied('*', ETAG)).toBe(true);
        expect(ifNoneMatchSatisfied('  *  ', ETAG)).toBe(true);
    });

    test('exact match', () => {
        expect(ifNoneMatchSatisfied('"1000-42"', ETAG)).toBe(true);
        expect(ifNoneMatchSatisfied('"other"', ETAG)).toBe(false);
    });

    test('comma-separated list matches any member', () => {
        expect(ifNoneMatchSatisfied('"a", "1000-42", "b"', ETAG)).toBe(true);
        expect(ifNoneMatchSatisfied('"a", "b"', ETAG)).toBe(false);
    });

    test('weak comparison: W/ prefix ignored on the client side', () => {
        expect(ifNoneMatchSatisfied('W/"1000-42"', ETAG)).toBe(true);
    });

    test('weak comparison: W/ prefix ignored on the server side too', () => {
        expect(ifNoneMatchSatisfied('"1000-42"', 'W/"1000-42"')).toBe(true);
    });

    test('empty list members are skipped, not matched', () => {
        expect(ifNoneMatchSatisfied(', ,"1000-42"', ETAG)).toBe(true);
        expect(ifNoneMatchSatisfied(', ,', ETAG)).toBe(false);
    });
});

// ─── formatSize ──────────────────────────────────────────────────────────────

describe('formatSize', () => {
    test('special values', () => {
        expect(formatSize(0)).toBe('0 B');
        expect(formatSize(undefined)).toBe('-');
        expect(formatSize(null)).toBe('-');
    });

    test('each unit boundary', () => {
        expect(formatSize(1)).toBe('1 B');
        expect(formatSize(1023)).toBe('1023 B');
        expect(formatSize(1024)).toBe('1 KB');
        expect(formatSize(1536)).toBe('1.5 KB');
        expect(formatSize(1048576)).toBe('1 MB');
        expect(formatSize(1073741824)).toBe('1 GB');
        expect(formatSize(1099511627776)).toBe('1 TB');
    });

    test('rounds to at most two decimals', () => {
        expect(formatSize(1234567)).toBe('1.18 MB');
    });
});

// ─── singleFlight ────────────────────────────────────────────────────────────

describe('singleFlight', () => {
    test('concurrent callers share one job; the map empties after settle', async () => {
        const map = new Map();
        let runs = 0;
        const work = () => new Promise(resolve => {
            runs++;
            setTimeout(() => resolve('payload'), 10);
        });
        const [a, b, c] = await Promise.all([
            singleFlight(map, 'k', work),
            singleFlight(map, 'k', work),
            singleFlight(map, 'k', work),
        ]);
        expect(runs).toBe(1);
        expect(a).toBe('payload');
        expect(b).toBe('payload');
        expect(c).toBe('payload');
        expect(map.size).toBe(0); // cleaned up on settle
    });

    test('a rejection is shared by all waiters, then the next call retries fresh', async () => {
        const map = new Map();
        let runs = 0;
        const failing = () => {
            runs++;
            return Promise.reject(new Error('boom'));
        };
        const p1 = singleFlight(map, 'k', failing);
        const p2 = singleFlight(map, 'k', failing);
        await expect(p1).rejects.toThrow('boom');
        await expect(p2).rejects.toThrow('boom');
        expect(runs).toBe(1); // both waiters shared the one failed job
        expect(map.size).toBe(0);

        await expect(singleFlight(map, 'k', failing)).rejects.toThrow('boom');
        expect(runs).toBe(2); // new call after failure retries from scratch
    });

    test('different keys run independent jobs', async () => {
        const map = new Map();
        let runs = 0;
        const work = v => () => { runs++; return Promise.resolve(v); };
        const [a, b] = await Promise.all([
            singleFlight(map, 'k1', work(1)),
            singleFlight(map, 'k2', work(2)),
        ]);
        expect(runs).toBe(2);
        expect(a).toBe(1);
        expect(b).toBe(2);
    });
});

// ─── refreshOrInsert ─────────────────────────────────────────────────────────

describe('refreshOrInsert', () => {
    test('stale-by-age with unchanged mtime+size refreshes in place (frequency survives)', () => {
        const cache = new LFUCache(1024, false, 'rawFile', silentLogger());
        cache.set('k', entry('AAAA', { mtime: 1000, size: 4 }));
        cache.get('k');
        cache.get('k'); // freq 3
        const cached = cache.peek('k');
        refreshOrInsert(cache, 'k',
            { buffer: Buffer.from('BBBB'), mtime: 1000, size: 4, insertedAt: 99 },
            cached, /* staleByAge */ true);
        expect(cache.peek('k').freq).toBe(3);
        expect(cache.peek('k').buffer.toString()).toBe('BBBB');
    });

    test('changed mtime falls back to delete + set (frequency resets)', () => {
        const cache = new LFUCache(1024, false, 'rawFile', silentLogger());
        cache.set('k', entry('AAAA', { mtime: 1000, size: 4 }));
        cache.get('k'); // freq 2
        const cached = cache.peek('k');
        refreshOrInsert(cache, 'k',
            { buffer: Buffer.from('BBBB'), mtime: 2000, size: 4, insertedAt: 99 },
            cached, true);
        expect(cache.peek('k').freq).toBe(1); // fresh entry, new life
        expect(cache.peek('k').mtime).toBe(2000);
    });

    test('no previous entry inserts normally', () => {
        const cache = new LFUCache(1024, false, 'rawFile', silentLogger());
        refreshOrInsert(cache, 'k',
            { buffer: Buffer.from('CCCC'), mtime: 1, size: 4, insertedAt: 0 },
            undefined, false);
        expect(cache.peek('k').buffer.toString()).toBe('CCCC');
    });

    test('in-place refresh that no longer fits falls back to delete + set', () => {
        // maxSize 10: entry of 4 bytes; refreshing to 9 bytes would push
        // currentSize past maxSize → refresh() fails → delete + set path.
        const cache = new LFUCache(10, false, 'rawFile', silentLogger());
        cache.set('other', entry('AAAA'));
        cache.set('k', entry('BBBB', { mtime: 1000, size: 4 }));
        cache.get('k'); // freq 2
        const cached = cache.peek('k');
        refreshOrInsert(cache, 'k',
            { buffer: Buffer.from('C'.repeat(9)), mtime: 1000, size: 4, insertedAt: 0 },
            cached, true);
        const e = cache.peek('k');
        expect(e.buffer.toString()).toBe('C'.repeat(9));
        expect(e.freq).toBe(1); // fallback path resets frequency
    });
});

// ─── escapeHtml ──────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
    test('escapes all five special characters', () => {
        expect(escapeHtml(`<a href="x" title='&'>`)).toBe(
            '&lt;a href=&quot;x&quot; title=&#039;&amp;&#039;&gt;'
        );
    });

    test('plain strings pass through unchanged', () => {
        expect(escapeHtml('plain-file.txt')).toBe('plain-file.txt');
    });

    test('non-string input is returned as-is', () => {
        expect(escapeHtml(42)).toBe(42);
        expect(escapeHtml(null)).toBe(null);
    });
});
