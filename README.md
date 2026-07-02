# koa-classic-server

🚀 **Production-ready Koa middleware** for serving static files with Apache2-like directory listing, sortable columns, pagination, hash-based CSP, template-engine timeouts, injectable logging, and enterprise-grade security.

[![npm version](https://img.shields.io/npm/v/koa-classic-server.svg)](https://www.npmjs.com/package/koa-classic-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-532%20passing-brightgreen.svg)]()
[![Node](https://img.shields.io/badge/node-%3E%3D18-blue.svg)]()

---

## 🎉 Version 3.0 — File Server First, Observable, Bounded

The 3.0 series builds on 2.x with new observability hooks, bounded resource usage on accidentally-large directories, and a more focused **design philosophy**: koa-classic-server is an **HTTP file server first** — defaults serve files without applying surprise restrictions, and hardening is opt-in via explicit configuration plus a documented Security Checklist.

### Key Features in Version 3.x

✅ **Design philosophy made explicit** — *"if a file is in `rootDir`, `GET` returns it"* — codified in [`CLAUDE.md`](./CLAUDE.md), with a **Security Checklist** + **Suggested Production Security Configuration** in this README and `docs/DOCUMENTATION.md`
✅ **`dirListing` namespace** — listing options grouped under one structured object (`enabled`, `maxEntries`, `entriesPerPage`); the v2 `showDirContents` flag is kept as a deprecated alias with a one-time warning
✅ **Soft cap on listing rendering** — `dirListing.maxEntries` defaults to `100000` as a *safety net* against accidentally-huge directories (broken log rotation, mistakenly mounted FS), NOT as a policy restriction; banner + `X-Dir-Truncated` header on the rare hit. Opt-in RAM-bounded streaming reads planned for v3.1.
✅ **Paginated listings** — `dirListing.entriesPerPage` adds 0-based `?page=N` navigation with First/Prev/Next/Last + `X-Dir-Pagination` header
✅ **Template render timeout + AbortSignal** — `template.renderTimeout` (default 30s) + a per-request `template.signal` so slow renders never wedge the server
✅ **Injectable logger** — pass any `{ error, warn, info, debug }`-shaped logger (Pino, Bunyan, Winston, console) for full observability
✅ **Hash-based CSP on listing page** — automatic SHA-256 of inline CSS, recomputed at module load
✅ **Security headers on generated pages** — `CSP`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` on listing + error pages
✅ **Sortable Directory Columns** — Click Name/Type/Size to sort (Apache2-like) with sort/order preserved across paginator links
✅ **HTTP Caching** — ETag, Last-Modified, conditional 304 responses (opt-in via `browserCacheEnabled`)
✅ **Template Engine Support** — EJS, Pug, Handlebars, Nunjucks, and more — with full async/await, AbortSignal forwarding, and timeout enforcement
✅ **Clean URLs** — Hide file extensions via `hideExtension` (mod_rewrite-like)
✅ **Symlink Support** — Transparent resolution + clear indicators in the listing
✅ **532 tests passing** — comprehensive coverage including security, listing pagination, logger injection, template timeouts, and edge cases

[See full changelog →](./docs/CHANGELOG.md)

---

## Features

**koa-classic-server** is a high-performance middleware for serving static files with Apache2-like behavior, making file browsing intuitive, observable, and safe.

### Core Features

- 🗂️ **Apache2-like Directory Listing** — Sortable columns (Name, Type, Size)
- 📄 **Static File Serving** — Automatic MIME type detection with streaming
- 📊 **Sortable Columns** — Click headers to sort ascending/descending
- 📏 **File Sizes** — Human-readable display (B, KB, MB, GB, TB)
- 📃 **Bounded + Paginated Listings** — `dirListing.maxEntries` cap + `dirListing.entriesPerPage` navigation
- ⏱️ **Template Render Timeout** — Configurable timeout with AbortSignal propagation
- 📝 **Injectable Logger** — Plug Pino/Bunyan/Winston/console at construction time
- ⚡ **HTTP Caching** — ETag, Last-Modified, 304 responses (opt-in)
- 🎨 **Template Engine Support** — EJS, Pug, Handlebars, Nunjucks, etc.
- 🔒 **Enterprise Security** — Path traversal, XSS, race condition protection, CSP, dot-file hiding
- ⚙️ **Highly Configurable** — URL prefixes, reserved paths, index files, hidden patterns
- 🚀 **High Performance** — Async/await, non-blocking I/O, single-syscall directory reads
- 🔗 **Symlink Support** — Transparent resolution with directory listing indicators
- 🌐 **Clean URLs** — Hide file extensions for SEO-friendly URLs via `hideExtension`
- 🧪 **Well-Tested** — 532 passing tests with comprehensive coverage
- 📦 **Dual Module Support** — CommonJS and ES Modules

---

## Installation

```bash
npm install koa-classic-server
```

**Requirements:**
- Node.js >= 18.0.0
- Koa >= 2.0.0 (Koa 3 requires >= 3.1.2)

---

## Quick Start

### Basic Usage

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Serve files from "public" directory
app.use(koaClassicServer(__dirname + '/public'));

app.listen(3000);
console.log('Server running on http://localhost:3000');
```

### With Options

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/public', {
  index: ['index.html', 'index.htm'],
  urlPrefix: '/static',
  dirListing: {
    enabled:        true,
    maxEntries:     5000,    // cap huge directories
    entriesPerPage: 50,      // 50 entries per listing page
  },
  browserCacheEnabled: true,
  browserCacheMaxAge:  3600,
}));

app.listen(3000);
```

---

## Complete Usage Guide

### 1. Import

```javascript
// CommonJS
const koaClassicServer = require('koa-classic-server');

// ES Modules
import koaClassicServer from 'koa-classic-server';
```

### 2. Basic File Server

```javascript
const Koa = require('koa');
const path = require('path');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

app.use(koaClassicServer(path.join(__dirname, 'public'), {
  dirListing: { enabled: true },
  index: ['index.html'],
}));

app.listen(3000);
```

### 3. With URL Prefix

```javascript
app.use(koaClassicServer(__dirname + '/public', {
  urlPrefix: '/static',
}));
// http://localhost:3000/static/image.png → public/image.png
```

### 4. With Reserved Paths

```javascript
app.use(koaClassicServer(__dirname, {
  urlsReserved: ['/api', '/admin', '/.git', '/node_modules'],
}));
// /api/* is passed through to the next middleware untouched.
```

### 5. Bounded + Paginated Directory Listings (V3)

For directories that may grow without bound (uploads, archives, logs), cap the maximum number of entries the middleware will enumerate and paginate what's visible:

```javascript
app.use(koaClassicServer(__dirname + '/uploads', {
  dirListing: {
    enabled:        true,
    maxEntries:     10000,  // cap visible / sorted / stat'd entries (default; 0 = disabled)
    entriesPerPage: 100,    // entries per page in the listing UI (default; 0 = disabled)
  },
}));
```

**What happens on a directory with 1,000,000 files**

- The middleware calls `fs.promises.readdir()` once and slices the result to `dirListing.maxEntries` — sorting, stat'ing, and rendering are CPU-bounded by `dirListing.maxEntries`. The initial `readdir()` itself is **not** bounded (see v3.1 roadmap for an opt-in streaming mode targeting adversarial-directory workloads).
- A yellow banner appears at the top of the listing: *"Showing first 10000 entries (cap reached)…"*
- The response carries `X-Dir-Truncated: 10000` so monitoring can flag capped pages.
- Pagination is rendered below the table with `« First · ‹ Prev · 0 1 … N · Next › · Last »`, and an `X-Dir-Pagination: <current>/<last>` response header is set.
- Navigate via `?page=N` (0-based). Out-of-range values clamp silently to the nearest valid page. Active `sort` / `order` query params are preserved across paginator links.

### 6. Template Engine with Timeout + AbortSignal (V3)

V3 hardens template rendering against runaway or hung renders: the middleware enforces a configurable timeout and forwards a `template.signal` (AbortSignal) you can use inside your renderer to abort I/O and long-running work.

```javascript
const ejs = require('ejs');
const koaClassicServer = require('koa-classic-server');

app.use(koaClassicServer(__dirname + '/views', {
  template: {
    ext: ['ejs'],
    renderTimeout: 5000,  // 5s hard cap (default 30000ms; 0 disables the cap)
    render: async (ctx, next, filePath, { signal }) => {
      // Forward the signal to your I/O — fetch, DB queries, async work.
      const data = await fetchData({ signal });
      if (signal.aborted) return;
      ctx.body = await ejs.renderFile(filePath, data);
      ctx.type  = 'text/html';
    },
  },
}));
```

If the renderer exceeds `renderTimeout`, the request fails closed with a 500 and a single warning is emitted via the configured logger — the response stream is never left half-written.

### 7. Injectable Logger (V3)

By default the middleware logs to `console`. Pass any object exposing `error`, `warn`, `info`, `debug` to integrate with your production logging stack:

```javascript
const pino = require('pino')();

app.use(koaClassicServer(__dirname + '/public', {
  logger: pino,  // any { error, warn, info, debug }-shaped object works
}));
```

- Backward compatible: when `logger` is omitted, behavior is unchanged (uses `console`).
- All internal warnings and errors flow through the same logger — useful for routing them to Sentry, Datadog, or stdout JSON.

### 8. Hidden Files & Dot-File Protection (V3 default: hidden)

Dot-files and dot-directories are **visible by default in v3** — aligned with the "file server first" philosophy (see [`CLAUDE.md`](./CLAUDE.md)). For production deployments where `.env`, `.git/config`, etc. could be served accidentally, **opt into hardening** explicitly via `hidden.dotFiles.default: 'hidden'`. This is the first item on the [Security Checklist](#design-philosophy--security-checklist).

```javascript
app.use(koaClassicServer(__dirname + '/www', {
  hidden: {
    dotFiles: {
      default:   'hidden',                    // 'hidden' | 'visible'
      whitelist: ['.well-known', '.htaccess'],// exact name, glob, or RegExp
      blacklist: [],                          // overrides whitelist
    },
    dotDirs: {
      default:   'visible',
      whitelist: [],
      blacklist: ['.git'],
    },
    alwaysHide: ['*.key', /secret/i, '/private/**'], // path-aware patterns
  },
}));
```

### 9. Clean URLs with `hideExtension`

Serve `.ejs` (or any extension) as extensionless URLs and 301-redirect the canonical form:

```javascript
app.use(koaClassicServer(__dirname + '/views', {
  hideExtension: {
    ext: '.ejs',     // required, must start with '.'
    redirect: 301,   // optional, 301 (default) or 302
  },
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      ctx.body = await ejs.renderFile(filePath);
      ctx.type  = 'text/html';
    },
  },
}));
// GET /about      → serves views/about.ejs
// GET /about.ejs  → 301 redirect to /about
```

### 10. URL Rewriting Support (`useOriginalUrl`)

Set `useOriginalUrl: false` when running behind i18n routers or path-rewriters that mutate `ctx.url`:

```javascript
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/it/')) {
    ctx.url = ctx.path.replace(/^\/it/, '');  // /it/page.html → /page.html
  }
  await next();
});

