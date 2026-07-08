/**
 * Global test setup — runs once per test file before the framework loads
 * (wired via `setupFiles` in jest.config.js).
 *
 * Windows: recursive fs.rm/rmSync intermittently throws ENOTEMPTY / EBUSY /
 * EPERM when the OS releases a file or directory handle a beat after the JS
 * call (antivirus, indexer, or a socket/handle closed microseconds earlier).
 * Node 22+ masks it with better internal retries; Node 18/20 surface it, which
 * broke afterAll cleanup across the suite on the Windows CI legs even though
 * the product code under test passed.
 *
 * fs.rm/rmSync already support `maxRetries` + `retryDelay` (they retry exactly
 * those transient errors with backoff). We inject sane defaults for every
 * RECURSIVE removal that doesn't set them explicitly. On Linux/macOS the first
 * attempt succeeds, so these options are inert there — no behavior change, no
 * slowdown; purely a Windows robustness net for the test teardown.
 */

'use strict';

const fs = require('fs');

const RM_RETRY_DEFAULTS = { maxRetries: 10, retryDelay: 100 };

function withRetryDefaults(options) {
    // Only augment recursive removals; leave single-file rm() untouched.
    if (!options || !options.recursive) return options;
    return { ...RM_RETRY_DEFAULTS, ...options };
}

const _rmSync = fs.rmSync.bind(fs);
fs.rmSync = (target, options) => _rmSync(target, withRetryDefaults(options));

const _rm = fs.rm.bind(fs);
fs.rm = (target, options, callback) => {
    // fs.rm(path, callback) — options omitted
    if (typeof options === 'function') return _rm(target, options);
    return _rm(target, withRetryDefaults(options), callback);
};

if (fs.promises && fs.promises.rm) {
    const _rmPromise = fs.promises.rm.bind(fs.promises);
    fs.promises.rm = (target, options) => _rmPromise(target, withRetryDefaults(options));
}
