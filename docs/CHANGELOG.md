# Changelog

All notable changes to koa-classic-server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.0] - Unreleased

### ⚠️ Breaking Changes

- **Dropped Koa 2 support — the `koa` peerDependency is now `>=3.1.2`** (was `^2.16.4 || >=3.1.2`).
  Koa 3 only. The trigger was `docs/revisione_codice_v5.0.md` #3: on Koa 2, a file read stream that
  errors *after* the response headers are flushed leaves the socket open until `server.requestTimeout`
  (5 min default), because Koa 2's `respond()` uses a bare `body.pipe(res)` that does not close `res`
  on a source error. Koa 3's `respond()` uses `Stream.pipeline(stream, res, …)`, which tears the
  socket down itself — so the hang cannot happen on Koa 3. Rather than carry a `ctx.res.destroy()`
  workaround for a framework major we no longer target, Koa 2 is dropped. **Migration**: upgrade the
  host app to Koa 3 (`npm install koa@^3`). The middleware's own API is unchanged; no code changes are
  required beyond the Koa upgrade.
- **Dropped Node.js 18 support — `engines.node` is now `>=20`** (was `>=18`). Node 20 is the oldest
  maintained LTS line going forward. This lets `String.prototype.toWellFormed()` (Node 20+) be used
  unconditionally for well-forming WTF-16 filenames; the Node-18 regex fallback in `toWellFormedName`
  was removed as dead code. **Migration**: run on Node 20, 22, or 24.
