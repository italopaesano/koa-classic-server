# koa-classic-server

**Serve a directory of files over HTTP from Koa** — with classic, sortable directory
listings, clean URLs, automatic compression, and HTTP caching. In the spirit of a
traditional web server, but intentionally its own thing.

[![npm version](https://img.shields.io/npm/v/koa-classic-server.svg)](https://www.npmjs.com/package/koa-classic-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-1239%20passing-brightgreen.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue.svg)]()
[![Koa](https://img.shields.io/badge/koa-%3E%3D3.1.2-blue.svg)]()

One rule drives every default:

> **If a file exists under `rootDir`, `GET` on its path returns it. A directory without an
> index file shows a listing of every visible entry.**

Defaults are transparent — the middleware never hides or restricts your files unless you ask.
Hardening is opt-in.

---

## Install

```bash
npm install koa-classic-server
```

Requires **Node ≥ 20** and **Koa ≥ 3.1.2**. (Koa 2 and Node 18 were supported through v4.x; both were dropped in v5.0.0.)

### Import

Ships as both CommonJS and ES modules via conditional exports — use whichever your project prefers:

```javascript
// CommonJS
const koaClassicServer = require('koa-classic-server');

// ES modules
import koaClassicServer from 'koa-classic-server';
```

The examples below use CommonJS; they work identically with the ESM import.

---

## Quick start

```javascript
const Koa = require('koa');
const path = require('path');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();
app.use(koaClassicServer(path.join(__dirname, 'public')));
app.listen(3000);
// → serves ./public, with a browsable listing when there's no index file
```

> `rootDir` **must be an absolute path** — use `path.join(__dirname, ...)`.

---

## Examples

Each example is self-contained. Copy, adjust the path, run.

### Serve a site with an index file

```javascript
app.use(koaClassicServer(path.join(__dirname, 'public'), {
  index: ['index.html'],   // GET /  → public/index.html
}));
```

### A browsable, sortable, paginated listing

```javascript
app.use(koaClassicServer(path.join(__dirname, 'uploads'), {
  dirListing: {
    enabled:        true,
    entriesPerPage: 100,   // paginate with ?page=N once a folder exceeds this
  },
}));
// Click Name / Type / Size to sort; sort order is kept across pages.
```

### Clean URLs with a template engine (EJS)

```javascript
const ejs = require('ejs');

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  hideExtension: { ext: '.ejs' },   // GET /about → views/about.ejs ; GET /about.ejs → 301 /about
  template: {
    ext: ['.ejs'],   // leading dot optional since v5: '.ejs' (preferred) ≡ 'ejs'
    // signature: (ctx, next, filePath, rawBuffer, signal)
    render: async (ctx, next, filePath, rawBuffer, signal) => {
      ctx.type = 'html';
      ctx.body = await ejs.renderFile(filePath, { user: ctx.state.user }, { signal });
    },
  },
}));
```

`rawBuffer` (4th arg) is the file's bytes if already in cache (may be `null`) and is **read-only**.
`signal` (5th arg) aborts on timeout **and** on client disconnect — forward it to your I/O.

### HTTP caching (production)

```javascript
app.use(koaClassicServer(path.join(__dirname, 'public'), {
  browserCacheEnabled: true,    // ETag + Last-Modified, and 304 on revalidation
  browserCacheMaxAge:  86400,   // Cache-Control: max-age=86400 (24h)
}));
```

Off by default (development-friendly). Conditional requests are fully handled: `If-None-Match`
(lists, `*`, weak tags), `If-Modified-Since`, and `Range` (206) all behave per the HTTP spec.

### Compression — automatic

Brotli/gzip are **on by default** for compressible types, negotiated from `Accept-Encoding`
and cached server-side. Nothing to configure. To tune or disable:

```javascript
app.use(koaClassicServer(root, {
  compression: {
    encodings:   ['br', 'gzip'], // server preference order; [] disables
    minFileSize: 1024,           // don't compress tiny files
  },
}));

// or turn it off entirely:
app.use(koaClassicServer(root, { compression: false }));
```

To size compression quality and the server-side caches to your host's RAM and CPU
(small VPS, weak CPU, big dedicated box, behind a CDN), see the
**[Performance Tuning Guide](./docs/PERFORMANCE_TUNING.md)** — it includes
copy-paste profiles.

### Hide sensitive files

Dot-files are **served by default** (the operator's directory is the source of truth). For a
public deployment, hide them explicitly:

```javascript
app.use(koaClassicServer(path.join(__dirname, 'www'), {
  hidden: {
    dotFiles: { default: 'hidden', whitelist: ['.well-known'] }, // keep ACME/Let's Encrypt working
    dotDirs:  { default: 'hidden', whitelist: ['.well-known'] },
    alwaysHide: ['*.key', /secret/i],                            // path-aware patterns
  },
}));
// .env, .git/config, *.key → 404
```

### Custom error pages

Branded 404/500/504 pages from self-contained `.html` files (v4.2+). Keep them **outside**
`rootDir` so they are not themselves reachable via URL; edit them anytime — changes are
picked up without a restart, and an unreadable file falls back to the built-in page:

```javascript
app.use(koaClassicServer(path.join(__dirname, 'www'), {
  errorPages: {
    404: path.join(__dirname, 'errors', '404.html'),
    500: path.join(__dirname, 'errors', '500.html'),
  },
}));
```

One rule: each page must be a single self-contained file (inline CSS, no external
css/js/img references). Custom pages are served without the built-in pages'
`Content-Security-Policy`, so an external reference would really load.

### Mount under a prefix, pass through some routes

```javascript
app.use(koaClassicServer(path.join(__dirname, 'public'), {
  urlPrefix:    '/static',              // GET /static/app.js → public/app.js
  urlsReserved: ['/api', '/admin'],     // first-level paths handed to the next middleware
}));
```

### Serve several directories

Mount it once per directory, each under its own `urlPrefix` — a request outside a mount's prefix falls through to the next:

```javascript
// Assets under /static, no listing
app.use(koaClassicServer(path.join(__dirname, 'public'), {
  urlPrefix: '/static',
  dirListing: { enabled: false },
}));

// Uploads under /files, browsable
app.use(koaClassicServer(path.join(__dirname, 'uploads'), {
  urlPrefix: '/files',
  dirListing: { enabled: true },
}));
```

### Allow HEAD (health checks, preflight)

Only `GET` is accepted by default; other methods fall through to the next middleware:

```javascript
app.use(koaClassicServer(root, {
  method: ['GET', 'HEAD'],   // HEAD mirrors GET: same status + headers, no body
}));
```

### Behind a URL rewriter (i18n, routing)

When an upstream middleware mutates `ctx.url`, tell the server to resolve against the rewritten URL:

```javascript
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/it/')) ctx.url = ctx.url.replace(/^\/it/, ''); // /it/page → /page
  await next();
});

app.use(koaClassicServer(path.join(__dirname, 'www'), {
  useOriginalUrl: false,   // resolve ctx.url (rewritten) instead of ctx.originalUrl
}));
```

### Keep symlinks inside `rootDir`

If `rootDir` holds files writable by untrusted parties (uploads, multi-tenant), stop a planted
symlink from escaping the served tree:

```javascript
app.use(koaClassicServer(root, {
  symlinks: 'follow-within-root',   // a link resolving outside rootDir → 404
}));
```

### A production-shaped setup

```javascript
const pino = require('pino')({ level: 'info' });

app.use(koaClassicServer(path.join(__dirname, 'public'), {
  index:               ['index.html'],
  dirListing:          { enabled: process.env.NODE_ENV !== 'production' },
  browserCacheEnabled: true,
  browserCacheMaxAge:  86400,
  logger:              pino,   // any { error, warn, info, debug } object (Pino/Winston/Bunyan/console)
  hidden: {
    dotFiles: { default: 'hidden', whitelist: ['.well-known'] },
    dotDirs:  { default: 'hidden', whitelist: ['.well-known'] },
  },
}));
```

---

## What's new in v5

**v5.0.0** is the configuration-correctness release: config mistakes that used to
misbehave silently at request time now fail fast at startup, and the two extension
options finally share one coherent, forgiving syntax.

- **`hideExtension.redirect` is validated at startup.** Accepted values are the real
  redirect codes — `300, 301, 302, 303, 305, 307, 308` — and anything else **throws at
  factory time** with the valid list in the message. Until v4 a wrong value failed
  silently in production: a non-redirect integer (`200`, `404`, `999`, …) was quietly
  sent as `302`, and a non-integer value produced a **500 on every redirect**.
- **The leading dot is optional in `template.ext` and `hideExtension.ext`** — `'.ejs'`
  and `'ejs'` are equivalent everywhere; the preferred, documented form is **`'.ejs'`**.
  This also fixes a long-standing trap: a dotted `template.ext` entry (`['.ejs']`) used
  to never match, so the render never ran and the **template source was served raw**.
  It now works as intended.
- **`template.ext` matches by suffix** (as `hideExtension.ext` always did), so compound
  extensions are supported: `['.html.ejs']` targets only `*.html.ejs` files. Entries
  that cannot name a suffix (empty, `'.'`, non-string) are dropped with a one-time
  warning.
- **A non-function `template.render` now warns** (one-time) instead of silently
  disabling template rendering.

The v4 highlights — canonical trailing slash, bounded compression with streamed-output
caching, configurable compression quality, custom error pages — are all still here.
Full details in the **[changelog](./docs/CHANGELOG.md)**.

---

## Options

Defaults shown; every option is optional.

```javascript
koaClassicServer(rootDir, {
  method: ['GET'],                       // allowed HTTP methods

  dirListing: {
    enabled:        true,                // render a listing when no index matches (false → 404)
    entriesPerPage: 100,                 // paginate above this (0 = off)
    maxEntries:     10000,               // safety-net cap on entries rendered (0 = off)
    trailingSlash:  true,                // v4: /dir → 301 /dir/, /file/ → 404
  },

  index: [],                             // e.g. ['index.html']; strings and/or RegExp

  urlPrefix:    '',                      // e.g. '/static' (leading slash, no trailing)
  urlsReserved: [],                      // e.g. ['/api'] — first-level, passed to next()
  useOriginalUrl: true,                  // false when an upstream middleware rewrites ctx.url

  hideExtension: {                       // clean URLs
    ext:      '.ejs',                    // suffix to hide — leading dot optional (v5), compound ('.tar.gz') ok
    redirect: 301,                       // v5: must be 300|301|302|303|305|307|308, else throws at startup
  },

  hidden: {                              // everything visible by default
    dotFiles: { default: 'visible', whitelist: [], blacklist: [] },
    dotDirs:  { default: 'visible', whitelist: [], blacklist: [] },
    alwaysHide: [],                      // glob strings or RegExp, path-aware
  },

  browserCacheEnabled: false,            // ETag/Last-Modified/304 (recommended true in prod)
  browserCacheMaxAge:  3600,             // Cache-Control max-age (seconds)

  compression: {                         // or `compression: false`
    enabled:     true,
    encodings:   ['br', 'gzip'],
    minFileSize: 1024,
    maxFileSize: 10485760,               // 10 MB buffered-path cap (false = no cap)
    mimeTypes:   [],                     // override the compressible-type list
    buffered:  { brotliQuality: 11, gzipLevel: 9 },  // v4.3: quality when compressing once, then caching
    streaming: { brotliQuality: 4,  gzipLevel: 6 },  // v4.3: quality when compressing per request (above maxFileSize)
  },

  serverCache: {                         // in-memory server-side caches
    rawFile: {                           // cache raw file buffers (skip disk reads)
      enabled:      false,
      maxSize:      52428800,            // total RAM cap, bytes (50 MB)
      maxFileSize:  1048576,             // larger files are never cached, bytes (1 MB)
      maxAge:       0,                   // ms before an entry counts as stale (0 = off)
      warnInterval: 60000,               // ms between "maxSize reached" warnings (0 = always, false = never)
    },
    compressedFile: {                    // cache br/gzip responses (compress once)
      enabled:      true,
      maxSize:      104857600,           // total RAM cap, bytes (100 MB)
      maxEntrySize: undefined,           // v4.3: per-entry cap on the compressed output, bytes
                                         //   default: maxSize / 4; false = no per-entry cap;
                                         //   oversized entries are served, just never cached
      maxAge:       0,                   // ms before an entry counts as stale (0 = off)
      warnInterval: 60000,               // ms between "maxSize reached" warnings (0 = always, false = never)
    },
  },

  symlinks: 'follow',                    // 'follow' | 'follow-within-root' | 'deny'
  staticSecurityHeaders: { nosniff: false }, // set nosniff on static responses

  errorPages: {                          // custom error pages (v4.2+); omitted → built-ins
    // 404: './errors/404.html',         // supported statuses: 404, 500, 504
    // 500: './errors/500.html',         // self-contained .html (inline CSS, no external refs)
    // 504: './errors/504.html',         // editable without a restart; unreadable → built-in
  },

  template: {
    ext: [],                             // e.g. ['.ejs'] — dot optional (v5); suffix match, so
                                         //   compound entries ('.html.ejs') target *.html.ejs only
    renderTimeout: 30000,                // ms; on timeout the request fails closed (0 = off)
    render: async (ctx, next, filePath, rawBuffer, signal) => { /* ... */ },
  },

  logger: console,                       // { error, warn, info, debug }
})
```

Full per-option reference: **[docs/DOCUMENTATION.md](./docs/DOCUMENTATION.md)**.

---

## Security

Defaults are transparent, so **hardening is a deliberate opt-in**. The single source of truth is
the **[Security Hardening Guide](./docs/SECURITY_HARDENING.md)** — threat models, per-topic
recommendations, per-profile checklists, and a copy-paste maximally-hardened config.

Built in and always on: path-traversal defense (traversal / encoded / null-byte / boundary →
404 or 400, never a leak), HTML-escaping + hash-based CSP on the listing, security headers on
generated pages, and last-resort error containment. Host validation and static-file CSP/HSTS
are intentionally left to a reverse proxy or an upstream middleware.

---

## Migrating from v4

If your `hideExtension.redirect` is already a real redirect code (or unset) and your
`template.ext` entries are dot-less, **v5 changes nothing** — everything below is either a
config bug surfacing earlier or a previously broken form starting to work.

| What | v4 | v5 |
|---|---|---|
| `hideExtension.redirect: 200` (any non-redirect integer) | silently sent as `302` | **throws at startup** — valid: `300, 301, 302, 303, 305, 307, 308` |
| `hideExtension.redirect: '301'` (non-integer) | **500 on every redirect** | **throws at startup** |
| `template.ext: ['.ejs']` (with dot) | never matched — template source served raw | **renders** — `'.ejs'` ≡ `'ejs'`, dotted form preferred |
| `template.ext: ['.html.ejs']` (compound) | never matched | targets `*.html.ejs` files only |
| `hideExtension.ext: 'ejs'` (no dot) | worked, with a warning | works — warning gone, both forms legal |
| `template.render: <non-function>` | silently dropped (sources served raw) | one-time warning (startup error planned for v6) |

The v3 → v4 notes (trailing slash, `compression.maxFileSize`, strict `options` validation)
remain in the **[changelog](./docs/CHANGELOG.md)**.

---

## Testing

```bash
npm test                 # full suite (lints first)
npm run test:ci          # suite without benchmarks — 1284 tests
npm run test:security    # security tests only
npm run test:performance # benchmarks
```

The suite includes [fast-check](https://fast-check.dev) property-based tests
(`__tests__/*.property.test.js`) alongside the example-based ones. They are
intentionally un-seeded; to replay a failure, see
**[property-based-testing.md](./docs/property-based-testing.md)**.

---

## Docs

- **[DOCUMENTATION.md](./docs/DOCUMENTATION.md)** — full API reference
- **[SECURITY_HARDENING.md](./docs/SECURITY_HARDENING.md)** — hardening guide (canonical)
- **[PERFORMANCE_TUNING.md](./docs/PERFORMANCE_TUNING.md)** — sizing caches & compression for your host's RAM/CPU
- **[CHANGELOG.md](./docs/CHANGELOG.md)** — version history
- **[TEMPLATE_ENGINE_GUIDE.md](./docs/template-engine/TEMPLATE_ENGINE_GUIDE.md)** — EJS/Pug/Handlebars/Nunjucks

---

## License

MIT © Italo Paesano · [npm](https://www.npmjs.com/package/koa-classic-server) · [GitHub](https://github.com/italopaesano/koa-classic-server) · [Issues](https://github.com/italopaesano/koa-classic-server/issues)