app.use(koaClassicServer(__dirname + '/www', {
  useOriginalUrl: false,  // use ctx.url (rewritten) instead of ctx.originalUrl
}));
```

### 11. HTTP Caching (opt-in)

```javascript
app.use(koaClassicServer(__dirname + '/public', {
  browserCacheEnabled: true,     // emit ETag + Last-Modified, honor If-None-Match / If-Modified-Since
  browserCacheMaxAge:  86400,    // Cache-Control: max-age=86400 (24h)
}));
```

Defaults: `browserCacheEnabled: false` (development-friendly). Enable in production for an 80–95% bandwidth reduction on cache hits.

### 12. Complete Production Example

```javascript
const Koa  = require('koa');
const path = require('path');
const pino = require('pino')({ level: 'info' });
const ejs  = require('ejs');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Allowlist Host headers to mitigate DNS rebinding (see docs/DOCUMENTATION.md → Sicurezza).
const ALLOWED_HOSTS = new Set(['app.example.com', 'localhost:3000']);
app.use(async (ctx, next) => {
  if (!ALLOWED_HOSTS.has(ctx.host)) { ctx.status = 421; ctx.body = 'Host not allowed'; return; }
  await next();
});

// Static-file security headers (see docs/DOCUMENTATION.md → Limiti dei Security Headers).
app.use(async (ctx, next) => {
  ctx.set('X-Content-Type-Options', 'nosniff');
  ctx.set('Referrer-Policy',       'strict-origin-when-cross-origin');
  ctx.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  await next();
});