- **`hideExtension.redirect` now throws at factory time unless it is one of `300, 301, 302, 303, 305, 307, 308`** (the codes Koa emits as-is; `300`/`305` are exotic/deprecated but valid)
  (`docs/revisione_codice_v4.3.md` #9 — maintainer decision: hard validation in a major, option C).
  Until v4.x any number was accepted, with two silent failure modes at request time: an integer
  that is not a redirect status (`200`, `404`, `999`, ...) was silently replaced with `302` by
  `ctx.redirect()`, and a non-integer (or out-of-range) value made Koa's status setter throw —
  a **500 on every hideExtension redirect** plus a log line per request. Both were configuration
  bugs that could only be noticed in production; they now fail at startup with the valid list in
  the error message. **Migration**: if your config uses one of the five valid codes, nothing
  changes. Otherwise replace the value with the redirect you actually intended (the silent
  pre-v5 behavior of e.g. `redirect: 200` was a `302` anyway).

### ✨ Changed — extension options: leading dot optional, unified suffix semantics

- **`template.ext` and `hideExtension.ext` now treat the leading dot as optional**
  (`docs/revisione_codice_v4.3.md` #10 — "tolerant equivalence"): `'.ejs'` and `'ejs'` are
  equivalent everywhere; the preferred, documented form is **`'.ejs'`**. The old
  `hideExtension.ext` missing-dot warning is gone (both forms are simply legal), and the old
  `template.ext` trap is fixed: a dotted entry (`['.ejs']`) used to never match — the render
  never ran and the **template source was served raw**. It now works as intended.
- **`template.ext` matches by suffix** (like `hideExtension.ext` always did), through one
  shared normalizer: compound extensions are now supported (`['.html.ejs']` targets only
  `*.html.ejs` files). Single-extension behavior is unchanged, including the dotfile edge
  (a file named exactly `.ejs` has no extension and never matches). Entries that cannot
  name a suffix (empty, `'.'`, non-string) are dropped with a one-time deprecation warning.
- **`template.render` with a non-function value now warns** (one-time, deprecation) instead
  of being dropped silently — the silent drop meant "templates configured but sources served
  raw" with no signal. Behavior is unchanged (rendering disabled); a future major (target:
  6.0.0) will make it a startup error, together with the other pending config deprecations
  (maintainer decision: existing warn-level deprecations are kept as warnings through 5.x).

### 🐛 Fixed — error pages are no longer heuristically cacheable

- **Every generated error page now carries `Cache-Control: no-store`**, not just `5xx`
  (`docs/revisione_codice_v5.0.md` #1). Previously `writeErrorPage` scrubbed any inherited
  `Cache-Control` but re-set `no-store` only for status ≥ 500, so a **404 went out with no
  caching directive at all**. A 404 is heuristically cacheable by default (RFC 9110 §15.1 /
  RFC 7231 §6.1): behind a shared cache/CDN, a "not found" could keep being served after the
  file was actually created. This was the one spot where the middleware left a caching
  decision to a proxy's heuristic — the static-file branch (`browserCacheEnabled: false`)
  and the directory listing already defeat it explicitly. `no-store` (rather than the
  listing's `no-cache` trio) because an error page has nothing worth storing to revalidate
  later. The minimal `400 Bad Request` reply is intentionally unchanged (stays header-light).

## [4.3.0] - 2026-07-14

Customization release: the compression qualities and the compressed cache's per-entry
admission cap — previously hardcoded — become options. Defaults are unchanged on every path.

### ✨ Feature — `compression.buffered` / `compression.streaming`: configurable quality
- **What**: two new option groups expose the previously hardcoded compression settings,
  one per execution mode — the modes have opposite cost models, so their quality is
  configured independently:
  - `compression.buffered: { brotliQuality: 11, gzipLevel: 9 }` — the buffered path
    (file ≤ `compression.maxFileSize`, output cached): the CPU cost is paid **once per
    file** (single-flight), so max quality by default.
  - `compression.streaming: { brotliQuality: 4, gzipLevel: 6 }` — the streaming path
    (file > `compression.maxFileSize`, or compressed cache disabled): the CPU cost is
    paid on **every non-cached request**, so deliberately light by default.
- **Validation**: integers only, brotli 0–11 / gzip 0–9; out-of-range, non-object groups
  and **unknown keys** throw at factory time (typo protection on a brand-new namespace).
- **Not exposed**: the streaming brotli window stays pinned at LGWIN 19 (512 KB) — it is
  what bounds the per-stream RAM, making it configurable would undermine the safety net.
- **Use case**: CPU-constrained hosts can lower `buffered.brotliQuality` to make
  cold-cache first requests cheaper (see `SECURITY_HARDENING.md` §3.10).

### ✨ Feature — `serverCache.compressedFile.maxEntrySize`: configurable per-entry cap
- **What**: the per-entry admission cap of the compressed cache — hardcoded at ¼ of
  `maxSize` since the stream-tee work — becomes an option, measured on the compressed
  OUTPUT. Unset → `maxSize / 4` (unchanged, and it keeps scaling with `maxSize`);
  explicit integer → bytes; `false` → no per-entry cap (`maxSize` still bounds).
  Oversized entries are still served, just never cached (throttled warning names the
  option). A value above `maxSize` throws at factory time (config contradiction — the
  hint points to `false`).
- **Where enforced**: inside the LFU cache itself (`set()` and `refresh()`), so the cap
  now applies to **every** insertion, not just the streamed-tee path; the tee keeps its
  early-abandon check so an over-budget accumulation stops holding RAM immediately.
- **Behavior note (non-default configs only)**: the buffered path previously had no
  per-entry cap. An operator running `compression.maxFileSize: false` with files whose
  compressed output exceeds ¼ of the cache's `maxSize` will see those entries no longer
  cached (responses are unchanged; repeat requests recompress). Restore the old behavior
  with `maxEntrySize: false` or an explicit higher value.

## [4.2.1] - 2026-07-13

Patch release: two follow-ups from the post-4.2.0 code review of the `errorPages` work.
No API changes.

### 🛡️ Fix — directory-read 500 routed through the unified error writer
- **Issue**: 4.2.0 claimed *every* middleware-generated error goes through one writer, but the
  `show_dir` readdir-failure 500 was missed: it built its own bespoke "Error Reading Directory"
  HTML, skipping `errorPages[500]`, the `no-store`, and the header scrub. An operator who
  configured a custom 500 page did not get it on a directory read failure (EACCES/EIO).
- **Fix**: `show_dir`'s error branch now calls the shared error writer — it honors
  `errorPages[500]`, sets `Cache-Control: no-store`, and scrubs leftover headers like all other
  500s. The caller only assigns the listing body when `show_dir` actually produced a listing.
- **Observable change**: without a custom page this branch now serves the generic built-in 500
  body (was the directory-specific message); with `errorPages[500]` configured it serves the
  operator's page. The existing `io-failure-paths` assertion was updated and a custom-page case
  added.

### ✅ Test — deterministic coverage of the error-writer output
- **Issue**: the two stream-failure tests asserting the served error body/headers ran their
  meaningful checks only inside an `if (response arrived)` branch that is never taken — Koa 3
  tears down the socket on a mid-stream body error, so the client always sees `ECONNRESET`. The
  output contract of `writeErrorPage` (stale `Content-Encoding` scrubbed, `text/html`, `no-store`
  on ≥ 500, custom-vs-built-in body, CSP present only for the built-in page) was therefore
  covered by line-coverage but never actually asserted.
- **Fix**: `writeErrorPage` is exported via `_internals` and unit-tested through a real Koa
  response (a middleware pre-sets "dirty" headers, then calls it — no stream, no teardown), so
  the exact output `sendErrorPageSync` produces is now deterministically verified. The
  stream-failure tests are kept for their log-line / non-crash assertions.
- **Tests**: new deterministic cases in `__tests__/error-pages.test.js`.

## [4.2.0] - 2026-07-13

### ✨ Feature — `errorPages`: operator-supplied custom error pages
- **What**: new opt-in `errorPages` option mapping a supported status to a filesystem path:
  `errorPages: { 404: './errors/404.html', 500: './errors/500.html', 504: './errors/504.html' }`.
  Supported statuses are exactly the ones the middleware generates HTML pages for (**404, 500,
  504**); any other key throws at factory time. `400` replies to malformed/hostile requests stay
  deliberately minimal and are not customizable. Omitted statuses keep the built-in pages
  byte-for-byte.
- **Path semantics**: filesystem path (absolute or relative to `process.cwd()`), intentionally
  NOT a URL inside `rootDir` — the page can (and should) live outside the served tree, and it
  never interacts with `hidden` / `urlPrefix` / `symlinks`.
- **Lifecycle**: read and validated at factory time (missing/unreadable → throw with hint, so a
  typo fails at startup, not on the first 404); cached in RAM; re-read automatically when
  mtime/size changes (editable without a restart); if unreadable at request time the built-in
  page is served and a throttled warning (1/min per status) goes to the operator's `logger`.
- **Security model**: custom pages must be a single self-contained `.html` (inline CSS, no
  external css/js/img references). Documented, not enforced: custom pages are served **without**
  the built-in pages' `Content-Security-Policy` (whose `default-src 'none'` would block inline
  styles); the other generated-page headers (`nosniff`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`) are still sent. See `SECURITY_HARDENING.md` §3.5.

### 🛡️ Robustness — every error branch unified through one writer
- **Issue**: error responses were assembled in three inconsistent styles: the HTML pages
  (404/template-500/504), the last-resort catch (HTML + header scrubbing + `no-store`), and five
  stream-failure branches replying **plain text** `Error reading file` with no security headers
  and no header cleanup — two of which could leave a stale `Content-Encoding: br/gzip` on a
  plain-text body. One 404 branch (file became unreadable between `stat` and `access`) could
  also leak `Cache-Control: public, max-age=...` onto the error, letting a proxy cache the 404
  as the resource.
- **Fix**: a single writer now produces every middleware-generated error response: custom or
  built-in page, generated-page security headers, scrubbing of leftover representation/caching
  headers (`Content-Encoding`, `ETag`, `Vary`, `Cache-Control`, ...), and `Cache-Control:
  no-store` on ≥ 500 (now including the template 500/504). The template-failure 500 keeps its
  specific built-in message when no custom page is configured.
- **Observable change** (rare branches only): the five stream-failure 500s now reply with the
  HTML error page instead of 11 bytes of plain text — when a reply is deliverable at all: Koa 3
  answers a stream-body error by tearing down the socket, so these writes are best-effort
  (verified: the old plain-text reply was equally undelivered under Koa 3). The
  `access`-failure 404 no longer carries the public `Cache-Control`. No test asserted the old
  bodies.
- **Docs**: `index.cjs` defaults JSDoc, `README.md` (options block + example),
  `DOCUMENTATION.md` (§ `errorPages` + updated 404-fallback best practice),
  `SECURITY_HARDENING.md` §3.5.
- **Tests**: `__tests__/error-pages.test.js` (22 tests: factory validation, custom/built-in
  serving, CSP presence/absence, HEAD, live reload, runtime fallback + warn throttling,
  template 500/504, last-resort catch, stream-failure branches, Cache-Control scrub,
  minimal 400 preserved).

## [4.1.0] - 2026-07-12

### ⚡ Performance — streamed compression output is cached (large-file RAM hits)
- **Issue**: above `compression.maxFileSize` (default 10 MB) every request re-ran the
  streaming compression from scratch and discarded the output — the cap gates the
  *input* size (never buffer a huge file), but it also disabled the compressed cache
  *lookup*, so a 20 MB log downloaded N times cost N full compressions (~0.4 s CPU and
  ~370 ms latency each, measured) while its ~6.5 MB compressed output would comfortably
  fit the 100 MB compressed cache. Benchmarks: `docs/performance_v3_vs_v4.md`.
- **Fix**: the compressed-cache lookup now runs on both sides of the cap. On a miss
  above the cap, the response is still streamed exactly as before (bounded RAM, brotli
  Q4 / gzip 6, no `Content-Length` on that first response), but the **leader** request
  also tees the compressed output into the cache through a passthrough `Transform` in
  the `pipeline`: from the second request on, the file is a RAM hit with
  `Content-Length` (measured: 15.5 ms vs 364 ms on a 20 MB file — on par with the v3
  buffered path, without its 35–50 s first-hit cost).
- **Bounded by construction**: only one request per `path:encoding:mtime:size`
  accumulates (concurrent cold requests all stream independently, with no tee stage
  and no added latency); accumulation stops — and the entry is skipped — beyond a
  quarter of the compressed cache's `maxSize` (one huge file can never evict most of
  the working set on insert) **and** beyond an aggregate in-flight budget equal to
  the cache's whole `maxSize` (many *distinct* large files teed concurrently can
  never hold more transient RAM than the cache they feed); an abort or stream error
  discards the accumulation (never a truncated entry). Admission is decided on the
  actual *output* size, known only after compressing.
- **No API change, no new option**: gated by the existing
  `serverCache.compressedFile.enabled` (disable it for fully stateless large-file
  responses). `HEAD` on a warm entry now carries the real `Content-Length`.
- **Docs**: `index.cjs` defaults JSDoc, `DOCUMENTATION.md` (§ compression thresholds +
  options table), `SECURITY_HARDENING.md` §3.10, CLAUDE.md safety-net table.
- **Tests**: `__tests__/compression-stream-tee.test.js` (9 tests: miss→tee→hit for
  br/gzip, per-entry cap, staleness on rewrite, abort mid-stream, read error, 5
  concurrent cold requests, cache-disabled gate; 5 verified to fail pre-fix). Two
  assertions in `compression-max-file-size.test.js` updated to the new contract
  (second request is a hit; warm `HEAD` has `Content-Length`).

### 🛡️ Robustness — streaming brotli window bounded (LGWIN 19) + hardening docs
- **Issue**: the per-stream brotli encoder state was the dominant RAM cost of concurrent
  streamed compressions (~10 MB per stream at brotli's default 4 MB window): 100
  concurrent cold requests to a 20 MB compressible file peaked at **~1.3 GB RSS**
  (pre-existing in 4.0.0 — the tee added nothing measurable). A client fanning out over
  many distinct large compressible files could drive RAM/CPU as a DoS vector.
- **Fix**: the streaming compressor (shared `createStreamCompressor()`) now sets
  `BROTLI_PARAM_LGWIN: 19` (512 KB window). Measured: same output size on typical text
  at Q4 (6.44 vs 6.45 MB on the 20 MB benchmark file, ~40% faster), peak RSS for the
  100-concurrent stress **1 414 → 344 MB (−76%)**. Trade-off: content with identical
  blocks repeated at > 512 KB distance (pathological) compresses worse than with the
  4 MB window. Buffered-path quality (brotli Q11, files ≤ `maxFileSize`) is untouched;
  gzip's window is 32 KB by design.
- **Docs**: new `SECURITY_HARDENING.md` §3.10 bullet documenting the concurrent
  on-the-fly-compression amplification surface (common to all compress-at-request-time
  servers) and the per-profile mitigations (reverse-proxy rate limiting first).

### 📦 Package Changes
- **Version**: `4.0.0` → `4.1.0`
- **Semver**: Minor — pure performance improvement; no observable-semantics change
  beyond `Content-Length` (and faster responses) from the second request on, plus the
  smaller brotli window on the streaming path (different but equivalent compressed
  bytes).

## [4.0.0] - 2026-07-09

This major release bundles the v3.1 robustness work with one intentional
behavior change that requires the version bump.

### ⚠️ Breaking Changes
- **Canonical trailing-slash enforcement is now ON by default** (`dirListing.trailingSlash: true`, finding #3). `GET /dir` on a directory now **301-redirects to `/dir/`** (so relative links in an index page resolve against the directory), and `GET /file/` on a file now returns **404** (a file is only reachable at its slash-less URL). Set `dirListing: { trailingSlash: false }` to restore the v3 behavior (serve directories and files regardless of the trailing slash). Clients that request `/dir` without following redirects, or that rely on `/file/` serving the file, must adapt.
- **`compression.maxFileSize` (default 10 MB)** caps the buffered high-quality compression path: compressible files above the cap are now streamed (bounded RAM, no `Content-Length`) instead of buffered whole into memory. Set `compression: { maxFileSize: false }` to restore the old buffered path.
- **Non-object `options` throws** at factory time (including explicit `null`), where it previously coerced or crashed with a raw `TypeError`.

### 🚦 Canonical trailing-slash redirect / 404 (`dirListing.trailingSlash`, #3)
- **Issue**: serving a directory's index at `/dir` (no slash) makes the browser resolve the page's relative links against the *parent* (`<a href="p2.html">` → `/p2.html`, a 404) instead of `/dir/p2.html`. Every mainstream static server (Apache, nginx, Caddy, express/serve-static) redirects `/dir` → `/dir/` to fix this.
- **Behavior** (default `true`): `GET /dir` → `301 /dir/` (query string preserved, percent-encoding preserved, `urlPrefix` included); `GET /file/` → `404` (this includes template files — `GET /page.ejs/` now 404s instead of rendering). Root `/` never redirects. The **directory** redirect only fires when the directory would actually render (listing enabled), so a listing-disabled directory 404s directly without a redirect-to-404; the **file** 404 applies independently of `dirListing.enabled` (it is pure URL canonicalization). The redirect `Location` is parsed origin-relative (an absolute-form request target cannot become an off-origin `Location`), and a `//host`-style path is collapsed to a single leading slash — no open redirect. With `useOriginalUrl: false`, canonicalization is based on the client's original URL; if your rewriting maps a trailing-slash URL to a file, set `trailingSlash: false`.
- **Code** (`index.cjs`): `_pathEndsWithSlash` captured from the raw `originalUrl` before the slash-stripping URL parse; redirect in the directory branch (before index/listing); 404 in the file branch. New `dirListing.trailingSlash` option (default `true`).
- **Tests**: `__tests__/dir-trailing-slash.test.js` (20 tests). Two existing suites that requested directories without a trailing slash (`index.test.js`, `directory-sorting-links.test.js`) were updated to use the canonical slash URLs.

### ⚠️ Deprecation — malformed `urlPrefix` / `urlsReserved` now warn (will throw in a future major)
- **Issue** (`docs/revisione_codice_v3.1.md` #11): both options had an implicit format the request-time matcher depended on, and a malformed value failed **silently** — `urlPrefix: '/static/'` (trailing slash) or `'static'` (missing leading slash) made the middleware serve nothing (it always fell through to `next()`); `urlsReserved: ['admin']` (missing leading slash) made the reservation never match (the path was served instead of passed on); a non-string entry 500'd on every request; a multi-segment entry (`'/admin/panel'`) never matched (matching is first-level only).
- **Fix**: because both are **v2-stable** options, a malformed value now emits a **once-per-process deprecation warning** and the runtime behavior is left **exactly as today** — throwing on a stable option would be a breaking change, and silently *normalizing* the value could change behavior for a config that "worked" only by falling through to a downstream handler. A future major will turn these warnings into hard errors (the messages are already written; a single helper flips warn → throw). Deliberately *not* flipped in 4.0.0 to keep the deprecation window open.
- **One deliberate exception**: a non-string `urlsReserved` entry is **dropped** (with a warning) instead of left in place, because it would otherwise `TypeError` on `value.substring` and 500 every request — not working behavior, so dropping it can't break anything.
- **No behavior change, no breakage**: valid configs are unaffected; malformed ones behave as they did before, just with a heads-up. The caller's config object is not mutated.
- **Tests**: `__tests__/url-prefix-reserved-validation.test.js` (10 tests: warning + unchanged behavior for each form, non-string-entry drop, no caller mutation, once-per-process dedup).

### 🐛 Bug Fix — factory no longer mutates the caller's options; non-object options throw
- **Issue** (`docs/revisione_codice_v3.1.md` #10): `options` was an alias of the caller's object — the factory rewrote `index`, `dirListing`, `template.renderTimeout`, `hideExtension.ext`, etc. in place. Reusing one config for two instances broke observably (with the v2 `showDirContents` alias the SECOND instance threw *"both set"*, because the first call had written `dirListing` into the caller's object); inspecting the config after startup showed values the operator never wrote. Also, `koaClassicServer(root, null)` crashed with a raw `TypeError` instead of a helpful message.
- **Fix**: the factory works on a shallow copy, with nested copies of the only two objects normalization writes into (`template`, `hideExtension`). Any non-object `options` — **including explicit `null`** — now throws `[koa-classic-server] options must be a plain object (or omitted entirely)` at factory time; only an omitted parameter yields defaults.
- **Note**: passing garbage like a string or an array used to silently fall through to near-default behavior; it now fails fast at startup, consistent with the project's other factory validations.
- **Tests**: `__tests__/options-immutability.test.js` (8 tests; 7 verified to fail pre-fix). One legacy test asserted the 30000 `renderTimeout` default *by reading it back from the caller's object* — i.e. it asserted the removed side effect — and was rewritten against the new contract.

### 🛡️ Robustness — error containment (last-resort catch + hideExtension URL guard)
- **Last-resort catch** (`docs/revisione_codice_v3.1.md` #18): an unexpected failure on any unguarded path used to leak to Koa's default handler — a plain-text 500 without the middleware's security headers, logged outside the operator's `logger` (invisible to pino/winston). The whole "owned request" section (after the method/prefix/urlsReserved pass-throughs, which return early) is now wrapped: unexpected errors are logged via `logger.error` and answered with a prebuilt 500 page carrying the generated-page security headers; if headers already went out, the socket is destroyed (same pattern as template errors). Downstream middleware errors are NOT masked — no `next()` call sits inside the net.
- **hideExtension URL guard** (#19): the redirect branch rebuilds `new URL(origin + ctx.originalUrl)`; with `useOriginalUrl: false` the URL prologue validates the rewritten `ctx.url`, not `originalUrl`, so a malformed `originalUrl` (e.g. an absolute-form request target, legal in HTTP/1.1) made the constructor throw. Now it returns **400 Bad Request**, consistent with every other malformed-client-input guard.
- **Tests**: `__tests__/error-containment.test.js` (5 tests: middleware 500 page + logger on unexpected throw, downstream errors untouched, normal serving unaffected, absolute-form target → 400, clean-URL redirect intact). Both regression tests verified to fail against the pre-fix code.

### 🏗️ Infrastructure — CI on every push and pull request
- New `.github/workflows/ci.yml`: full test suite (performance excluded) on **Node 18 / 20 / 22 / 24 on Linux, Node 22 / 24 on Windows, and Node 20 / 22 / 24 on macOS**, for every push to `main` and every PR. Previously tests only ran at release-publish time, on a single Node/OS. All legs are blocking (Windows and macOS were each rolled out informational for one green run, then promoted).
- **macOS coverage** exercises the `darwin` half of the case-insensitive-FS boundary logic (only `win32` hit it before) and runs the symlink-policy suites natively (Windows skips them for lack of privileges). Node 18 is excluded on macOS (covered on Linux).
- **Windows / Node 18 & 20 excluded by design**: the middleware itself passes on Windows (the Node 22/24 Windows legs are green), but on Node 18/20 the *test-suite teardown* (`fs.rmSync(dir, { recursive: true })` in afterEach/afterAll) flakes with EPERM/ENOTEMPTY — a lingering served-file handle that Node 22+ releases in time and 18/20 do not. It's an old-Node-on-Windows teardown quirk, not a product bug. Node 18/20 stay fully covered on Linux; Windows is covered on the two current stable Node lines.
- **Lint** runs in a dedicated job (once, on Node 22): eslint 10 requires Node >=20.19, so it cannot run inside the Node 18 leg — and linting the same code many times would be wasted work anyway. `npm test` locally still lints via the existing `pretest` hook.
- **Performance tests** (timing assertions, flaky on shared runners) run in a separate non-blocking job on ubuntu/Node 22; still available locally via `npm run test:performance`.
- **Nix job** (informational): runs the suite with a Nix-store-provided Node on ubuntu, approximating NixOS environments — consistent with the project's DT_UNKNOWN / `buildFHSEnv` support.
- `workflow_dispatch` trigger for manual runs (also needed because pushes made by bot/app integrations do not fire push/pull_request workflow events).
- New npm script `test:ci` (`jest --testPathIgnorePatterns=performance`).

### 🐛 Bug Fix — `If-Modified-Since` never produced 304 for sub-second mtimes
- **Issue** (`docs/revisione_codice_v3.1.md` #2): `Last-Modified` is emitted with second precision (`toUTCString()` — HTTP dates have no milliseconds), but the `If-Modified-Since` comparison used the raw millisecond mtime. A client echoing the received header back (standard behavior: `curl -z`, wget, proxies, minimal HTTP clients) never matched a sub-second mtime (`22:13:20.500 <= 22:13:20.000` → false) and always got a full 200. Browsers were unaffected only because they also send `If-None-Match` (checked first).
- **Fix**: the mtime is truncated to whole seconds before the comparison, matching the precision of the emitted header.
- **Tests**: `caching-headers.test.js` — new describe reusing the real `Last-Modified` of the previous response on a file whose mtime has a `.500` ms component (`fs.utimesSync`); verified to fail against the pre-fix code.

### 🐛 Bug Fix — Accept-Encoding q-values honored + `Vary` completeness (register #6, #7)
- **`Accept-Encoding` q-values (#6)**: encoding selection used a loose substring match (`acceptEncoding.includes(enc)`), so `Accept-Encoding: br;q=0, gzip` served **brotli** — the encoding the client explicitly *refused* (RFC 9110 §12.5.3) — and `x-gzip` wrongly matched `gzip`. Selection now parses each member's q-value and **excludes `q=0`** encodings, matches tokens **exactly**, and understands the `*` wildcard (`*` supplies the q-value for any encoding not listed; `*;q=0` refuses all). Server preference order (`compression.encodings`) still decides the winner among acceptable encodings — the client's q-values are used only to exclude, not to reorder (a deliberately minimal parser).
- **`Vary: Accept-Encoding` completeness (#7)**: `Vary` was set only inside the compressed branch, so (a) a `304` for a compressed variant went out **without** `Vary` (RFC 9110 §15.4.5 requires the 304 to carry the headers the 200 would), and (b) an **identity** response to a compressible resource (client without a matching `Accept-Encoding`) lacked `Vary`, letting a shared proxy serve it to a client that would have received the compressed variant. `Vary: Accept-Encoding` is now set as soon as the resource is *potentially* compressible (compressible MIME + compression enabled + meets `minFileSize`), **before** the 304 check and independent of `browserCacheEnabled`. The compression-error fallback now **keeps** `Vary` and **resets the ETag** to its un-suffixed form (it previously removed `Vary` and left the stale `-br`/`-gz` ETag on the identity body, poisoning shared caches).
- **No breaking change**: valid clients that list a supported encoding get the same result as before; only refused (`q=0`) and wildcard cases change, plus the now-present `Vary` on identity/304 responses. Nothing changes the default `GET /file` bytes for a normal browser.
- **Tests**: `__tests__/encoding-negotiation.test.js` (q=0 exclusion, server-preference-wins, `*`/`*;q=0`, exact-token match, case-insensitivity, whitespace; `Vary` on compressed/identity/304, absent below-threshold and on non-compressible MIME) and `__tests__/compression-fallback-vary-etag.test.js` (forced brotli failure → identity body with `Vary` kept and ETag reset).

### 🐛 Bug Fix — conditional-request precedence over Range + richer `If-None-Match` (register #8, #9)
- **Validators now precede Range (#8)**: the `If-None-Match` / `If-Modified-Since` checks were evaluated *after* the Range branch, so a conditional request that also carried a `Range` header got a **206 (Partial Content)** even when the client's cached copy was still current — it should get a **304 (Not Modified)** (RFC 9110 §13.2.2 gives the validators precedence over Range). The precondition block is now evaluated before the Range branch. Separately, **206 responses now carry `ETag` + `Last-Modified`** (when `browserCacheEnabled`), so a partial response can be revalidated/resumed. The 206 is tagged with the un-suffixed `baseEtag` (the partial bytes are always identity, never compressed), while the preconditions compare against the encoding-specific `fullEtag` from #7. `If-Range` is unchanged: still a strong, exact comparison against `baseEtag` (RFC 9110 §13.1.5).
- **`If-None-Match` understands `*`, lists, and weak tags (#9)**: the check was an exact string comparison against the whole header, so `If-None-Match: "a", "b"` (a comma-list, e.g. from a CDN), `If-None-Match: *`, and a weak-tagged `If-None-Match: W/"…"` never matched → a full **200 (OK)** instead of **304 (Not Modified)**. A new module-level helper `ifNoneMatchSatisfied()` handles all three: `*` matches any existing representation, lists are split and matched element-wise, and the comparison is the weak function (a leading `W/` is ignored on both sides, per RFC 9110 §13.1.2). A single strong ETag behaves exactly as before.
- **No breaking change**: a normal full `GET` (with or without a single conditional header) is unaffected; only the Range+conditional precedence, the new validators on 206, and the previously-never-matching `*`/list/weak forms change — all toward RFC conformance.
- **Tests**: `__tests__/conditional-precedence.test.js` (12 tests: 206 carries ETag/Last-Modified, Range+matching validator → 304, non-matching → 206, no-ETag without `browserCacheEnabled`, base-ETag on a compressible 206, and the `*`/list/weak/`W/` If-None-Match cases).

### 🐛 Bug Fix — `hideExtension` trailing-slash & percent-encoded extension (register #14, #20)
- **Trailing slash on an extension URL → 404, not a broken redirect (#20)**: `GET /foo.ejs/` produced `301 → /foo.` (the extension slice ate the trailing slash instead of the extension), and `/sub/index.ejs/` produced `301 → /sub/index.`. Aligned with the V4 trailing-slash model (#3, "a file requested with a trailing slash is a 404"): `hideExtension` now canonicalizes an extension URL **only when it has no trailing slash**, gating on the same `_pathEndsWithSlash` flag the #3 file-branch 404 uses. So `/foo.ejs/`, `/sub/index.ejs/`, and `/foo%2Eejs/` all 404 (a file with a trailing slash), while `/foo.ejs` → `/foo` and `/sub/index.ejs` → `/sub/` are unchanged. With `dirListing: { trailingSlash: false }` the escape hatch serves the file (200) regardless of the slash. This is not a new restriction — it makes `hideExtension` consistent with the trailing-slash correctness fix already shipped in 4.0.0.
- **Percent-encoded extension handled consistently (#14)**: the extension *check* mixed a decoded path (no trailing slash) with a raw path (trailing slash), so `/foo%2Eejs` was detected but `/foo%2Eejs/` was not; and the redirect *target* sliced `hideExt.length` characters off the raw (encoded) path, so `/foo%2Eejs` redirected to the broken `/foo%2`. The check now uses the decoded path throughout, and the target is built in decoded space (extension literal → sliceable) then re-encoded per segment — so `/foo%2Eejs` → `/foo` and a filename with a space round-trips (`/my%20file.ejs` → `/my%20file`).
- **Open-redirect guard preserved**: the guard that collapses a leading `//` or `/\` now runs **after** the re-encode (a decoded `%2F` could otherwise reintroduce a leading `//`), and backslashes are always re-encoded (`%5C`), so the `Location` can never become protocol-relative. Verified against adversarial inputs (`//`, `/\`, `%2F%2F`, `%5C%5C`, `%09//`, `///`).
- **Tests**: `__tests__/hideExtension-trailing-slash.test.js` (9 tests: trailing-slash → 404 for plain/encoded/index forms, the `trailingSlash:false` escape hatch, `%2E`/space redirect targets, and the `%2F`-reintroduction open-redirect guard).

### 🐛 Bug Fix — directory-listing cosmetics: Parent Directory link & empty-folder row (register #13, #16)
- **"Parent Directory" link respects `urlPrefix` (#13)**: with `urlPrefix: '/static'`, the listing of `/static/` showed a `.. Parent Directory` link pointing to `/` — outside the middleware's served tree. The link is now omitted at the middleware's **logical** root (`pageHrefOutPrefix.pathname === '/'`), not only at the absolute root; a sub-listing like `/static/sub/` still links to `/static/` (inside the prefix).
- **"empty folder" row when every entry is hidden (#16)**: the `dir.length === 0` check ran before the hidden-entry filter, so a directory containing only hidden entries (dotfiles with `hidden.dotFiles.default: 'hidden'`, `alwaysHide`, `blacklist`) rendered a header-only table with no rows and no message. The "empty folder" row is now also shown when `items.length === 0` after filtering — making an all-hidden directory indistinguishable from an empty one (and not hinting that hidden files exist).
- **Tests**: `__tests__/listing-parent-empty.test.js` (8 tests: parent link present/absent and its href with and without `urlPrefix`; empty-folder row for all-hidden / physically-empty / has-visible-entry directories, and the no-leak equivalence).

### ⚠️ Deprecation — invalid `browserCacheMaxAge` now warns (will throw in a future major) (register #12)
- **Issue**: an invalid `browserCacheMaxAge` (negative, `NaN`, non-integer, `Infinity`, or a string) fell back to the default `3600` **silently** — inconsistent with `dirListing.maxEntries` / `template.renderTimeout` / `serverCache.*.maxAge`, which throw with a hint.
- **Fix**: consistent with the #11 decision, the factory now emits a **once-per-process deprecation warning** and keeps the `3600` fallback; a future major will turn it into a hard throw. The validity boundary is strict (non-negative finite integer), so exactly the values that warn now are the ones that will throw later — nothing goes from silently-accepted straight to throwing without a deprecation window. An omitted value still defaults to `3600` with no warning.
- **No behavior change beyond the warning**: any value that produced a given `Cache-Control: max-age` before still does; only previously-silent fallbacks (and the now-flagged non-integer/`Infinity` cases) additionally log the warning. The caller's options object is not mutated.
- **Tests**: `__tests__/browser-cache-maxage-validation.test.js` (11 tests: warn + `max-age=3600` fallback for each invalid form, valid values used without warning, `0`/undefined handling, once-per-process dedup, no caller mutation).

### 🧹 Chore — `Buffer.slice()` → `Buffer.subarray()` (register #15)
- The Range/206 in-memory path used the deprecated `Buffer.prototype.slice` (DEP0158); replaced with `subarray()` — identical zero-copy semantics.

### 🛡️ Robustness — fd leak in streaming compression on client disconnect
- **Issue** (`docs/revisione_codice_v3.1.md` #17, from the 2026-07 robustness analysis B1): the streaming compression path built the response with `src.pipe(compress)`. On client disconnect Koa destroys the body (the zlib transform), but `pipe()` does not propagate destruction back to the source: the `fs.ReadStream` stayed paused with its file descriptor open forever (ReadStreams close their fd only on `end`/`error`, and raw fds have no GC finalizer). Every aborted download of a large file leaked one fd → eventual `EMFILE`. Reachable with the default config for compressible files above `compression.maxFileSize`.
- **Fix**: `stream.pipeline(src, compress, cb)` — teardown propagates in both directions, so the ReadStream is destroyed (fd closed) as soon as the client goes away. Client disconnects (`ERR_STREAM_PREMATURE_CLOSE`) are ignored silently (normal event; avoids client-driven log spam); real read errors keep the previous behavior (log + 500 when headers not yet sent). Applied to both streaming variants (disk-backed and in-memory).
- **Tests**: `__tests__/streaming-abort.test.js` (client abort mid-download → source stream destroyed; normal completion unaffected). Verified the abort test fails against the pre-fix code.

### 🐛 Bug Fix — HEAD returned 404 on the streaming compression path
- **Issue** (found by the internal code review of the two robustness fixes below): the streaming compression branch never assigns a body or a status for HEAD requests, so Koa's default **404** leaked — with stray `Content-Encoding`/`Vary` headers. The path was pre-existing (reachable with `serverCache.compressedFile.enabled: false`), but the new `compression.maxFileSize` gate made it reachable with the DEFAULT config: `HEAD` on a compressible file above the cap returned 404 while `GET` returned 200, violating RFC 9110 §9.3.2.
- **Fix**: the streaming branch sets `ctx.status = 200` explicitly for HEAD (no `Content-Length`, since the compressed size is unknown without running the compression) — mirroring GET's status and headers.
- **Other review outcomes applied**:
  - `LFUCache.set()` now emits a **throttled warning** when an entry exceeds the whole cache's `maxSize` instead of silently never caching it (operators keep the sizing signal the old eviction loop provided); shared `_warnThrottled()` helper.
  - Removed the now-dead post-eviction size guard in `LFUCache.set()`.
  - Single-flight in-flight keys now include the stat'd **mtime+size**, so concurrent requests that observed different versions of a file never share a job (each response stays coherent with its own `ETag`/`Last-Modified`).
  - The template render's `rawBuffer` parameter is now documented as **read-only** (JSDoc + template-engine guide): it is the same Buffer instance shared with the server cache and concurrent requests.
  - CLAUDE.md safety-net table updated with the `compression.maxFileSize` row; register finding #7 extended with the encoding-suffixed-ETag-on-fallback case to cover in the same fix.
- **Tests**: HEAD-mirrors-GET on both streaming paths + oversized-entry warning (3 new tests).

### 🛡️ Robustness — `compression.maxFileSize` cap + LFU eviction fix
- **Issue** (`docs/revisione_codice_v3.1.md` #4): with the default config, a compressible file of ANY size was read whole into RAM and brotli-Q11-compressed on first request (multi-GB text file → RAM allocation equal to the file + heavy CPU). Aggravating: when the compressed buffer exceeded the cache's `maxSize`, `LFUCache.set()` flushed the ENTIRE cache in its eviction loop before discovering the entry could never fit — repeatable CPU/RAM DoS that also destroyed every other cached file.
- **Fix**:
  - New option `compression.maxFileSize` (default **10 MB**, `false` = no cap): files above the cap are STILL compressed, but through the existing bounded-RAM streaming mode (brotli Q4 / gzip 6, no `Content-Length`, not cached) instead of the buffered+cached path. Safety net against process failure modes, not a serving restriction — every file remains downloadable.
  - `LFUCache.set()` now returns early when the entry is larger than the whole cache, BEFORE the eviction loop — an entry that can never fit no longer evicts everyone else.
- **Behavior change (default)**: compressible files larger than 10 MB switch from buffered brotli Q11 (unbounded RAM) to streamed compression. Operators can restore the old behavior with `compression: { maxFileSize: false }`.
- **Docs**: option documented in the `index.cjs` defaults JSDoc block and in `SECURITY_HARDENING.md` §3.10.
- **Tests**: `__tests__/compression-max-file-size.test.js` (10 tests: buffered vs streaming paths, `false` cap, invalid-value fallback, LFU flush regression).

### 🛡️ Robustness — single-flight cache population (thundering herd)
- **Issue** (`docs/revisione_codice_v3.1.md` #5): N concurrent requests for a file not yet cached ran N `readFile()` + N brotli/gzip compressions in parallel for identical content; only the last `set()` "won". On a cold cache (deploy, restart) the CPU/RAM peak multiplied by the number of concurrent requests.
- **Fix**: in-flight job maps (`key → Promise`) for both server caches. The first request (the leader) performs the read (+ compression) and the cache insert; concurrent requests await the same Promise. A rejection is shared as well — all waiters fall back together to the existing uncompressed-stream path — and the entry is removed on settlement, so the next request after a failure retries from scratch. Keys: `path` (rawFile), `path:encoding` (compressedFile — br and gzip stay independent jobs).
- **No API change**; zero overhead on cache hits (the single-flight path is only reached on a cache miss).
- **Code** (`index.cjs`): module-level `singleFlight()` helper; per-factory `_inflightRawReads` / `_inflightCompressions` maps; both cache-population sites wrapped.
- **Tests**: `__tests__/single-flight.test.js` (5 tests: concurrent dedup on both caches, per-encoding key granularity, shared failure + retry after cleanup).

## [3.1.0] - 2026-07-02

### 🔒 Security — new `symlinks` policy (opt-in protection against symlink escape)

#### `symlinks` option — contain symbolic links inside `rootDir`
- **Issue (V-1)**: A symlink placed inside `rootDir` whose target lives **outside** `rootDir` was followed and served with no boundary check. The path-traversal defense validates the *requested path string* only; because `fs.promises.stat()` follows symlinks, the resolved target was never re-checked against `rootDir`. On deployments where `rootDir` contains directories writable by untrusted parties (uploads, spool, multi-tenant hosting), a planted symlink could read any file the process can access (`/etc/passwd`, keys, `.env` outside root). This contradicted the documented `[PS-1]` property *"the resolved path must start with rootDir"*, which did not hold for symlinks.
- **Fix**: A new opt-in `symlinks` option:
  - `'follow'` **(default)** — historical behavior, follow symlinks anywhere including outside `rootDir`. **Zero overhead**, no behavior change on upgrade.
  - `'follow-within-root'` — follow only while the resolved `realpath` stays inside `rootDir`; escaping links return **404**.
  - `'deny'` — never follow a symlink resolved **below** `rootDir`.
- **`rootDir` as a symlink is preserved** in every mode: the boundary is pinned to `realpath(rootDir)` resolved **once at factory init**, so atomic-deploy / Capistrano / Nix setups keep working. Protected modes require `rootDir` to exist at factory time (throw otherwise); `'follow'` keeps the historical no-existence-check behavior.
- **Directory listing**: symlinks blocked by the policy render as `( Blocked Symlink )`, non-clickable, and do not expose the target's size.
- **Cross-platform**: case-insensitive boundary comparison on macOS/Windows to avoid spurious 404s.
- **Residual risk**: realpath-based check does not fully prevent TOCTOU (a symlink swapped between check and open). For hostile multi-tenant setups combine with OS-level isolation.
- **Code** (`index.cjs`): `symlinks` validation + pinned `realRootDir` (`fs.realpathSync.native`) at factory init; `symlinkAllowed()` / `_isWithinRoot()` helpers; boundary checks on the served path, the resolved index file, and each listing entry.

### 🐛 Bug Fix — malformed requests return 400 instead of 500 (V-2)
- **Issue**: Client-controlled inputs surfaced as **500 Internal Server Error** instead of **400 Bad Request**:
  - Malformed percent-encoding in the path (`/%`, `/%zz`, a truncated UTF-8 sequence) — `decodeURIComponent()` throws `URIError`.
  - An invalid `Host` header (e.g. `Host: bad host with spaces`) — `new URL()` throws.
- **Impact**: LOW — a 500 on client-controlled input is log noise and a probing surface; the correct response is 400. Inconsistent with the existing null-byte guard, which already returned 400.
- **Fix**: The URL-parsing prologue (`new URL()` for the request URL and the `urlPrefix` reconstruction, plus `decodeURIComponent()`) is wrapped and returns **400 Bad Request** on failure. A shared `sendBadRequest()` helper is introduced and the existing null-byte guard refactored to use it. No logging of malformed requests (avoids log-spam / DoS from client input). Well-formed requests — including valid percent-encoding and valid Host headers — are unaffected.
- **Code** (`index.cjs`): `sendBadRequest()` helper; try/catch around `new URL(fullUrl)`, the `urlPrefix` `new URL()`, and `decodeURIComponent()`.

### 🔒 Hardening — boundary-aware rootDir check (V-3)
- **Issue**: The rootDir containment check used a plain `fullPath.startsWith(normalizedRootDir)` without a trailing separator — the classic prefix pattern that (if the way `fullPath` is built ever changed) could match a sibling directory like `/srv/wwwsecret` for root `/srv/www`. Not exploitable today (`path.join` always inserts a separator and the leading `/` prevents `..` escape), but fragile.
- **Fix**: Both containment checks (the main path check and the `hideExtension` `pathWithExt` check) now use the shared `_isWithinRoot()` helper introduced with the symlinks feature — boundary-aware (`rootDir` exactly or `rootDir` + `path.sep`), with case-insensitive comparison on macOS/Windows. The main check now returns **404** (was 403) so "outside root" is indistinguishable from "not found", matching the symlink-escape and hidden-entry outcomes.
- **Behavior change**: `../` traversal now responds **404** instead of **403**. (Existing tests already accepted either.)
- **Code** (`index.cjs`): `startsWith(normalizedRootDir)` → `_isWithinRoot(..., normalizedRootDir)` at both sites; 403 branch replaced with `sendNotFound()`.

### 🔒 New (opt-in) — static security headers (V-4)
- **Issue**: Security headers (incl. `X-Content-Type-Options: nosniff`) were set only on middleware-generated pages (directory listing, error pages), never on static files served from disk. When serving user-uploaded content, a browser MIME-sniffing a response can interpret it against the declared `Content-Type` — a content-sniffing XSS vector (already documented as `[M-4]`).
- **Fix**: New opt-in `staticSecurityHeaders` option. `staticSecurityHeaders: { nosniff: true }` adds `X-Content-Type-Options: nosniff` to static file responses (200 / 206 / 304). **Default off** — no behavior change on upgrade, consistent with the "hardening is opt-in" design philosophy. Template-rendered output is intentionally unaffected (the operator sets headers in their `render`). Other headers (X-Frame-Options, Referrer-Policy, HSTS) remain the reverse proxy's responsibility (`[M-3]`/`[M-4]`).
- **Code** (`index.cjs`): `staticSecurityHeaders` validation at factory init; `nosniff` set in `loadFile()` after the template early-return so it covers all static branches.

### 📚 Documentation — canonical Security Hardening Guide
- Added **`docs/SECURITY_HARDENING.md`** as the single source of truth for hardening: threat-model profiles (trusted content / internal tool / user-uploads & multi-tenant), per-topic recommendations (dot-files, symlinks, directory listing & size, `nosniff`, `Host`/DNS rebinding, methods, template, logging, deps), per-profile checklists, residual risks, OS-level hardening, and a copy-paste **maximally-hardened configuration**.
- Consolidated to avoid drift: `README.md` and `docs/DOCUMENTATION.md` now link to the guide instead of duplicating the checklist and suggested configuration; `CLAUDE.md` points contributors to the guide as the canonical location for hardening docs.

### 📚 Documentation — hardened DNS-rebinding guidance (V-5, docs-only)
- The middleware still does not validate the `Host` header (deliberate design choice `[M-3]`: Virtual-Host policy belongs to the reverse proxy or an app-level allowlist, not a file server). No code change.
- Strengthened `docs/DOCUMENTATION.md → DNS Rebinding` (Mitigation 2) with a robust example: `normalizeHost()` (case + trailing-dot FQDN), use of the **raw** `ctx.get('host')` instead of `ctx.host`, and an explicit footgun note on trusting a forgeable `X-Forwarded-Host` under `app.proxy`.
- Aligned the `Host` allowlist examples in `README.md` (quick start + Suggested production security configuration) to the robust form.
- **Fixed a docs/code inconsistency on the `dirListing.maxEntries` default (V-6, docs-only)**: the real default is `10000` (`index.cjs`), but the JSDoc block, `CLAUDE.md`, `README.md` and `DOCUMENTATION.md` stated `100000` in places — all aligned to `10000` (no code/behavior change). Also corrected the `CLAUDE.md` rationale: `maxEntries` bounds the work *after* `readdir()` (stat/sort/render), **not** the `readdir()` allocation itself — the unbounded initial `readdir()` on adversarial directories remains the `[F-1]` gap tracked for v3.1. A lower `maxEntries` is the more defensive choice against listing-driven CPU/IO amplification.

### 🧪 Testing
- Added `__tests__/symlinks-policy.test.js` (19 tests): factory validation (invalid value, missing `rootDir` in protected vs `follow` mode), all three modes for escaping file/dir symlinks, in-root symlinks, `rootDir`-is-a-symlink in `follow-within-root` and `deny`, escaping index file, and the non-clickable/size-hidden listing rendering.
- Added `__tests__/malformed-request.test.js` (13 tests): malformed percent-encoding, invalid Host, null-byte regression, well-formed requests (valid encoding/Host/404), and behavior under `urlPrefix`.
- Added `__tests__/boundary-check.test.js` (9 tests): traversal → 404, sibling-directory-sharing-the-root-prefix unreachable, root/normal requests unaffected, `hideExtension` boundary.
- Added `__tests__/static-security-headers.test.js` (7 tests): default-off, nosniff on 200/206/304, generated pages unchanged, template output excluded, factory validation.
- Full suite: **604 tests** pass across 25 suites (zero regressions).

### 📦 Package Changes
- **Version**: `3.0.1` → `3.1.0`
- **Semver**: Minor bump — additive, opt-in `symlinks` feature (default unchanged) plus the V-2 bug fix; no breaking change.

## [3.0.1] - 2026-06-10

### 🐛 Bug Fix

#### Fixed `HEAD` on template-engine routes returning 404 (HTTP conformance, RFC 9110 §9.3.2)
- **Issue**: When `HEAD` was enabled (`method: ['GET', 'HEAD']`), a `GET` on a route served by the template engine (e.g. `index.ejs` as the index of `/`) returned **200**, but a `HEAD` on the same route returned **404**. The static-file branch already handled `HEAD` correctly, and directory listings worked incidentally, so only the template branch was affected.
- **Root cause**: `loadFile()` calls `tryRenderTemplate()` before the static-serving branch and returns as soon as it reports the request was handled. `tryRenderTemplate()` invoked the operator's `render` callback with the real `ctx.method` and did nothing `HEAD`-specific. A render that does not itself set a body on non-`GET` requests (a common pattern — operators guard render work behind a `GET` check) therefore left `ctx.status` at Koa's default **404** for `HEAD`, even though `GET` rendered normally.
- **Impact**: MEDIUM — breaks caches, reverse proxies, link-checkers, and uptime monitors that issue `HEAD`. `HEAD` must be identical to `GET` minus the body (same status code and headers).
- **Fix**: In `tryRenderTemplate()`, a `HEAD` request now runs the render exactly as a `GET` (the method is presented as `GET` for the duration of the render, then restored) so it resolves, validates, and sets `Content-Type` / status identically. The new `stripBodyForHead()` helper then replaces the rendered body with an empty buffer and restores `Content-Length` to the byte length the `GET` body would have had — sending the correct status and headers with no body. The `GET` path and all public options are unchanged; compatible with Koa 2 and Koa 3.
- **Code**:
  - `tryRenderTemplate()` — present `ctx.method` as `GET` for the render, restore to `HEAD` and call `stripBodyForHead()` in `finally`
  - `stripBodyForHead()` — new helper: empty body + restored `Content-Length`, preserving the status and headers the render produced

### 🧪 Testing
- Added `__tests__/head-method.test.js` (9 tests) covering, with both a method-aware and a method-agnostic render:
  - `HEAD` on a directory whose index is a template → **200**, status/`Content-Type`/`Content-Length` match `GET`, empty body
  - `HEAD` on a directly-requested template file → **200**, matches `GET`
  - `HEAD` on a static file → **200**, matches `GET` (and still advertises `Accept-Ranges`)
  - `HEAD` on a listable directory (no index) → **200**, matches `GET`
  - `HEAD` on a non-existent template/static path → **404**, matches `GET`
- All 556 tests pass across 21 test suites (zero regressions)

### 📦 Package Changes
- **Version**: `3.0.0` → `3.0.1`
- **Semver**: Patch version bump (bug fix only, no API changes)

## [3.0.0] - 2026-05-13

### 🆕 New Features

#### `hidden` option — protect dot-files, dot-dirs and custom patterns (Fase 1 + Fase 2)

A new `hidden` option controls which files and directories are blocked from both directory listing and direct HTTP access (returning **404**). Applies recursively to the entire directory tree.

**Default behavior (secure out of the box):**
- Dot-files (names starting with `.`) → **hidden by default** (`dotFiles.default: 'hidden'`)
- Dot-directories → **visible by default** (`dotDirs.default: 'visible'`)

```js
app.use(koaClassicServer('/public', {
  hidden: {
    dotFiles: {
      default: 'hidden',          // 'hidden' | 'visible'
      whitelist: ['.well-known'], // Always visible (string exact/glob or RegExp)
      blacklist: [],              // Always hidden — overrides whitelist
    },
    dotDirs: {
      default: 'visible',
      whitelist: [],
      blacklist: ['.git', /^\.svn/],
    },
    alwaysHide: ['*.secret', 'config/secrets/**', /\.key$/], // Path-aware patterns
  }
}));
```

**Priority (highest to lowest):**
1. `blacklist` — always hidden, beats everything
2. `whitelist` — always visible, overrides `alwaysHide` and `default`
3. `alwaysHide` — path-aware patterns, beats `default`
4. `default` — fallback behavior for unmatched dot-entries

**`alwaysHide` pattern rules:**
- String without `/`: matches basename at any depth (e.g. `*.secret` hides `a/b/file.secret`)
- String with `/`: path-anchored from root (e.g. `config/secrets/**`)
- RegExp: tested against the full relative path

**Blocked dot-dirs block sub-paths too:**
`GET /.git/config` returns 404 if `.git` is in `dotDirs.blacklist`.

#### `template.renderTimeout` — bounded template execution (Security M-1)

The template `render` callback now runs under a configurable timeout (default **30 000 ms**, `0` = disabled). When a render exceeds the timeout the middleware responds **`504 Gateway Timeout`** with the usual security headers, instead of leaving the client connection blocked on a slow/hung render. Protects against DoS via connection exhaustion when a render performs unbounded I/O (DB queries, remote fetches, etc.).

The `render` function now receives an **`AbortSignal` as 5th argument**. The signal aborts on timeout *and* when the client disconnects (even when `renderTimeout: 0`). Cooperative renders that propagate the signal to `fetch` / DB clients / `fs.promises.*` also free backend resources on timeout.

```js
app.use(koaClassicServer('/public', {
  template: {
    ext: ['ejs'],
    renderTimeout: 5000,                                  // ms; 0 disables
    render: async (ctx, next, filePath, rawBuffer, signal) => {
      const data = await db.query('SELECT ...', { signal }); // honour signal
      const ext  = await fetch('https://api/...', { signal });
      signal.throwIfAborted();
      ctx.type = 'text/html';
      ctx.body = ejs.render(rawBuffer.toString(), { data, ext });
    }
  }
}));
```

**Backward compatible:** existing 4-argument render functions keep working — the 5th argument is simply ignored.

#### `serverCache.*.maxAge` — time-based cache invalidation (Security M-2)

Both server-side caches (`serverCache.rawFile` and `serverCache.compressedFile`) accept a new `maxAge` option (ms, default `0` = disabled). When `> 0`, an entry is considered stale after `maxAge` ms regardless of `mtime + size`, forcing a fresh disk read on the next request.

Designed for **NFS / SMB / Docker bind mounts** where the OS attribute cache can keep `stat()` returning a stale `mtime` for several seconds after a remote modification — making the mtime+size invariant insufficient to detect changes. `maxAge` bounds the worst-case staleness window to a known value.

```js
app.use(koaClassicServer('/public', {
  serverCache: {
    rawFile:        { enabled: true, maxAge: 30000 }, // refresh every 30 s
    compressedFile: { enabled: true, maxAge: 30000 }
  }
}));
```

> **Limitation:** `maxAge` limits but does not eliminate NFS staleness. For strict freshness combine with a low `actimeo=` on the mount.

Internally a new `LFUCache.refresh(key, fields)` method updates the entry in place while preserving its LFU frequency, so popular files refreshed by `maxAge` don't fall to the bottom of the eviction bucket.

#### `logger` option — pluggable structured logging (Security N-1)

All internal `console.error` / `console.warn` calls now route through an injectable logger. Pass any object that exposes `error(...)` and `warn(...)` methods — `console` (default), `pino`, `winston`, `bunyan`, or a custom adapter — to integrate with aggregated logging pipelines in production.

```js
const pino = require('pino')();

app.use(koaClassicServer('/public', {
  logger: pino
}));
```

**Contract:**
- Must be an object with `typeof logger.error === 'function'` and `typeof logger.warn === 'function'`
- Invalid loggers (missing methods, non-objects, `null`, `false`, arrays) throw at factory time
- Extra methods (`info`, `debug`, `fatal`, ...) are ignored — pass any superset freely

**ANSI escape codes** in warning messages are only emitted when the logger is the global `console` (detected by reference). Structured loggers receive the plain text, keeping log aggregators clean.

**Backward compatible:** when `logger` is omitted, the default is `console` — existing code and tests that spy on `console.error` / `console.warn` continue to work unchanged.

#### `dirListing` namespace — bounded and paginated directory listings (Security N-2)

A new namespaced option groups all directory-listing config together, replacing the v2-era flat `showDirContents` knob with a structured object. Hardens the listing against indirect DoS via very large directories and improves usability on big folders.

```js
app.use(koaClassicServer('/public', {
  dirListing: {
    enabled:        true,    // render listing HTML when no index file matches (default: true)
    maxEntries:     10000,   // hard cap on visible / sorted / stat'd entries (default; 0 = disabled)
    entriesPerPage: 100,     // entries per page in the listing UI (default; 0 = disabled)
  }
}));
```

**dirListing.enabled**
- Replaces the v2 top-level `showDirContents`. Accepts `true` / `false`. When `false`, requests for a directory without a matching index file return 404 instead of an HTML listing.

**dirListing.maxEntries**
- Caps how many entries are sorted, stat'd, and rendered per directory listing. Excess entries trigger a yellow banner at the top of the page and an `X-Dir-Truncated: <N>` response header so monitoring can distinguish capped listings.
- Implementation: the middleware calls `fs.promises.readdir()` once and then slices the result. This bounds rendering and CPU cost but **not** the size of the initial `readdir()` allocation. For typical static-file servers (where the directory contents are controlled by the operator) this is the right trade-off — it recovers v2-class listing performance.
- Default `10000` is permissive enough for normal use while bounding rendering cost on accidentally-large folders.
- **Caveat for adversarial workloads:** if you serve a directory writable by untrusted parties, an attacker creating millions of files could still force a large `readdir()` allocation. Tracked for v3.1 as opt-in streaming reads — see `docs/security_improvement_for_V3.md` → *Future Work* → *[F-1]*.

**dirListing.entriesPerPage**
- Pagination kicks in only when the visible entries exceed `entriesPerPage`; small directories render in a single page exactly like before.
- The current page is selected by `?page=N` (0-based). Invalid or out-of-range values clamp silently to the nearest valid page.
- A numbered paginator (`« First | ‹ Prev | 0 1 … N-1 | Next › | Last »`) is rendered below the table, preserving any active `sort`/`order`. An `X-Dir-Pagination: <current>/<last>` header is also emitted.

**Migration from v2**

`showDirContents` (a v2-stable option) keeps working as a **backward-compatibility alias** for `dirListing.enabled`. v2 code that passes it continues to function unchanged. A one-time deprecation warning is emitted via the configured `logger.warn(...)` to encourage migration:

```
[koa-classic-server] DEPRECATION: options.showDirContents was renamed to dirListing.enabled in v3.0.0.
  The old name is currently accepted as an alias and may be removed in a future major version.
  Replace with: dirListing: { enabled: true }
```

Passing both `showDirContents` and `dirListing.enabled` at the same time throws — pick one.

**Migration from v3.0.0-alpha.0**

The two V3-alpha-only legacy names throw helpful errors at startup (no v2 user can have these in production):

```
options.maxDirEntries was relocated in v3.0.0.
  Replace with: dirListing: { maxEntries: 10000 }

options.pageSize was relocated and renamed in v3.0.0.
  Replace with: dirListing: { entriesPerPage: 100 }
```

**CSP impact:** the listing CSS now includes rules for `.kcs-banner` and `.kcs-pagination`. The page's CSP hash is auto-recomputed at module load (no manual config change needed).

### 📝 Documentation

#### DNS Rebinding deployment guidance (Security M-3)

The `Host` header is intentionally not validated by the middleware — host validation belongs to the reverse proxy or to a dedicated application-level guard. The new *Best Practices → Sicurezza → DNS Rebinding* section in `docs/DOCUMENTATION.md` explains:

- When the risk applies (LAN/loopback exposure without a fronting proxy).
- When it doesn't (reverse proxy with `server_name` allowlist, public IP behind CDN/WAF).
- A drop-in nginx allowlist snippet.
- A Koa middleware that checks `ctx.host` against an allowlist and returns `421 Misdirected Request`, plus a note on `app.proxy = true` + `X-Forwarded-Host` when terminating TLS upstream.

No code change in `index.cjs` — documentation only.

#### Security headers scope and limits (Security M-4)

Clarify that the security headers emitted by the middleware (`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) are applied **only** to middleware-generated responses (directory listing + error pages). User-served static files are returned without these headers — by design, because the right policy is application-specific.

The new *Best Practices → Sicurezza → Limiti dei Security Headers sui file statici* section in `docs/DOCUMENTATION.md` covers:

- A table listing which headers are emitted automatically and on which responses.
- An upstream Koa middleware example that adds `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security` to every response and a strict CSP only to HTML responses.
- Notes on rolling out CSP via `Content-Security-Policy-Report-Only`, and on `COOP`/`COEP` for projects using `SharedArrayBuffer`.

No code change in `index.cjs` — documentation only.

### 🎯 Design Philosophy

v3.0.0 codifies the project's design intent in a new top-level `CLAUDE.md`: **koa-classic-server is an HTTP file server first**. The contract with the operator is: *"if a file is in `rootDir`, `GET` on its path returns it"*. Defaults serve files without applying surprise restrictions — the operator's directory is the source of truth.

This drove a revision of two v3-alpha defaults late in the cycle (see *Breaking Changes* below) and shapes how new features will be designed going forward. Operators harden via explicit configuration; the README and `docs/DOCUMENTATION.md` now ship a **Security Checklist** and a **Suggested Production Security Configuration** to help with that.

### ⚠️ Breaking Changes

#### Dot-files visible by default (philosophy alignment)

Earlier in the v3.0.0 alpha cycle, `hidden.dotFiles.default` was flipped to `'hidden'` as a security-by-default choice. This created surprise behavior — `GET /.env` returning 404 even when the file exists — which violates the "file server first" design philosophy.

**Final v3.0.0 behavior:** `hidden.dotFiles.default` is `'visible'`, restoring v2 behavior. The implicit-default warning that fired in alpha when the option was omitted is also removed.

| Default | v2 | v3.0.0-alpha early | **v3.0.0 final** |
|---|---|---|---|
| `hidden.dotFiles.default` | `'visible'` | `'hidden'` | **`'visible'`** |
| Implicit-default runtime warning | — | emitted | **removed** |

**Operators upgrading from v2:** no change in behavior — your existing dot-files keep being served. **Migration to harden** (recommended for production): set `hidden.dotFiles.default: 'hidden'` explicitly and whitelist `.well-known` for ACME. See the *Security Checklist* in `README.md`.

#### `dirListing.maxEntries` default raised from 10,000 → 100,000

The earlier v3-alpha default of `10,000` was tight enough that operators with normal-sized media catalogs, releases archives, or asset directories would hit truncation silently (the listing banner would appear). This violated the "no surprise restrictions" rule — the cap was acting as a policy restriction rather than a safety net.

**Final v3.0.0 behavior:** `dirListing.maxEntries` defaults to `100,000` — high enough that 99% of legitimate deployments never hit it, low enough to bound rendering cost on accidentally-huge directories (log rotation broken, mistakenly mounted FS).

| Default | v3.0.0-alpha early | **v3.0.0 final** |
|---|---|---|
| `dirListing.maxEntries` | `10000` | **`100000`** |
| `dirListing.entriesPerPage` | `100` | `100` (unchanged) |

**Caveat:** even with `maxEntries: 100000`, the initial `fs.promises.readdir()` allocation is not bounded. For adversarial-directory workloads (multi-tenant uploads, untrusted writes), this gap will be closed by the v3.1 `dirListing.readMode: 'bounded'` option — tracked under `[F-1]` in `docs/security_improvement_for_V3.md`.

#### Dot-files hardening is now opt-in (was implicit "secure by default")

Operators who *want* the v3-alpha behavior (dot-files hidden by default, including `.env`, `.git/config`, etc.) must now opt in explicitly:

```javascript
app.use(koaClassicServer('/public', {
  hidden: {
    dotFiles: { default: 'hidden', whitelist: ['.well-known'] },
    dotDirs:  { default: 'hidden', whitelist: ['.well-known'] },
  },
}));
```

This snippet now appears in the *Suggested Production Security Configuration* in both `README.md` and `docs/DOCUMENTATION.md`.

#### Removed string format for `index` option
- **Removed**: `index: 'index.html'` — passing a non-empty string now throws an `Error` at startup
- **Empty string** `index: ''` is still silently treated as `[]` (no index file, show directory listing)
- **Migration**:
  ```js
  // Before (v2.x — now throws)
  app.use(koaClassicServer('/public', { index: 'index.html' }));

  // After (v3.0.0)
  app.use(koaClassicServer('/public', { index: ['index.html'] }));
  ```

#### Removed deprecated option names `cacheMaxAge` and `enableCaching`
- **Removed**: `cacheMaxAge` — use `browserCacheMaxAge` instead
- **Removed**: `enableCaching` — use `browserCacheEnabled` instead
- **Behaviour**: Passing either removed option now throws an `Error` at startup with a clear migration message pointing to the new name and the current value.
- **Migration**:
  ```js
  // Before (v2.x — now throws)
  app.use(koaClassicServer('/public', {
    enableCaching: true,
    cacheMaxAge: 3600
  }));

  // After (v3.0.0)
  app.use(koaClassicServer('/public', {
    browserCacheEnabled: true,
    browserCacheMaxAge: 3600
  }));
  ```

#### Renamed `compression.minSize` → `compression.minFileSize`

The threshold below which files are served uncompressed has a clearer name. Brings naming into line with `serverCache.rawFile.maxFileSize`, where "file size" is the explicit unit. Affects only alpha-tester code (the `compression` namespace was introduced in v3 and is not present in v2).

- **Removed**: `compression.minSize` — passing it now throws an `Error` at startup
- **Migration**:
  ```js
  // Before (v3.0.0-alpha.0 — now throws)
  app.use(koaClassicServer('/public', {
    compression: { minSize: 2048 }
  }));

  // After (v3.0.0)
  app.use(koaClassicServer('/public', {
    compression: { minFileSize: 2048 }
  }));
  ```

The `false` shorthand (disable the threshold entirely) is preserved on the new name: `compression: { minFileSize: false }`.

---

## [2.6.1] - 2026-03-04

### 🐛 Bug Fix

#### Fixed DT_UNKNOWN Handling (type 0) on overlayfs, NFS, FUSE, NixOS buildFHSEnv, ecryptfs
- **Issue**: On filesystems where `readdir({ withFileTypes: true })` returns dirents with `DT_UNKNOWN` (type 0), all `dirent.is*()` methods return `false`. This caused three failures:
  1. `isFileOrSymlinkToFile()` missed valid files — `findIndexFile()` returned empty results, so `GET /` showed a directory listing instead of rendering the index file
  2. `isDirOrSymlinkToDir()` missed valid directories — directory type resolution failed
  3. `show_dir()` skipped entries with type 0, logging `"Unknown file type: 0"` — directory listings appeared empty or partial
- **Affected environments**: overlayfs (Docker image layers), NFS (some implementations), FUSE filesystems (sshfs, s3fs, rclone mount), NixOS with buildFHSEnv, ecryptfs (encrypted home directories), and any filesystem that doesn't fill `d_type` in the kernel's `getdents64` syscall
- **Impact**: HIGH — Server unusable on affected filesystems (index file not served, directory listing empty)
- **Fix**: Added `fs.promises.stat()` fallback in all three locations when none of the `dirent.is*()` type methods return `true` (i.e., type is genuinely unknown). On standard filesystems (ext4, btrfs, xfs, APFS, NTFS), `d_type` is always filled correctly, so the `stat()` fallback is never reached — **zero performance overhead** on the fast path.
- **Code**:
  - `isFileOrSymlinkToFile()` — DT_UNKNOWN fallback via `stat().isFile()`
  - `isDirOrSymlinkToDir()` — DT_UNKNOWN fallback via `stat().isDirectory()`
  - `show_dir()` — Accept type 0 entries and resolve via `stat()` instead of skipping them
- **Reference**: Linux `man 2 getdents` — *"Currently, only some filesystems have full support for returning the file type in d_type. All applications must properly handle a return of DT_UNKNOWN."*

### 🧪 Testing
- Added `__tests__/dt-unknown.test.js` with 20 tests covering:
  - `isFileOrSymlinkToFile` / `isDirOrSymlinkToDir` with DT_UNKNOWN dirents
  - `findIndexFile` with all-unknown-type entries (string and RegExp patterns)
  - `show_dir` rendering (resolved types, no skipped entries, correct MIME types and sizes)
  - Full integration tests (index file serving, direct file access, complete directory listing)
  - Edge cases (mixed regular + DT_UNKNOWN dirents, index priority, Dirent type 0 verification)
- Tests use `jest.spyOn(fs.promises, 'readdir')` to mock DT_UNKNOWN dirents via `new fs.Dirent(name, 0)` while keeping `fs.promises.stat()` working normally
- All 329 tests pass across 12 test suites (zero regressions)

### 📦 Package Changes
- **Version**: `2.6.0` → `2.6.1`
- **Semver**: Patch version bump (bug fix only, no API changes)

---

## [2.6.0] - 2026-03-01

### 📦 Dependency Upgrades

#### mime-types: ^2.1.35 → ^3.0.2 (Major)
- **Breaking change upstream**: New `mimeScore` algorithm for extension conflict resolution
- **Impact on this project**: Minimal — the 11 changed MIME mappings affect only uncommon extensions
- **Notable mapping changes**:
  - `.wav`: `audio/wave` → `audio/wav` (equivalent, all browsers accept both)
  - `.js`: `application/javascript` → `text/javascript` (correct per RFC 9239)
  - `.rtf`: `text/rtf` → `application/rtf` (marginal, rare usage)
  - `.mp4`: Unchanged in v3.0.2 — still resolves to `video/mp4`
- **Node.js requirement**: mime-types 3 requires Node.js >= 18

#### ejs: ^3.1.10 → ^4.0.0 (Major)
- **Breaking changes upstream**: None affecting this project
  - EJS 4 removed deprecated `with()` statement support (this project never used it)
  - EJS 4 added stricter `exports` map in package.json
- **API fully compatible**: `ejs.render()` and `ejs.renderFile()` work identically
- **Security**: EJS 3.x is EOL — v4 resolves known CVEs in the 3.x line

### 🔧 Configuration Changes

#### Added `engines` field
- Added `"engines": { "node": ">=18" }` to package.json
- Formalizes the Node.js minimum version requirement imposed by mime-types 3

#### Tightened Koa peerDependency for 2.x
- **koa**: `"^2.0.0 || >=3.1.2"` → `"^2.16.4 || >=3.1.2"`
- Excludes Koa 2.0.0–2.16.3 which are affected by 4 known CVEs:
  - CVE-2025-25200: ReDoS via `X-Forwarded-Proto`/`X-Forwarded-Host` (CVSS 9.2, fixed in 2.15.4)
  - CVE-2025-32379: XSS via `ctx.redirect()` (fixed in 2.16.1)
  - CVE-2025-62595: Open Redirect via trailing `//` (fixed in 2.16.3)
  - CVE-2026-27959: Host Header Injection via `ctx.hostname` (CVSS 7.5, fixed in 2.16.4)

### 🧪 Testing
- All 309 tests pass across 11 test suites (zero regressions)
- No code changes required — both library upgrades are API-compatible

### 📦 Package Changes
- **Version**: `2.5.2` → `2.6.0`
- **Semver**: Minor version bump (dependency upgrades, no API changes)

---

## [2.5.2] - 2026-03-01

### 🔒 Security Fix

#### Resolved all 11 npm audit vulnerabilities
- **jest**: `^29.7.0` → `^30.2.0` (major — fixes minimatch ReDoS, brace-expansion ReDoS, @babel/helpers inefficient RegExp)
- **supertest**: `^7.0.0` → `^7.2.2` (fixes critical form-data unsafe random boundary)
- **inquirer**: `^12.4.1` → `^13.3.0` (fixes tmp arbitrary file write via symlink, external-editor chain)
- **autocannon**: `^7.15.0` → `^8.0.0` (major)

#### Updated peerDependency
- **koa**: `"^2.0.0 || ^3.0.0"` → `"^2.0.0 || >=3.1.2"`
- Excludes Koa 3.0.0–3.1.1 which had Host Header Injection via `ctx.hostname`

### 🧪 Testing
- All 309 tests pass across 11 test suites (zero regressions)
- `npm audit` reports 0 vulnerabilities

### 📦 Package Changes
- **Version**: `2.5.1` → `2.5.2`
- **Semver**: Patch version bump (security fixes only, no API changes)

---

## [2.5.1] - 2026-03-01

### 📝 Documentation

- Added dedicated usage example for `useOriginalUrl` (Section 7) with realistic i18n middleware scenario (/it/, /en/, /fr/)
- Added "Advanced hideExtension Scenarios" section (Section 8):
  - Recommended file/directory structure (ASCII tree)
  - Combined `hideExtension` + i18n middleware example with `useOriginalUrl: false`
  - Temporary redirect (302) variant with guidance on 301 vs 302 usage
- Added `hideExtension` and `useOriginalUrl` to the Complete Production Example (Section 11)

### 📦 Package Changes
- **Version**: `2.5.0` → `2.5.1`
- **Semver**: Patch version bump (documentation only, no code changes)

---

## [2.5.0] - 2026-02-28

### ✨ New Feature

#### hideExtension - Clean URLs (mod_rewrite-like)
- **New Option**: `hideExtension: { ext: '.ejs', redirect: 301 }`
- **Purpose**: Hide file extensions from URLs for SEO-friendly clean URLs
- **Clean URL Resolution**: `/about` → serves `about.ejs` (when file exists)
- **Extension Redirect**: `/about.ejs` → 301 redirect to `/about` (preserves query string)
- **Index File Redirect**: `/index.ejs` → redirect to `/`, `/section/index.ejs` → redirect to `/section/`
- **Conflict Resolution**: `.ejs` file wins over both directories and extensionless files with same base name
- **Case-Sensitive**: Extension matching is case-sensitive (`.ejs` ≠ `.EJS`)
- **No Interference**: URLs with other extensions (`.css`, `.png`, etc.) pass through normally
- **Trailing Slash**: `/about/` always means directory, never resolves to file
- **Redirect uses `ctx.originalUrl`**: Preserves URL prefixes from upstream middleware (i18n, routing)

#### Input Validation
- `hideExtension: true` → throws Error (must be an object)
- `hideExtension: {}` → throws Error (missing `ext`)
- `hideExtension: { ext: '' }` → throws Error (empty ext)
- `hideExtension: { ext: 'ejs' }` → warning + auto-normalizes to `.ejs`
- `hideExtension: { ext: '.ejs', redirect: 'abc' }` → throws Error (redirect must be number)

#### Integration with Existing Options
- **urlsReserved**: Checked before `hideExtension`, no interference
- **urlPrefix**: `hideExtension` works on path after prefix removal
- **useOriginalUrl**: Resolution follows setting; redirect always uses `ctx.originalUrl`
- **template**: Resolved files pass through template engine normally
- **method**: `hideExtension` only applies to allowed HTTP methods

### 🧪 Testing
- Added `__tests__/hideExtension.test.js` with 31 tests covering:
  - Clean URL resolution (single and multi-level paths)
  - Extension redirect (301/302, query string preservation)
  - Directory/file conflict resolution
  - Trailing slash behavior
  - Extensionless file conflict
  - Index file redirect (`/index.ejs` → `/`)
  - `urlsReserved` interaction
  - `useOriginalUrl` interaction (redirect preserves prefix)
  - Case-sensitive matching
  - No interference with other extensions
  - Template engine integration
  - Input validation (7 validation tests)
- All 278 existing tests still pass (zero regressions)

### 📦 Package Changes
- **Version**: `2.4.0` → `2.5.0`
- **Semver**: Minor version bump (new feature, backward compatible)

---

## [2.4.0] - 2026-02-28

### 🐛 Bug Fix

#### Fixed Symlink Support in Index File Discovery and Directory Listing
- **Issue**: On systems where served files are symbolic links (NixOS buildFHSEnv, Docker bind mounts, `npm link`, Capistrano-style deploys), `findIndexFile()` failed because `dirent.isFile()` returns `false` for symlinks. This caused `GET /` to show directory listing instead of rendering the index file, and `GET /index.ejs` to return 404.
- **Impact**: HIGH - Server unusable on NixOS/buildFHSEnv and similar environments
- **Fix**: Added `isFileOrSymlinkToFile()` / `isDirOrSymlinkToDir()` helpers that follow symlinks via `fs.promises.stat()` only when `dirent.isSymbolicLink()` is true, adding zero overhead for regular files.
- **Code**: `index.cjs` - new helpers + `findIndexFile()` + `show_dir()`

### ✨ Improvements

#### Directory Listing Symlink Indicators
- Symlinks to files/directories show `( Symlink )` label next to the name
- Broken/circular symlinks show `( Broken Symlink )` label (name visible but not clickable)
- Symlinks resolved to effective type for MIME and size display (e.g. symlink to dir shows `DIR`)
- Sorting uses effective type (symlink-to-dir sorts with directories)

### 🧪 Testing
- Added `__tests__/symlink.test.js` with 17 tests covering:
  - Regular file as index (regression)
  - Symlink to file as index (string and RegExp patterns)
  - Direct GET to symlinked file
  - EJS template via symlink
  - Symlink to directory (listing and file access)
  - Broken and circular symlinks
  - Directory listing indicators (`( Symlink )`, `( Broken Symlink )`)
  - Regular file regression (no false symlink indicator)
- All 187 existing tests still pass (zero regressions)

### 📦 Package Changes
- **Semver**: Minor version bump (new feature, backward compatible)

---

## [2.3.0] - 2026-01-03

### 🔄 Renamed Options (with Backward Compatibility)

#### Renamed Caching Options for Clarity
- **Old Names** (DEPRECATED): `enableCaching`, `cacheMaxAge`
- **New Names**: `browserCacheEnabled`, `browserCacheMaxAge`
- **Reason**: Improved clarity - these options specifically control browser-side HTTP caching
- **Backward Compatible**: Old names still work but display deprecation warnings

#### Deprecation Warnings
When using deprecated option names, a warning is displayed on the terminal:
```
[koa-classic-server] DEPRECATION WARNING: The "enableCaching" option is deprecated and will be removed in future versions.
  Current usage: enableCaching: true
  Recommended:   browserCacheEnabled: true
  Please update your configuration to use the new option name.
```

### 📝 Documentation Updates

- Updated README.md with new option names
- Updated JSDoc comments in index.cjs
- Added deprecation notes in Options table
- All examples updated to use new names

### 🔧 Changes

- **index.cjs**: Lines 109-135 - Added backward compatibility logic with deprecation warnings
- **index.cjs**: Lines 47-58 - Updated JSDoc comments
- **index.cjs**: Lines 350, 361 - Updated code to use new option names
- **README.md**: Updated all references to use new names, added deprecation notes
- **package.json**: Version bumped from `2.2.0` to `2.3.0`

### ⚠️ Migration Guide

**No immediate changes required** - old option names still work.

**Recommended migration:**

```javascript
// Old (still works, but deprecated)
app.use(koaClassicServer('/public', {
  enableCaching: true,
  cacheMaxAge: 3600
}));

// New (recommended)
app.use(koaClassicServer('/public', {
  browserCacheEnabled: true,
  browserCacheMaxAge: 3600
}));
```

**Timeline:**
- **v2.3.0**: Old names work with deprecation warnings
- **Future versions**: Old names may be removed (will be announced in advance)

### 📦 Package Changes

- **Version**: `2.2.0` → `2.3.0`
- **Semver**: Minor version bump (new feature names, backward compatible)

---

## [2.2.0] - 2026-01-03

### ✨ Features

#### Added useOriginalUrl Option
- **New Option**: `useOriginalUrl` (Boolean, default: `true`)
- **Purpose**: Controls URL resolution for file serving - use `ctx.originalUrl` (immutable) or `ctx.url` (mutable)
- **Use Case**: Compatibility with URL rewriting middleware (i18n, routing)
- **Backward Compatible**: Default value `true` maintains existing behavior

#### URL Rewriting Middleware Support
- **Problem Solved**: koa-classic-server previously used `ctx.href` (based on `ctx.originalUrl`), which caused 404 errors when middleware rewrites URLs by modifying `ctx.url`
- **Solution**: Set `useOriginalUrl: false` to use the rewritten URL from `ctx.url` instead
- **Example**: i18n middleware that strips language prefixes (`/it/page.html` → `/page.html`)

### 📝 Documentation

- Added comprehensive `useOriginalUrl` documentation in README.md
- Added JSDoc comments in index.cjs
- Included practical i18n middleware example
- Added option to API reference table

### 🔧 Changes

- **index.cjs**: Line 108 - Added `useOriginalUrl` option initialization
- **index.cjs**: Lines 117-125 - Modified URL construction logic to support both `ctx.originalUrl` and `ctx.url`
- **README.md**: Added detailed section explaining `useOriginalUrl` with examples
- **package.json**: Version bumped from `2.1.4` to `2.2.0`

### 💡 Usage Example

```javascript
// i18n middleware example
app.use(async (ctx, next) => {
  if (ctx.path.match(/^\/it\//)) {
    ctx.url = ctx.path.replace(/^\/it/, ''); // /it/page.html → /page.html
  }
  await next();
});

app.use(koaClassicServer('/www', {
  useOriginalUrl: false // Use rewritten URL
}));
```

### ⚠️ Migration Notes

**No breaking changes** - this is a backward-compatible release.

- **Default behavior unchanged**: `useOriginalUrl` defaults to `true`
- **No code changes required** for existing implementations
- **New feature**: Set `useOriginalUrl: false` if you use URL rewriting middleware

### 📦 Package Changes

- **Version**: `2.1.4` → `2.2.0`
- **Semver**: Minor version bump (new feature, backward compatible)

---

## [2.1.3] - 2025-11-25

### 🔧 Configuration Changes

#### Changed Default Caching Behavior
- **Change**: `enableCaching` default value changed from `true` to `false`
- **Rationale**: Better development experience - changes are immediately visible without cache invalidation
- **Production Impact**: **Users should explicitly set `enableCaching: true` in production environments**
- **Benefits in Production**:
  - 80-95% bandwidth reduction
  - Faster page loads with 304 Not Modified responses
  - Reduced server load
- **Code**: `index.cjs:107`

### 📝 Documentation Improvements

#### Enhanced Caching Documentation
- Added comprehensive production recommendations in README.md
- Added inline code comments explaining the default behavior
- Clear guidance on when to enable caching (development vs production)
- **Files**: `README.md`, `index.cjs`

### ⚠️ Migration Notice

**IMPORTANT**: If you are upgrading from 2.1.2 or earlier and rely on HTTP caching:

```javascript
// You must now explicitly enable caching in production
app.use(koaClassicServer(__dirname + '/public', {
  enableCaching: true  // ← Add this for production environments
}));
```

**Development**: No changes needed - the new default (`false`) is better for development.

**Production**: Explicitly set `enableCaching: true` to maintain previous behavior and performance benefits.

### 📦 Package Changes

- **Version**: `2.1.2` → `2.1.3`

---

## [2.1.2] - 2025-11-24

### 🎨 Features

#### Sortable Directory Columns
- Apache2-like directory listing with clickable column headers
- Sort by Name, Type, or Size (ascending/descending)
- Fixed navigation bug after sorting

#### File Size Display
- Human-readable file sizes (B, KB, MB, GB, TB)
- Proper formatting and precision

#### HTTP Caching
- ETag and Last-Modified headers
- 304 Not Modified responses
- 80-95% bandwidth reduction

### 🧪 Testing
- 153 tests passing
- Comprehensive test coverage

---

## [2.1.1] - 2025-11-23

### 🚀 Production Release

- Async/await implementation
- Non-blocking I/O
- Performance optimizations
- Flow documentation

---

## [1.2.0] - 2025-11-17

### 🎉 SECURITY & BUG FIX RELEASE

This release contains **critical security fixes** and important bug fixes. All users should upgrade immediately.

### 🔒 Security Fixes (CRITICAL)

#### Fixed Path Traversal Vulnerability
- **Issue**: Attackers could access files outside the served directory using `../` sequences
- **Impact**: CRITICAL - Unauthorized file access
- **Fix**: Added path normalization and validation to ensure all file access stays within `rootDir`
- **Code**: `index.cjs:106-124`

#### Fixed Template Rendering Crash
- **Issue**: Unhandled errors in template rendering could crash the entire server
- **Impact**: CRITICAL - Denial of Service
- **Fix**: Added try-catch around template render calls with proper error handling
- **Code**: `index.cjs:195-205`

### ✅ Bug Fixes

#### Fixed HTTP Status Code 404
- **Issue**: Missing files returned HTML "Not Found" with HTTP 200 status instead of 404
- **Impact**: HIGH - Violates HTTP standards, affects SEO, breaks caching
- **Fix**: Properly set `ctx.status = 404` when resources are not found
- **Locations**:
  - `index.cjs:130` - File/directory not found
  - `index.cjs:158` - Directory listing disabled

#### Fixed Race Condition in File Access
- **Issue**: Files could be deleted between existence check and reading, causing uncaught errors
- **Impact**: HIGH - Server crashes on file access errors
- **Fix**: Added `fs.promises.access()` check before streaming files with error handling
- **Code**: `index.cjs:208-216`

#### Fixed File Extension Extraction
- **Issue**: Using `split(".")` failed for:
  - Files without extension (`README`)
  - Hidden files (`.gitignore`)
  - Paths with dots (`/folder.backup/file`)
- **Impact**: HIGH - Template rendering activated incorrectly
- **Fix**: Use `path.extname()` for robust extension extraction
- **Code**: `index.cjs:192`

#### Fixed Directory Read Errors
- **Issue**: `fs.readdirSync()` could throw unhandled errors (permissions, deleted directories)
- **Impact**: MEDIUM - Server crashes on directory access errors
- **Fix**: Added try-catch with user-friendly error message
- **Code**: `index.cjs:245-264`

#### Fixed Content-Disposition Header
- **Issue**: Filename in Content-Disposition header was not quoted and included full path
- **Impact**: MEDIUM - Download issues with special characters in filenames
- **Fix**:
  - Use only basename (not full path)
  - Quote filename and escape quotes
- **Code**: `index.cjs:234-239`

### 🎨 Improvements

#### Added Input Validation
- Validate `rootDir` is a non-empty string
- Validate `rootDir` is an absolute path
- Throw meaningful errors for invalid input

#### Added XSS Protection
- HTML-escape all user-controlled content in directory listings
- Escapes filenames, paths, and MIME types
- Prevents XSS attacks through malicious filenames

#### Improved Error Messages
- More descriptive error messages
- Console logging for debugging
- Stream error handling

#### Code Quality
- Fixed usage of `Array()` constructor to literal syntax `[]`
- Better code organization and comments
- Improved HTML output formatting

### 📝 Added Files

- **`__tests__/security.test.js`**: Comprehensive security and bug tests
- **`DEBUG_REPORT.md`**: Detailed analysis of all bugs and fixes
- **`DOCUMENTATION.md`**: Complete documentation (1500+ lines)
- **`CHANGELOG.md`**: This file

### 🧪 Testing

- All 71 tests passing
- Added security test suite
- Path traversal tests
- Template error handling tests
- Status code validation tests
- Race condition tests
- Content-Disposition tests

### 📦 Package Changes

- **Version**: `1.1.0` → `1.2.0`
- **Description**: Enhanced with security fixes
- **Keywords**: Added `secure`, `middleware`, `file-server`, `directory-listing`
- **Scripts**: Added `test:security` command

### ⚠️ Breaking Changes

**None** - This is a backwards-compatible release. However, behavior changes for security:

1. **404 Status Codes**: Now properly returns 404 instead of 200 for missing resources
2. **Path Traversal**: Requests with `../` now return 403 Forbidden instead of allowing access
3. **Error Handling**: Template errors return 500 instead of crashing the server

These changes fix bugs and security issues. The new behavior is correct and standards-compliant.

### 🔄 Migration Guide

No code changes required! Simply update:

```bash
npm update koa-classic-server
```

**Recommended**: Verify that:
1. `rootDir` is an absolute path (e.g., `__dirname + '/public'`)
2. Your error handling expects proper 404/403/500 status codes
3. Your tests pass with the new behavior

### 📊 Statistics

- **Lines of code fixed**: ~200
- **Security vulnerabilities fixed**: 2 critical
- **Bugs fixed**: 6
- **Tests added**: 12 security tests
- **Documentation added**: 2000+ lines
- **Test coverage**: 71 tests passing

### 🙏 Credits

- **Author**: Italo Paesano
- **Security Audit**: Comprehensive code analysis
- **Testing**: Jest & Supertest

---

## [1.1.0] - Previous Release

### Features
- Basic static file serving
- Directory listing
- Template engine support
- URL prefixes
- Reserved URLs

### Known Issues (Fixed in 1.2.0)
- Path traversal vulnerability ⚠️ CRITICAL
- Missing 404 status codes
- Unhandled template errors ⚠️ CRITICAL
- Race condition in file access
- Fragile file extension extraction
- Missing error handling

---

## Links

- [Full Documentation](./DOCUMENTATION.md)
- [Debug Report](./DEBUG_REPORT.md)
- [Repository](https://github.com/italopaesano/koa-classic-server)
- [npm Package](https://www.npmjs.com/package/koa-classic-server)

---

**⚠️ Security Notice**: Version 1.2.0 fixes critical vulnerabilities. Update immediately if using 1.1.0 or earlier.
