
const { URL } = require("url");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const util = require("util");
const mime = require("mime-types");
const { Readable, Transform, pipeline } = require('stream');

const _brotliCompressAsync = util.promisify(zlib.brotliCompress);
const _gzipAsync           = util.promisify(zlib.gzip);

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
// Must NOT be called for user files served from disk. `csp` may be null for
// operator-authored custom error pages (options.errorPages): the built-in pages'
// `default-src 'none'` would block their inline styles, so they get the non-CSP
// headers only — the self-contained requirement is documented, not enforced.
function setGeneratedPageHeaders(ctx, csp) {
    if (csp) ctx.set('Content-Security-Policy', csp);
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
const _INTERNAL_ERROR_HTML  = buildErrorHtml('Internal Server Error', 'Internal Server Error', 'The server encountered an unexpected condition.');

// Statuses an operator can override via options.errorPages, each with its
// built-in fallback page. 400 is deliberately absent: it answers malformed /
// hostile requests and stays minimal by design. _TEMPLATE_ERROR_HTML is a
// call-site-specific 500 body (template failures), not a separate status.
const _BUILTIN_ERROR_HTML = {
    404: _NOT_FOUND_HTML,
    500: _INTERNAL_ERROR_HTML,
    504: _GATEWAY_TIMEOUT_HTML,
};

// Representation / caching headers a partially-built response may have left
// behind by the time an error is detected: a stale Content-Encoding would
// corrupt the error page (its body is never compressed), a public
// Cache-Control could get the 404/500 cached by proxies under the resource's
// URL. Scrubbed on every error page write.
const ERROR_PAGE_SCRUB_HEADERS = [
    'Content-Encoding', 'Content-Disposition', 'Content-Range', 'Vary',
    'ETag', 'Last-Modified', 'Accept-Ranges',
    'Cache-Control', 'Pragma', 'Expires',
];

// Single writer for every middleware-generated error response (404 / 500 / 504).
// `customBuffer` is the operator's page from options.errorPages (or null →
// `builtinHtml` is served). Assumes the response is still writable — callers
// keep their own headerSent / writableEnded guards.
function writeErrorPage(ctx, status, customBuffer, builtinHtml) {
    for (const h of ERROR_PAGE_SCRUB_HEADERS) ctx.remove(h);
    if (status >= 500) ctx.set('Cache-Control', 'no-store');
    setGeneratedPageHeaders(ctx, customBuffer ? null : NOT_FOUND_CSP);
    ctx.set('Content-Type', 'text/html; charset=utf-8');
    ctx.status = status;
    ctx.body = customBuffer || builtinHtml;
}

// Plain-text 400 for malformed requests (bad percent-encoding, invalid Host,
// null byte). Kept minimal and header-light to match the existing null-byte /
// traversal guards — the response body carries no attacker-controlled data.
function sendBadRequest(ctx) {
    ctx.status = 400;
    ctx.body = 'Bad Request';
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

// Config-deprecation warnings, deduplicated once-per-process (per distinct
// message) so creating many middleware instances doesn't repeat the same nag —
// same intent as the _showDirContentsDeprecationWarned flag, generalized to
// multiple messages. These options (urlPrefix, urlsReserved, ...) are v2-stable,
// so a malformed value is TOLERATED with a warning for now rather than thrown:
// throwing on a stable option would be a breaking change on a minor upgrade.
// The next major will flip `warnConfigDeprecation` into a hard throw (the call
// sites already carry the final message) — see docs/revisione_codice_v3.1.md #11.
const _configDeprecationsWarned = new Set();
function warnConfigDeprecation(logger, message) {
    if (_configDeprecationsWarned.has(message)) return;
    _configDeprecationsWarned.add(message);
    logger.warn(...warnPayload(logger,
        '[koa-classic-server] DEPRECATION: ' + message +
        '\n  This is tolerated for now and WILL throw in a future major version.'));
}

// Sends an error response for a failed template render. If headers were already
// flushed by the render itself, destroys the underlying socket instead (the
// status/body can no longer be changed at that point). Page selection (custom
// vs built-in) goes through the instance's sendErrorPage; `builtinHtml` keeps
// the call-site-specific fallback body (timeout vs render failure).
async function sendTemplateError(ctx, status, builtinHtml, logMsg, err, logger, sendErrorPage) {
    logger.error(logMsg, err);
    if (ctx.headerSent || ctx.res.writableEnded) {
        ctx.res.destroy();
        return;
    }
    await sendErrorPage(ctx, status, builtinHtml);
}

// Rewrites an already-rendered response into an RFC 9110 §9.3.2 compliant HEAD
// response: the status and headers produced by the render are preserved, the
// body is replaced with an empty buffer (so no content is sent), and
// Content-Length is restored to the byte length the GET body would have had.
// Reassigning ctx.body to a non-stream value also makes Koa auto-destroy a
// previous stream body, so no file descriptor leaks. Stream / non-buffer bodies
// (uncommon for template renders) carry no Content-Length, matching the static
// streaming-HEAD branch.
function stripBodyForHead(ctx) {
    if (ctx.headerSent) return;       // render already flushed — status/headers are locked
    const body = ctx.body;
    if (body == null) return;         // render produced no body (redirect, pass-through, ...) — leave status as-is
    const hasKnownLength = typeof body === 'string' || Buffer.isBuffer(body);
    const length = hasKnownLength ? Buffer.byteLength(body) : null;
    ctx.body = Buffer.alloc(0);
    if (length !== null) {
        ctx.set('Content-Length', String(length)); // body setter zeroed it — restore the real length
    } else {
        ctx.remove('Content-Length');               // unknown length — omit, like static streaming HEAD
    }
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
async function tryRenderTemplate(ctx, next, filePath, rawBuffer, templateOpts, logger, sendErrorPage) {
    if (templateOpts.ext.length === 0 || !templateOpts.render) return false;

    const fileExt = path.extname(filePath).slice(1);
    if (!fileExt || !templateOpts.ext.includes(fileExt)) return false;

    // RFC 9110 §9.3.2: HEAD must mirror GET (same status + headers, no body). The
    // user's render is run exactly as for GET — by presenting ctx.method as GET for
    // the duration of the render — so it resolves, validates, and sets Content-Type
    // / status identically; stripBodyForHead() then discards the body and restores
    // Content-Length. Without this, a render that early-returns on non-GET never
    // sets ctx.body, leaving ctx.status at Koa's default 404 for HEAD even though
    // GET returns 200.
    const isHeadRequest = ctx.method === 'HEAD';
    if (isHeadRequest) ctx.method = 'GET';

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
            await sendTemplateError(ctx, 504, _GATEWAY_TIMEOUT_HTML,
                'Template render timeout after ' + timeoutMs + 'ms:', filePath, logger, sendErrorPage);
        } else {
            await sendTemplateError(ctx, 500, _TEMPLATE_ERROR_HTML,
                'Template rendering error:', error, logger, sendErrorPage);
        }
    } finally {
        if (timer) clearTimeout(timer);
        ctx.req.removeListener('close', onClientClose);
        if (isHeadRequest) {
            ctx.method = 'HEAD';
            stripBodyForHead(ctx);
        }
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

// Lone (unpaired) surrogates cannot be percent-encoded: encodeURIComponent
// throws URIError on them. They cannot arrive from URL-decoded client input
// (the decode guards already reject invalid encodings with a 400), but Windows
// filenames are WTF-16 and readdir() can return them — one such name must not
// turn the whole directory listing (or the file's Content-Disposition) into a
// 500. Normalizes like String.prototype.toWellFormed() (Node >= 20); the
// regex fallback covers Node 18 (engines: >=18). Well-formed strings —
// including astral pairs like emoji — pass through unchanged.
const _LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
function toWellFormedName(name) {
    return typeof name.toWellFormed === 'function'
        ? name.toWellFormed()
        : name.replace(_LONE_SURROGATE_RE, '\uFFFD');
}

// Explicit bidi control characters (embedding/override/isolate,
// U+202A-U+202E and U+2066-U+2069) can make a listing entry DISPLAY as a
// different name — "evil‮txt.exe" renders roughly as "evilexe.txt"
// (extension spoofing). In the DISPLAYED name only they are replaced with a
// visible U+FFFD (the href and the served file are untouched); the caller
// additionally wraps the name in <bdi> so the directional run of one name
// (legit RTL included) cannot bleed into the rest of its row. Direction MARKS
// (U+200E/U+200F) are legitimate in RTL text and are left alone.
const _BIDI_CONTROLS_RE = /[\u202A-\u202E\u2066-\u2069]/g;
function listingDisplayName(name) {
    return escapeHtml(name.replace(_BIDI_CONTROLS_RE, '\uFFFD'));
}

/**
 * Build a Content-Disposition header value for inline serving.
 *
 * Uses both the legacy quoted-string form (ASCII fallback) and the RFC 5987
 * extended form (UTF-8 percent-encoded) for maximum browser compatibility:
 *   inline; filename="ascii-safe"; filename*=UTF-8''percent-encoded
 *
 * The quoted-string form must stay within what Node accepts in a header
 * value (latin1 minus control chars): anything outside — CJK, emoji, \n —
 * would make ctx.set() throw ERR_INVALID_CHAR and turn the response into a
 * 500. Those characters are replaced with '?' (same policy as express's
 * content-disposition package); the real name still round-trips via the
 * RFC 5987 form, which browsers prefer over filename (RFC 6266 §4.1).
 * The name is normalized to well-formed UTF-16 first: a lone surrogate (WTF-16
 * filename on Windows) would otherwise make encodeURIComponent throw.
 */
function buildContentDisposition(filename) {
    filename = toWellFormedName(filename);

    // quoted-string fallback: printable latin1 only (controls and >0xFF → '?'), then escape \ and "
    const asciiSafe = filename
        .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');

    // RFC 5987 extended value: UTF-8 percent-encode everything except
    // unreserved chars (ALPHA / DIGIT / "-" / "." / "_" / "~")
    const rfc5987 = encodeURIComponent(filename)
        .replace(/['()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

    return `inline; filename="${asciiSafe}"; filename*=UTF-8''${rfc5987}`;
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

// Evaluate an If-None-Match header against our (strong) ETag, per RFC 9110 §13.1.2.
// The header is either "*" (matches any existing representation) or a comma-separated
// list of entity-tags. The comparison is the WEAK function: a leading "W/" is ignored
// on both sides (a proxy/CDN may have weakened the validator). Returns true when the
// precondition is satisfied, i.e. the client's cached representation is still current
// and the server should answer 304 (Not Modified) for a GET/HEAD.
function ifNoneMatchSatisfied(headerValue, etag) {
    if (!headerValue) return false;
    const trimmed = headerValue.trim();
    if (trimmed === '*') return true; // "*" matches any existing representation
    const target = etag.replace(/^W\//, ''); // our ETag is strong, but strip defensively
    for (const part of trimmed.split(',')) {
        const tag = part.trim().replace(/^W\//, '');
        if (tag && tag === target) return true;
    }
    return false;
}

// LFU cache with O(1) eviction using frequency buckets.
// peek(key)  — read without touching frequency (for staleness checks)
// get(key)   — read and increment frequency
// set(key, entry) — insert, evicting LFU entries if needed
// delete(key) — remove explicitly (e.g. stale entry before re-insert)
class LFUCache {
    constructor(maxSize, warnInterval, cacheLabel, logger, maxEntrySize) {
        this.maxSize     = maxSize;
        // Per-entry admission cap (bytes). Entries larger than this are never
        // cached (they are still served). Infinity = no per-entry cap: only the
        // physical maxSize bound applies.
        this.maxEntrySize = typeof maxEntrySize === 'number' ? maxEntrySize : Infinity;
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
        // An entry larger than the whole cache can never fit: bail out BEFORE the
        // eviction loop, otherwise it would flush every other entry for nothing.
        // Warn (throttled) so the operator learns the cache is undersized for
        // this file instead of it silently never being cached.
        if (entry.buffer.length > this.maxSize) {
            this._warnThrottled(`[koa-classic-server] serverCache.${this.cacheLabel}: entry of ${entry.buffer.length} bytes exceeds maxSize (${this.maxSize} bytes) and will never be cached. Consider increasing maxSize.`);
            return;
        }
        // Per-entry admission cap: refuse (and keep serving uncached) instead of
        // letting one oversized entry evict most of the working set on insert.
        if (entry.buffer.length > this.maxEntrySize) {
            this._warnThrottled(`[koa-classic-server] serverCache.${this.cacheLabel}: entry of ${entry.buffer.length} bytes exceeds maxEntrySize (${this.maxEntrySize} bytes) and will not be cached. Increase serverCache.${this.cacheLabel}.maxEntrySize or set it to false.`);
            return;
        }
        while (this.currentSize + entry.buffer.length > this.maxSize && this._keyMap.size > 0) {
            this._evictOne();
        }

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

        if (fields.buffer.length > this.maxEntrySize) return false;
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

        this._warnThrottled(`[koa-classic-server] serverCache.${this.cacheLabel}: maxSize reached, evicting LFU entries. Consider increasing maxSize.`);
    }

    // Emits a warning at most once per warnInterval ms (0 = always, false = never).
    _warnThrottled(message) {
        if (this.warnInterval === false) return;
        const now = Date.now();
        if (now - this._lastWarnAt >= this.warnInterval) {
            this.logger.warn(message);
            this._lastWarnAt = now;
        }
    }
}

// Single-flight job map helper: joins the in-flight job for `key`, or starts
// `work()` as the leader. Concurrent callers share the same Promise — including
// a rejection, so on failure every waiter falls back together instead of
// re-running the work. The entry is removed as soon as the job settles
// (success or failure), so the next request after a failure retries from
// scratch and the map only ever holds jobs actually in progress.
function singleFlight(map, key, work) {
    let job = map.get(key);
    if (!job) {
        job = work();
        map.set(key, job);
        const clean = () => map.delete(key);
        job.then(clean, clean);
    }
    return job;
}

// Upserts a fresh entry into an LFUCache. When the previous entry was only
// stale-by-age (mtime + size unchanged), updates in place so the existing
// frequency counter survives — important for popular files refreshed by maxAge.
// Otherwise falls back to delete + set (frequency resets to 1).
// Bounded-RAM streaming compressor: constant-memory transform, lower quality
// than the buffered path (which can afford max quality because it runs once and
// is cached). Used by every streamed-compression pipeline. `quality` carries the
// normalized compression.streaming settings (brotliQuality default 4, gzipLevel
// default 6).
// LGWIN 19 (512 KB window instead of brotli's default 4 MB): the encoder state
// is the dominant per-request RAM on this path (~10 MB/stream at the default,
// ~1.3 GB peak measured under 100 concurrent cold requests), and at Q4 the big
// window buys nothing on typical text (measured: same output size, ~40% faster).
// The trade-off: content with identical blocks repeated at >512 KB distance
// (rare, pathological) compresses worse than with the 4 MB window. gzip's
// window is 32 KB by design — nothing to bound there. LGWIN is deliberately
// NOT configurable: it is what bounds the per-stream RAM.
function createStreamCompressor(encoding, quality) {
    return encoding === 'br'
        ? zlib.createBrotliCompress({ params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: quality.brotliQuality,
            [zlib.constants.BROTLI_PARAM_LGWIN]: 19,
        } })
        : zlib.createGzip({ level: quality.gzipLevel });
}

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
        symlinks: 'follow', // Symlink policy (V3.1+). Opt-in protection against symlink escape:
                            //   'follow'             (default) — follow symlinks anywhere, incl.
                            //                        targets OUTSIDE rootDir. Zero overhead;
                            //                        historical behavior (no rootDir existence check).
                            //   'follow-within-root' — follow only while the resolved realpath stays
                            //                        inside rootDir; escaping links return 404.
                            //   'deny'               — never follow a symlink resolved below rootDir
                            //                        (rootDir being a symlink itself is always allowed).
                            //   Protected modes cost one fs.realpath() per served path and require
                            //   rootDir to exist at factory time. See README "Security Checklist".
        dirListing: {                   // Directory listing configuration (V3+).
            enabled:        true,       // Render the directory listing HTML when no index file matches.
                                        //   Set to false to return 404 instead of a listing.
            maxEntries:     10000,      // Soft cap on entries shown / sorted / stat'd per listing.
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
            trailingSlash: true,        // Canonical trailing-slash enforcement (V4). Default true:
                                        //   GET /dir  (directory, no slash) → 301 redirect to /dir/
                                        //   GET /file/ (file, trailing slash) → 404
                                        //   so relative links in an index page resolve against the
                                        //   directory. Set false for the v3 behavior (serve directories
                                        //   and files regardless of the trailing slash).
        },
        index: [], // Index file name(s) - must be an ARRAY.
                   // Default: [] — no index file is looked up; directories always
                   // show the listing (when dirListing.enabled). Configure explicitly
                   // for the classic index-file behavior, e.g. ["index.html"].
                   //   - Array of strings: ["index.html", "index.htm", "default.html"]
                   //   - Array of RegExp:  [/index\.html/i, /default\.(html|htm)/i]
                   //   - Mixed array:      ["index.html", /index\.[eE][jJ][sS]/]
                   // Priority is determined by array order (first match wins)
        urlPrefix: "", // URL path prefix. Should start with "/" and NOT end with "/"
                       //   (e.g. "/static"); "" disables the prefix. A malformed value
                       //   is tolerated with a deprecation warning for now (behavior
                       //   unchanged) and WILL throw in the next major version.
        urlsReserved: [], // Reserved first-level paths passed through to next().
                          //   Each entry should be a single first-level path: a leading
                          //   "/" plus one segment, no further "/" (e.g. "/admin").
                          //   Malformed entries are tolerated with a deprecation warning
                          //   for now and WILL throw in the next major version (a
                          //   non-string entry is dropped to avoid a per-request 500).
        template: {
            render: undefined, // Template rendering function: async (ctx, next, filePath, rawBuffer, signal) => {}
                               // rawBuffer (4th arg, may be null) is READ-ONLY: the same Buffer
                               // instance is shared with the server cache and with concurrent
                               // requests — mutating it corrupts other responses.
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
        errorPages: {        // Custom error pages (V4.2+). Opt-in — omitted statuses keep the built-in pages.
            // Keys: the statuses the middleware generates error pages for: 404, 500, 504.
            //   Any other key throws at factory time. (400 replies to malformed/hostile
            //   requests are deliberately NOT customizable — they stay minimal.)
            // Values: filesystem path (absolute, or relative to process.cwd()) to a
            //   SELF-CONTAINED .html file: one single file, inline CSS only, no external
            //   css/js/img references. Documented requirement, not enforced — custom
            //   pages are served WITHOUT the built-in pages' Content-Security-Policy
            //   (which would block their inline styles); the other generated-page
            //   security headers (nosniff, X-Frame-Options, ...) are still sent.
            //   The file may live outside rootDir (recommended: keeps it unreachable via URL).
            //   Read and validated at factory time (missing/unreadable → throw), cached in
            //   RAM, and re-read automatically when its mtime/size changes — editable
            //   without a restart. If it becomes unreadable at request time, the built-in
            //   page is served instead (fallback; throttled warning via logger).
            // 404: './errors/404.html',
            // 500: './errors/500.html',
            // 504: './errors/504.html',
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
                maxEntrySize: undefined,     // max bytes of a SINGLE cached entry, measured on the compressed
                                             //   OUTPUT (V4.3+). Applies to every insertion: buffered path and
                                             //   streamed-tee path alike. Oversized entries are still served,
                                             //   just not cached (throttled warning via logger).
                                             //   undefined (default) → maxSize / 4, so one huge file cannot
                                             //   evict most of the working set on insert; false → no per-entry
                                             //   cap (maxSize still bounds); explicit bytes must be <= maxSize
                                             //   (larger throws at factory time — use false instead).
                maxAge: 0,                   // ms after insertion to consider an entry stale; 0 = disabled. See rawFile.maxAge.
                warnInterval: 60000,         // ms between "maxSize reached" warnings; 0 = always; false = never
            },
        },
        compression: {       // Response compression (gzip / brotli) — to enable/disable caching → serverCache.compressedFile
            enabled: true,                // master switch (false = disable all compression)
            encodings: ['br', 'gzip'],    // algorithms in priority order; [] = disable
            minFileSize: 1024,            // min file size in bytes to compress; false = no minimum
            maxFileSize: 10485760,        // max file size (bytes) for the buffered high-quality
                                          //   compression path (whole file in RAM → brotli Q11 →
                                          //   result cached). Default: 10 MB; false = no cap.
                                          //   Larger files are STILL compressed, but via the
                                          //   bounded-RAM streaming mode (brotli Q4 / gzip 6, no
                                          //   Content-Length on the first response). This is a
                                          //   SAFETY NET against unbounded RAM/CPU on huge
                                          //   compressible files (multi-GB logs/JSON/CSV), not a
                                          //   serving restriction. When serverCache.compressedFile
                                          //   is enabled, the streamed OUTPUT is also cached
                                          //   (when it fits in a quarter of that cache's maxSize),
                                          //   so subsequent requests are served from RAM with
                                          //   Content-Length.
            mimeTypes: [],                // compressible MIME types (replaces default list if provided)
            buffered: {                   // quality for the BUFFERED path (V4.3+): file <= maxFileSize,
                brotliQuality: 11,        //   compressed once, output cached — the cost is paid once per
                gzipLevel: 9,             //   file, so max quality by default. brotliQuality: integer 0-11;
            },                            //   gzipLevel: integer 0-9. Out-of-range throws at factory time.
            streaming: {                  // quality for the STREAMING path (V4.3+): file > maxFileSize, or
                brotliQuality: 4,         //   compressed cache disabled — the cost is paid on EVERY
                gzipLevel: 6,             //   non-cached request, so deliberately light by default.
            },                            //   The brotli window stays fixed at 512 KB (bounds per-stream
                                          //   RAM; not configurable). Same ranges as `buffered`.
        },
        // compression: false            // shorthand to disable all compression
        staticSecurityHeaders: {   // Opt-in security headers on STATIC file responses (V3.1+).
            nosniff: false,        // false (default) — no change. true → sets
                                   //   'X-Content-Type-Options: nosniff' on 200/206/304 static
                                   //   responses, stopping MIME sniffing (content-sniffing XSS on
                                   //   user-uploaded files). Does NOT apply to template-rendered
                                   //   output. Off by default: hardening is opt-in. Other headers
                                   //   (X-Frame-Options, HSTS, ...) stay with the reverse proxy.
        },
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

    // Options must be a plain object, or omitted entirely (the `opts = {}`
    // default covers undefined). An explicit null — or any other non-object —
    // is a configuration bug: surface it with a helpful error instead of a raw
    // TypeError further down (or, worse, a silent fall-through to defaults).
    if (opts === null || typeof opts !== 'object' || Array.isArray(opts)) {
        throw new Error(
            '[koa-classic-server] options must be a plain object (or omitted entirely). Got: ' +
            (opts === null ? 'null' : Array.isArray(opts) ? 'an array' : typeof opts)
        );
    }

    // Work on a copy: the factory normalizes options in place and must never
    // mutate the caller's configuration object (reusing one config for two
    // instances, or inspecting it after startup, would otherwise observe the
    // rewritten values). Only the two nested objects the normalization writes
    // into need their own copy — template (render/ext/renderTimeout) and
    // hideExtension (ext/redirect); every other namespace is only read and
    // normalized into new internal structures.
    const options = { ...opts };
    options.template = (opts.template && typeof opts.template === 'object' && !Array.isArray(opts.template))
        ? { ...opts.template }
        : {};
    if (options.hideExtension && typeof options.hideExtension === 'object' && !Array.isArray(options.hideExtension)) {
        options.hideExtension = { ...options.hideExtension };
    }

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
        // Canonical trailing-slash enforcement (V4). Default ON:
        //   - GET /dir  (directory, no slash) → 301 redirect to /dir/
        //   - GET /file/ (file, trailing slash) → 404
        // so relative links in an index page resolve against the directory and
        // a file is only reachable at its slash-less URL. Set false to keep the
        // v3 behavior (serve directories and files regardless of trailing slash).
        trailingSlash: userDirListing && userDirListing.trailingSlash !== undefined
            ? !!userDirListing.trailingSlash
            : true,
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

    // ── urlPrefix / urlsReserved validation (V3.1, deprecation-warn) ──
    // The request-time matcher depends on an implicit format for both options,
    // and a malformed value fails SILENTLY: a urlPrefix with a stray
    // leading/trailing slash makes the middleware serve nothing (it always falls
    // through to next()), and a urlsReserved entry without a leading slash makes
    // the reservation never match (the path is served instead of passed on).
    // Both are v2-stable options, so instead of throwing (a breaking change on a
    // minor upgrade — a mis-slashed value that "worked" only by falling through
    // to a downstream handler would suddenly change behavior), we WARN and leave
    // the runtime behavior exactly as it is today. The next major turns these
    // warnings into throws. The one exception is a non-string urlsReserved entry:
    // it would 500 on every request (value.substring is not a function), which is
    // not working behavior, so it is dropped defensively (still warned).
    if (options.urlPrefix === undefined) {
        options.urlPrefix = "";
    } else if (typeof options.urlPrefix !== 'string') {
        // Unchanged behavior: pre-existing code already coerced non-string → "".
        warnConfigDeprecation(_logger,
            'urlPrefix should be a string like "/static" (or "" for no prefix); got ' +
            (options.urlPrefix === null ? 'null' : typeof options.urlPrefix) + ' — treating it as "".');
        options.urlPrefix = "";
    } else if (options.urlPrefix !== "" && (!options.urlPrefix.startsWith('/') || options.urlPrefix.endsWith('/'))) {
        // Left as-is: the matcher behaves exactly as today (falls through to
        // next() under this prefix). Warn only — no behavior change.
        warnConfigDeprecation(_logger,
            'urlPrefix should start with "/" and not end with "/" (use "" to disable); got ' +
            JSON.stringify(options.urlPrefix) + ' — it will not route correctly until corrected.');
    }
    const _urlPrefixParts = options.urlPrefix.split("/");

    if (options.urlsReserved === undefined) {
        options.urlsReserved = [];
    } else if (!Array.isArray(options.urlsReserved)) {
        // Unchanged behavior: pre-existing code already coerced non-array → [].
        warnConfigDeprecation(_logger,
            'urlsReserved should be an array of first-level paths like ["/admin"]; got ' +
            (options.urlsReserved === null ? 'null' : typeof options.urlsReserved) + ' — treating it as [].');
        options.urlsReserved = [];
    } else {
        const cleaned = [];
        for (const value of options.urlsReserved) {
            if (typeof value !== 'string') {
                // Dropped defensively: a non-string entry would throw at match
                // time (value.substring is not a function) → a 500 on every
                // request. Dropping it can't break working code.
                warnConfigDeprecation(_logger,
                    'urlsReserved entries must be strings like "/admin"; dropping a non-string (' +
                    (value === null ? 'null' : typeof value) + ') entry.');
                continue;
            }
            // Malformed but non-crashing (missing leading slash, extra segment,
            // trailing slash, empty): kept as-is so the matcher behaves exactly
            // as today (it simply won't match). Warn only.
            if (value === '' || !value.startsWith('/') || value.indexOf('/', 1) !== -1) {
                warnConfigDeprecation(_logger,
                    'each urlsReserved entry should be a single first-level path — a leading "/" plus one ' +
                    'segment, e.g. "/admin"; got ' + JSON.stringify(value) + ' — it will not match until corrected.');
            }
            cleaned.push(value);
        }
        options.urlsReserved = cleaned;
    }
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

    // browserCacheMaxAge: non-negative integer seconds. An invalid value (negative, NaN,
    // non-integer, Infinity, or a string) previously fell back to 3600 SILENTLY (#12).
    // Consistent with #11: warn now and keep the fallback; a future major will throw
    // (validateNonNegativeInt semantics) — so what warns here is exactly what will throw then.
    if (options.browserCacheMaxAge === undefined) {
        options.browserCacheMaxAge = 3600;
    } else if (!(typeof options.browserCacheMaxAge === 'number'
        && Number.isInteger(options.browserCacheMaxAge)
        && options.browserCacheMaxAge >= 0)) {
        warnConfigDeprecation(_logger,
            'browserCacheMaxAge must be a non-negative integer (seconds). Got: ' +
            String(options.browserCacheMaxAge) + '. Falling back to the default 3600 for now.');
        options.browserCacheMaxAge = 3600;
    }
    // else: valid — keep as-is
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
        // Per-path quality defaults (V4.3+). Two groups because the two execution
        // modes have opposite cost models: the buffered path compresses once and
        // caches the result (can afford max quality), the streaming path pays the
        // CPU on every non-cached request (must stay light).
        const defaultBuffered  = { brotliQuality: 11, gzipLevel: 9 };
        const defaultStreaming = { brotliQuality: 4,  gzipLevel: 6 };

        // Strict validation: these namespaces are new in 4.3.0, so unknown keys
        // are caught as typos instead of being silently ignored (an operator who
        // misspells brotliQuality must not believe they lowered the quality).
        function validateQualityGroup(group, groupName, defaults) {
            if (group === undefined) return { ...defaults };
            if (!group || typeof group !== 'object' || Array.isArray(group)) {
                throw new Error(
                    `[koa-classic-server] compression.${groupName} must be an object, e.g. ` +
                    `{ brotliQuality: ${defaults.brotliQuality}, gzipLevel: ${defaults.gzipLevel} }. Got: ` + String(group)
                );
            }
            for (const key of Object.keys(group)) {
                if (key !== 'brotliQuality' && key !== 'gzipLevel') {
                    throw new Error(
                        `[koa-classic-server] compression.${groupName}.${key} is not a valid option. ` +
                        'Valid keys: brotliQuality, gzipLevel.'
                    );
                }
            }
            const out = { ...defaults };
            if (group.brotliQuality !== undefined) {
                if (!Number.isInteger(group.brotliQuality) || group.brotliQuality < 0 || group.brotliQuality > 11) {
                    throw new Error(
                        `[koa-classic-server] compression.${groupName}.brotliQuality must be an integer between 0 and 11. ` +
                        'Got: ' + String(group.brotliQuality)
                    );
                }
                out.brotliQuality = group.brotliQuality;
            }
            if (group.gzipLevel !== undefined) {
                if (!Number.isInteger(group.gzipLevel) || group.gzipLevel < 0 || group.gzipLevel > 9) {
                    throw new Error(
                        `[koa-classic-server] compression.${groupName}.gzipLevel must be an integer between 0 and 9. ` +
                        'Got: ' + String(group.gzipLevel)
                    );
                }
                out.gzipLevel = group.gzipLevel;
            }
            return out;
        }

        if (compression === false) return { enabled: false };

        if (!compression || typeof compression !== 'object' || Array.isArray(compression)) {
            return {
                enabled: true,
                encodings: ['br', 'gzip'],              // priority order: brotli first, gzip as fallback
                minFileSize: 1024,                      // bytes; skip compression for files smaller than this
                maxFileSize: 10485760,                  // bytes; above this the buffered+cached path is skipped (streaming instead)
                mimeTypes: new Set(DEFAULT_COMPRESSIBLE_MIME_TYPES),
                buffered: { ...defaultBuffered },
                streaming: { ...defaultStreaming },
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

        // Cap for the buffered (whole-file-in-RAM, max-quality, cached) compression
        // path. false = no cap. Files above the cap still get compressed via the
        // bounded-RAM streaming mode — safety net, not a serving restriction.
        const maxFileSize = compression.maxFileSize === false ? false
            : (typeof compression.maxFileSize === 'number' && compression.maxFileSize > 0 ? compression.maxFileSize : 10485760);

        const mimeTypes = Array.isArray(compression.mimeTypes) && compression.mimeTypes.length > 0
            ? compression.mimeTypes
            : DEFAULT_COMPRESSIBLE_MIME_TYPES;

        const buffered  = validateQualityGroup(compression.buffered,  'buffered',  defaultBuffered);
        const streaming = validateQualityGroup(compression.streaming, 'streaming', defaultStreaming);

        return { enabled, encodings, minFileSize, maxFileSize, mimeTypes: new Set(mimeTypes), buffered, streaming };
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
            maxEntrySize: 26214400, // maxSize / 4
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

        // maxEntrySize (V4.3+): per-entry admission cap for the compressed cache,
        // measured on the compressed OUTPUT. Applies to every insertion (buffered
        // path and streamed-tee path alike). undefined → a quarter of maxSize
        // (the historical tee-path bound, and it keeps scaling with maxSize);
        // false → no per-entry cap (normalized to Infinity; maxSize still bounds).
        function validateMaxEntrySize(value, maxSize) {
            if (value === undefined) return Math.floor(maxSize / 4);
            if (value === false) return Infinity;
            if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
                throw new Error(
                    '[koa-classic-server] serverCache.compressedFile.maxEntrySize must be a positive integer (bytes) or false. ' +
                    'Got: ' + String(value)
                );
            }
            if (value > maxSize) {
                throw new Error(
                    `[koa-classic-server] serverCache.compressedFile.maxEntrySize (${value}) exceeds maxSize (${maxSize}) — ` +
                    'a per-entry cap larger than the whole cache is a configuration contradiction. ' +
                    'Use false to disable the per-entry cap.'
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
        let compressedFile;
        if (!cf || typeof cf !== 'object' || Array.isArray(cf)) {
            compressedFile = defaultCompressedFile;
        } else {
            const cfMaxSize = typeof cf.maxSize === 'number' && cf.maxSize > 0 ? cf.maxSize : 104857600;
            compressedFile = {
                enabled: typeof cf.enabled === 'boolean' ? cf.enabled : true,
                maxSize: cfMaxSize,
                maxEntrySize: validateMaxEntrySize(cf.maxEntrySize, cfMaxSize),
                maxAge: validateMaxAge(cf.maxAge, 'compressedFile'),
                warnInterval: cf.warnInterval === false ? false : (typeof cf.warnInterval === 'number' ? cf.warnInterval : 60000),
            };
        }

        return { rawFile, compressedFile };
    }

    // ── symlinks policy (V3.1+) — opt-in protection against symlink escape ──
    // 'follow'             (default) : follow symlinks anywhere, including targets
    //                                  outside rootDir. Zero overhead — current behavior.
    // 'follow-within-root'          : follow symlinks only while the resolved realpath
    //                                  stays inside rootDir; escaping links return 404.
    // 'deny'                        : never follow a symlink resolved BELOW rootDir
    //                                  (rootDir itself being a symlink is always allowed).
    // Protected modes cost one fs.realpath() per served path. See the Security Checklist.
    if (options.symlinks === undefined) {
        options.symlinks = 'follow';
    } else if (
        options.symlinks !== 'follow' &&
        options.symlinks !== 'follow-within-root' &&
        options.symlinks !== 'deny'
    ) {
        throw new Error(
            '[koa-classic-server] options.symlinks must be one of "follow", "follow-within-root", "deny". ' +
            'Got: ' + String(options.symlinks)
        );
    }
    const _symlinkMode = options.symlinks;

    // realpath of rootDir, resolved once at init (pinned). This is what makes a
    // rootDir that is ITSELF a symlink work in protected modes: the boundary check
    // compares against the real target, not the (unresolved) symlink path.
    // In 'follow' mode we skip this entirely (and keep the historical behavior of
    // NOT requiring rootDir to exist at factory time).
    let realRootDir = normalizedRootDir;
    if (_symlinkMode !== 'follow') {
        try {
            realRootDir = fs.realpathSync.native(normalizedRootDir);
        } catch (err) {
            throw new Error(
                `[koa-classic-server] rootDir must exist when symlinks mode is "${_symlinkMode}". ` +
                'Original error: ' + err.message
            );
        }
    }

    // Case-insensitive path comparison on filesystems that are case-insensitive by
    // default (APFS/HFS+ on macOS, NTFS on Windows) — otherwise a casing mismatch
    // between realRootDir and a resolved path would produce spurious 404s.
    const _caseInsensitiveFS = process.platform === 'darwin' || process.platform === 'win32';

    function _isWithinRoot(resolved, root) {
        if (_caseInsensitiveFS) {
            resolved = resolved.toLowerCase();
            root = root.toLowerCase();
        }
        if (resolved === root) return true;
        const withSep = root.endsWith(path.sep) ? root : root + path.sep;
        return resolved.startsWith(withSep);
    }

    // Returns true if serving `resolvedPath` is permitted under the current symlinks
    // policy. In 'follow' mode this is a no-op (no syscall). In protected modes it
    // resolves the realpath and checks it against realRootDir.
    async function symlinkAllowed(resolvedPath) {
        if (_symlinkMode === 'follow') return true;
        let real;
        try {
            real = await fs.promises.realpath(resolvedPath);
        } catch {
            return false; // cannot resolve (broken/circular link, race) → treat as not found
        }
        if (_symlinkMode === 'deny') {
            // Reject if ANY symlink was resolved below rootDir: the real path must equal
            // the path obtained by swapping only the rootDir prefix (no inner resolution).
            const rel = path.relative(normalizedRootDir, resolvedPath);
            const expected = path.join(realRootDir, rel);
            return _caseInsensitiveFS
                ? real.toLowerCase() === expected.toLowerCase()
                : real === expected;
        }
        // 'follow-within-root': the resolved target must stay inside rootDir.
        return _isWithinRoot(real, realRootDir);
    }

    // ── staticSecurityHeaders (V3.1+) — opt-in security headers on static responses ──
    // Off by default (design philosophy: hardening is opt-in, documentation over defaults).
    // Currently supports `nosniff` (X-Content-Type-Options: nosniff), which stops browsers
    // from MIME-sniffing a response and interpreting it against the declared Content-Type
    // (a content-sniffing XSS vector when serving user-uploaded files). Other headers
    // (X-Frame-Options, Referrer-Policy, HSTS) remain the reverse proxy's responsibility.
    const _ssh = options.staticSecurityHeaders;
    if (_ssh !== undefined && (typeof _ssh !== 'object' || _ssh === null || Array.isArray(_ssh))) {
        throw new Error(
            '[koa-classic-server] options.staticSecurityHeaders must be an object, e.g. { nosniff: true }.'
        );
    }
    const staticSecurityHeaders = {
        nosniff: !!(_ssh && _ssh.nosniff),
    };

    // ── errorPages (V4.2+) — operator-supplied custom error pages ──
    // Validated and read once at factory time (a typo must fail at startup, not
    // on the first 404), then kept in RAM and refreshed when mtime/size changes.
    const _errorPages = new Map(); // status → { path, buffer, mtimeMs, size }
    const userErrorPages = opts.errorPages;
    if (userErrorPages !== undefined) {
        if (typeof userErrorPages !== 'object' || userErrorPages === null || Array.isArray(userErrorPages)) {
            throw new Error(
                '[koa-classic-server] options.errorPages must be an object mapping a supported HTTP status ' +
                "to an .html file path. Example: errorPages: { 404: './errors/404.html' }"
            );
        }
        for (const key of Object.keys(userErrorPages)) {
            const status = Number(key);
            if (_BUILTIN_ERROR_HTML[status] === undefined) {
                throw new Error(
                    `[koa-classic-server] errorPages: unsupported status "${key}". ` +
                    'Supported statuses: ' + Object.keys(_BUILTIN_ERROR_HTML).join(', ') + '. ' +
                    '(400 is deliberately not customizable: replies to malformed requests stay minimal.)'
                );
            }
            const value = userErrorPages[key];
            if (typeof value !== 'string' || value === '') {
                throw new Error(
                    `[koa-classic-server] errorPages[${key}] must be a non-empty string path to an .html file. ` +
                    'Got: ' + (value === '' ? 'an empty string' : value === null ? 'null' : typeof value)
                );
            }
            const resolved = path.resolve(value);
            let pageStat, pageBuffer;
            try {
                pageStat = fs.statSync(resolved);
                if (!pageStat.isFile()) throw new Error('not a regular file');
                pageBuffer = fs.readFileSync(resolved);
            } catch (err) {
                throw new Error(
                    `[koa-classic-server] errorPages[${key}]: cannot read "${resolved}" (${err.message}). ` +
                    'The file must exist and be readable at startup.'
                );
            }
            _errorPages.set(status, { path: resolved, buffer: pageBuffer, mtimeMs: pageStat.mtimeMs, size: pageStat.size });
        }
    }

    // Runtime read-failure warnings, throttled per status: a 404 flood against a
    // deleted custom page must not flood the log.
    const _errorPageWarnAt = new Map(); // status → last warn timestamp (ms)
    function warnErrorPageUnreadable(status, entry, err) {
        const now = Date.now();
        if (now - (_errorPageWarnAt.get(status) || 0) < 60000) return;
        _errorPageWarnAt.set(status, now);
        _logger.warn(...warnPayload(_logger,
            `[koa-classic-server] errorPages[${status}]: cannot read "${entry.path}" — ` +
            `serving the built-in page instead. (${err.message})`));
    }

    // Returns the custom page buffer for `status`, re-read from disk when the
    // file changed (mtime+size — pages are editable without a restart). Returns
    // null when no custom page is configured for the status, or when the file is
    // no longer readable (the caller falls back to the built-in page).
    async function getCustomErrorPage(status) {
        const entry = _errorPages.get(status);
        if (!entry) return null;
        try {
            const st = await fs.promises.stat(entry.path);
            if (st.mtimeMs !== entry.mtimeMs || st.size !== entry.size) {
                entry.buffer = await fs.promises.readFile(entry.path);
                entry.mtimeMs = st.mtimeMs;
                entry.size = st.size;
            }
            return entry.buffer;
        } catch (err) {
            warnErrorPageUnreadable(status, entry, err);
            return null;
        }
    }

    // Single sender for every middleware-generated error response. `builtinHtml`
    // lets a call site keep its specific fallback body (e.g. the template-failure
    // 500) while still honoring the operator's custom page when configured.
    async function sendErrorPage(ctx, status, builtinHtml = _BUILTIN_ERROR_HTML[status]) {
        writeErrorPage(ctx, status, await getCustomErrorPage(status), builtinHtml);
    }

    // Sync variant for stream-error callbacks, where no await is possible: serves
    // the last-loaded custom buffer without the freshness stat — an acceptable
    // trade for a branch that only fires when the disk fails mid-response.
    function sendErrorPageSync(ctx, status) {
        const entry = _errorPages.get(status);
        writeErrorPage(ctx, status, entry ? entry.buffer : null, _BUILTIN_ERROR_HTML[status]);
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
        _logger,
        serverCacheConfig.compressedFile.maxEntrySize
    );

    // Single-flight maps for cache population (thundering-herd protection):
    // N concurrent misses on the same key share ONE read (+ compression) instead
    // of N duplicated jobs. Entries live only while a job is in flight. Keys
    // include the stat'd mtime+size so requests that observed different versions
    // of the file never share a job (each response stays coherent with its own
    // ETag/Last-Modified).
    const _inflightRawReads     = new Map(); // `${path}:${mtime}:${size}` → Promise<Buffer>
    const _inflightCompressions = new Map(); // `${path}:${encoding}:${mtime}:${size}` → Promise<Buffer>
    // Streamed-compression tee leaders in flight (`${path}:${encoding}:${mtime}:${size}`).
    // Only ONE request per key accumulates the compressed output for the cache,
    // so tee RAM never scales with the number of concurrent clients.
    const _inflightStreamTees = new Set();
    // Aggregate bytes currently accumulated by ALL in-flight tees. Bounds the
    // transient RAM across DISTINCT large files too: accumulation stops (the
    // entry is skipped, streaming continues) rather than let the tees hold more
    // RAM in aggregate than the compressed cache they feed (its maxSize).
    let _inflightTeeBytes = 0;

    // Streams `toOpen` (or `rawBuffer`) through the bounded-RAM compressor for
    // `encoding` and sets it as the response body. Shared by the cache-disabled
    // streaming branch and by tee followers; the tee leader builds its own
    // pipeline with the extra accumulator stage.
    // pipeline (NOT pipe): teardown propagates in BOTH directions. When the
    // client disconnects mid-transfer, Koa destroys the body (the zlib
    // transform) and pipeline destroys `src` too, closing its file descriptor.
    // A bare src.pipe(compress) leaves the ReadStream paused with the fd open
    // forever — fd leak under aborted downloads. Client disconnects are a
    // normal event and are not logged (avoids client-driven log spam).
    function streamCompressedBody(ctx, toOpen, rawBuffer, encoding) {
        const compress = createStreamCompressor(encoding, compressionConfig.streaming);
        const src = rawBuffer
            ? Readable.from(rawBuffer) // compress from in-memory buffer — no disk I/O
            : fs.createReadStream(toOpen);
        ctx.body = pipeline(src, compress, (err) => {
            if (!err || err.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
            _logger.error('Stream error:', err);
            if (!ctx.headerSent) sendErrorPageSync(ctx, 500);
        });
    }

    // Returns the server-preferred enabled encoding the client is willing to accept.
    // Server preference order (compressionConfig.encodings) still wins; the
    // Accept-Encoding q-values are used only to EXCLUDE encodings the client refuses
    // (q=0), per RFC 9110 §12.5.3. Token match is exact, not substring ("x-gzip" is
    // NOT "gzip"). A "*" supplies the q-value for any encoding not explicitly listed.
    function getClientEncoding(acceptEncoding) {
        if (!acceptEncoding) return null;
        const qValues = new Map(); // token → q-value
        for (const part of acceptEncoding.split(',')) {
            const [tokenRaw, ...params] = part.split(';');
            const token = tokenRaw.trim().toLowerCase();
            if (!token) continue;
            let q = 1;
            for (const p of params) {
                const m = /^\s*q=(\d+(?:\.\d+)?)\s*$/i.exec(p);
                if (m) q = parseFloat(m[1]);
            }
            qValues.set(token, q);
        }
        const star = qValues.get('*');
        for (const enc of compressionConfig.encodings) {
            let q = qValues.get(enc);
            if (q === undefined) q = star;   // not listed → fall back to "*" if present
            if (q === undefined) continue;   // not listed and no "*" → not offered
            if (q > 0) return enc;           // acceptable → pick it (server preference order)
        }
        return null;
    }

    // Compress a Buffer using the given encoding ('br' or 'gzip') at the
    // buffered-path quality (compression.buffered). Defaults are maxed out:
    // serverCache pays this cost once per file, not per request.
    function compressBuffer(data, encoding) {
        if (encoding === 'br') {
            return _brotliCompressAsync(data, {
                params: { [zlib.constants.BROTLI_PARAM_QUALITY]: compressionConfig.buffered.brotliQuality }
            });
        }
        return _gzipAsync(data, { level: compressionConfig.buffered.gzipLevel });
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

        // Whether the client's request path ends with "/" — captured from the
        // raw originalUrl BEFORE the trailing slash is stripped for URL parsing
        // below. Drives the canonical trailing-slash redirect / 404 in the
        // directory / file branch. "/" (root) counts as ending with a slash, so
        // it is already canonical and never redirects.
        const _rawOriginalPath = ctx.originalUrl.split('?')[0];
        const _pathEndsWithSlash = _rawOriginalPath.endsWith('/');
        // Parse the request URL. `new URL()` throws on an invalid Host header
        // (e.g. "Host: bad host") — reject as 400 rather than letting it surface as 500.
        let pageHref = '';
        try {
            if (fullUrl.charAt(fullUrl.length - 1) === '/') {
                pageHref = new URL(fullUrl.slice(0, -1));
            } else {
                pageHref = new URL(fullUrl);
            }
        } catch {
            sendBadRequest(ctx);
            return;
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
            try {
                pageHrefOutPrefix = new URL(hrefOutPrefix);
            } catch {
                sendBadRequest(ctx);
                return;
            }
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

        // From this point on the middleware OWNS the request: every early
        // pass-through above has already returned, and no next() is called below
        // (the template render's next goes through tryRenderTemplate's own catch).
        // Last-resort net: an unexpected failure on any unguarded path must not
        // leak to Koa's default handler (a plain-text 500 without the middleware's
        // security headers, logged outside the operator's `logger`). Errors from
        // downstream middleware are NOT masked — they never reach this try.
        try {
            // Path traversal protection: build and validate safe file path
            let requestedPath = "";
            if (pageHrefOutPrefix.pathname === "/") {
                requestedPath = "";
            } else {
                // decodeURIComponent() throws URIError on malformed percent-encoding
                // (e.g. "/%", "/%zz", a truncated UTF-8 sequence) — reject as 400
                // rather than letting it surface as an unhandled 500.
                try {
                    requestedPath = decodeURIComponent(pageHrefOutPrefix.pathname);
                } catch {
                    sendBadRequest(ctx);
                    return;
                }
            }

            // Null byte guard: path.normalize() throws ERR_INVALID_ARG_VALUE for paths
            // containing \0. Reject early with 400 Bad Request before it reaches fs calls.
            if (requestedPath.includes('\0')) {
                sendBadRequest(ctx);
                return;
            }

            const normalizedPath = path.normalize(requestedPath);
            const fullPath = path.join(normalizedRootDir, normalizedPath);

            // Security check: ensure resolved path is within rootDir. Uses the shared
            // _isWithinRoot() helper, which is boundary-aware: it matches rootDir exactly
            // or rootDir + path.sep, never a sibling (e.g. /srv/wwwsecret for root /srv/www) —
            // hardened defense in depth against a future change to how fullPath is built.
            // Covers: ../ traversal, URL-encoded variants (%2e%2e%2f), and on Windows
            // backslash sequences (path.normalize converts \ to / before the check).
            // Returns 404 (not 403) so "outside root" is indistinguishable from "not found",
            // matching the symlink-escape and hidden-entry outcomes.
            if (!_isWithinRoot(fullPath, normalizedRootDir)) {
                await sendErrorPage(ctx, 404);
                return;
            }

            // Hidden check: block requests that traverse a hidden directory.
            // Stops at length-1 because the leaf (the file or dir being served) is
            // checked separately by the file/listing path with its real stat.isDirectory().
            if (requestedPath !== '') {
                const segments = normalizedPath.split(path.sep).filter(Boolean);
                for (let i = 0; i < segments.length - 1; i++) {
                    const segName = segments[i];
                    const segRelPath = segments.slice(0, i + 1).join('/');
                    if (isHiddenEntry(segName, segRelPath, true)) {
                        await sendErrorPage(ctx, 404);
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

                // Model B (V4): an extension URL is canonicalized to its clean form only when it
                // has NO trailing slash. A trailing slash means directory intent, so /foo.ejs/
                // falls through to the file/dir dispatch, where a file requested with a trailing
                // slash is a 404 (finding #3). We gate on _pathEndsWithSlash — the very flag that
                // #3's file-branch 404 uses — so "skip the redirect" and "404 downstream" are the
                // same condition. requestedPath is decoded (and already slash-stripped by the URL
                // parse), so a percent-encoded dot (/foo%2Eejs → /foo.ejs) matches consistently (#14),
                // while /foo%2Eejs/ is excluded here by _pathEndsWithSlash and 404s downstream.
                if (!_pathEndsWithSlash && requestedPath.endsWith(hideExt)) {
                    // Build redirect target using ctx.originalUrl (always, regardless of
                    // useOriginalUrl). With useOriginalUrl: false the URL-parsing prologue
                    // validated ctx.url (the rewritten one), NOT originalUrl — a malformed
                    // originalUrl (e.g. an absolute-form request target, legal in HTTP/1.1)
                    // makes this constructor throw. Same treatment as the other malformed
                    // client input: 400 Bad Request, not an unhandled error.
                    let originalUrlObj;
                    try {
                        originalUrlObj = new URL(_origin + ctx.originalUrl);
                    } catch {
                        sendBadRequest(ctx);
                        return;
                    }

                    // Build the clean target in DECODED space: the extension may be percent-encoded
                    // in the raw URL (e.g. "%2Eejs"), so decoding first makes it literal and
                    // sliceable, then we re-encode per segment (#14, #20). The URL constructor
                    // already validated the encoding, so decodeURIComponent cannot throw — but
                    // guard for symmetry with the other malformed-client-input guards.
                    let decodedPath;
                    try {
                        decodedPath = decodeURIComponent(originalUrlObj.pathname);
                    } catch {
                        sendBadRequest(ctx);
                        return;
                    }

                    let cleanPath = decodedPath.slice(0, decodedPath.length - hideExt.length);

                    // Special case: /index.ejs → /, /sezione/index.ejs → /sezione/
                    const baseName = path.basename(cleanPath);
                    if (options.index && options.index.length > 0) {
                        for (const pattern of options.index) {
                            if (typeof pattern === 'string' && (baseName + hideExt) === pattern) {
                                // Redirect to the directory (with trailing slash)
                                cleanPath = cleanPath.slice(0, cleanPath.length - baseName.length);
                                break;
                            }
                        }
                    }

                    // Re-encode per path segment: round-trips spaces, "%", etc. back into a valid
                    // URL. encodeURIComponent may over-encode sub-delims in exotic filenames, but
                    // the result always resolves to the same path.
                    let redirectPath = cleanPath.split('/').map(encodeURIComponent).join('/');

                    // Open-redirect guard LAST: a Location starting with "//" (or "/\") is a
                    // protocol-relative URL that would navigate off-origin ("GET //evil.com/foo.ejs").
                    // Placed after re-encoding because a decoded "%2F" can reintroduce a leading
                    // "//"; collapse any run of leading slashes/backslashes to a single slash.
                    if (redirectPath.length > 1 && (redirectPath.charCodeAt(1) === 0x2F || redirectPath.charCodeAt(1) === 0x5C)) {
                        redirectPath = '/' + redirectPath.replace(/^[/\\]+/, '');
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

                    // Security check: ensure resolved path is still within rootDir (boundary-aware)
                    if (_isWithinRoot(pathWithExt, normalizedRootDir)) {
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
                await sendErrorPage(ctx, 404);
                return;
            }

            // Hidden check: block access to the requested file or directory itself
            if (requestedPath !== '') {
                const entryName = path.basename(toOpen);
                const entryRelPath = path.relative(normalizedRootDir, toOpen).split(path.sep).join('/');
                if (isHiddenEntry(entryName, entryRelPath, stat.isDirectory())) {
                    await sendErrorPage(ctx, 404);
                    return;
                }
            }

            // Symlink boundary check (V-1): in protected modes reject any requested file
            // or directory whose realpath escapes rootDir (or, in 'deny' mode, any symlink
            // resolved below rootDir). The `_symlinkMode !== 'follow'` guard short-circuits
            // before any await so the default 'follow' mode stays truly zero-overhead.
            if (_symlinkMode !== 'follow' && !(await symlinkAllowed(toOpen))) {
                await sendErrorPage(ctx, 404);
                return;
            }

            if (stat.isDirectory()) {
                // Handle directory
                if (options.dirListing.enabled) {
                    // Canonical trailing-slash redirect (V4): a directory URL
                    // without a trailing slash serves an index/listing whose
                    // relative links would resolve against the parent. Redirect
                    // /dir → /dir/ (301) BEFORE serving so the browser's base is
                    // the directory itself.
                    if (options.dirListing.trailingSlash && !_pathEndsWithSlash) {
                        // Build the Location from the parsed originalUrl (same
                        // defense as the hideExtension redirect): re-parsing forces
                        // the target to be origin-relative — an absolute-form
                        // request target (`GET http://evil/x`, legal in HTTP/1.1
                        // and reachable under useOriginalUrl:false + rewriting)
                        // would otherwise become an off-origin `Location` (open
                        // redirect). .pathname keeps urlPrefix and percent-encoding.
                        let originalUrlObj;
                        try {
                            originalUrlObj = new URL(_origin + ctx.originalUrl);
                        } catch {
                            sendBadRequest(ctx);
                            return;
                        }
                        // Collapse a leading "//" / "/\" (protocol-relative) to a
                        // single slash before appending the canonical trailing one.
                        let redirectPath = originalUrlObj.pathname;
                        if (redirectPath.length > 1 && (redirectPath.charCodeAt(1) === 0x2F || redirectPath.charCodeAt(1) === 0x5C)) {
                            redirectPath = '/' + redirectPath.replace(/^[/\\]+/, '');
                        }
                        ctx.status = 301;
                        ctx.redirect(redirectPath + '/' + originalUrlObj.search);
                        return;
                    }

                    // Search for index file matching configured patterns
                    if (options.index && options.index.length > 0) {
                        const indexFile = await findIndexFile(toOpen, options.index);
                        if (indexFile) {
                            const indexRelPath = path.relative(normalizedRootDir, path.join(toOpen, indexFile.name)).split(path.sep).join('/');
                            if (!isHiddenEntry(indexFile.name, indexRelPath, false)) {
                                const indexPath = path.join(toOpen, indexFile.name);
                                // Symlink boundary check (V-1): an index file may itself be a
                                // symlink escaping rootDir — validate before serving it.
                                // Guarded so the default 'follow' mode skips the await entirely.
                                if (_symlinkMode !== 'follow' && !(await symlinkAllowed(indexPath))) {
                                    await sendErrorPage(ctx, 404);
                                    return;
                                }
                                await loadFile(indexPath, indexFile.stat);
                                return;
                            }
                        }
                    }

                    // No index file found, show directory listing. On a readdir
                    // failure show_dir writes the 500 error page itself and returns
                    // undefined — don't clobber that body with the listing assignment.
                    const listing = await show_dir(toOpen, ctx);
                    if (listing !== undefined) ctx.body = listing;
                } else {
                    // Directory listing disabled
                    await sendErrorPage(ctx, 404);
                }
                return;
            } else {
                // Canonical trailing-slash 404 (V4): a trailing slash means
                // "directory", but this path resolved to a FILE — a file is only
                // reachable at its slash-less URL. Return 404 (indistinguishable
                // from not-found) rather than serving the file at a non-canonical
                // URL. Disabled by dirListing.trailingSlash: false (v3 behavior).
                if (options.dirListing.trailingSlash && _pathEndsWithSlash) {
                    await sendErrorPage(ctx, 404);
                    return;
                }
                await loadFile(toOpen, stat);
                return;
            }
        } catch (err) {
            _logger.error('[koa-classic-server] Unexpected error while serving the request:', err);
            if (ctx.headerSent || ctx.res.writableEnded) {
                ctx.res.destroy(); // response already in flight — nothing sane left to send
                return;
            }
            // writeErrorPage scrubs the representation/caching headers a
            // partially-built response may have left behind (stale
            // Content-Encoding, public Cache-Control, ...) and sets no-store.
            await sendErrorPage(ctx, 500);
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
                    await sendErrorPage(ctx, 404);
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
                        // Single-flight: concurrent misses on the same path share one
                        // readFile + cache insert; only the leader (the closure below)
                        // runs, waiters await the same Promise. The key includes the
                        // stat'd mtime+size so a request that observed a DIFFERENT
                        // version of the file starts its own job instead of adopting
                        // bytes that don't match the validators it will emit.
                        const inflightKey = `${toOpen}:${fileStat.mtime.getTime()}:${fileStat.size}`;
                        rawBuffer = await singleFlight(_inflightRawReads, inflightKey, async () => {
                            const buf = await fs.promises.readFile(toOpen);
                            refreshOrInsert(_rawFileCache, toOpen, {
                                buffer: buf,
                                mtime: fileStat.mtime.getTime(),
                                size: fileStat.size,
                                insertedAt: Date.now(),
                            }, cached, staleByAge);
                            return buf;
                        });
                    } catch {
                        rawBuffer = null; // Fall through to disk reads later
                    }
                }
            }

            if (await tryRenderTemplate(ctx, next, toOpen, rawBuffer, options.template, _logger, sendErrorPage)) {
                return;
            }

            // baseEtag — encoding-independent; used only for If-Range (Range requests skip compression)
            const baseEtag = `"${fileStat.mtime.getTime()}-${fileStat.size}"`;

            // Advertise range support on all file responses (including 304)
            ctx.set('Accept-Ranges', 'bytes');

            // Opt-in static security headers (V-4). Applies to all static file
            // responses (200 / 206 / 304). Placed after the template early-return,
            // so template-rendered output is unaffected (that is the operator's
            // responsibility inside their render function). Off by default — see
            // the design philosophy: hardening is opt-in, not a default.
            if (staticSecurityHeaders.nosniff) {
                ctx.set('X-Content-Type-Options', 'nosniff');
            }

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
                    await sendErrorPage(ctx, 404);
                    return;
                }
            }

            // Determine MIME type and compression encoding for the full-file response
            const mimeType = mime.lookup(toOpen) || 'application/octet-stream';
            const filename = path.basename(toOpen);

            // Resolve compression: enabled + compressible MIME + meets minFileSize + client supports it
            let encoding = null; // 'br' | 'gzip' | null
            let potentiallyCompressible = false; // response content-negotiates on Accept-Encoding
            if (compressionConfig.enabled && compressionConfig.encodings.length > 0) {
                const isCompressibleMime = compressionConfig.mimeTypes.has(mimeType);
                const meetsMinSize = compressionConfig.minFileSize === false
                    || fileStat.size >= compressionConfig.minFileSize;
                if (isCompressibleMime && meetsMinSize) {
                    potentiallyCompressible = true; // even if this client gets identity
                    encoding = getClientEncoding(ctx.get('Accept-Encoding'));
                }
            }

            // fullEtag is encoding-specific to avoid false 304 hits across representations.
            // Proxies use Vary: Accept-Encoding to cache separate versions per encoding.
            const etagSuffix = encoding === 'br' ? '-br' : encoding === 'gzip' ? '-gz' : '';
            const fullEtag = `"${fileStat.mtime.getTime()}-${fileStat.size}${etagSuffix}"`;

            // Vary: Accept-Encoding as soon as the resource is *potentially* compressible —
            // regardless of whether THIS client gets a compressed variant, and regardless
            // of browserCacheEnabled. RFC 9110 §15.4.5: the 304 below must carry the same
            // Vary the 200 would; and a shared proxy must not serve the identity variant to
            // a client that would have received the compressed one (#7).
            if (potentiallyCompressible) {
                ctx.set('Vary', 'Accept-Encoding');
            }

            // Preconditions are evaluated BEFORE the Range branch: RFC 9110 §13.2.2 gives the
            // validators precedence over Range (steps 3/4 before step 5), so a conditional
            // request that matches returns 304 (Not Modified), not 206 (Partial Content).
            // Comparison uses fullEtag (the encoding-specific representation a full GET would
            // return); a 206 below re-tags itself with baseEtag (the identity partial it serves).
            if (options.browserCacheEnabled) {
                ctx.set('ETag', fullEtag);
                ctx.set('Last-Modified', fileStat.mtime.toUTCString());

                // If-None-Match: "*" | comma-list, weak comparison (RFC 9110 §13.1.2).
                if (ifNoneMatchSatisfied(ctx.get('If-None-Match'), fullEtag)) {
                    ctx.status = 304;
                    return;
                }

                // If-Modified-Since (date validation). The mtime is truncated to whole seconds
                // before comparing: Last-Modified is emitted via toUTCString() (second precision
                // — HTTP dates have no milliseconds), so a client echoing that header back would
                // otherwise never match a sub-second mtime (e.g. 22:13:20.500 <= 22:13:20.000).
                const clientModifiedSince = ctx.get('If-Modified-Since');
                if (clientModifiedSince) {
                    const clientDate = new Date(clientModifiedSince);
                    const mtimeSeconds = Math.floor(fileStat.mtime.getTime() / 1000) * 1000;
                    if (mtimeSeconds <= clientDate.getTime()) {
                        ctx.status = 304;
                        return;
                    }
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

                        ctx.status = 206;
                        // 206 returns identity bytes → tag with baseEtag, not the encoding-specific
                        // fullEtag set above. Last-Modified is already set (browserCacheEnabled).
                        if (options.browserCacheEnabled) ctx.set('ETag', baseEtag);
                        ctx.set('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                        ctx.set('Content-Type', mimeType);
                        ctx.set('Content-Length', String(rangeLength));
                        ctx.set('Content-Disposition', buildContentDisposition(filename));

                        if (ctx.method !== 'HEAD') {
                            if (rawBuffer) {
                                // Serve range slice from in-memory buffer — zero disk I/O.
                                // subarray(): zero-copy view; Buffer.slice is deprecated (DEP0158).
                                ctx.body = rawBuffer.subarray(start, end + 1);
                            } else {
                                const src = fs.createReadStream(toOpen, { start, end });
                                src.on('error', (err) => {
                                    _logger.error('Stream error:', err);
                                    if (!ctx.headerSent) sendErrorPageSync(ctx, 500);
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

            // Common response headers
            ctx.set('Content-Type', mimeType);
            ctx.set('Content-Disposition', buildContentDisposition(filename));

            if (encoding) {
                // ── Compressed response ───────────────────────────────────────────────
                // Vary: Accept-Encoding is already set above (potentiallyCompressible).
                ctx.set('Content-Encoding', encoding);

                // Safety net (#4): the buffered path reads the WHOLE file into RAM and
                // compresses at max quality — fine for web assets, catastrophic for a
                // multi-GB log/CSV. Above compression.maxFileSize the bounded-RAM
                // streaming mode below is used instead. The cap gates only HOW the
                // compression runs (buffered Q11 vs streamed Q4) — the compressed
                // cache stays in play on both sides: above the cap the streamed
                // OUTPUT is teed into the cache when it fits (see the tee branch),
                // so later requests are RAM hits either way.
                const withinCompressCap = compressionConfig.maxFileSize === false
                    || fileStat.size <= compressionConfig.maxFileSize;

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
                    } else if (!withinCompressCap) {
                        // Above the buffered-compression cap: stream at the bounded-RAM
                        // quality (never buffer the input), and tee the compressed OUTPUT
                        // into the cache so later requests are RAM hits with Content-Length.
                        // The cap protects against a large INPUT; the cache admission below
                        // is decided on the actual OUTPUT size, which is only known here.
                        if (ctx.method === 'HEAD') {
                            // Mirror the GET status/headers (RFC 9110 §9.3.2) without running
                            // the compression: no Content-Length (unknown), no cache insert.
                            ctx.status = 200;
                            return;
                        }
                        const mtimeMs = fileStat.mtime.getTime();
                        const teeKey = `${cacheKey}:${mtimeMs}:${fileStat.size}`;
                        if (_inflightStreamTees.has(teeKey)) {
                            // Follower: another request is already accumulating this exact
                            // file version. Stream independently (no added latency, no tee
                            // stage) — the cache will be warm for the NEXT request.
                            streamCompressedBody(ctx, toOpen, rawBuffer, encoding);
                            return;
                        }
                        // Leader: stream AND accumulate a copy for the cache.
                        _inflightStreamTees.add(teeKey);
                        let acc = [];
                        let accBytes = 0;
                        // Two admission bounds, both on the real OUTPUT size:
                        //  - per entry: maxEntrySize (default: a quarter of the cache), so
                        //    one huge file cannot evict most of the working set on insert.
                        //    Checked here — not just in LFUCache.set() — to stop ACCUMULATING
                        //    RAM as soon as the budget is blown, not merely refuse the insert;
                        //  - aggregate (_inflightTeeBytes): all in-flight tees together may
                        //    never hold more RAM than the cache's own maxSize.
                        const entryCap = serverCacheConfig.compressedFile.maxEntrySize;
                        // Stops accumulating and releases this tee's share of the aggregate
                        // budget. Safe to call more than once.
                        const abandonAccumulation = () => {
                            if (acc) {
                                _inflightTeeBytes -= accBytes;
                                acc = null;
                            }
                        };
                        try {
                            const compress = createStreamCompressor(encoding, compressionConfig.streaming);
                            const src = rawBuffer
                                ? Readable.from(rawBuffer) // compress from in-memory buffer — no disk I/O
                                : fs.createReadStream(toOpen);
                            const tee = new Transform({
                                transform(chunk, _enc, done) {
                                    if (acc) {
                                        accBytes += chunk.length;
                                        _inflightTeeBytes += chunk.length;
                                        if (accBytes > entryCap
                                            || _inflightTeeBytes > serverCacheConfig.compressedFile.maxSize) {
                                            abandonAccumulation(); // over budget: keep streaming, skip the cache
                                        } else {
                                            acc.push(chunk);
                                        }
                                    }
                                    done(null, chunk);
                                },
                            });
                            // pipeline (NOT pipe): teardown propagates in BOTH directions —
                            // same fd-leak rationale as streamCompressedBody.
                            ctx.body = pipeline(src, compress, tee, (err) => {
                                _inflightStreamTees.delete(teeKey);
                                if (!err && acc) {
                                    // Clean completion only: an aborted or failed stream never
                                    // inserts a (truncated) entry.
                                    refreshOrInsert(_compressedFileCache, cacheKey, {
                                        buffer: Buffer.concat(acc, accBytes),
                                        mtime: mtimeMs,
                                        size: fileStat.size,
                                        insertedAt: Date.now(),
                                    }, cached, staleByAge);
                                }
                                abandonAccumulation();
                                if (!err || err.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
                                _logger.error('Stream error:', err);
                                if (!ctx.headerSent) sendErrorPageSync(ctx, 500);
                            });
                        } catch (err) {
                            // Defensive: nothing between add() and pipeline() is expected to
                            // throw synchronously, but a leaked teeKey would silently disable
                            // the tee for this file version forever.
                            _inflightStreamTees.delete(teeKey);
                            abandonAccumulation();
                            throw err;
                        }
                        return;
                    } else {
                        try {
                            // Single-flight: concurrent misses on the same path+encoding
                            // share one read+compress+insert instead of N parallel brotli
                            // jobs for identical content. A rejection is shared too: all
                            // waiters land in this catch and use the uncompressed fallback.
                            // The key includes the stat'd mtime+size so a request that
                            // observed a DIFFERENT version of the file starts its own job
                            // (its ETag/Last-Modified must describe the bytes it serves).
                            const inflightKey = `${cacheKey}:${fileStat.mtime.getTime()}:${fileStat.size}`;
                            buf = await singleFlight(_inflightCompressions, inflightKey, async () => {
                                // Use rawFile buffer if available — avoids redundant disk read
                                const rawData = rawBuffer || await fs.promises.readFile(toOpen);
                                const compressed = await compressBuffer(rawData, encoding);
                                refreshOrInsert(_compressedFileCache, cacheKey, {
                                    buffer: compressed,
                                    mtime: fileStat.mtime.getTime(),
                                    size: fileStat.size,
                                    insertedAt: Date.now(),
                                }, cached, staleByAge);
                                return compressed;
                            });
                        } catch (err) {
                            _logger.error('Compression error:', err);
                            // Fall back to uncompressed on any compression failure. Vary STAYS
                            // (the resource is still compressible), but the ETag must be reset to
                            // the un-suffixed form: this identity body must not be cached by a
                            // shared proxy under the -br/-gz validator (#7).
                            ctx.remove('Content-Encoding');
                            if (options.browserCacheEnabled) ctx.set('ETag', baseEtag);
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
                                        if (!ctx.headerSent) sendErrorPageSync(ctx, 500);
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
                    // Streaming mode (compressed cache disabled): pipe through the zlib
                    // transform — Content-Length not known in advance, nothing cached.
                    if (ctx.method !== 'HEAD') {
                        streamCompressedBody(ctx, toOpen, rawBuffer, encoding);
                    } else {
                        // HEAD: mirror the GET status and headers (RFC 9110 §9.3.2) — no
                        // Content-Length, since the compressed size is unknown without
                        // running the compression. The explicit status is required: with
                        // no body ever assigned, Koa would otherwise respond its default 404.
                        ctx.status = 200;
                    }
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
                            if (!ctx.headerSent) sendErrorPageSync(ctx, 500);
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
                // Route through the unified writer so this 500 honors errorPages[500]
                // (custom page when configured), the no-store / header-scrub, and the
                // generated-page security headers — like every other 500. sendErrorPage
                // sets ctx.status/headers/body itself; returning undefined signals the
                // caller not to overwrite the body it just wrote.
                await sendErrorPage(ctx, 500);
                return undefined;
            }

            // Relative path of this directory from rootDir (used for alwaysHide path matching)
            const rawDirRel = path.relative(normalizedRootDir, toOpen);
            const dirRelPath = (rawDirRel === '' || rawDirRel === '.') ? '' : rawDirRel.split(path.sep).join('/');

            // Get sorting parameters from query string
            const sortBy = ctx.query.sort || 'name';
            const sortOrder = ctx.query.order || 'asc';

            // Base for the listing's self-referencing links (sort headers,
            // paginator). Built from the WITH-prefix pathname — the out-prefix
            // one would make these links escape urlPrefix (#2), unlike the
            // parent/entry links which already use pageHref — and normalized
            // to exactly one trailing slash: the pathname was slash-stripped
            // for URL parsing, and linking the canonical /dir/ form spares a
            // 301 redirect hop on every sort/pagination click.
            const baseUrl = pageHref.pathname.endsWith('/')
                ? pageHref.pathname
                : pageHref.pathname + '/';

            // Preserves sort/order while overriding `page`; omits page when 0.
            function buildQueryUrl(targetPage) {
                const params = [];
                if (ctx.query.sort)  params.push(`sort=${encodeURIComponent(ctx.query.sort)}`);
                if (ctx.query.order) params.push(`order=${encodeURIComponent(ctx.query.order)}`);
                if (targetPage > 0)  params.push(`page=${targetPage}`);
                return params.length ? `${baseUrl}?${params.join('&')}` : baseUrl;
            }

            function getSortUrl(column) {
                let newOrder = 'asc';
                if (sortBy === column && sortOrder === 'asc') {
                    newOrder = 'desc';
                }
                return `${baseUrl}?sort=${column}&order=${newOrder}`;
            }

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

            // Parent directory link — omitted at the middleware's LOGICAL root
            // (pageHrefOutPrefix.pathname === '/'), not only at the absolute root: with
            // urlPrefix '/static', the listing of /static/ must not link to '/', which is
            // outside the served tree (#13).
            const currentPath = pageHref.origin + pageHref.pathname;
            if (pageHrefOutPrefix.pathname !== "/") {
                // Build parent directory URL without query parameters
                const a_pD = currentPath.split("/");
                a_pD.pop();
                const parentDirectory = a_pD.join("/");
                // Escape HTML to prevent XSS
                parts.push(`<tr><td><a href="${escapeHtml(parentDirectory)}"><b>.. Parent Directory</b></a></td><td>DIR</td><td>-</td></tr>`);
            }

            const emptyFolderRow = `<tr><td>empty folder</td><td></td><td></td></tr>`;
            if (dir.length === 0) {
                parts.push(emptyFolderRow);
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
                                itemUri = `${_listingOriginPrefix}/${encodeURIComponent(toWellFormedName(s_name))}`;
                            } else {
                                itemUri = `${_listingBaseUrl}/${encodeURIComponent(toWellFormedName(s_name))}`;
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

                            // Symlink boundary (V-1): in protected modes, flag entries whose
                            // target escapes rootDir (or, in 'deny' mode, any symlink). Blocked
                            // entries are rendered non-clickable and do not expose the target size.
                            let isBlockedSymlink = false;
                            if (_symlinkMode !== 'follow' && !isBrokenSymlink && (type === 3 || type === 0)) {
                                if (!(await symlinkAllowed(itemPath))) isBlockedSymlink = true;
                            }

                            // Get file size — reuse cachedStat if already available (avoids double stat for symlinks)
                            let sizeStr = '-';
                            let sizeBytes = 0;
                            if (!isBrokenSymlink && !isBlockedSymlink) {
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
                                isBlockedSymlink,
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

                // Every entry was filtered out as hidden (dotfiles / alwaysHide / blacklist):
                // show the same "empty folder" row as a physically empty directory (#16), not a
                // header-only empty table (which would also hint that hidden files exist).
                if (items.length === 0) {
                    parts.push(emptyFolderRow);
                }

                // Places directories before non-directories; falls back to `tieBreaker`
                // when both items are in the same bucket. `effectiveType === 2` covers plain
                // dirs and dir-resolved symlinks, matching the rest of the listing logic.
                const compareDirsFirst = (a, b, tieBreaker) => {
                    const aIsDir = a.effectiveType === 2;
                    const bIsDir = b.effectiveType === 2;
                    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
                    return tieBreaker(a, b);
                };

                items.sort((a, b) => {
                    let comparison = 0;

                    if (sortBy === 'name') {
                        comparison = a.name.localeCompare(b.name);
                    } else if (sortBy === 'type') {
                        comparison = compareDirsFirst(a, b, (x, y) => x.mimeType.localeCompare(y.mimeType));
                    } else if (sortBy === 'size') {
                        comparison = compareDirsFirst(a, b, (x, y) => x.sizeBytes - y.sizeBytes);
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
                        : item.isBlockedSymlink
                            ? ' ( Blocked Symlink )'
                            : item.isSymlink
                                ? ' ( Symlink )'
                                : '';

                    if (item.isReserved) {
                        parts.push(`${rowStart} <bdi>${listingDisplayName(item.name)}</bdi>${symlinkLabel}</td> <td> DIR BUT RESERVED</td><td>${item.sizeStr}</td></tr>`);
                    } else if (item.isBrokenSymlink || item.isBlockedSymlink) {
                        // Broken or policy-blocked symlink: name visible but not clickable
                        parts.push(`${rowStart} <bdi>${listingDisplayName(item.name)}</bdi>${symlinkLabel}</td> <td> ${escapeHtml(item.mimeType)} </td><td>${item.sizeStr}</td></tr>`);
                    } else {
                        parts.push(`${rowStart} <bdi><a href="${escapeHtml(item.itemUri)}">${listingDisplayName(item.name)}</a></bdi>${symlinkLabel} </td> <td> ${escapeHtml(item.mimeType)} </td><td>${item.sizeStr}</td></tr>`);
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

// ── Test-only internals ──────────────────────────────────────────────────────
// NOT part of the public API: exposed so the unit tests can exercise the pure
// helpers and the LFU cache directly (eviction order, frequency preservation,
// range parsing, validator matching) without a full HTTP round-trip. No
// stability guarantee — do not import from application code.
module.exports._internals = {
    LFUCache,
    parseRangeHeader,
    ifNoneMatchSatisfied,
    formatSize,
    singleFlight,
    refreshOrInsert,
    escapeHtml,
    // toWellFormedName / buildContentDisposition / listingDisplayName: the
    // lone-surrogate class (#14) cannot be exercised through fixtures on
    // POSIX (invalid UTF-8 names become U+FFFD at write time, and only
    // Windows readdir can return WTF-16 names), so their totality is
    // asserted at unit level here.
    toWellFormedName,
    buildContentDisposition,
    listingDisplayName,
    // writeErrorPage is the shared output path for every middleware-generated error
    // response (sendErrorPage / sendErrorPageSync delegate to it). Exposed so its
    // contract — header scrub, no-store on >=500, Content-Type, custom-vs-built-in
    // body, CSP only for the built-in page — can be asserted deterministically: the
    // stream-failure branches that also use it can't be, because Koa 3 tears the
    // socket down on a mid-stream body error before the client sees the response.
    writeErrorPage,
};