app.use(koaClassicServer(path.join(__dirname, 'public'), {
  index: ['index.html'],
  dirListing: {
    enabled:        process.env.NODE_ENV !== 'production',
    maxEntries:     10000,
    entriesPerPage: 100,
  },
  browserCacheEnabled: true,
  browserCacheMaxAge:  86400,
  logger:              pino,
  hidden: {
    dotFiles: { default: 'hidden', whitelist: ['.well-known'] },
    dotDirs:  { default: 'hidden', whitelist: ['.well-known'] },
    alwaysHide: ['*.key', /^backup-/],
  },
  template: {
    ext:           ['ejs'],
    renderTimeout: 5000,
    render: async (ctx, next, filePath, { signal }) => {
      ctx.body = await ejs.renderFile(filePath, { user: ctx.state.user }, { signal });
      ctx.type = 'text/html';
    },
  },
}));

app.listen(3000);
```

---

## API Reference

### `koaClassicServer(rootDir, options)`

Creates a Koa middleware for serving static files.

**Parameters:**
- **`rootDir`** *(String, required)* — Absolute path to the directory containing files
- **`options`** *(Object, optional)* — Configuration options

**Returns:** Koa middleware function

### Options Summary

```javascript
{
  // HTTP methods allowed (default: ['GET'])
  method: ['GET', 'HEAD'],

  // Directory listing (V3 namespace)
  dirListing: {
    enabled:        true,
    maxEntries:     10000,   // cap visible entries (0 = disabled)
    entriesPerPage: 100,     // entries per page (0 = disabled)
  },

  // Index file resolution (Array of strings and/or RegExp)
  index: ['index.html', 'index.htm'],

  // URL routing
  urlPrefix:    '/static',
  urlsReserved: ['/api', '/admin'],
  useOriginalUrl: true,

  // Hidden files / dirs
  hidden: {
    dotFiles: { default: 'visible', whitelist: [], blacklist: [] },
    dotDirs:  { default: 'visible', whitelist: [], blacklist: [] },
    alwaysHide: [],
  },

  // Clean URLs
  hideExtension: { ext: '.ejs', redirect: 301 },

  // Browser HTTP caching
  browserCacheEnabled: false,
  browserCacheMaxAge:  3600,

  // Template engine
  template: {
    ext:           ['ejs'],
    renderTimeout: 30000,   // ms; 0 disables the cap
    render: async (ctx, next, filePath, { signal }) => { /* ... */ },
  },

  // Observability
  logger: console,          // any { error, warn, info, debug } shape
}
```

### Options Details

| Option | Type | Default | Description |
|---|---|---|---|
| `method` | `String[]` | `['GET']` | Allowed HTTP methods |
| `dirListing.enabled` | `Boolean` | `true` | **V3** Render directory listing HTML when no index file matches |
| `dirListing.maxEntries` | `Number` | `10000` | **V3** Cap entries shown / sorted / stat'd (0 = disabled) |
| `dirListing.entriesPerPage` | `Number` | `100` | **V3** Entries per listing page (0 = disabled) |
| `index` | `Array` | `[]` | Index file patterns (strings, RegExp, or mixed) |
| `urlPrefix` | `String` | `''` | URL path prefix |
| `urlsReserved` | `String[]` | `[]` | First-level paths passed through to next middleware |
| `useOriginalUrl` | `Boolean` | `true` | Use `ctx.originalUrl` (`true`) or `ctx.url` (`false`) |
| `hideExtension.ext` | `String` | – | Extension to hide (`.ejs`, must start with `.`) |
| `hideExtension.redirect` | `Number` | `301` | HTTP redirect code |
| `hidden.dotFiles.default` | `String` | `'visible'` | Default visibility for `.foo` files (`'hidden'` to harden) |
| `hidden.dotFiles.whitelist` | `Array` | `[]` | Names always visible (string/glob/RegExp) |
| `hidden.dotFiles.blacklist` | `Array` | `[]` | Names always hidden (overrides whitelist) |
| `hidden.dotDirs.default` | `String` | `'visible'` | Default visibility for `.foo` directories |
| `hidden.dotDirs.whitelist` | `Array` | `[]` | Names always visible |
| `hidden.dotDirs.blacklist` | `Array` | `[]` | Names always hidden |
| `hidden.alwaysHide` | `Array` | `[]` | Path-aware patterns (string glob or RegExp) |
| `browserCacheEnabled` | `Boolean` | `false` | Emit ETag + Last-Modified (recommended `true` in production) |
| `browserCacheMaxAge` | `Number` | `3600` | `Cache-Control: max-age` in seconds |
| `template.render` | `Function` | – | `async (ctx, next, filePath, { signal }) => void` |
| `template.ext` | `String[]` | `[]` | Extensions handled by the template engine |
| `template.renderTimeout` | `Number` | `30000` | **V3** Max render time in ms (0 = disabled) |
| `logger` | `Object` | `console` | **V3** Logger with `{ error, warn, info, debug }` |

For deep dives, see [DOCUMENTATION.md](./docs/DOCUMENTATION.md) and the per-option guides in [`docs/`](./docs).

---

## Directory Listing Features

### Sortable Columns

Click any column header to sort:
- **Name** — Alphabetical (A→Z / Z→A)
- **Type** — By MIME type (directories first)
- **Size** — By byte size (directories first)

Visual indicators: `↑` ascending, `↓` descending. Sort + order are preserved across pagination links.

### Pagination (V3)

When the number of visible entries exceeds `dirListing.entriesPerPage`, a numbered paginator is rendered below the table:

```
« First · ‹ Prev · 0 · 1 · … · 7 · 8 · 9 · Next › · Last »
```

- Page index is 0-based (`?page=N`).
- Invalid or out-of-range values clamp silently.
- Response header `X-Dir-Pagination: <current>/<last>` is emitted only when pagination is meaningful.

### Truncation Banner (V3)

When `dirListing.maxEntries` is hit, a banner is rendered above the table and `X-Dir-Truncated: <N>` is set, so capped listings are visible both to users and to monitoring.

### File Size Display

Human-readable: `1.5 KB`, `2.3 MB`, `1.2 GB`. Directories show `-`.

### Navigation

- Click folder → enter directory
- Click file → serve / download
- **Parent Directory** link → go up one level

### Symlink Support

The middleware follows symbolic links transparently via `fs.promises.stat()` — useful in NixOS, Docker bind mounts, `npm link`, and Capistrano-style deploys.

| Entry type | Indicator | Clickable | Type column |
|---|---|---|---|
| Symlink to file | `( Symlink )` | yes | target MIME |
| Symlink to directory | `( Symlink )` | yes | `DIR` |
| Broken symlink | `( Broken Symlink )` | no | original MIME guess |
| Policy-blocked symlink | `( Blocked Symlink )` | no | MIME guess, size hidden |

Regular files incur zero additional `stat()` overhead.

#### `symlinks` policy (V3.1+) — protect against symlink escape

By default (`symlinks: 'follow'`) a symlink inside `rootDir` is followed **even when its target lives outside `rootDir`** — consistent with the *"file server first"* philosophy (`rootDir` is the source of truth). If `rootDir` contains directories writable by untrusted parties (uploads, spool, multi-tenant hosting), a planted symlink could then read any file the process can access. Opt into containment:

| Value | Behavior | Overhead |
|---|---|---|
| `'follow'` *(default)* | Follow symlinks anywhere, including outside `rootDir`. Historical behavior. | none |
| `'follow-within-root'` | Follow only while the resolved realpath stays inside `rootDir`; escaping links → **404**. | one `realpath()` per served path |
| `'deny'` | Never follow a symlink resolved **below** `rootDir`. | one `realpath()` per served path |

```js
app.use(koaClassicServer(rootDir, { symlinks: 'follow-within-root' }));
```

Notes:
- **`rootDir` may itself be a symlink** (atomic-deploy / Capistrano / Nix) in every mode: the boundary is pinned to `realpath(rootDir)` resolved once at factory init.
- Protected modes require `rootDir` to **exist at factory time** (they resolve its realpath up front) and throw otherwise.
- In the directory listing, blocked symlinks appear as `( Blocked Symlink )`, non-clickable, and do not expose the target's size.
- Residual risk: the check is realpath-based, so (a) a symlink swapped between the check and the file open (TOCTOU) is not fully prevented, and (b) **hardlinks** cannot be detected — a hardlink has no resolvable target path, so its `realpath` is inside `rootDir` even when it points to an external inode. For hostile multi-tenant setups combine with OS-level isolation (chroot, per-tenant mounts, `nosymfollow`, a dedicated upload filesystem).

---

## Security

### Built-in Protection

#### 1. Path Traversal

```text
GET /../../etc/passwd            → 403 Forbidden
GET /%2e%2e%2fpackage.json       → 403 Forbidden
GET /file\0.txt                  → 400 Bad Request   (null-byte guard)
GET /%                           → 400 Bad Request   (malformed percent-encoding)
Host: bad host                   → 400 Bad Request   (invalid Host header)
```

Defense in depth: malformed-request rejection (bad percent-encoding / invalid `Host` → 400) → null-byte rejection → `path.normalize()` → resolved-path boundary check against `rootDir`. Malformed inputs return **400**, never an unhandled 500.

#### 2. XSS in Directory Listing

All file and directory names are HTML-escaped. CSS is inlined under a hash-based `Content-Security-Policy` recomputed at module load — script execution from inline `<style>`/`<script>` is rejected by the browser.

#### 3. Dot-Files Hidden by Default (V3)

`.env`, `.git/config`, SSH keys, etc. return 404 unless explicitly whitelisted via `hidden.dotFiles.whitelist`. The `.well-known` whitelist pattern stays friendly to ACME / Let's Encrypt.

#### 4. Security Headers on Generated Pages

The middleware emits the following on directory listings and error pages (404/405/500/etc.):

| Header | Value |
|---|---|
| `Content-Security-Policy` | hash-based on listing, fully restrictive on errors |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |

> ⚠️ User-served static files (HTML/JS/CSS on disk) are returned **without** these headers — by design. See [docs/DOCUMENTATION.md → Limiti dei Security Headers](./docs/DOCUMENTATION.md#limiti-dei-security-headers-sui-file-statici) for an upstream-middleware example that applies your own CSP/HSTS to static files.

#### 5. DNS Rebinding

The middleware does not validate the `Host` header — that belongs to the reverse proxy or an application-level allowlist. See [docs/DOCUMENTATION.md → DNS Rebinding](./docs/DOCUMENTATION.md#dns-rebinding--valida-lheader-host-a-monte) for nginx + Koa allowlist examples.

#### 6. Reserved URLs

```javascript
app.use(koaClassicServer(__dirname, {
  urlsReserved: ['/admin', '/api', '/.git', '/node_modules'],
}));
```

#### 7. Race-Condition Protection

File metadata is verified before streaming. A file deleted between check and access returns `404`, never a crash or partial response.

#### 8. Bounded Listings (V3)

`dirListing.maxEntries` caps the number of entries that are sorted, stat'd, and rendered per listing — bounds CPU and HTML size against accidentally-large folders. The initial `readdir()` is not bounded by this option; an opt-in streaming mode for adversarial-directory workloads is planned for v3.1.

#### 9. Template Render Timeout (V3)

`template.renderTimeout` (default 30 s) prevents a hung or runaway template render from blocking the request indefinitely; the AbortSignal forwarded to the renderer lets you abort downstream I/O cleanly.

**See:**
- [Security improvement roadmap →](./docs/security_improvement_for_V3.md)
- [Security tests →](./__tests__/security.test.js)

### Design philosophy & Security Checklist

koa-classic-server follows the principle: **"if a file is in `rootDir`, `GET` on its path returns it"**. The defaults serve files without applying surprise restrictions — the operator is the source of truth. See [`CLAUDE.md`](./CLAUDE.md) for the full design philosophy.

This means hardening is **opt-in via explicit configuration**. The checklist below covers the most common production concerns. Each item is one or two lines of configuration; not all of them apply to every deployment.

#### ✅ Static site / public asset serving

- [ ] **Hide dot-files** that may contain secrets:
  `hidden: { dotFiles: { default: 'hidden', whitelist: ['.well-known'] } }`
- [ ] **Block dot-directories** like `.git`:
  `hidden: { dotDirs: { default: 'hidden', whitelist: ['.well-known'] } }`
- [ ] **Disable directory listing** in production:
  `dirListing: { enabled: false }` (combine with an `index` file)
- [ ] **Enable browser HTTP caching**:
  `browserCacheEnabled: true, browserCacheMaxAge: 86400`
- [ ] **Restrict methods** to read-only (default already `['GET']`):
  `method: ['GET', 'HEAD']`
- [ ] **Reserve sensitive paths** for app routes:
  `urlsReserved: ['/api', '/admin']`
- [ ] **Add upstream security headers** for user-served HTML (not auto-added by this middleware — see *DNS Rebinding / Headers* in `docs/DOCUMENTATION.md`).

#### ✅ User uploads, multi-tenant, untrusted-write directories

- [ ] **Lower the entry cap** for accidentally-large dirs:
  `dirListing: { maxEntries: 1000 }` (default 100000 is a safety net, not a security feature)
- [ ] **Hide dot-files at every depth**:
  `hidden: { dotFiles: { default: 'hidden' }, dotDirs: { default: 'hidden' } }`
- [ ] **Add path-aware blocklists** for known secret patterns:
  `hidden: { alwaysHide: ['*.key', '*.pem', /\.secret$/, 'config/secrets/**'] }`
- [ ] **Contain symlinks** so a planted link cannot escape `rootDir`:
  `symlinks: 'follow-within-root'` (or `'deny'` to forbid all in-tree symlinks). Default `'follow'` serves symlink targets outside `rootDir`. See *Symlink Support → `symlinks` policy*.
- [ ] **Monitor directory growth externally** (cron + alert) — the v3.0 cap bounds rendering CPU but not the initial `readdir()` allocation. See `[F-1]` in `docs/security_improvement_for_V3.md` for the v3.1 streaming-read opt-in tracking this gap.

#### ✅ Production hygiene (any deployment)

- [ ] **Validate `Host` header upstream** (nginx `server_name` allowlist or app-level middleware) — this middleware does NOT validate `Host`. See *DNS Rebinding* in `docs/DOCUMENTATION.md`.
- [ ] **Disable template-engine in production** if you don't use SSR — minimizes attack surface:
  omit the `template` option entirely
- [ ] **Tune `template.renderTimeout`** if you do use SSR — default 30 s is conservative; tighten for tight-SLA services
- [ ] **Inject a real logger** instead of `console`:
  `logger: pino()` so security-relevant warnings reach your aggregation
- [ ] **Pin the latest patch version** in `package.json` and run `npm audit` in CI

### Suggested production security configuration

A single configuration block that covers most production deployments. Start here and tune for your workload (static site vs uploads vs internal admin):

```javascript
const Koa  = require('koa');
const pino = require('pino')({ level: 'info' });
const path = require('path');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// 1) Validate Host header — mitigates DNS rebinding on LAN / loopback exposure.
const ALLOWED_HOSTS = new Set([
  'app.example.com',
  'localhost:3000',
]);
app.use(async (ctx, next) => {
  if (!ALLOWED_HOSTS.has(ctx.host)) {
    ctx.status = 421;
    ctx.body = 'Misdirected Request';
    return;
  }
  await next();
});

