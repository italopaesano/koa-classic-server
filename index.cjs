
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const mime = require("mime-types");
const { Readable } = require('stream');

// Pre-computed module-level constants
const _LOG_1024 = Math.log(1024);

// Emitted at most once per process lifetime when the caller passes the v2-era
// `showDirContents` option instead of the v3 `dirListing.enabled`. The old
// name is accepted as a backward-compatibility alias and may be removed in a
// future major version.
let _showDirContentsDeprecationWarned = false;

// Default list of MIME types that benefit from compression.
// User-provided compression.mimeTypes replaces this list entirely.
const DEFAULT_COMPRESSIBLE_MIME_TYPES = [
    'text/html',
    'text/css',
    'text/javascript',
    'text/plain',
    'text/xml',
    'text/csv',
    'application/javascript',
    'application/json',
    'application/xml',
    'application/wasm',
    'image/svg+xml',
];

// CSS for the directory listing page — extracted so its SHA-256 hash can be
// computed once at module load time and placed in the Content-Security-Policy header.
const LISTING_CSS = `
    body {
        font-family: Arial, sans-serif;
        margin: 20px;
    }
    h1 {
        border-bottom: 1px solid #ddd;
        padding-bottom: 10px;
    }
    table {
        border-collapse: collapse;
        width: 100%;
        max-width: 800px;
    }
    thead {
        background-color: #f5f5f5;
        border-bottom: 2px solid #ddd;
    }
    th {
        text-align: left;
        padding: 10px;
        font-weight: bold;
        border-bottom: 2px solid #ddd;
    }
    td {
        padding: 8px 10px;
        border-bottom: 1px solid #eee;
    }
    tr:hover {
        background-color: #f9f9f9;
    }
    a {
        color: #0066cc;
        text-decoration: none;
    }
    a:hover {
        text-decoration: underline;
    }
    th:nth-child(1), td:nth-child(1) { width: 50%; }
    th:nth-child(2), td:nth-child(2) { width: 30%; }
    th:nth-child(3), td:nth-child(3) { width: 20%; text-align: right; }
    .kcs-banner {
        max-width: 800px;
        margin: 10px 0;
        padding: 10px 14px;
        background-color: #fff7e0;
        border-left: 4px solid #e0a800;
        font-size: 14px;
        color: #5a4a00;
    }
    .kcs-pagination {
        max-width: 800px;
        margin: 16px 0;
        font-size: 14px;
    }
    .kcs-pagination a, .kcs-pagination span {
        display: inline-block;
        padding: 4px 8px;
        margin-right: 4px;
    }
    .kcs-pagination .kcs-page-current {
        font-weight: bold;
        background-color: #f0f0f0;
        border-radius: 3px;
    }
    .kcs-pagination .kcs-page-ellipsis {
        color: #888;
    }
    .kcs-pagination .kcs-page-disabled {
        color: #bbb;
    }
`;

// SHA-256 hash of the listing CSS, computed once at startup (zero per-request overhead).
const _listingCssHash = 'sha256-' + crypto.createHash('sha256').update(LISTING_CSS, 'utf8').digest('base64');

// CSP for the directory listing page (has inline CSS → hash-based allowance).
const LISTING_CSP = `default-src 'none'; style-src '${_listingCssHash}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

// CSP for error/404 pages (no inline CSS → fully restrictive).
const NOT_FOUND_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

// Sets security headers on all middleware-generated HTML pages (listing + error).
// Must NOT be called for user files served from disk.
function setGeneratedPageHeaders(ctx, csp) {
    ctx.set('Content-Security-Policy', csp);
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('X-Frame-Options', 'DENY');
    ctx.set('Referrer-Policy', 'no-referrer');
    ctx.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
}

// Builds a minimal error page used by the middleware (404 / 500 / 504).
// Each page is pre-computed once at module load and reused on every request.
function buildErrorHtml(title, heading, message) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body>
  <h1>${heading}</h1>
  <h3>${message}</h3>
</body>
</html>`;
}

const _NOT_FOUND_HTML       = buildErrorHtml('URL not found',         'Not Found',             'The requested URL was not found on this server.');
const _GATEWAY_TIMEOUT_HTML = buildErrorHtml('Gateway Timeout',       'Gateway Timeout',       'The template took too long to render.');
const _TEMPLATE_ERROR_HTML  = buildErrorHtml('Internal Server Error', 'Internal Server Error', 'Template rendering failed for the requested resource.');

function sendNotFound(ctx) {
    setGeneratedPageHeaders(ctx, NOT_FOUND_CSP);
    ctx.status = 404;
    ctx.body = _NOT_FOUND_HTML;
}

// Validates and returns a logger compatible with our contract. The minimum
// surface is `{ error: Function, warn: Function }` — any object exposing both
// (console, pino, winston, bunyan, ...) is accepted as-is.
function normalizeLogger(logger) {
    if (logger === undefined) return console;
    if (!logger || typeof logger !== 'object' || Array.isArray(logger)) {
        throw new Error(
            '[koa-classic-server] options.logger must be an object exposing error() and warn() methods.'
        );
    }
    if (typeof logger.error !== 'function' || typeof logger.warn !== 'function') {
        throw new Error(
            '[koa-classic-server] options.logger must implement both error() and warn() methods.'
        );
    }
    return logger;
}

// Yellow ANSI wrap, but only when writing to the actual console TTY. Structured
// loggers (pino/winston/...) would otherwise receive escape bytes as noise.
function warnPayload(logger, message) {
    return logger === console
        ? ['\x1b[33m%s\x1b[0m', message]
        : [message];
}

// Sends an error response for a failed template render. If headers were already
// flushed by the render itself, destroys the underlying socket instead (the
// status/body can no longer be changed at that point).
function sendTemplateError(ctx, status, html, logMsg, err, logger) {
    logger.error(logMsg, err);
    if (ctx.headerSent || ctx.res.writableEnded) {
        ctx.res.destroy();
        return;
    }
    setGeneratedPageHeaders(ctx, NOT_FOUND_CSP);
    ctx.status = status;
    ctx.body = html;
}

// Attempts to render the requested file through the user's template engine.
// Returns true if the request was handled (success, timeout, or error response
// already written), false if no template applies (caller should continue with
// normal file serving).
//
// The render function is invoked with (ctx, next, filePath, rawBuffer, signal).
// The signal aborts on timeout (when templateOpts.renderTimeout > 0) and on
// client disconnect. Cooperative renders that propagate the signal to fetch/db
// release backend resources promptly; non-cooperative renders still get a 504
// response, but their work continues in the background.
async function tryRenderTemplate(ctx, next, filePath, rawBuffer, templateOpts, logger) {
    if (templateOpts.ext.length === 0 || !templateOpts.render) return false;

    const fileExt = path.extname(filePath).slice(1);
    if (!fileExt || !templateOpts.ext.includes(fileExt)) return false;

    const controller = new AbortController();
    const onClientClose = () => controller.abort();
    ctx.req.on('close', onClientClose);

    const timeoutMs = templateOpts.renderTimeout;
    let timer = null;
    let timedOut = false;

    const renderPromise = Promise.resolve().then(() =>
        templateOpts.render(ctx, next, filePath, rawBuffer, controller.signal)
    );
    renderPromise.catch(() => {}); // swallow rejections that arrive after we've already responded

    try {
        if (timeoutMs > 0) {
            await Promise.race([
                renderPromise,
                new Promise((_, reject) => {
                    timer = setTimeout(() => {
                        timedOut = true;
                        controller.abort();
                        const err = new Error('Template render timeout');
                        err.code = 'ETEMPLATETIMEOUT';
                        reject(err);
                    }, timeoutMs);
                })
            ]);
        } else {
            await renderPromise;
        }
    } catch (error) {
        if (timedOut || error.code === 'ETEMPLATETIMEOUT') {
            sendTemplateError(ctx, 504, _GATEWAY_TIMEOUT_HTML,
                'Template render timeout after ' + timeoutMs + 'ms:', filePath, logger);
        } else {
            sendTemplateError(ctx, 500, _TEMPLATE_ERROR_HTML,
                'Template rendering error:', error, logger);
        }
    } finally {
        if (timer) clearTimeout(timer);
        ctx.req.removeListener('close', onClientClose);
    }

    return true;
}

// Single-pass HTML escaping — one regex scan, one allocation, lookup table compiled once.
const _HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
const _HTML_ESCAPE_RE  = /[&<>"']/g;

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe.replace(_HTML_ESCAPE_RE, c => _HTML_ESCAPE_MAP[c]);
}

// Pure helper — depends only on _LOG_1024 (module scope), safe to hoist.
function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    if (bytes === undefined || bytes === null) return '-';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / _LOG_1024);

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Returns the dirent numeric type using the official Node.js API instead of
// the internal Symbol hack: 1=file, 2=dir, 3=symlink, 0=DT_UNKNOWN.
function getDirentType(dirent) {
    if (dirent.isFile())        return 1;
    if (dirent.isDirectory())   return 2;
    if (dirent.isSymbolicLink()) return 3;
    return 0;
}

/**
 * Parse a "Range: bytes=..." header against a known file size.
 * Only single ranges are supported; multi-range requests are treated as invalid.
 *
 * Returns:
 *   { start, end }   — valid range (both inclusive, 0-based)
 *   'invalid'        — malformed or multi-range → caller should serve full 200
 *   'unsatisfiable'  — out of bounds → caller should return 416
 */
