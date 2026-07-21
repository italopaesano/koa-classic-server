# CLAUDE.md

Guidance for AI coding assistants working on **koa-classic-server**.

---

## Project orientation

koa-classic-server is a Koa middleware that serves static files from disk over HTTP, with classic directory listings, optional template-engine integration, and server-side compressed cache. It is a *classic* file server — its primary job is to take an HTTP request and respond with the file at the requested path, or with a directory listing if a directory is requested without an index file.

The declared positioning (since the earliest versions): behavior **similar, but not identical, to Apache 2**. Apache parity is NOT a goal — never justify a change purely with "Apache does it"; divergence from Apache is acceptable whenever it serves the project. A feature borrowed from Apache must stand on its own merits.

The project is **not** a framework, not a router, not a CMS. It is intentionally focused.

Current version: **5.0.0** (see `docs/CHANGELOG.md`). Peer-depends on `koa` (`>=3.1.2` — Koa 2 support was dropped in 5.0.0); the only runtime dependency is `mime-types`. Requires Node `>=20`.

---

## Codebase structure

The entire middleware lives in **one file**: `index.cjs` (~3200 lines). This is deliberate — a single-file, zero-heavy-dependency module is easy to audit and vendor. Do not split it into modules without a strong structural reason.

Layout of `index.cjs`:

- **Module-level constants & helpers (top ~760 lines)** — pure, testable functions declared before the factory: `normalizeExtSuffix`, `escapeHtml`, `toWellFormedName` (lone-surrogate totality), `listingDisplayName` (bidi-control scrubbing), `buildContentDisposition`, `formatSize`, `getDirentType`, `parseRangeHeader`, `ifNoneMatchSatisfied`, the `LFUCache` class, `singleFlight`, `refreshOrInsert`, and the error-page/CSP builders. The directory-listing CSS (`LISTING_CSS`) and its CSP hash (`_listingCssHash`) are also computed here at load time.
- **The factory `module.exports = function koaClassicServer(rootDir, opts)` (from ~line 766)** — the single public entry point. Its second parameter carries a large inline `opts STRUCTURE` comment block (starts ~line 769) that is the **canonical documentation of every option and its default**. Validation/throw-guards run at the top; the returned `async (ctx, next) => {}` is the Koa middleware.
- **`module.exports._internals` (bottom, ~line 3205)** — a curated export of pure helpers (`LFUCache`, `parseRangeHeader`, `formatSize`, `toWellFormedName`, `writeErrorPage`, …) exposed **only for unit tests** that cannot be driven through HTTP fixtures (e.g. lone-surrogate filenames that POSIX can't create). Not part of the public API.

Other source files:

- **`index.mjs`** — a two-line ESM re-export wrapper (`import koaClassicServer from './index.cjs'`). Keeps the package usable from both `require` and `import` via the `exports` map in `package.json`.

Directories:

- **`__tests__/`** — 61 `*.test.js` files, ~1450 test cases. Also holds benchmark scripts (`benchmark.js`, `setup-benchmark.js`), saved benchmark baselines (`benchmark-results-*.txt`), and fixture dirs (`compression-fixtures/`, `hidden-fixtures/`, `range-fixtures/`, `server-cache-fixtures/`, `publicWwwTest/`, `customTest/`).
- **`docs/`** — all long-form documentation (see **Key references** below). Includes `template-engine/` with the template-engine integration guide and examples.
- **`.github/`** — CI workflows.

---

## Design philosophy: HTTP file server first

The middleware's primary contract with the operator is:

> **"If a file exists in the served directory, `GET` on its path returns it. If a directory is requested without an index file, the listing shows every visible entry."**

This contract drives every default. The defaults are picked so that:

- Asking for any file under `rootDir` returns it (no silent 404 unless the file truly does not exist).
- Asking for a directory without an index file returns the listing of that directory.
- The listing includes every visible entry.
- No request is silently restricted by some default policy the operator did not ask for.

In short: **the operator's directory is the source of truth. The middleware does not second-guess it.**

### What this implies for defaults

- **Dot-files are visible by default.** Files named `.env`, `.htaccess`, `.well-known/...` are served if requested. If the operator does not want this, they hide them via the `hidden.dotFiles` namespace.
- **No artificial small-entry limit on directory listings.** If a directory has 5,000 files, the listing shows 5,000 entries. The middleware does NOT decide that "5,000 is too many".
- **No forced pagination on tiny directories.** Pagination kicks in only when the listing exceeds `dirListing.entriesPerPage`. The default is high enough that most directories render in a single page.

### What counts as a "safety net" (acceptable)

Some defaults are NOT restrictions on the served content — they are guards against catastrophic failure modes of the **process itself**:

| Default | Protects against |
|---|---|
| `template.renderTimeout: 30000` | Hung template render blocking the event loop indefinitely |
| `serverCache.compressedFile.maxSize: 100 MB` | RAM growing unbounded in the compressed-response cache |
| `compression.maxFileSize: 10 MB` | Unbounded RAM/CPU on the buffered compression path (whole file in RAM + brotli Q11 for a multi-GB text file). Above the cap, files are still compressed via the bounded-RAM streaming mode, whose output is teed into the compressed cache when it fits in `serverCache.compressedFile.maxEntrySize` (default ¼ of that cache's `maxSize`) so repeat requests are RAM hits |
| `dirListing.maxEntries: 10000` | Unbounded `stat()` / sort / render CPU and oversized HTML when listing an accidentally-huge directory (broken log rotation, mistakenly mounted FS). Bounds work *after* `readdir()`, not the `readdir()` allocation itself — the latter is the `[F-1]` gap tracked for v3.1 |

These are deliberate exceptions because they protect the process from itself, not the served content. The distinction:

- A **safety net** prevents the server from crashing.
- A **restriction** prevents the operator's intent from being respected.

### What restrictions look like (and would NOT be acceptable as defaults)

- Hiding files by name pattern (`.env`, `.git`, `secret*`) without the operator opting in.
- Refusing to serve files larger than N bytes by default.
- Auto-disabling listings on "too many" entries.
- Forcing small-default pagination on the listing UI.

When proposing a new feature, ask: *"does this change the default observable behavior of `GET /path/to/file` or `GET /some/dir/`?"* If yes, it is a restriction — make it opt-in.

> Note: `method: ['GET']` IS technically restrictive (rejects HEAD, POST, etc. by default). It is kept as-is because it has been the v2 default since forever and the migration cost is not worth the philosophical purity. Documented as a known imperfection.

> Note: `dirListing.trailingSlash: true` (V4 default) DOES change the default observable behavior of `GET /dir` (now `301 → /dir/`) and `GET /file/` (now `404`). This is a deliberate exception to "make default-changing features opt-in", defended as a **correctness fix, not a restriction**: without the redirect, an index page served at `/dir` resolves its relative links against the parent, so the page is broken. It shipped in a **major** (4.0.0) with an escape hatch (`trailingSlash: false`). The justification stands on its own merit — that Apache/nginx/Caddy/express all do the same is context, not the reason.

---

## Consequences for future changes

- **New options should default to "transparent / pass-through".** A new feature that changes default observable behavior must be defended in the PR description: why is this a safety net and not a restriction?

- **Security hardening lives in documentation, not in defaults.** When you find a hardening opportunity, the first instinct should be to add it to the canonical *Security Hardening Guide* (`docs/SECURITY_HARDENING.md`), not to change a default. Defaults serve operators; the guide guides them when they need to harden. Keep the guide the single source of truth — `README.md` and `docs/DOCUMENTATION.md` link to it rather than duplicating checklists (this avoids the drift that previously caused, e.g., the `maxEntries` 10000/100000 mismatch).

- **Breaking-change cost is real.** This middleware has v2-era stable options. Renaming or changing default behavior of stable options breaks every operator on upgrade. Justify breaks by **structural necessity**, not by aesthetic preference. Renaming `showDirContents` → `dirListing.enabled` was justified because it was needed to group related listing options under a namespace. Renaming `hideExtension.redirect` → `redirectStatusCode` would be aesthetic only and was therefore declined.

- **Aliases for v2-stable names are acceptable** to soften transitions, with a one-time deprecation warning via `_logger.warn(...)` (see the `showDirContents` alias for the canonical pattern).

- **Throw guards for V3-alpha-only options** are acceptable as hard breaks (no v2 user has them; alpha-testers accept breakage).

---

## Key references

- **`docs/SECURITY_HARDENING.md`** — **canonical** security hardening guide (threat model, per-topic recommendations, per-profile checklists, maximally-hardened config). Single source of truth; README and DOCUMENTATION link here.
- **`README.md`** — user-facing entry point. Built-in Protection overview; links to the hardening guide.
- **`docs/DOCUMENTATION.md`** — full API reference (per-option docs, incl. `symlinks` / `staticSecurityHeaders`); links to the hardening guide for best practices.
- **`docs/CHANGELOG.md`** — version history; breaking changes documented under *⚠️ Breaking Changes*.
- **`docs/security_improvement_for_V3.md`** — audit roadmap for v3 security improvements (implemented + Future Work under `[F-1]`).
- **`docs/revisione_codice_v5.0.md`** — **active** open-findings register from the 2026-07-19 full code review (in Italian). Each finding has a checkbox in its index: tick it (`[x]`) when the item is resolved or consciously closed. Check this file before starting fix work — it holds the agreed problem list, code locations, and proposed fixes.
- **`docs/revisione_codice_v4.3.md`** — previous register (2026-07-14 review); all 16 findings resolved. Kept for history.
- **`docs/revisione_codice_v3.1.md`** — earlier register (2026-07-03 review); all 20 findings resolved. Kept for history.
- **`__tests__/`** — 61 test files, ~1450 test cases asserting behavior contracts. See **Development workflows** below.

---

## Development workflows

All commands run from the repo root; there is no build step (the package ships `index.cjs` / `index.mjs` as-is).

| Command | Purpose |
|---|---|
| `npm test` | Full Jest suite. `pretest` runs `npm run lint` first, so a lint error fails the test run. |
| `npm run test:ci` | Suite minus the performance tests (`--testPathIgnorePatterns=performance`). |
| `npm run test:coverage` | Coverage run; enforces the thresholds in `jest.config.js` (~97% stmts / 94% branch / 99% funcs / 97.5% lines on `index.cjs`). A regression that deletes or bypasses tests fails loudly here. |
| `npm run test:security` | Just `__tests__/security.test.js`. |
| `npm run test:performance` | Performance tests, `--runInBand`. |
| `npm run lint` | ESLint over `index.cjs` and `index.mjs` (flat config in `eslint.config.mjs`). |
| `npm run benchmark` / `benchmark:save` | Autocannon-based throughput benchmark; `:save` writes a baseline. `benchmark:setup` generates fixtures. |

Notes:

- `index.mjs` reports 0% coverage in the aggregate because `__tests__/esm-export.test.js` exercises it in a **child** Node process (Jest's CJS transform can't load real ESM in-process); Istanbul can't see it. This is expected — its ~2 statements are noise.
- Tests are written with `supertest` over a `Koa` app instantiated per `describe` block.
- The `__tests__/*.property.test.js` files are [fast-check](https://fast-check.dev) (dev-only dependency) property-based tests that **complement** the example tests, targeting the pure `_internals` helpers. They are intentionally un-seeded; the how/why and the failure-reproduction recipe live in **`docs/property-based-testing.md`**.
- The typical fix workflow: pick a finding from the active review register, locate it in `index.cjs`, add/adjust a `*.test.js` asserting the contract, implement, run `npm test`, then tick the register checkbox and note the resolution in `docs/CHANGELOG.md`.

---

## Working conventions

- All defaults are documented in the inline `opts STRUCTURE` comment block inside the factory signature in `index.cjs` (starts ~line 769). When you change a default, update that block — it is the canonical option reference the rest of the docs mirror.
- Validation errors throw at factory time with a helpful migration hint. See existing throw guards for `cacheMaxAge`, `enableCaching`, `maxDirEntries`, `pageSize`, `compression.minSize`, `hideExtension.redirect` (must be one of `300, 301, 302, 303, 305, 307, 308` — `_VALID_REDIRECT_CODES`), and the `compression.buffered`/`compression.streaming` quality groups.
- Extension options (`template.ext`, `hideExtension.ext`) share one normalizer, `normalizeExtSuffix`: the leading dot is optional (`'.ejs'` ≡ `'ejs'`, `'.ejs'` preferred), matching is by suffix (compound extensions like `'.html.ejs'` work), and un-nameable entries are dropped with a one-time deprecation warning.
- Tests use `supertest` over a `Koa` app instantiated per `describe` block.
- The CSP hash for the directory-listing inline CSS is computed once at module load (`_listingCssHash`) — editing the listing CSS automatically refreshes the hash. Tests that asserted the hash must compute it from the actual `<style>` block in the response, not hardcode it.
- Once-per-process warnings use a module-level boolean flag (see `_showDirContentsDeprecationWarned` for the canonical pattern). For **config deprecations** that should fire once per distinct message, use `warnConfigDeprecation(logger, msg)`, which dedupes via the module-level `_configDeprecationsWarned` Set. Existing warn-level deprecations are kept as warnings through 5.x; the plan is to promote them to factory-time throws in **6.0.0**.
- Logger calls use `warnPayload(_logger, msg)` so that structured loggers (pino/winston) receive plain text and `console` receives ANSI colors.
- Pure helpers that can't be exercised through HTTP fixtures are exported on `module.exports._internals` for unit tests only (see `__tests__/internals-unit.test.js`). This is a test seam, not public API — don't document it for operators.

---

## When in doubt

Re-read the **Design philosophy** section above. If the change you are about to propose would make `GET /some/file` behave differently than the operator placing that file would expect, you are probably violating the philosophy. Either redesign the change as opt-in, or document the rationale explicitly in the PR.