// 2) Apply security headers to user-served HTML/JS/CSS. The middleware
//    sets these only on its own generated pages (listing + errors).
app.use(async (ctx, next) => {
  ctx.set('X-Content-Type-Options',     'nosniff');
  ctx.set('Referrer-Policy',            'strict-origin-when-cross-origin');
  ctx.set('Strict-Transport-Security',  'max-age=63072000; includeSubDomains');
  await next();
});

// 3) The file server with hardened defaults.
app.use(koaClassicServer(path.join(__dirname, 'public'), {
  method: ['GET', 'HEAD'],            // read-only

  index: ['index.html'],              // serve index when present

  dirListing: {
    enabled: process.env.NODE_ENV !== 'production',
    maxEntries: 10000,                // tighten the soft cap below the 100k default
    entriesPerPage: 100,
  },

  hidden: {
    dotFiles: {
      default: 'hidden',              // hide .env / .htaccess / etc by default
      whitelist: ['.well-known'],     // expose ACME / Let's Encrypt
    },
    dotDirs: {
      default: 'hidden',
      whitelist: ['.well-known'],
    },
    alwaysHide: ['*.key', '*.pem', /^backup-/, /\.secret$/],
  },

  browserCacheEnabled: true,
  browserCacheMaxAge:  86400,         // 24 h — bandwidth savings on cache hits

  logger: pino,                       // pipe internal warnings to structured logs

  urlsReserved: ['/api', '/admin'],   // routes handled by other middleware
}));