function parseRangeHeader(rangeHeader, fileSize) {
    if (!rangeHeader.startsWith('bytes=')) return 'invalid';

    const spec = rangeHeader.slice(6);

    // Reject multi-range (comma-separated)
    if (spec.includes(',')) return 'invalid';

    const dashIdx = spec.indexOf('-');
    if (dashIdx === -1) return 'invalid';

    const startStr = spec.slice(0, dashIdx);
    const endStr   = spec.slice(dashIdx + 1);

    let start, end;

    if (startStr === '') {
        // Suffix range: bytes=-N (last N bytes)
        if (endStr === '') return 'invalid';
        const suffix = parseInt(endStr, 10);
        if (isNaN(suffix) || suffix <= 0) return 'invalid';
        if (fileSize === 0) return 'unsatisfiable';
        start = suffix >= fileSize ? 0 : fileSize - suffix;
        end   = fileSize - 1;
    } else {
        start = parseInt(startStr, 10);
        if (isNaN(start) || start < 0) return 'invalid';
        if (fileSize === 0 || start >= fileSize) return 'unsatisfiable';

        if (endStr === '') {
            // Open range: bytes=N-
            end = fileSize - 1;
        } else {
            end = parseInt(endStr, 10);
            if (isNaN(end) || end < 0) return 'invalid';
            if (start > end) return 'invalid';
            // Clamp end to file size - 1
            if (end >= fileSize) end = fileSize - 1;
        }
    }

    return { start, end };
}

// LFU cache with O(1) eviction using frequency buckets.
// peek(key)  — read without touching frequency (for staleness checks)
// get(key)   — read and increment frequency
// set(key, entry) — insert, evicting LFU entries if needed
// delete(key) — remove explicitly (e.g. stale entry before re-insert)
class LFUCache {
    constructor(maxSize, warnInterval, cacheLabel, logger) {
        this.maxSize     = maxSize;
        this.warnInterval = warnInterval;
        this.cacheLabel  = cacheLabel;
        this.logger      = logger || console;
        this.currentSize = 0;
        this._keyMap     = new Map(); // key → { buffer, mtime, size, insertedAt, freq }
        this._freqMap    = new Map(); // freq → Set<key>
        this._minFreq    = 0;
        this._lastWarnAt = 0;
    }

    get size() { return this._keyMap.size; }

    // Returns entry without incrementing frequency — safe for staleness checks.
    peek(key) {
        return this._keyMap.get(key);
    }

    // Returns entry and increments its frequency.
    get(key) {
        if (!this._keyMap.has(key)) return undefined;
        this._incrementFreq(key);
        return this._keyMap.get(key);
    }

    set(key, entry) {
        while (this.currentSize + entry.buffer.length > this.maxSize && this._keyMap.size > 0) {
            this._evictOne();
        }
        if (this.currentSize + entry.buffer.length > this.maxSize) return; // entry too large for cache

        this._keyMap.set(key, { ...entry, freq: 1 });
        this._addToFreqBucket(key, 1);
        this.currentSize += entry.buffer.length;
        this._minFreq = 1;
    }

    // In-place update of an existing entry that preserves its current frequency.
    // Used when refreshing a stale-by-maxAge entry so popular files don't fall to
    // the bottom of the LFU bucket just because they got re-read from disk.
    // Returns true on success, false if the new buffer doesn't fit in maxSize
    // (caller can fall back to delete + set in that case).
    refresh(key, fields) {
        const entry = this._keyMap.get(key);
        if (!entry) return false;

        const sizeDelta = fields.buffer.length - entry.buffer.length;
        if (this.currentSize + sizeDelta > this.maxSize) return false;

        entry.buffer = fields.buffer;
        if (fields.mtime !== undefined)      entry.mtime = fields.mtime;
        if (fields.size !== undefined)       entry.size = fields.size;
        if (fields.insertedAt !== undefined) entry.insertedAt = fields.insertedAt;
        this.currentSize += sizeDelta;
        return true;
    }

    delete(key) {
        if (!this._keyMap.has(key)) return;
        const { freq, buffer } = this._keyMap.get(key);
        this.currentSize -= buffer.length;
        this._keyMap.delete(key);
        const bucket = this._freqMap.get(freq);
        if (bucket) {
            bucket.delete(key);
            if (bucket.size === 0) this._freqMap.delete(freq);
        }
        // _minFreq may be stale after external delete — reset to 1 on next set()
    }

    _incrementFreq(key) {
        const entry   = this._keyMap.get(key);
        const oldFreq = entry.freq;
        const newFreq = oldFreq + 1;
        entry.freq = newFreq;
        const oldBucket = this._freqMap.get(oldFreq);
        oldBucket.delete(key);
        if (oldBucket.size === 0) {
            this._freqMap.delete(oldFreq);
            if (this._minFreq === oldFreq) this._minFreq = newFreq;
        }
        this._addToFreqBucket(key, newFreq);
    }

    _addToFreqBucket(key, freq) {
        if (!this._freqMap.has(freq)) this._freqMap.set(freq, new Set());
        this._freqMap.get(freq).add(key);
    }
    _evictOne() {
        // Recover from stale _minFreq (can happen after consecutive evictions)
        while (this._freqMap.size > 0 && (!this._freqMap.has(this._minFreq) || this._freqMap.get(this._minFreq).size === 0)) {
            this._freqMap.delete(this._minFreq);
            if (this._freqMap.size === 0) return;
            this._minFreq = Math.min(...this._freqMap.keys());
        }
        const bucket = this._freqMap.get(this._minFreq);
        if (!bucket || bucket.size === 0) return;

        const evictKey = bucket.values().next().value; // FIFO within same freq
        const { buffer } = this._keyMap.get(evictKey);
        this.currentSize -= buffer.length;
        this._keyMap.delete(evictKey);
        bucket.delete(evictKey);
        if (bucket.size === 0) this._freqMap.delete(this._minFreq);

        if (this.warnInterval !== false) {
            const now = Date.now();
            if (now - this._lastWarnAt >= this.warnInterval) {
                this.logger.warn(`[koa-classic-server] serverCache.${this.cacheLabel}: maxSize reached, evicting LFU entries. Consider increasing maxSize.`);
                this._lastWarnAt = now;
            }
        }
    }
}

// Upserts a fresh entry into an LFUCache. When the previous entry was only
// stale-by-age (mtime + size unchanged), updates in place so the existing
// frequency counter survives — important for popular files refreshed by maxAge.
// Otherwise falls back to delete + set (frequency resets to 1).
function refreshOrInsert(cache, key, newEntry, cached, staleByAge) {
    const canRefreshInPlace = cached
        && staleByAge
        && cached.mtime === newEntry.mtime
        && cached.size === newEntry.size;
    if (!canRefreshInPlace || !cache.refresh(key, newEntry)) {
        if (cached) cache.delete(key);
        cache.set(key, newEntry);
    }
}

