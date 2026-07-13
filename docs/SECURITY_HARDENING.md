# Security Hardening Guide

> **Canonical security reference for koa-classic-server.** This is the single source of
> truth for hardening. The README and `docs/DOCUMENTATION.md` link here instead of
> duplicating checklists, to avoid drift.

koa-classic-server is an **HTTP file server first**: by design, defaults are *transparent /
pass-through* — "if a file is in `rootDir`, `GET` returns it". Security hardening is therefore
**opt-in**: you enable it explicitly for your threat model. This guide tells you what to enable,
why, and gives a maximally-hardened reference configuration.

---

## 1. Threat model — pick your profile

Hardening depends on **who can put files into `rootDir`** and **who can reach the server**.

| Profile | Description | Risk level |
|---|---|---|
| **A — Trusted content** | You (the operator) control every file under `rootDir`; served publicly, usually behind a CDN/reverse proxy. | Low |
| **B — Internal / dev tool** | Reached over `localhost` / LAN, often **without** a reverse proxy. | Medium (DNS rebinding) |
| **C — User uploads / multi-tenant** | Untrusted parties can write files (and possibly symlinks) into `rootDir`. | High |

Jump to the [per-profile checklists](#7-per-profile-checklists) and the
[maximally-hardened configuration](#8-maximally-hardened-reference-configuration).

---

## 2. What the middleware protects by default (and what it does not)

**Handled for you, always:**
- Path traversal: null-byte rejection → `path.normalize()` → boundary check against `rootDir`
  (matches `rootDir` exactly or `rootDir` + separator — no sibling escape). Escapes return **404**.
- Malformed requests (bad percent-encoding, invalid `Host`) return **400**, never an unhandled 500.
- XSS-safe directory listing (all names HTML-escaped; hash-based CSP on generated pages).
- Security headers (`CSP`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`) on **middleware-generated pages** (listing, errors).

**NOT done by default — you must opt in (this guide):**
- Dot-files (`.env`, `.git/…`) are **served** unless you hide them.
- Symlinks are **followed anywhere**, including targets outside `rootDir`.
- Static files (your HTML/JS/CSS/uploads) get **no** security headers.
- No `Host`-header validation (DNS rebinding).
- The initial `readdir()` on a listing is **not** RAM-bounded (huge/adversarial directories).

---

## 3. Security recommendations by topic

Each item: **risk → recommendation → snippet**. Default vs hardened is called out.

### 3.1 Dot-files and dot-directories (`.env`, `.git`, keys)

**Risk:** `GET /.env`, `GET /.git/config` return the file — secrets leak. Default is `visible`.

**Recommendation:** hide dot-files and dot-dirs; whitelist `.well-known` for ACME/Let's Encrypt.

```js
hidden: {
  dotFiles: { default: 'hidden', whitelist: ['.well-known'] },
  dotDirs:  { default: 'hidden', whitelist: ['.well-known'] },
}
```

### 3.2 Symlinks — recommended internal standard: `follow-within-root`

**Risk:** a symlink inside `rootDir` pointing **outside** it is served → arbitrary file read
(especially dangerous if untrusted parties can plant symlinks). Default is `follow`.

**Recommendation (internal standard):** keep symlink support but confine it to `rootDir`.
For hostile multi-tenant, forbid in-tree symlinks entirely with `deny`.

```js
symlinks: 'follow-within-root'   // escaping links → 404. Recommended default for most deployments.
// symlinks: 'deny'              // stricter: never follow any symlink resolved below rootDir.
```

Notes:
- `rootDir` may itself be a symlink (atomic-deploy / Capistrano / Nix) in every mode — the
  boundary is pinned to `realpath(rootDir)` at startup.
- Protected modes cost one `fs.realpath()` per served path and require `rootDir` to exist at startup.
- **Residual risks:** realpath cannot prevent **hardlinks** (no resolvable target path) or a
  **TOCTOU** swap between check and open. For hostile tenants, combine with OS isolation
  (see [§6](#6-os--process-level-hardening)).

### 3.3 Directory listing, directory size & subdirectory count

**Risk 1 — accidental exposure:** listings reveal every visible entry.
**Risk 2 — CPU/IO amplification:** a listing does up to `maxEntries` `stat()` calls + a sort per
request (even with pagination — only rendering is paginated).
**Risk 3 — RAM (`[F-1]`):** the initial `readdir()` reads **all** on-disk entries; `maxEntries`
bounds work *after* `readdir()`, **not** the `readdir()` allocation itself. A directory with
millions of entries can exhaust RAM regardless of `maxEntries`.

**Recommendation:**
- If you don't need listings, disable them and rely on an index file:
  ```js
  dirListing: { enabled: false }, index: ['index.html']
  ```
- If you do need them, lower the cap (a lower value is *more* defensive) and paginate:
  ```js
  dirListing: { enabled: true, maxEntries: 1000, entriesPerPage: 100 }
  ```
- For untrusted-write directories, **monitor directory growth externally** (cron + alert) until
  the opt-in RAM-bounded read (`dirListing.readMode: 'bounded'`) lands — tracked as `[F-1]` in
  `docs/security_improvement_for_V3.md`. A capped listing sets the `X-Dir-Truncated` header.

### 3.4 Path-aware blocklists for secret patterns

**Risk:** secrets by extension/path (`*.key`, `*.pem`, `config/secrets/**`) served if requested.

**Recommendation:**
```js
hidden: { alwaysHide: ['*.key', '*.pem', /\.secret$/, 'config/secrets/**'] }
```

### 3.5 Security headers on static files

**Risk:** a browser MIME-sniffing a user-uploaded file can execute it against the declared
`Content-Type` (content-sniffing XSS). Static responses get no security headers by default.

**Recommendation:** enable `nosniff`; set the rest (CSP, X-Frame-Options, Referrer-Policy, HSTS)
via an upstream middleware or the reverse proxy — they are policy that varies per deployment.

```js
staticSecurityHeaders: { nosniff: true }   // X-Content-Type-Options: nosniff on 200/206/304
```

```js
// Upstream Koa middleware for the rest (before koa-classic-server):
app.use(async (ctx, next) => {
  ctx.set('X-Frame-Options', 'DENY');
  ctx.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  ctx.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  // Add a CSP tuned to your own HTML if you serve user-facing pages.
  await next();
});
```

> Note: `nosniff` applies to static files only, not to template-rendered output (that is the
> operator's responsibility inside the `render` function).

**Custom error pages (`errorPages`, v4.2+):** built-in error pages carry a fully restrictive
CSP; a **custom** page (operator-authored content) is served **without** `Content-Security-Policy`
— the other generated-page headers (`nosniff`, `X-Frame-Options`, …) stay. Two rules:
keep each page a single self-contained `.html` (inline CSS, no external css/js/img — an
external reference *would* load, and a third-party endpoint would see your visitors' error
traffic), and keep the content generic — no stack traces, versions, paths, or hostnames.
A 404 page is shown for *every* not-found/hidden/outside-root request, so anything in it is
public. Keep the files **outside** `rootDir` so they are not themselves served.

### 3.6 `Host` validation / DNS rebinding

**Risk:** with the server exposed **directly** (loopback/LAN, no proxy), a malicious web page can
use DNS rebinding to read local files — the browser sends `Host: evil.com` and, since the origin
is still `evil.com`, the Same-Origin Policy does not protect. The middleware does **not** validate
`Host` (design choice: it is a network/proxy concern).

**Recommendation:**
- **Production:** reverse proxy with a `server_name` allowlist (nginx/Caddy). Best place — robust and central.
  ```nginx
  server { listen 80; server_name app.example.com; location / { proxy_pass http://127.0.0.1:3000; } }
  ```
- **Direct exposure (dev/LAN):** an upstream Koa allowlist, using the **raw** `Host`:
  ```js
  const ALLOWED_HOSTS = new Set(['app.example.com', 'localhost:3000']);
  const normalizeHost = (h) => (h || '').toLowerCase().replace(/\.$/, '');
  app.use(async (ctx, next) => {
    // Use ctx.get('host') (raw), NOT ctx.host: with app.proxy=true the latter trusts a
    // forgeable X-Forwarded-Host, which would bypass the allowlist.
    if (!ALLOWED_HOSTS.has(normalizeHost(ctx.get('host')))) {
      ctx.status = 421; ctx.body = 'Host not allowed'; return;
    }
    await next();
  });
  ```

> `Host` validation stops rebinding; it is **not** a client-provenance control (for that: IP
> allowlist / firewall / auth). A half-correct check (trusting `X-Forwarded-Host`, missing
> normalization) gives false security — which is why this is delegated to the proxy.

### 3.7 HTTP methods

The default `method: ['GET']` already rejects everything else. Add `HEAD` only if you need it:
```js
method: ['GET', 'HEAD']
```

### 3.8 Reserved paths

Keep application routes (`/api`, `/admin`) from being shadowed by files:
```js
urlsReserved: ['/api', '/admin']
```

### 3.9 Template engine

**Risk:** a slow/hung `render` blocks the event loop; template output is dynamic and
operator-controlled (escaping, headers, `nosniff` are up to you).

**Recommendation:**
- If you don't do SSR, **omit `template` entirely** — smaller attack surface.
- If you do, keep a sane `renderTimeout` (default `30000` ms; tighten for tight-SLA services) and
  set output headers inside your `render`.

### 3.10 Caching & compression

- `browserCacheEnabled: true` in production reduces bandwidth; combine with a CDN.
- Compression is on by default. If you serve secrets *and* reflect user input in the same
  response over TLS, be aware of BREACH-class risks (rare for a static file server).
- `compression.maxFileSize` (default 10 MB) caps the buffered high-quality compression path:
  larger compressible files are compressed via bounded-RAM streaming instead of being read
  whole into memory. Lower it on RAM-constrained hosts; `false` removes the cap (not
  recommended if untrusted parties can place large text files under `rootDir`).
  The streamed output is itself cached when it fits in a quarter of the compressed cache's
  `maxSize`, so repeat downloads of the same large file cost RAM proportional to the
  *compressed* size, never the input size; disable `serverCache.compressedFile` to keep
  large-file responses fully stateless.
- **Concurrent on-the-fly compression is a CPU/RAM amplification surface** — as on any
  server that compresses at request time (nginx `gzip on` included). Each concurrent
  streamed compression costs one encoder state in RAM (bounded: the streaming brotli
  window is deliberately 512 KB, a few MB per stream in total) plus real CPU for the
  duration of the transfer. The compressed cache defuses repeat requests to the *same*
  file (after the first completion they are RAM hits), but a client fanning out over
  many *distinct* large compressible files pays one compression per stream. Measured
  order of magnitude: 100 concurrent cold requests to a 20 MB text file ≈ 340 MB peak
  RSS and ~85 s of CPU. Mitigations, per profile:
  - internet-facing: **rate-limit / cap per-IP concurrency at the reverse proxy**
    (`limit_conn` / `limit_req` in nginx) — the canonical fix, out of the middleware's
    scope;
  - RAM/CPU-constrained hosts: lowering `compression.maxFileSize` changes only *how*
    large files compress, not *whether* — if the concern is the compression work
    itself, disable compression for those trees (`compression: false` on that mount)
    or keep large compressible files out of untrusted-facing roots;
  - the identity (uncompressed) path is unaffected: it streams with no encoder state.

### 3.11 Logging

Inject a real logger so security-relevant warnings reach your aggregation. Malformed requests
return 400 **without** logging (client-controlled input → avoids log-spam / DoS).
```js
logger: require('pino')()
```

---

## 4. Dependency hygiene

- Run `npm audit` in CI. The runtime footprint is intentionally tiny (`mime-types`), so most
  advisories are dev-only, but keep them green.
- Pin the latest patch version of koa-classic-server and your chosen Koa major.

---

## 5. Residual risks the middleware deliberately does NOT handle

| Risk | Why it's out of scope | Mitigate with |
|---|---|---|
| `Host` validation (DNS rebinding) | Network policy, per-deployment | Reverse proxy `server_name` / upstream allowlist ([§3.6](#36-host-validation--dns-rebinding)) |
| Full CSP / framing policy on static files | Policy varies per site | Upstream middleware / proxy ([§3.5](#35-security-headers-on-static-files)) |
| Unbounded `readdir()` on huge dirs (`[F-1]`) | Perf vs. adversarial-dir trade-off; v3.1 opt-in | Low `maxEntries` + external monitoring + OS quotas |
| Hardlinks escaping `rootDir` | No resolvable target path (realpath can't see it) | Dedicated FS / mount for uploads, OS controls |
| TOCTOU symlink swap | Not fully preventable without `openat`/`O_NOFOLLOW` | OS isolation (`nosymfollow`, per-tenant mounts) |

---

## 6. OS / process-level hardening

For Profile C (untrusted writes) especially:
- Run the process as a **non-root** user with least privilege.
- **Bind to a specific interface** (`app.listen(port, '127.0.0.1')`) when it should not be public.
- Put uploads on a **dedicated filesystem / mount** (quotas, `nosuid`, `nodev`, `nosymfollow`).
- Consider chroot / containers / per-tenant mounts to contain hardlink & TOCTOU vectors.

---

## 7. Per-profile checklists

### Profile A — Trusted static content (public)
- [ ] `method: ['GET']` (or `['GET', 'HEAD']`)
- [ ] `browserCacheEnabled: true`
- [ ] `staticSecurityHeaders: { nosniff: true }`
- [ ] Upstream headers (CSP/HSTS/…) via proxy or middleware
- [ ] `hidden.dotFiles/dotDirs.default: 'hidden'` (unless you knowingly serve dot-files)
- [ ] Reverse proxy with `server_name` allowlist

### Profile B — Internal / dev tool (loopback/LAN, often no proxy)
- [ ] Everything in Profile A, **plus**
- [ ] **Host allowlist** upstream (raw `ctx.get('host')`) — DNS rebinding
- [ ] Bind to a specific interface; firewall the port
- [ ] `symlinks: 'follow-within-root'`

### Profile C — User uploads / multi-tenant (untrusted write)
- [ ] Everything above, **plus**
- [ ] `symlinks: 'follow-within-root'` (or `'deny'`)
- [ ] `hidden.alwaysHide` blocklist for secret patterns
- [ ] `dirListing: { enabled: false }` (or low `maxEntries` + pagination) + **monitor dir growth**
- [ ] Uploads on a dedicated FS/mount with quotas; non-root process
- [ ] Disable template engine if unused

---

## 8. Maximally-hardened reference configuration

A copy-paste, defense-in-depth baseline. Loosen only what your use case truly needs.

```js
const Koa  = require('koa');
const pino = require('pino')();
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// 1) Host allowlist — DNS rebinding (skip if a reverse proxy enforces server_name).
const ALLOWED_HOSTS = new Set(['app.example.com']);
const normalizeHost = (h) => (h || '').toLowerCase().replace(/\.$/, '');
app.use(async (ctx, next) => {
  if (!ALLOWED_HOSTS.has(normalizeHost(ctx.get('host')))) {
    ctx.status = 421; ctx.body = 'Host not allowed'; return;
  }
  await next();
});

// 2) Extra response headers for user-facing HTML (nosniff is set by the middleware below).
app.use(async (ctx, next) => {
  ctx.set('X-Frame-Options', 'DENY');
  ctx.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  ctx.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  await next();
});

// 3) The file server — hardened.
app.use(koaClassicServer('/var/www/public', {
  method: ['GET'],                                  // read-only
  symlinks: 'follow-within-root',                   // no symlink escape (use 'deny' for hostile tenants)
  staticSecurityHeaders: { nosniff: true },         // block MIME sniffing on static files
  hidden: {
    dotFiles: { default: 'hidden', whitelist: ['.well-known'] },
    dotDirs:  { default: 'hidden', whitelist: ['.well-known'] },
    alwaysHide: ['*.key', '*.pem', /\.secret$/, 'config/secrets/**'],
  },
  dirListing: { enabled: false },                   // no listings; rely on index files
  index: ['index.html'],
  browserCacheEnabled: true,
  browserCacheMaxAge: 86400,
  logger: pino,                                     // real logger for warnings
  // template: omitted — no SSR attack surface
}));

app.listen(3000, '0.0.0.0');
```

If you **need** directory listings, replace `dirListing: { enabled: false }` with:
```js
dirListing: { enabled: true, maxEntries: 1000, entriesPerPage: 100 },
```
and monitor directory growth externally (see [§3.3](#33-directory-listing-directory-size--subdirectory-count)).

---

## 9. See also

- [`README.md`](../README.md) — quick start and feature overview
- [`docs/DOCUMENTATION.md`](./DOCUMENTATION.md) — full API reference
- [`docs/CHANGELOG.md`](./CHANGELOG.md) — version history (security changes under 🔒)
- [`docs/security_improvement_for_V3.md`](./security_improvement_for_V3.md) — audit roadmap, incl. `[F-1]`
- [`docs/SECURITY_AUDIT_v3.0.1.md`](./SECURITY_AUDIT_v3.0.1.md) — audit findings and resolutions