app.listen(3000);
```

For multi-tenant or user-upload scenarios, also drop `dirListing.maxEntries` to `1000` and monitor the served directory's size externally.

---

## Performance

### Optimizations

- **Single-syscall `readdir()`** — directory entries fetched in one batched syscall, then sliced to `dirListing.maxEntries` to cap rendering work
- **Single `stat()`** per item — no double filesystem traversal
- **Array `.join()`** for listing HTML — significantly less GC pressure than `+=`
- **HTTP conditional responses** — 304s with `If-None-Match` / `If-Modified-Since` (when caching enabled)
- **File streaming** — large files streamed via `fs.createReadStream`, never buffered in full
- **Pre-computed CSP hash** — SHA-256 of inline CSS hashed once at module load, not per request

### Benchmarks

See [`docs/BENCHMARKS.md`](./docs/BENCHMARKS.md) and [`docs/PERFORMANCE_COMPARISON.md`](./docs/PERFORMANCE_COMPARISON.md) for full benchmarks and methodology.

---

## Testing

```bash
# Run all tests
npm test

# Run security tests only
npm run test:security

# Run performance benchmarks
npm run test:performance
```

**Coverage:**
- ✅ 532 tests passing across 20 suites
- ✅ Security (path traversal, XSS, race conditions, CSP, hidden-files)
- ✅ Directory listing (sorting, pagination, truncation cap, symlinks)
- ✅ Template engine (timeout, abort signal, error propagation, EJS integration)
- ✅ Logger injection (validation, custom logger, console default)
- ✅ Index option (arrays, RegExp, priority)
- ✅ `hideExtension` (clean URLs, redirects, conflicts, validation)
- ✅ HTTP caching (ETag, Last-Modified, 304)
- ✅ Performance benchmarks

---

## Complete Documentation

### Core
- **[DOCUMENTATION.md](./docs/DOCUMENTATION.md)** — Full API reference and usage guide
- **[FLOW_DIAGRAM.md](./docs/FLOW_DIAGRAM.md)** — Visual flow diagrams and execution paths
- **[CHANGELOG.md](./docs/CHANGELOG.md)** — Version history and release notes

### Template Engine
- **[TEMPLATE_ENGINE_GUIDE.md](./docs/template-engine/TEMPLATE_ENGINE_GUIDE.md)** — EJS, Pug, Handlebars, Nunjucks; AbortSignal + timeout patterns

### Configuration
- **[INDEX_OPTION_PRIORITY.md](./docs/INDEX_OPTION_PRIORITY.md)** — Priority rules for `index`
- **[EXAMPLES_INDEX_OPTION.md](./docs/EXAMPLES_INDEX_OPTION.md)** — 10 practical examples

### Security
- **[security_improvement_for_V3.md](./docs/security_improvement_for_V3.md)** — Audit roadmap and status

### Performance
- **[PERFORMANCE_ANALYSIS.md](./docs/PERFORMANCE_ANALYSIS.md)** — Optimization analysis
- **[PERFORMANCE_COMPARISON.md](./docs/PERFORMANCE_COMPARISON.md)** — Latency, throughput, concurrency
- **[OPTIMIZATION_HTTP_CACHING.md](./docs/OPTIMIZATION_HTTP_CACHING.md)** — Caching internals
- **[BENCHMARKS.md](./docs/BENCHMARKS.md)** — Methodology and results

### Code Quality
- **[CODE_REVIEW.md](./docs/CODE_REVIEW.md)** — Code review and standards
- **[DEBUG_REPORT.md](./docs/DEBUG_REPORT.md)** — Known limitations and debugging

---

## Migration Guide

### From v2.x to v3.x

**Breaking changes**

| What | v2.x | v3.x |
|---|---|---|
| `index: 'index.html'` | accepted | **throws** — must be an array |
| `cacheMaxAge` | accepted | **removed** — use `browserCacheMaxAge` |
| `enableCaching` | accepted | **removed** — use `browserCacheEnabled` |
| `showDirContents` | accepted | accepted as **deprecated alias** — emits a one-time warning, prefer `dirListing: { enabled: true }` |
| Dot-files | served | **served** (unchanged — opt into hiding via `hidden.dotFiles.default: 'hidden'`; see Security Checklist) |
| Logger | `console` only | `logger` option injects any logger; default still `console` |
| Template `render` signature | `(ctx, next, filePath)` | `(ctx, next, filePath, { signal })` — old signature still works, `signal` is opt-in |

**Quick migration**

```javascript
// v2.x
app.use(koaClassicServer(root, {
  index:           'index.html',
  enableCaching:   true,
  cacheMaxAge:     3600,
  showDirContents: true,
}));