module.exports = function koaClassicServer(
    rootDir,
    opts = {}
    /*
    opts STRUCTURE
     opts = {
        method: ['GET'], // Supported methods, otherwise next() will be called
        dirListing: {                   // Directory listing configuration (V3+).
            enabled:        true,       // Render the directory listing HTML when no index file matches.
                                        //   Set to false to return 404 instead of a listing.
            maxEntries:     100000,     // Soft cap on entries shown / sorted / stat'd per listing.
                                        //   Implementation: fs.promises.readdir() then slice(0, maxEntries).
                                        //   This is a SAFETY NET against catastrophic operational accidents
                                        //   (broken log rotation, mistakenly mounted huge FS) — not a policy
                                        //   restriction on what the operator can serve. 99% of legitimate
                                        //   deployments never hit this cap. Excess entries are not shown:
                                        //   a banner + the X-Dir-Truncated response header advertise the
                                        //   truncation. Bounds the rendering / CPU cost, NOT the size of the
                                        //   initial readdir() allocation.
                                        //   Must be a finite integer >= 0; 0 = disabled (no cap).
                                        //   For directories writable by untrusted parties, see the v3.1
                                        //   TODO [F-1] in docs/security_improvement_for_V3.md (`readMode`).
            entriesPerPage: 100,        // Entries per page in the listing UI. Pagination kicks in only
                                        //   when visible entries > entriesPerPage. Page index via
                                        //   ?page=N (0-based); out-of-range values are clamped silently.
                                        //   Must be a finite integer >= 0; 0 = disabled (no pagination).
        },
        index: ["index.html"], // Index file name(s) - must be an ARRAY:
                               //   - Array of strings: ["index.html", "index.htm", "default.html"]
                               //   - Array of RegExp:  [/index\.html/i, /default\.(html|htm)/i]
                               //   - Mixed array:      ["index.html", /index\.[eE][jJ][sS]/]
                               // Priority is determined by array order (first match wins)
        urlPrefix: "", // URL path prefix
        urlsReserved: [], // Reserved paths (first level only)
        template: {
            render: undefined, // Template rendering function: async (ctx, next, filePath, rawBuffer, signal) => {}
            ext: [], // File extensions to process with template.render
            renderTimeout: 30000, // Max ms allowed for template.render (number ≥ 0; 0 = disabled).
                                  // On timeout responds 504 Gateway Timeout. The render receives an
                                  // AbortSignal as 5th argument; propagate it to fetch/db/fs to free
                                  // backend resources. The signal also aborts on client disconnect,
                                  // even when renderTimeout is 0.
        },
        browserCacheMaxAge: 3600, // Browser Cache-Control max-age in seconds (default: 1 hour)
        browserCacheEnabled: false, // Enable browser HTTP caching headers (ETag, Last-Modified)
                                    // NOTE: Default is false for development.
                                    // In production, it's recommended to set browserCacheEnabled: true
                                    // to reduce bandwidth usage and improve performance.
        useOriginalUrl: true, // Use ctx.originalUrl (default) or ctx.url
                              // Set false for URL rewriting middleware (i18n, routing)
        hideExtension: {     // Hide file extension from URLs (clean URLs like mod_rewrite)
            ext: '.ejs',     // Extension to hide (required, string, case-sensitive, must start with '.')
            redirect: 301    // HTTP redirect code for URLs with extension (optional, default: 301)
        },
        hidden: {            // Block files/dirs from listing and serving (HTTP 404)
            dotFiles: {      // Dot-files (names starting with '.'): visible by default — design philosophy
                default: 'visible',  // 'hidden' | 'visible' — system default: 'visible'
                                     //   To protect .env / .git / etc., set 'hidden' explicitly OR add to
                                     //   `blacklist` / `alwaysHide`. See README "Security Checklist".
                whitelist: [],       // Always visible (string exact/glob or RegExp). Overrides default and alwaysHide.
                blacklist: [],       // Always hidden (string or RegExp). Overrides whitelist.
            },
            dotDirs: {       // Dot-directories: visible by default
                default: 'visible',  // 'hidden' | 'visible' — system default: 'visible'
                whitelist: [],
                blacklist: [],
            },
            alwaysHide: [],  // Path-aware patterns (string glob or RegExp) for any file/dir.
                             // Secondary to dotFiles/dotDirs whitelist and blacklist.
                             // Examples: ['*.secret', 'config/secrets/**', /\.key$/]
        },
        serverCache: {       // Server-side in-memory caches (independent of browser HTTP caching)
            rawFile: {
                enabled: false,               // enable in-memory cache of raw file buffers
                maxSize: 52428800,            // max total RAM used by this cache (bytes; default: 50 MB)
                maxFileSize: 1048576,         // files larger than this are never cached (bytes; default: 1 MB)
                maxAge: 0,                    // ms after insertion to consider an entry stale; 0 = disabled.
                                              // Useful on NFS/SMB/overlay FS where mtime+size may not reflect
                                              // remote changes within the OS attribute-cache window. Limits but
                                              // does not eliminate staleness — combine with low actimeo on the
                                              // mount for stricter freshness.
                warnInterval: 60000,          // ms between "maxSize reached" warnings; 0 = always; false = never
            },
            compressedFile: {                 // cache for HTTP br/gzip responses — not for .zip/.tar files on disk
                enabled: true,               // enable in-memory cache of compressed response buffers
                maxSize: 104857600,          // max total RAM used by this cache (bytes; default: 100 MB)
                maxAge: 0,                   // ms after insertion to consider an entry stale; 0 = disabled. See rawFile.maxAge.
                warnInterval: 60000,         // ms between "maxSize reached" warnings; 0 = always; false = never
            },
        },
        compression: {       // Response compression (gzip / brotli) — to enable/disable caching → serverCache.compressedFile
            enabled: true,                // master switch (false = disable all compression)
            encodings: ['br', 'gzip'],    // algorithms in priority order; [] = disable
            minFileSize: 1024,            // min file size in bytes to compress; false = no minimum
            mimeTypes: [],                // compressible MIME types (replaces default list if provided)
        },
        // compression: false            // shorthand to disable all compression
        logger: console,    // Logger used for internal errors and warnings.
                            // Must expose error(...) and warn(...). Pass pino/winston/bunyan
                            // or any compatible object to integrate with aggregated logging.
                            // Default: the global console.

    }
    */
) {
    if (!rootDir || typeof rootDir !== 'string') {
        throw new TypeError('rootDir must be a non-empty string');
    }
    if (!path.isAbsolute(rootDir)) {
        throw new Error('rootDir must be an absolute path');
    }

    const normalizedRootDir = path.resolve(rootDir);

    const options = opts || {};
    options.template = opts.template || {};

    const _logger = normalizeLogger(options.logger);

    options.method = Array.isArray(options.method) ? options.method : ['GET'];

    // ── V3 breaking-change guards: helpful errors for V3-alpha-only renamed options ──
    // These were introduced in v3.0.0-alpha.0 only; no v2 user can have them in production.
    if (opts.maxDirEntries !== undefined) {
        throw new Error(
            '[koa-classic-server] options.maxDirEntries was relocated in v3.0.0.\n' +
            `  Replace with: dirListing: { maxEntries: ${opts.maxDirEntries} }`
        );
    }
    if (opts.pageSize !== undefined) {
        throw new Error(
            '[koa-classic-server] options.pageSize was relocated and renamed in v3.0.0.\n' +
            `  Replace with: dirListing: { entriesPerPage: ${opts.pageSize} }`
        );
    }

    function validateNonNegativeInt(value, optionName, defaultValue) {
        if (value === undefined) return defaultValue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
            throw new Error(
                `[koa-classic-server] options.${optionName} must be a non-negative integer. ` +
                'Use 0 to disable. Got: ' + String(value)
            );
        }
        return value;
    }

    // ── dirListing namespace (V3+) — single source of truth for listing config ──
    const userDirListing = opts.dirListing;
    if (userDirListing !== undefined && (typeof userDirListing !== 'object' || userDirListing === null || Array.isArray(userDirListing))) {
        throw new Error('[koa-classic-server] options.dirListing must be an object.');
    }

    // V3 backward-compat alias: showDirContents (v2-stable) maps to dirListing.enabled.
    // The alias may be removed in a future major version. Emits a one-time deprecation
    // warning per process. Throws if both names are passed (the user picked one of them
    // by mistake — surface the conflict rather than silently choosing one).
    let aliasEnabled; // undefined unless showDirContents was passed
    if (opts.showDirContents !== undefined) {
        if (userDirListing && userDirListing.enabled !== undefined) {
            throw new Error(
                '[koa-classic-server] options.showDirContents and options.dirListing.enabled are both set.\n' +
                '  These configure the same thing — pick one.'
            );
        }
        if (!_showDirContentsDeprecationWarned) {
            _showDirContentsDeprecationWarned = true;
            _logger.warn(...warnPayload(_logger,
                '[koa-classic-server] DEPRECATION: options.showDirContents was renamed to dirListing.enabled in v3.0.0.\n' +
                '  The old name is currently accepted as an alias and may be removed in a future major version.\n' +
                `  Replace with: dirListing: { enabled: ${opts.showDirContents} }`
            ));
        }
        aliasEnabled = !!opts.showDirContents;
    }

    options.dirListing = {
        enabled: userDirListing && userDirListing.enabled !== undefined
            ? !!userDirListing.enabled
            : (aliasEnabled !== undefined ? aliasEnabled : true),
        maxEntries: validateNonNegativeInt(
            userDirListing && userDirListing.maxEntries,
            'dirListing.maxEntries',
            10000
        ),
        entriesPerPage: validateNonNegativeInt(
            userDirListing && userDirListing.entriesPerPage,
            'dirListing.entriesPerPage',
            100
        ),
    };

    // Normalize index option to array format
    if (typeof options.index === 'string') {
        if (options.index) {
            // v3.0.0: non-empty string format removed
            throw new Error(
                '[koa-classic-server] The "index" option no longer accepts a string in v3.0.0.\n' +
                `  Replace with: index: ["${options.index}"]`
            );
        }
        // Empty string → silently treat as no index (empty array)
        options.index = [];
    } else if (Array.isArray(options.index)) {
        // Already an array → validate elements are strings or RegExp
        options.index = options.index.filter(item =>
            typeof item === 'string' || item instanceof RegExp
        );
    } else {
        // Invalid type → default to empty array
        options.index = [];
    }

    options.urlPrefix = typeof options.urlPrefix === 'string' ? options.urlPrefix : "";
    const _urlPrefixParts = options.urlPrefix.split("/");
    options.urlsReserved = Array.isArray(options.urlsReserved) ? options.urlsReserved : [];
    options.template.render = (options.template.render === undefined || typeof options.template.render === 'function') ? options.template.render : undefined;
    options.template.ext = Array.isArray(options.template.ext) ? options.template.ext : [];

    if (options.template.renderTimeout === undefined) {
        options.template.renderTimeout = 30000;
    } else if (
        typeof options.template.renderTimeout !== 'number' ||
        !Number.isFinite(options.template.renderTimeout) ||
        options.template.renderTimeout < 0
    ) {
        throw new Error(
            '[koa-classic-server] template.renderTimeout must be a finite number >= 0 (ms). ' +
            'Use 0 to disable. Got: ' + String(options.template.renderTimeout)
        );
    }

    // v3.0.0: removed legacy option names — throw to surface the breaking change clearly
    if ('cacheMaxAge' in opts) {
        throw new Error(
            '[koa-classic-server] The "cacheMaxAge" option was removed in v3.0.0.\n' +
            '  Replace with: browserCacheMaxAge: ' + opts.cacheMaxAge
        );
    }
    if ('enableCaching' in opts) {
        throw new Error(
            '[koa-classic-server] The "enableCaching" option was removed in v3.0.0.\n' +
            '  Replace with: browserCacheEnabled: ' + opts.enableCaching
        );
    }

    options.browserCacheMaxAge = typeof options.browserCacheMaxAge === 'number' && options.browserCacheMaxAge >= 0 ? options.browserCacheMaxAge : 3600;
    options.browserCacheEnabled = typeof options.browserCacheEnabled === 'boolean' ? options.browserCacheEnabled : false;
    options.useOriginalUrl = typeof options.useOriginalUrl === 'boolean' ? options.useOriginalUrl : true;

    // Validate and normalize hideExtension option
    if (options.hideExtension !== undefined && options.hideExtension !== null) {
        if (typeof options.hideExtension !== 'object' || Array.isArray(options.hideExtension)) {
            throw new Error('[koa-classic-server] hideExtension must be an object with an "ext" property. Example: { ext: ".ejs" }');
        }
        if (!options.hideExtension.ext || typeof options.hideExtension.ext !== 'string') {
            throw new Error('[koa-classic-server] hideExtension.ext is required and must be a non-empty string. Example: { ext: ".ejs" }');
        }
        // Normalize ext: add leading dot if missing
        if (!options.hideExtension.ext.startsWith('.')) {
            _logger.warn(...warnPayload(_logger,
                '[koa-classic-server] WARNING: hideExtension.ext should start with a dot.\n' +
                `  Current usage: ext: "${options.hideExtension.ext}"\n` +
                `  Corrected to:  ext: ".${options.hideExtension.ext}"\n` +
                '  Please update your configuration.'
            ));
            options.hideExtension.ext = '.' + options.hideExtension.ext;
        }
        // Validate redirect code
        if (options.hideExtension.redirect !== undefined) {
            if (typeof options.hideExtension.redirect !== 'number') {
                throw new Error('[koa-classic-server] hideExtension.redirect must be a number (e.g. 301, 302). Got: ' + typeof options.hideExtension.redirect);
            }
        } else {
            options.hideExtension.redirect = 301;
        }
    }

    // Normalize and validate the hidden option into a clean internal structure.
    function normalizeHiddenConfig(hidden) {
        if (!hidden || typeof hidden !== 'object' || Array.isArray(hidden)) {
            return {
                dotFiles: { default: 'visible', whitelist: [], blacklist: [] },
                dotDirs:  { default: 'visible', whitelist: [], blacklist: [] },
                alwaysHide: []
            };
        }

        const filterPatternList = (arr) =>
            Array.isArray(arr)
                ? arr.filter(p => typeof p === 'string' || p instanceof RegExp)
                : [];

        function normalizeCategory(input, systemDefault, categoryName) {
            if (!input || typeof input !== 'object' || Array.isArray(input)) {
                return { default: systemDefault, whitelist: [], blacklist: [] };
            }
            if (input.default !== undefined && input.default !== 'hidden' && input.default !== 'visible') {
                throw new Error(
                    `[koa-classic-server] hidden.${categoryName}.default must be "hidden" or "visible". Got: "${input.default}"`
                );
            }
            return {
                default: input.default !== undefined ? input.default : systemDefault,
                whitelist: filterPatternList(input.whitelist),
                blacklist: filterPatternList(input.blacklist),
            };
        }

        return {
            dotFiles: normalizeCategory(hidden.dotFiles, 'visible', 'dotFiles'),
            dotDirs:  normalizeCategory(hidden.dotDirs,  'visible', 'dotDirs'),
            alwaysHide: filterPatternList(hidden.alwaysHide),
        };
    }

    const hiddenConfig = normalizeHiddenConfig(options.hidden);

    // Returns true if `value` matches any pattern in the list.
    // RegExp patterns are tested directly; string patterns go through `globMatch`.
    // Non-string non-RegExp entries are ignored (defensive — config validation should reject them).
    function matchesPatternList(value, patterns, globMatch) {
        for (const pattern of patterns) {
            if (pattern instanceof RegExp) {
                if (pattern.test(value)) return true;
            } else if (typeof pattern === 'string') {
                if (globMatch(value, pattern)) return true;
            }
        }
        return false;
    }

    // Match against a list using filename-glob semantics (case-sensitive, no path component).
    function matchesNameList(name, patterns) {
        return matchesPatternList(name, patterns, nameGlobMatch);
    }

    // Compiled-RegExp caches for glob patterns. Patterns come from `hidden.*` config and are
    // immutable after factory init, so memoization is bounded by the operator's config size
    // and avoids recompiling the same regex on every directory entry during a listing.
    const _nameGlobRegexCache = new Map();
    const _pathGlobRegexCache = new Map();

    // Matches a bare filename against a simple glob pattern (* = any chars except /, ? = one char).
    function nameGlobMatch(name, pattern) {
        if (!pattern.includes('*') && !pattern.includes('?')) {
            return name === pattern;
        }
        let re = _nameGlobRegexCache.get(pattern);
        if (re === undefined) {
            const regexStr = '^' +
                pattern
                    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                    .replace(/\*/g, '[^/]*')
                    .replace(/\?/g, '[^/]')
                + '$';
            re = new RegExp(regexStr);
            _nameGlobRegexCache.set(pattern, re);
        }
        return re.test(name);
    }

    // Match against a list using path-aware glob semantics (anchored to rootDir, supports **).
    function matchesPathList(relPath, patterns) {
        return matchesPatternList(relPath, patterns, pathGlobMatch);
    }

    /**
     * Matches a relative path against a glob pattern (path-aware).
     *   - Pattern without '/': matches the basename at any depth  (e.g. '*.secret')
     *   - Pattern with '/':    anchored to rootDir               (e.g. 'config/secrets/**')
     *   - '*'  matches any characters except '/'
     *   - '**' matches any characters including '/'
     *   - '?'  matches any single character except '/'
     */
    function pathGlobMatch(relPath, pattern) {
        let re = _pathGlobRegexCache.get(pattern);
        if (re === undefined) {
            const hasSlash = pattern.includes('/');
            const escaped = pattern
                .replace(/[.+^${}()|[\]\\]/g, '\\$&')
                .replace(/\*\*/g, '\x00')
                .replace(/\*/g, '[^/]*')
                .replace(/\?/g, '[^/]')
                .replace(/\x00/g, '.*');

            const regexStr = hasSlash
                ? '^' + escaped + '($|/)'    // path-anchored from root
                : '(^|/)' + escaped + '$';   // basename match at any depth

            re = new RegExp(regexStr);
            _pathGlobRegexCache.set(pattern, re);
        }
        return re.test(relPath);
    }

    /**
     * Returns true if a filesystem entry should be hidden (blocked from listing and serving).
     *
     * Priority (highest to lowest):
     *   1. blacklist  (dotFiles/dotDirs) — always hidden, beats everything
     *   2. whitelist  (dotFiles/dotDirs) — always visible, overrides alwaysHide and default
     *   3. alwaysHide                    — path-aware, overrides default
     *   4. default    (dotFiles/dotDirs) — 'hidden' or 'visible' for unmatched dot-entries
     *
     * Non-dot entries are only affected by alwaysHide.
     *
     * @param {string}  name    - Basename of the file or directory
     * @param {string}  relPath - Relative path from rootDir (e.g. "subdir/.env")
     * @param {boolean} isDir   - True if the entry is a directory
     */
    function isHiddenEntry(name, relPath, isDir) {
        const isDot = name.startsWith('.');

        if (isDot) {
            const category = isDir ? hiddenConfig.dotDirs : hiddenConfig.dotFiles;

            if (matchesNameList(name, category.blacklist)) return true;
            if (matchesNameList(name, category.whitelist)) return false;
            if (matchesPathList(relPath, hiddenConfig.alwaysHide)) return true;

            return category.default === 'hidden';
        }

        return matchesPathList(relPath, hiddenConfig.alwaysHide);
    }

    /**
     * Returns true if dirent is a regular file or a symlink pointing to a regular file.
     * Uses fs.promises.stat (which follows symlinks) when dirent.isSymbolicLink() is true,
     * or when the dirent type is unknown (DT_UNKNOWN / type 0).
     *
     * DT_UNKNOWN occurs on overlayfs, NFS, FUSE, NixOS buildFHSEnv, ecryptfs,
     * and any filesystem that doesn't fill d_type in the kernel's getdents64 syscall.
     * On standard filesystems (ext4, btrfs, xfs, APFS, NTFS), d_type is always
     * filled correctly, so the stat() fallback is never reached.
     */
    async function isFileOrSymlinkToFile(dirent, dirPath) {
        if (dirent.isFile()) return true;
        if (dirent.isSymbolicLink()) {
            try {
                const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
                return realStat.isFile();
            } catch {
                return false; // Broken or circular symlink
            }
        }
        // DT_UNKNOWN fallback: when none of the type methods return true,
        // the filesystem didn't report d_type — resolve via stat()
        if (!dirent.isDirectory() && !dirent.isBlockDevice() && !dirent.isCharacterDevice() && !dirent.isFIFO() && !dirent.isSocket()) {
            try {
                const realStat = await fs.promises.stat(path.join(dirPath, dirent.name));
                return realStat.isFile();
            } catch {
                return false;
            }
        }
        return false;
    }

    // Normalize and validate the compression option into a clean internal structure.
    // compression: false is a valid shorthand for { enabled: false }.
    function normalizeCompressionConfig(compression) {
        if (compression === false) return { enabled: false };

        if (!compression || typeof compression !== 'object' || Array.isArray(compression)) {
            return {
                enabled: true,
                encodings: ['br', 'gzip'],              // priority order: brotli first, gzip as fallback
                minFileSize: 1024,                      // bytes; skip compression for files smaller than this
                mimeTypes: new Set(DEFAULT_COMPRESSIBLE_MIME_TYPES),
            };
        }

        // V3 breaking-change guard: catch the v2-alpha name minSize with a helpful migration hint.
        if (compression.minSize !== undefined) {
            throw new Error(
                '[koa-classic-server] options.compression.minSize was renamed in v3.0.0.\n' +
                `  Replace with: compression: { minFileSize: ${compression.minSize} }`
            );
        }

        const enabled = typeof compression.enabled === 'boolean' ? compression.enabled : true;
        if (!enabled) return { enabled: false };

        const encodings = Array.isArray(compression.encodings)
            ? compression.encodings.filter(e => e === 'br' || e === 'gzip')
            : ['br', 'gzip'];

        const minFileSize = compression.minFileSize === false ? false
            : (typeof compression.minFileSize === 'number' && compression.minFileSize >= 0 ? compression.minFileSize : 1024);

        const mimeTypes = Array.isArray(compression.mimeTypes) && compression.mimeTypes.length > 0
            ? compression.mimeTypes
            : DEFAULT_COMPRESSIBLE_MIME_TYPES;

        return { enabled, encodings, minFileSize, mimeTypes: new Set(mimeTypes) };
    }

    // Normalize and validate the serverCache option into a clean internal structure.
    function normalizeServerCacheConfig(serverCache) {
        const defaultRawFile = {
            enabled: false,
            maxSize: 52428800,      // 50 MB
            maxFileSize: 1048576,   // 1 MB
            maxAge: 0,
            warnInterval: 60000,
        };
        const defaultCompressedFile = {
            enabled: true,
            maxSize: 104857600,     // 100 MB
            maxAge: 0,
            warnInterval: 60000,
        };

        function validateMaxAge(value, cacheName) {
            if (value === undefined) return 0;
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
                throw new Error(
                    `[koa-classic-server] serverCache.${cacheName}.maxAge must be a finite number >= 0 (ms). ` +
                    'Use 0 to disable. Got: ' + String(value)
                );
            }
            return value;
        }

        if (!serverCache || typeof serverCache !== 'object' || Array.isArray(serverCache)) {
            return { rawFile: defaultRawFile, compressedFile: defaultCompressedFile };
        }

        const rf = serverCache.rawFile;
        const rawFile = (!rf || typeof rf !== 'object' || Array.isArray(rf)) ? defaultRawFile : {
            enabled: typeof rf.enabled === 'boolean' ? rf.enabled : false,
            maxSize: typeof rf.maxSize === 'number' && rf.maxSize > 0 ? rf.maxSize : 52428800,
            maxFileSize: typeof rf.maxFileSize === 'number' && rf.maxFileSize > 0 ? rf.maxFileSize : 1048576,
            maxAge: validateMaxAge(rf.maxAge, 'rawFile'),
            warnInterval: rf.warnInterval === false ? false : (typeof rf.warnInterval === 'number' ? rf.warnInterval : 60000),
        };

        const cf = serverCache.compressedFile;
        const compressedFile = (!cf || typeof cf !== 'object' || Array.isArray(cf)) ? defaultCompressedFile : {
            enabled: typeof cf.enabled === 'boolean' ? cf.enabled : true,
            maxSize: typeof cf.maxSize === 'number' && cf.maxSize > 0 ? cf.maxSize : 104857600,
            maxAge: validateMaxAge(cf.maxAge, 'compressedFile'),
            warnInterval: cf.warnInterval === false ? false : (typeof cf.warnInterval === 'number' ? cf.warnInterval : 60000),
        };

        return { rawFile, compressedFile };
    }

    const compressionConfig = normalizeCompressionConfig(options.compression);
    const serverCacheConfig = normalizeServerCacheConfig(options.serverCache);

    // In-memory LFU cache for raw file buffers (serverCache.rawFile).
    // Key: absoluteFilePath — O(1) eviction via frequency-bucket structure.
    const _rawFileCache = new LFUCache(
        serverCacheConfig.rawFile.maxSize,
        serverCacheConfig.rawFile.warnInterval,
        'rawFile',
        _logger
    );

    // In-memory LFU cache for compressed file buffers (serverCache.compressedFile).
    // Key: `${absoluteFilePath}:${encoding}` — O(1) eviction via frequency-bucket structure.
    const _compressedFileCache = new LFUCache(
        serverCacheConfig.compressedFile.maxSize,
        serverCacheConfig.compressedFile.warnInterval,
        'compressedFile',
        _logger
    );

    // Returns the client's preferred encoding based on Accept-Encoding header,
    // filtered against the enabled encodings list. Returns null if no match.
    function getClientEncoding(acceptEncoding) {
        if (!acceptEncoding) return null;
        for (const enc of compressionConfig.encodings) {
            if (acceptEncoding.includes(enc)) return enc;
        }
        return null;
    }

    // Compress a Buffer using the given encoding ('br' or 'gzip').
    // Uses maximum quality — appropriate for serverCache mode (cost paid once).
    function compressBuffer(data, encoding) {
        return new Promise((resolve, reject) => {
            if (encoding === 'br') {
                zlib.brotliCompress(
                    data,
                    { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } },
                    (err, result) => { if (err) reject(err); else resolve(result); }
                );
            } else {
                zlib.gzip(
                    data,
                    { level: zlib.constants.Z_BEST_COMPRESSION },
                    (err, result) => { if (err) reject(err); else resolve(result); }
                );
            }
        });
    }

    /**
     * Build a Content-Disposition header value for inline serving.
     *
     * Uses both the legacy quoted-string form (ASCII fallback) and the RFC 5987
     * extended form (UTF-8 percent-encoded) for maximum browser compatibility:
     *   inline; filename="ascii-safe"; filename*=UTF-8''percent-encoded
     *
     * The quoted-string form escapes only double-quotes; the RFC 5987 form
     * percent-encodes every byte that is not an unreserved URI character.
     * Browsers that support filename* prefer it over filename (RFC 6266 §4.1).
     */
    function buildContentDisposition(filename) {
        // quoted-string fallback: escape " and \ so the value is always valid ASCII
        const asciiSafe = filename.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

        // RFC 5987 extended value: UTF-8 percent-encode everything except
        // unreserved chars (ALPHA / DIGIT / "-" / "." / "_" / "~")
        const rfc5987 = encodeURIComponent(filename)
            .replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

        return `inline; filename="${asciiSafe}"; filename*=UTF-8''${rfc5987}`;
    }

    // Find the first matching index file in a directory.
    // Fast-path: string patterns use a direct stat() — no readdir needed.
    // Slow-path: RegExp patterns trigger a single lazy readdir(), shared across
    // all RegExp patterns in the array.
    async function findIndexFile(dirPath, indexPatterns) {
        let fileNames = null; // populated lazily on first RegExp pattern

        for (const pattern of indexPatterns) {
            if (typeof pattern === 'string') {
                // Fast path: stat directly, zero readdir
                try {
                    const fileStat = await fs.promises.stat(path.join(dirPath, pattern));
                    if (fileStat.isFile()) return { name: pattern, stat: fileStat };
                } catch {
                    continue; // file doesn't exist, try next pattern
                }
            } else if (pattern instanceof RegExp) {
                // Slow path: readdir once (lazy), reused for subsequent RegExp patterns
                if (!fileNames) {
                    try {
                        const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });
                        const checkResults = await Promise.all(
                            dirents.map(async dirent => ({
                                name: dirent.name,
                                isFile: await isFileOrSymlinkToFile(dirent, dirPath)
                            }))
                        );
                        fileNames = checkResults.filter(e => e.isFile).map(e => e.name);
                    } catch (error) {
                        _logger.error('Error finding index file:', error);
                        return null;
                    }
                }
                const matchedFile = fileNames.find(name => pattern.test(name));
                if (matchedFile) {
                    try {
                        const fileStat = await fs.promises.stat(path.join(dirPath, matchedFile));
                        if (fileStat.isFile()) return { name: matchedFile, stat: fileStat };
                    } catch {
                        continue; // file deleted between readdir and stat
                    }
                }
            }
        }
        return null;
    }

    return async (ctx, next) => {
        if (!options.method.includes(ctx.method)) {
            await next();
            return;
        }

        // Construct full URL based on useOriginalUrl option
        const urlToUse = options.useOriginalUrl ? ctx.originalUrl : ctx.url;
        const _origin  = ctx.protocol + '://' + ctx.host;
        const fullUrl  = _origin + urlToUse;
        let pageHref = '';
        if (fullUrl.charAt(fullUrl.length - 1) === '/') {
            pageHref = new URL(fullUrl.slice(0, -1));
        } else {
            pageHref = new URL(fullUrl);
        }

        // Check URL prefix
        const a_pathname = pageHref.pathname.split("/");

        for (let i = 0; i < _urlPrefixParts.length; i++) {
            if (_urlPrefixParts[i] !== a_pathname[i]) {
                await next();
                return;
            }
        }

        // Create pageHrefOutPrefix without URL prefix
        let pageHrefOutPrefix = pageHref;
        if (options.urlPrefix !== "") {
            let a_pathnameOutPrefix = a_pathname.slice(_urlPrefixParts.length);
            let s_pathnameOutPrefix = a_pathnameOutPrefix.join("/");
            let hrefOutPrefix = pageHref.origin + '/' + s_pathnameOutPrefix;
            pageHrefOutPrefix = new URL(hrefOutPrefix);
        }

        // Check reserved URLs (first level only)
        if (Array.isArray(options.urlsReserved) && options.urlsReserved.length > 0) {
            const a_pathnameOutPrefix = pageHrefOutPrefix.pathname.split("/");
            for (const value of options.urlsReserved) {
                if (a_pathnameOutPrefix[1] === value.substring(1)) {
                    await next();
                    return;
                }
            }
        }

        // Path traversal protection: build and validate safe file path
        let requestedPath = "";
        if (pageHrefOutPrefix.pathname === "/") {
            requestedPath = "";
        } else {
            requestedPath = decodeURIComponent(pageHrefOutPrefix.pathname);
        }

        // Null byte guard: path.normalize() throws ERR_INVALID_ARG_VALUE for paths
        // containing \0. Reject early with 400 Bad Request before it reaches fs calls.
        if (requestedPath.includes('\0')) {
            ctx.status = 400;
            ctx.body = 'Bad Request';
            return;
        }

        const normalizedPath = path.normalize(requestedPath);
        const fullPath = path.join(normalizedRootDir, normalizedPath);

        // Security check: ensure resolved path is within rootDir.
        // Covers: ../ traversal, URL-encoded variants (%2e%2e%2f), and on Windows
        // backslash sequences (path.normalize converts \ to / before the check).
        if (!fullPath.startsWith(normalizedRootDir)) {
            ctx.status = 403;
            ctx.body = 'Forbidden';
            return;
        }

        // Hidden check: block requests that traverse a hidden directory
        if (requestedPath !== '') {
            const segments = normalizedPath.split(path.sep).filter(Boolean);
            for (let i = 0; i < segments.length - 1; i++) {
                const segName = segments[i];
                const segRelPath = segments.slice(0, i + 1).join('/');
                if (isHiddenEntry(segName, segRelPath, true)) {
                    sendNotFound(ctx);
                    return;
                }
            }
        }

        let toOpen = fullPath;

        // hideExtension logic: redirect URLs with extension and resolve clean URLs
        if (options.hideExtension) {
            const hideExt = options.hideExtension.ext;
            const hideRedirect = options.hideExtension.redirect;

            // Trailing slash check via string — avoids a full new URL() construction
            const rawPath = urlToUse.split('?')[0];
            const hadTrailingSlash = rawPath.length > 1 && rawPath.endsWith('/');

            // Check if URL ends with the configured extension → redirect to clean URL
            // Use the original path (before trailing slash stripping) for accurate matching
            const pathForExtCheck = hadTrailingSlash ? rawPath.slice(0, -1) : requestedPath;
            if (pathForExtCheck.endsWith(hideExt)) {
                // Build redirect target using ctx.originalUrl (always, regardless of useOriginalUrl)
                const originalUrlObj = new URL(_origin + ctx.originalUrl);
                let redirectPath = originalUrlObj.pathname;

                redirectPath = redirectPath.slice(0, redirectPath.length - hideExt.length);

                // Special case: /index.ejs → /, /sezione/index.ejs → /sezione/
                const baseName = path.basename(redirectPath);
                // Check if the remaining path points to an index file
                if (options.index && options.index.length > 0) {
                    for (const pattern of options.index) {
                        if (typeof pattern === 'string' && (baseName + hideExt) === pattern) {
                            // Redirect to the directory (with trailing slash)
                            redirectPath = redirectPath.slice(0, redirectPath.length - baseName.length);
                            break;
                        }
                    }
                }

                // Preserve query string
                const redirectUrl = redirectPath + (originalUrlObj.search || '');

                ctx.status = hideRedirect;
                ctx.redirect(redirectUrl);
                return;
            }

            // Check if URL has no extension → try adding the configured extension
            // Skip if original URL had trailing slash (trailing slash = directory intent)
            const extOfRequested = path.extname(requestedPath);
            if (!extOfRequested && requestedPath !== '' && !requestedPath.endsWith('/') && !hadTrailingSlash) {
                const pathWithExt = fullPath + hideExt;

                // Security check: ensure resolved path is still within rootDir
                if (pathWithExt.startsWith(normalizedRootDir)) {
                    try {
                        const statWithExt = await fs.promises.stat(pathWithExt);
                        if (statWithExt.isFile()) {
                            // File with extension exists, serve it
                            toOpen = pathWithExt;
                        }
                    } catch {
                        // File with extension doesn't exist, continue normal flow
                    }
                }
            }
        }

        // Check if path exists
        let stat;
        try {
            stat = await fs.promises.stat(toOpen);
        } catch {
            // File/directory doesn't exist or can't be accessed
            sendNotFound(ctx);
            return;
        }

        // Hidden check: block access to the requested file or directory itself
        if (requestedPath !== '') {
            const entryName = path.basename(toOpen);
            const entryRelPath = path.relative(normalizedRootDir, toOpen).split(path.sep).join('/');
            if (isHiddenEntry(entryName, entryRelPath, stat.isDirectory())) {
                sendNotFound(ctx);
                return;
            }
        }

        if (stat.isDirectory()) {
            // Handle directory
            if (options.dirListing.enabled) {
                // Search for index file matching configured patterns
                if (options.index && options.index.length > 0) {
                    const indexFile = await findIndexFile(toOpen, options.index);
                    if (indexFile) {
                        const indexRelPath = path.relative(normalizedRootDir, path.join(toOpen, indexFile.name)).split(path.sep).join('/');
                        if (!isHiddenEntry(indexFile.name, indexRelPath, false)) {
                            const indexPath = path.join(toOpen, indexFile.name);
                            await loadFile(indexPath, indexFile.stat);
                            return;
                        }
                    }
                }

                // No index file found, show directory listing
                ctx.body = await show_dir(toOpen, ctx);
            } else {
                // Directory listing disabled
                sendNotFound(ctx);
            }
            return;
        } else {
            await loadFile(toOpen, stat);
            return;
        }

        // Internal functions

        // Accepts a pre-fetched stat to avoid a redundant stat call
        async function loadFile(toOpen, fileStat) {
            // Get file stat if not provided
            if (!fileStat) {
                try {
                    fileStat = await fs.promises.stat(toOpen);
                } catch (error) {
                    _logger.error('File stat error:', error);
                    sendNotFound(ctx);
                    return;
                }
            }

            // Populate rawFile cache (before template check so buffer is available as 4th param to render).
            // Only for files within maxFileSize; large files are always streamed.
            let rawBuffer = null;
            if (serverCacheConfig.rawFile.enabled && fileStat.size <= serverCacheConfig.rawFile.maxFileSize) {
                const cached = _rawFileCache.peek(toOpen);
                const maxAge = serverCacheConfig.rawFile.maxAge;
                const staleByAge = maxAge > 0 && cached && (Date.now() - cached.insertedAt) >= maxAge;
                const fresh = cached
                    && cached.mtime === fileStat.mtime.getTime()
                    && cached.size === fileStat.size
                    && !staleByAge;
                if (fresh) {
                    _rawFileCache.get(toOpen); // increment frequency
                    rawBuffer = cached.buffer;
                } else {
                    try {
                        rawBuffer = await fs.promises.readFile(toOpen);
                        refreshOrInsert(_rawFileCache, toOpen, {
                            buffer: rawBuffer,
                            mtime: fileStat.mtime.getTime(),
                            size: fileStat.size,
                            insertedAt: Date.now(),
                        }, cached, staleByAge);
                    } catch {
                        rawBuffer = null; // Fall through to disk reads later
                    }
                }
            }

            if (await tryRenderTemplate(ctx, next, toOpen, rawBuffer, options.template, _logger)) {
                return;
            }

            // baseEtag — encoding-independent; used only for If-Range (Range requests skip compression)
            const baseEtag = `"${fileStat.mtime.getTime()}-${fileStat.size}"`;

            // Advertise range support on all file responses (including 304)
            ctx.set('Accept-Ranges', 'bytes');

            // Cache-Control set early — applies to all responses (200, 206, 304)
            if (options.browserCacheEnabled) {
                ctx.set('Cache-Control', `public, max-age=${options.browserCacheMaxAge}, must-revalidate`);
            } else {
                // Explicitly disable caching: without these headers browsers may use heuristic caching
                ctx.set('Cache-Control', 'no-cache, no-store, must-revalidate');
                ctx.set('Pragma', 'no-cache'); // HTTP 1.0 compatibility
                ctx.set('Expires', '0');       // Proxies
            }

            // Verify file is still readable (race condition protection).
            // Skip if rawBuffer already loaded — the successful readFile() is equivalent proof.
            if (!rawBuffer) {
                try {
                    await fs.promises.access(toOpen, fs.constants.R_OK);
                } catch (error) {
                    _logger.error('File access error:', error);
                    sendNotFound(ctx);
                    return;
                }
            }

            // Range request handling (HTTP 206 Partial Content — compression skipped for ranges)
            const rangeHeader = ctx.get('Range');
            if (rangeHeader) {
                const fileSize = fileStat.size;
                const parsed = parseRangeHeader(rangeHeader, fileSize);

                if (parsed === 'unsatisfiable') {
                    ctx.status = 416;
                    ctx.set('Content-Range', `bytes */${fileSize}`);
                    ctx.body = '';
                    return;
                }

                if (parsed !== 'invalid') {
                    // Honor If-Range: serve range only when baseEtag matches (or If-Range absent)
                    const ifRange = ctx.get('If-Range');
                    if (!ifRange || ifRange === baseEtag) {
                        const { start, end } = parsed;
                        const rangeLength = end - start + 1;
                        const mimeType = mime.lookup(toOpen) || 'application/octet-stream';
                        const filename = path.basename(toOpen);

                        ctx.status = 206;
                        ctx.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                        ctx.set('Content-Type', mimeType);
                        ctx.set('Content-Length', String(rangeLength));
                        ctx.set('Content-Disposition', buildContentDisposition(filename));

                        if (ctx.method !== 'HEAD') {
                            if (rawBuffer) {
                                // Serve range slice from in-memory buffer — zero disk I/O
                                ctx.body = rawBuffer.slice(start, end + 1);
                            } else {
                                const src = fs.createReadStream(toOpen, { start, end });
                                src.on('error', (err) => {
                                    _logger.error('Stream error:', err);
                                    if (!ctx.headerSent) {
                                        ctx.status = 500;
                                        ctx.body = 'Error reading file';
                                    }
                                });
                                ctx.body = src;
                            }
                        } else {
                            // HEAD: send 206 headers only — body assignment resets Content-Length,
                            // so we restore it afterwards.
                            ctx.body = Buffer.alloc(0);
                            ctx.set('Content-Length', String(rangeLength));
                        }
                        return;
                    }
                    // If-Range mismatch → fall through to full 200 response
                }
                // Invalid Range → fall through to full 200 response
            }

            // Determine MIME type and compression encoding for the full-file response
            const mimeType = mime.lookup(toOpen) || 'application/octet-stream';
            const filename = path.basename(toOpen);

            // Resolve compression: enabled + compressible MIME + meets minFileSize + client supports it
            let encoding = null; // 'br' | 'gzip' | null
            if (compressionConfig.enabled && compressionConfig.encodings.length > 0) {
                const isCompressibleMime = compressionConfig.mimeTypes.has(mimeType);
                const meetsMinSize = compressionConfig.minFileSize === false
                    || fileStat.size >= compressionConfig.minFileSize;
                if (isCompressibleMime && meetsMinSize) {
                    encoding = getClientEncoding(ctx.get('Accept-Encoding'));
                }
            }

            // fullEtag is encoding-specific to avoid false 304 hits across representations.
            // Proxies use Vary: Accept-Encoding to cache separate versions per encoding.
            const etagSuffix = encoding === 'br' ? '-br' : encoding === 'gzip' ? '-gz' : '';
            const fullEtag = `"${fileStat.mtime.getTime()}-${fileStat.size}${etagSuffix}"`;

            // ETag, Last-Modified, and 304 check — deferred until encoding is known
            if (options.browserCacheEnabled) {
                ctx.set('ETag', fullEtag);
                ctx.set('Last-Modified', fileStat.mtime.toUTCString());

                // Check If-None-Match (ETag validation)
                const clientEtag = ctx.get('If-None-Match');
                if (clientEtag && clientEtag === fullEtag) {
                    ctx.status = 304;
                    return;
                }

                // Check If-Modified-Since (date validation)
                const clientModifiedSince = ctx.get('If-Modified-Since');
                if (clientModifiedSince) {
                    const clientDate = new Date(clientModifiedSince);
                    if (fileStat.mtime.getTime() <= clientDate.getTime()) {
                        ctx.status = 304;
                        return;
                    }
                }
            }

            // Common response headers
            ctx.set('Content-Type', mimeType);
            ctx.set('Content-Disposition', buildContentDisposition(filename));

            if (encoding) {
                // ── Compressed response ───────────────────────────────────────────────
                ctx.set('Content-Encoding', encoding);
                ctx.set('Vary', 'Accept-Encoding'); // Required so proxies cache per-encoding

                if (serverCacheConfig.compressedFile.enabled) {
                    // compressedFile cache mode: compress once → buffer in RAM → Content-Length known
                    const cacheKey = `${toOpen}:${encoding}`;
                    const cached = _compressedFileCache.peek(cacheKey);
                    const maxAge = serverCacheConfig.compressedFile.maxAge;
                    const staleByAge = maxAge > 0 && cached && (Date.now() - cached.insertedAt) >= maxAge;
                    const stale = !cached
                        || cached.mtime !== fileStat.mtime.getTime()
                        || cached.size !== fileStat.size
                        || staleByAge;

                    let buf;
                    if (!stale) {
                        _compressedFileCache.get(cacheKey); // increment frequency
                        buf = cached.buffer; // Serve from cache
                    } else {
                        try {
                            // Use rawFile buffer if available — avoids redundant disk read
                            const rawData = rawBuffer || await fs.promises.readFile(toOpen);
                            buf = await compressBuffer(rawData, encoding);

                            refreshOrInsert(_compressedFileCache, cacheKey, {
                                buffer: buf,
                                mtime: fileStat.mtime.getTime(),
                                size: fileStat.size,
                                insertedAt: Date.now(),
                            }, cached, staleByAge);
                        } catch (err) {
                            _logger.error('Compression error:', err);
                            // Fall back to uncompressed on any compression failure
                            ctx.remove('Content-Encoding');
                            ctx.remove('Vary');
                            if (rawBuffer) {
                                ctx.set('Content-Length', String(rawBuffer.length));
                                if (ctx.method !== 'HEAD') {
                                    ctx.body = rawBuffer;
                                } else {
                                    ctx.body = Buffer.alloc(0);
                                    ctx.set('Content-Length', String(rawBuffer.length));
                                }
                            } else {
                                ctx.set('Content-Length', String(fileStat.size));
                                if (ctx.method !== 'HEAD') {
                                    const src = fs.createReadStream(toOpen);
                                    src.on('error', (streamErr) => {
                                        _logger.error('Stream error:', streamErr);
                                        if (!ctx.headerSent) { ctx.status = 500; ctx.body = 'Error reading file'; }
                                    });
                                    ctx.body = src;
                                } else {
                                    ctx.body = Buffer.alloc(0);
                                    ctx.set('Content-Length', String(fileStat.size));
                                }
                            }
                            return;
                        }
                    }

                    ctx.set('Content-Length', String(buf.length));
                    if (ctx.method !== 'HEAD') {
                        ctx.body = buf;
                    } else {
                        // HEAD: set correct Content-Length; body assignment would reset it, restore after
                        ctx.body = Buffer.alloc(0);
                        ctx.set('Content-Length', String(buf.length));
                    }

                } else {
                    // Streaming mode: pipe through zlib transform — Content-Length not known in advance
                    if (ctx.method !== 'HEAD') {
                        const compress = encoding === 'br'
                            ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
                            : zlib.createGzip({ level: 6 });
                        if (rawBuffer) {
                            // Compress from in-memory buffer — no disk I/O
                            const src = Readable.from(rawBuffer);
                            ctx.body = src.pipe(compress);
                        } else {
                            const src = fs.createReadStream(toOpen);
                            src.on('error', (err) => {
                                _logger.error('Stream error:', err);
                                if (!ctx.headerSent) { ctx.status = 500; ctx.body = 'Error reading file'; }
                            });
                            ctx.body = src.pipe(compress);
                        }
                    }
                    // HEAD + streaming: no Content-Length available; Koa sends headers only via res.end()
                }

            } else {
                // ── Uncompressed response ─────────────────────────────────────────────
                if (rawBuffer) {
                    // Serve directly from in-memory buffer — zero disk I/O
                    ctx.set('Content-Length', String(rawBuffer.length));
                    if (ctx.method !== 'HEAD') {
                        ctx.body = rawBuffer;
                    } else {
                        ctx.body = Buffer.alloc(0);
                        ctx.set('Content-Length', String(rawBuffer.length));
                    }
                } else {
                    ctx.set('Content-Length', String(fileStat.size));
                    if (ctx.method !== 'HEAD') {
                        const src = fs.createReadStream(toOpen);
                        src.on('error', (err) => {
                            _logger.error('Stream error:', err);
                            if (!ctx.headerSent) { ctx.status = 500; ctx.body = 'Error reading file'; }
                        });
                        ctx.body = src;
                    } else {
                        // HEAD: body assignment resets Content-Length — restore after
                        ctx.body = Buffer.alloc(0);
                        ctx.set('Content-Length', String(fileStat.size));
                    }
                }
            }
        }


        async function show_dir(toOpen, ctx) {
            // Read the full directory in one syscall, then cap the result.
            // `dirListing.maxEntries` bounds the visible / sorted / stat'd entries, but
            // does NOT bound the size of the initial readdir() allocation — see the
            // adversarial-directory caveat tracked for v3.1 [F-1].
            const maxDirEntries = options.dirListing.maxEntries; // 0 = disabled (no cap)
            let dir;
            let truncated = false;
            try {
                const all = await fs.promises.readdir(toOpen, { withFileTypes: true });
                if (maxDirEntries > 0 && all.length > maxDirEntries) {
                    truncated = true;
                    dir = all.slice(0, maxDirEntries);
                } else {
                    dir = all;
                }
            } catch (error) {
                _logger.error('Directory read error:', error);
                ctx.status = 500;
                setGeneratedPageHeaders(ctx, NOT_FOUND_CSP);
                return `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Error</title>
                    </head>
                    <body>
                        <h1>Error Reading Directory</h1>
                        <p>Unable to access directory contents.</p>
                    </body>
                    </html>
                `;
            }

            // Relative path of this directory from rootDir (used for alwaysHide path matching)
            const rawDirRel = path.relative(normalizedRootDir, toOpen);
            const dirRelPath = (rawDirRel === '' || rawDirRel === '.') ? '' : rawDirRel.split(path.sep).join('/');

            // Get sorting parameters from query string
            const sortBy = ctx.query.sort || 'name';
            const sortOrder = ctx.query.order || 'asc';

            // Build base URL for sorting links (without query params)
            const baseUrl = pageHrefOutPrefix.pathname;

            // Preserves sort/order while overriding `page`; omits page when 0.
            function buildQueryUrl(targetPage) {
                const params = [];
                if (ctx.query.sort)  params.push(`sort=${encodeURIComponent(ctx.query.sort)}`);
                if (ctx.query.order) params.push(`order=${encodeURIComponent(ctx.query.order)}`);
                if (targetPage > 0)  params.push(`page=${targetPage}`);
                return params.length ? `${baseUrl}?${params.join('&')}` : baseUrl;
            }

            // Helper to create sorting URL
            function getSortUrl(column) {
                let newOrder = 'asc';
                if (sortBy === column && sortOrder === 'asc') {
                    newOrder = 'desc';
                }
                return `${baseUrl}?sort=${column}&order=${newOrder}`;
            }

            // Helper to get sort indicator
            function getSortIndicator(column) {
                if (sortBy === column) {
                    return sortOrder === 'asc' ? ' ↑' : ' ↓';
                }
                return '';
            }

            const parts = [];
            let totalPages = 1;     // populated in the non-empty branch below
            let currentPage = 0;
            if (truncated) {
                parts.push(`<div class="kcs-banner">⚠ Showing first ${maxDirEntries} entries (cap reached). More files exist but are not listed. Adjust <code>dirListing.maxEntries</code> to see more.</div>`);
                ctx.set('X-Dir-Truncated', `${maxDirEntries}`);
            }
            parts.push("<table>");
            parts.push("<thead>");
            parts.push("<tr>");
            parts.push(`<th><a href="${escapeHtml(getSortUrl('name'))}">Name${getSortIndicator('name')}</a></th>`);
            parts.push(`<th><a href="${escapeHtml(getSortUrl('type'))}">Type${getSortIndicator('type')}</a></th>`);
            parts.push(`<th><a href="${escapeHtml(getSortUrl('size'))}">Size${getSortIndicator('size')}</a></th>`);
            parts.push("</tr>");
            parts.push("</thead>");
            parts.push("<tbody>");

            // Parent directory link
            const currentPath = pageHref.origin + pageHref.pathname;
            if (currentPath !== pageHrefOutPrefix.origin + "/") {
                // Build parent directory URL without query parameters
                const a_pD = currentPath.split("/");
                a_pD.pop();
                const parentDirectory = a_pD.join("/");
                // Escape HTML to prevent XSS
                parts.push(`<tr><td><a href="${escapeHtml(parentDirectory)}"><b>.. Parent Directory</b></a></td><td>DIR</td><td>-</td></tr>`);
            }

            if (dir.length === 0) {
                parts.push(`<tr><td>empty folder</td><td></td><td></td></tr>`);
            } else {
                const _listingBaseUrl = pageHref.origin + pageHref.pathname;
                const _listingOriginPrefix = pageHref.origin + options.urlPrefix;

                // Collect item data with stat I/O in parallel (batched to avoid
                // overwhelming the filesystem on very large directories).
                const BATCH_SIZE = 64;
                const rawItems = [];
                for (let bi = 0; bi < dir.length; bi += BATCH_SIZE) {
                    const batch = await Promise.all(
                        dir.slice(bi, bi + BATCH_SIZE).map(async (item) => {
                            const s_name = item.name.toString();
                            const type = getDirentType(item);
                            const itemPath = path.join(toOpen, s_name);

                            // Build item URI without query parameters
                            let itemUri;
                            if (_listingBaseUrl === _listingOriginPrefix + "/" || _listingBaseUrl === _listingOriginPrefix) {
                                itemUri = `${_listingOriginPrefix}/${encodeURIComponent(s_name)}`;
                            } else {
                                itemUri = `${_listingBaseUrl}/${encodeURIComponent(s_name)}`;
                            }

                            // Resolve symlinks and DT_UNKNOWN entries to their effective type.
                            // cachedStat is reused below to avoid a second stat() on the same path.
                            let effectiveType = type;
                            let isBrokenSymlink = false;
                            let cachedStat = null;
                            if (type === 3 || type === 0) {
                                // type 3 = symlink, type 0 = DT_UNKNOWN (overlayfs, NFS, FUSE, NixOS buildFHSEnv, ecryptfs)
                                try {
                                    cachedStat = await fs.promises.stat(itemPath);
                                    if (cachedStat.isFile()) effectiveType = 1;
                                    else if (cachedStat.isDirectory()) effectiveType = 2;
                                } catch {
                                    if (type === 3) {
                                        isBrokenSymlink = true; // Broken or circular symlink
                                    } else {
                                        return null; // DT_UNKNOWN entry that can't be stat'd — skip it
                                    }
                                }
                            }

                            // Hidden check: skip entries that should not appear in directory listing
                            const itemIsDir = effectiveType === 2;
                            const itemRelPath = dirRelPath ? dirRelPath + '/' + s_name : s_name;
                            if (isHiddenEntry(s_name, itemRelPath, itemIsDir)) return null;

                            // Get file size — reuse cachedStat if already available (avoids double stat for symlinks)
                            let sizeStr = '-';
                            let sizeBytes = 0;
                            if (!isBrokenSymlink) {
                                try {
                                    const itemStat = cachedStat || await fs.promises.stat(itemPath);
                                    if (effectiveType === 1) {
                                        sizeBytes = itemStat.size;
                                        sizeStr = formatSize(sizeBytes);
                                    }
                                } catch {
                                    sizeStr = '-';
                                }
                            }

                            const mimeType = effectiveType === 2 ? "DIR" : (mime.lookup(itemPath) || 'unknown');
                            const isReserved = pageHrefOutPrefix.pathname === '/' && options.urlsReserved.includes('/' + s_name) && (effectiveType === 2 || type === 3);

                            return {
                                name: s_name,
                                type,
                                effectiveType,
                                isSymlink: type === 3,
                                isBrokenSymlink,
                                mimeType,
                                sizeStr,
                                sizeBytes,
                                itemUri,
                                isReserved
                            };
                        })
                    );
                    rawItems.push(...batch);
                }
                const items = rawItems.filter(Boolean);

                // Sort items based on query parameters
                items.sort((a, b) => {
                    let comparison = 0;

                    if (sortBy === 'name') {
                        comparison = a.name.localeCompare(b.name);
                    } else if (sortBy === 'type') {
                        // Sort directories first, then by mime type (using effectiveType for symlinks)
                        if (a.effectiveType === 2 && b.effectiveType !== 2) {
                            comparison = -1;
                        } else if (a.effectiveType !== 2 && b.effectiveType === 2) {
                            comparison = 1;
                        } else {
                            comparison = a.mimeType.localeCompare(b.mimeType);
                        }
                    } else if (sortBy === 'size') {
                        // Directories always at top when sorting by size (using effectiveType for symlinks)
                        if (a.effectiveType === 2 && b.effectiveType !== 2) {
                            comparison = -1;
                        } else if (a.effectiveType !== 2 && b.effectiveType === 2) {
                            comparison = 1;
                        } else {
                            comparison = a.sizeBytes - b.sizeBytes;
                        }
                    }

                    return sortOrder === 'desc' ? -comparison : comparison;
                });

                // Pagination — slice the sorted items into the requested page (0-based).
                const pageSize = options.dirListing.entriesPerPage; // 0 disables pagination
                totalPages = pageSize > 0 ? Math.max(1, Math.ceil(items.length / pageSize)) : 1;
                const rawPage = parseInt(ctx.query.page, 10);
                const requestedPage = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0;
                currentPage = Math.min(requestedPage, totalPages - 1); // silent clamp
                const visibleItems = (pageSize > 0 && items.length > pageSize)
                    ? items.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
                    : items;
                if (totalPages > 1) {
                    ctx.set('X-Dir-Pagination', `${currentPage}/${totalPages - 1}`);
                }

                // Generate HTML for sorted items
                for (const item of visibleItems) {
                    let rowStart = '';
                    if (item.effectiveType === 1) {
                        rowStart = `<tr><td> FILE `;
                    } else {
                        rowStart = `<tr><td>`;
                    }

                    // Symlink indicator label
                    const symlinkLabel = item.isBrokenSymlink
                        ? ' ( Broken Symlink )'
                        : item.isSymlink
                            ? ' ( Symlink )'
                            : '';

                    if (item.isReserved) {
                        parts.push(`${rowStart} ${escapeHtml(item.name)}${symlinkLabel}</td> <td> DIR BUT RESERVED</td><td>${item.sizeStr}</td></tr>`);
                    } else if (item.isBrokenSymlink) {
                        // Broken symlink: name visible but not clickable
                        parts.push(`${rowStart} ${escapeHtml(item.name)}${symlinkLabel}</td> <td> ${escapeHtml(item.mimeType)} </td><td>${item.sizeStr}</td></tr>`);
                    } else {
                        parts.push(`${rowStart} <a href="${escapeHtml(item.itemUri)}">${escapeHtml(item.name)}</a>${symlinkLabel} </td> <td> ${escapeHtml(item.mimeType)} </td><td>${item.sizeStr}</td></tr>`);
                    }
                }
            }

            parts.push("</tbody>");
            parts.push("</table>");

            // Numbered paginator with First/Prev/Next/Last and ellipsis around the current page.
            // Only emitted when pagination is meaningful (computed above; reuses currentPage/totalPages).
            if (totalPages > 1) {
                const pageWindow = 2;
                const pagesToShow = new Set([0, totalPages - 1]);
                for (let i = Math.max(0, currentPage - pageWindow); i <= Math.min(totalPages - 1, currentPage + pageWindow); i++) {
                    pagesToShow.add(i);
                }
                const sortedPages = [...pagesToShow].sort((a, b) => a - b);

                const pager = ['<nav class="kcs-pagination" aria-label="Pagination">'];
                if (currentPage > 0) {
                    pager.push(`<a href="${escapeHtml(buildQueryUrl(0))}">« First</a>`);
                    pager.push(`<a href="${escapeHtml(buildQueryUrl(currentPage - 1))}">‹ Prev</a>`);
                } else {
                    pager.push(`<span class="kcs-page-disabled">« First</span>`);
                    pager.push(`<span class="kcs-page-disabled">‹ Prev</span>`);
                }
                let prev = -1;
                for (const p of sortedPages) {
                    if (prev !== -1 && p - prev > 1) {
                        pager.push(`<span class="kcs-page-ellipsis">…</span>`);
                    }
                    if (p === currentPage) {
                        pager.push(`<span class="kcs-page-current">${p}</span>`);
                    } else {
                        pager.push(`<a href="${escapeHtml(buildQueryUrl(p))}">${p}</a>`);
                    }
                    prev = p;
                }
                if (currentPage < totalPages - 1) {
                    pager.push(`<a href="${escapeHtml(buildQueryUrl(currentPage + 1))}">Next ›</a>`);
                    pager.push(`<a href="${escapeHtml(buildQueryUrl(totalPages - 1))}">Last »</a>`);
                } else {
                    pager.push(`<span class="kcs-page-disabled">Next ›</span>`);
                    pager.push(`<span class="kcs-page-disabled">Last »</span>`);
                }
                pager.push('</nav>');
                parts.push(pager.join(''));
            }

            const tableHtml = parts.join('');

            const html = `
                        <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta http-equiv="X-UA-Compatible" content="IE=edge">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>Index of ${escapeHtml(pageHrefOutPrefix.pathname)}</title>
                        <style>${LISTING_CSS}</style>
                    </head>
                    <body>
                    <h1>Index of ${escapeHtml(pageHrefOutPrefix.pathname)}</h1>
                    ${tableHtml}
                    </body>
                    </html>
                `;

            setGeneratedPageHeaders(ctx, LISTING_CSP);
            return html;
        }

    };
};