// v3.x
app.use(koaClassicServer(root, {
  index:               ['index.html'],
  browserCacheEnabled: true,
  browserCacheMaxAge:  3600,
  dirListing:          { enabled: true },
}));
```

**Dot-files in v3**

```javascript
// To restore v2.x behavior (serve dot-files):
{ hidden: { dotFiles: { default: 'visible' } } }

// Recommended v3 — hide dot-files but expose .well-known for ACME / Let's Encrypt:
{
  hidden: {
    dotFiles: { default: 'hidden', whitelist: ['.well-known'] },
    dotDirs:  { default: 'hidden', whitelist: ['.well-known'] },
  },
}
```

**Template render in v3**

```javascript
// v2.x — still works:
template: { render: async (ctx, next, filePath) => { /* ... */ } }

// v3.x — opt into the AbortSignal:
template: {
  renderTimeout: 5000,
  render: async (ctx, next, filePath, { signal }) => {
    const data = await fetchData({ signal });
    ctx.body  = await ejs.renderFile(filePath, data, { signal });
    ctx.type  = 'text/html';
  },
}
```

### From v1.x to v2.x

```javascript
// v1.x
{ index: 'index.html' }

// v2.x+
{ index: ['index.html'] }
```

See the full [CHANGELOG.md](./docs/CHANGELOG.md) for every change.

---

## Examples

### Example 1: Simple Static Server

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();
app.use(koaClassicServer(__dirname + '/public'));
app.listen(3000);
```

### Example 2: Multi-Directory Server

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Static assets — no listing in production
app.use(koaClassicServer(__dirname + '/public', {
  urlPrefix: '/static',
  dirListing: { enabled: false },
}));

// User uploads — paginated browsable index
app.use(koaClassicServer(__dirname + '/uploads', {
  urlPrefix: '/files',
  dirListing: {
    enabled:        true,
    maxEntries:     5000,
    entriesPerPage: 50,
  },
}));

app.listen(3000);
```

### Example 3: Development Server with Templates + Timeout

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/src', {
  dirListing: { enabled: true },
  template: {
    ext: ['ejs'],
    renderTimeout: 3000,
    render: async (ctx, next, filePath, { signal }) => {
      ctx.body = await ejs.renderFile(filePath, {
        dev: true,
        timestamp: Date.now(),
      }, { signal });
      ctx.type = 'text/html';
    },
  },
}));

app.listen(3000);
```

### Example 4: Production with Pino Logger + Caching

```javascript
const Koa = require('koa');
const pino = require('pino')({ level: 'info' });
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/public', {
  index:               ['index.html'],
  dirListing:          { enabled: false },
  browserCacheEnabled: true,
  browserCacheMaxAge:  86400,
  logger:              pino,
}));

app.listen(3000);
```

---

## Troubleshooting

**404 for all files**

Use an absolute path for `rootDir`:

```javascript
koaClassicServer('./public')                   // ❌ relative
koaClassicServer(__dirname + '/public')        // ✅ absolute
koaClassicServer(path.join(__dirname, 'pub'))  // ✅ absolute
```

**Reserved URLs not matching nested paths**

`urlsReserved` only matches first-level path segments — use it for top-level routes (`/api`), not nested ones (`/api/users`).

**Directory listing shows fewer files than expected**

Check the response headers: `X-Dir-Truncated` indicates the `dirListing.maxEntries` cap was reached. Increase the cap or paginate via `?page=N`.

**Templates time out under load**

Lower `template.renderTimeout` to fail fast, forward the `signal` to your I/O, and check the logger output for `Template render timeout after Xms` warnings.

See full troubleshooting: [DEBUG_REPORT.md](./docs/DEBUG_REPORT.md).

---

## Contributing

Contributions are welcome:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass (`npm test`)
5. Submit a pull request

---

## Known Limitations

- `urlsReserved` only matches first-level path segments
- The middleware does not validate the `Host` header — configure a reverse proxy or an upstream allowlist (see [DOCUMENTATION.md → DNS Rebinding](./docs/DOCUMENTATION.md#dns-rebinding--valida-lheader-host-a-monte))
- Static files are returned without security headers — apply your own upstream middleware (see [DOCUMENTATION.md → Limiti dei Security Headers](./docs/DOCUMENTATION.md#limiti-dei-security-headers-sui-file-statici))

See [DEBUG_REPORT.md](./docs/DEBUG_REPORT.md) for technical details.

---

## License

MIT License — see LICENSE file for details.

---

## Author

Italo Paesano

---

## Links

- **[npm Package](https://www.npmjs.com/package/koa-classic-server)** — Official npm package
- **[GitHub Repository](https://github.com/italopaesano/koa-classic-server)** — Source code
- **[Issue Tracker](https://github.com/italopaesano/koa-classic-server/issues)** — Report bugs
- **[Full Documentation](./docs/DOCUMENTATION.md)** — Complete reference

---

## Changelog

See [CHANGELOG.md](./docs/CHANGELOG.md) for version history.

---

**⚠️ Security Notice:** Always use the latest version for security updates and bug fixes.
