# Performance Tuning Guide — sizing for RAM and CPU

> How to adapt koa-classic-server to the resources of the machine it runs on:
> what each knob costs in **RAM** and **CPU**, what it buys in **latency** and
> **bandwidth**, and copy-paste profiles for common host shapes.

The defaults target a *balanced* host (a few hundred MB of RAM available to the
process, a reasonably modern CPU) and follow the project's safety-net philosophy:
they bound the failure modes of the process, not the served content. On a smaller
or a bigger machine, the same knobs move in opposite directions — this guide
tells you which ones, and by how much.

All measurements quoted here come from the project's own benchmarks
(`docs/performance_v3_vs_v4.md`, `docs/BENCHMARKS.md`; Node 22, loopback,
20 MB real-text fixture with ≈ 3:1 brotli ratio). Treat absolute numbers as
orders of magnitude; the *ratios* are the reliable part.

For exact option semantics see [DOCUMENTATION.md](./DOCUMENTATION.md); for the
abuse/DoS angle of the same knobs see
[SECURITY_HARDENING.md §3.10](./SECURITY_HARDENING.md).

---

## 1. The map: which option spends which resource

| Option | Spends | Buys |
|---|---|---|
| `serverCache.compressedFile.maxSize` (default **100 MB**, ON) | RAM (bounded) | compress once, then RAM-speed hits with `Content-Length` |
| `serverCache.compressedFile.maxEntrySize` (default `maxSize / 4`) | — (admission bound) | keeps one huge output from evicting the working set |
| `serverCache.rawFile.*` (default **OFF**, 50 MB) | RAM (bounded) | skips disk reads for small hot files (identity path, template sources) |
| `compression.enabled` / `encodings` (default ON, `['br','gzip']`) | CPU per cold file | −60…80 % bandwidth on text |
| `compression.maxFileSize` (default **10 MB**) | — (routing bound) | picks buffered-max-quality vs streamed-bounded-RAM per file |
| `compression.buffered.{brotliQuality: 11, gzipLevel: 9}` | CPU **once per file** | best ratio on everything that gets cached |
| `compression.streaming.{brotliQuality: 4, gzipLevel: 6}` | CPU **per request** (until the output is cached) | bounded-RAM compression of large files |
| `compression.minFileSize` (default 1 KB) | — | skips pointless compression of tiny files |
| `browserCacheEnabled` (default OFF) | nothing | 304s: zero body bytes, zero compression on revalidation |
| `dirListing.entriesPerPage` / `maxEntries` (100 / 10 000) | CPU per listing | bounded sort/render on huge directories |

Two facts worth internalizing before touching anything:

1. **The compressed cache is the center of the design.** With it ON (default),
   compression CPU is a *cold-start* cost: every file is compressed once per
   version, then served from RAM. With it OFF, **all** compression drops to the
   streaming path and its per-request quality — you trade RAM for CPU on every
   single compressible response.
2. **`compression.maxFileSize` does not decide *whether* a file is compressed**,
   only *how*: at/below the cap the file is buffered whole and compressed at
   maximum quality; above it, it is streamed with bounded RAM at light quality,
   and since v4.1 the streamed output is still teed into the compressed cache
   when it fits — so from the second request even a 20 MB file is a RAM hit
   (measured: 15.5 ms vs 364 ms).

---

## 2. Where the RAM goes

Steady-state, worst case, with defaults:

| Consumer | Bound | Default worst case |
|---|---|---|
| Compressed-response cache | `serverCache.compressedFile.maxSize` | 100 MB |
| In-flight tee accumulations (large-file outputs being added to the cache) | aggregate ≤ `compressedFile.maxSize`, per entry ≤ `maxEntrySize` | +100 MB transient |
| Raw-file cache | `serverCache.rawFile.maxSize` (OFF by default) | 0 (50 MB if enabled) |
| Buffered compression in flight | file + output, ≤ `compression.maxFileSize` per distinct file; single-flight per file | ~10–20 MB per distinct cold file |
| Streaming compression in flight | encoder state per concurrent stream (brotli window pinned at 512 KB) | **~3.5 MB per concurrent stream** (measured: 100 concurrent cold streams of a 20 MB file ≈ 344 MB peak RSS) |
| Directory listing render | `dirListing.maxEntries` bounds stat/sort/HTML *after* `readdir()` (the `readdir()` allocation itself is the known `[F-1]` gap) | small |

Practical readings:

- **The knob that matters on a small host is `serverCache.compressedFile.maxSize`.**
  It is the only large *steady* allocation that is ON by default. 100 MB is sized
  for "a typical site fits in RAM"; on a 512 MB VPS sharing the box with Node
  itself, drop it to 16–32 MB — you keep the compress-once behavior for the hot
  working set and let cold files be recompressed (LFU keeps the frequent ones).
- **Concurrency is the hidden multiplier.** Caches are hard-bounded; concurrent
  *cold* streams are bounded per stream but multiply with traffic. If you expect
  N concurrent cold downloads of large compressible files, budget ~3.5 MB × N —
  or cap concurrency at the reverse proxy (see §3.10 of the hardening guide).
- `maxAge` on both caches costs nothing and frees nothing: entries are already
  invalidated by mtime+size. It exists for network filesystems (NFS/SMB), not
  for RAM control.

---

## 3. Where the CPU goes

| Work | Quality | Paid | Measured cost |
|---|---|---|---|
| Buffered compression (file ≤ `maxFileSize`, cache ON) | brotli **Q11** / gzip 9 | **once per file version** | ~ms for typical web assets; ~50 s for a 20 MB text file (why the 10 MB cap exists) |
| Streaming compression (file > `maxFileSize`, or cache OFF) | brotli **Q4** / gzip 6 | **per request** until the output lands in the cache; *every* request if the cache is OFF | ~0.6 s CPU / ~0.5 s latency per 20 MB request |
| Cache hit (either origin) | — | — | RAM-speed (2 500+ req/s on small files, 15.5 ms on a 20 MB entry) |
| Conditional revalidation (`browserCacheEnabled: true`) | — | — | a 304 costs no body, no compression |
| Directory listing | — | per request | O(entries) stat+sort+render, bounded by `maxEntries` |

Practical readings:

- **Cold-start CPU** is dominated by `buffered.brotliQuality: 11`. On a weak CPU
  that shows up as slow *first* requests after deploy/restart (single-flight
  already ensures each file is compressed exactly once, even under thundering
  herd — 100 concurrent cold requests to one 100 KB file: 0.3 s CPU total).
  Lowering `buffered.brotliQuality` to 9–10 cuts that cost several-fold for a
  small ratio loss; the cache makes the quality choice *permanent* per file, so
  Q11 is worth keeping wherever cold starts are rare.
- **Per-request CPU** exists only on the streaming path. Its default (Q4) is
  deliberately light; the project measured Q4 output ≈ +19 % bytes vs Q11 on
  real text. Raise `streaming.brotliQuality` only if large files are downloaded
  rarely AND bandwidth is precious; lower it to 1–2 (or prefer
  `encodings: ['gzip']`) on very weak CPUs.
- **brotli vs gzip**: brotli compresses text noticeably better but costs more
  CPU at every quality level. `encodings: ['gzip']` is a legitimate weak-CPU
  choice; order expresses server preference, and `[]` disables negotiation
  entirely (same effect as `compression: false`).

---

## 4. The knobs, one by one

### `compression` — off, or gzip-only

```js
compression: false                    // serve everything identity — zero compression CPU/RAM
compression: { encodings: ['gzip'] }  // cheapest real compression; drop brotli entirely
```

Turn it off when a CDN/reverse proxy already compresses for you (§5.5), when
content is overwhelmingly non-compressible (images, video, archives — those
types are skipped automatically anyway), or on CPU-starved hosts where even the
buffered one-time cost hurts.

### `compression.minFileSize` (default 1024)

Below ~1 KB compression saves nothing and costs headers + CPU. Raise to 2–4 KB
on busy small-file workloads; not worth tuning below that.

### `compression.maxFileSize` (default 10 MB) — the buffered ↔ streaming boundary

- **Lower it** (e.g. `2 * 1024 * 1024`) on RAM-tight hosts: less transient RAM
  per cold file and less Q11 CPU per cold file; files above it still compress,
  stream with bounded RAM, and still end up cached when they fit.
- **Raise it / set `false`** on big dedicated boxes serving large text files
  (logs, CSV, JSON dumps) where you want maximum ratio and `Content-Length`
  *from the first response*: the whole file is then buffered and compressed at
  Q11. Know the price — Q11 on 20 MB is ~50 s of CPU, paid once per file
  version, and the input is held in RAM while it runs. With the default cache
  in play, the *second* request is a RAM hit either way, so `false` mostly buys
  a better ratio (−19 % bytes) and `Content-Length` on the very first download.
  Not recommended when untrusted parties can drop large text files in `rootDir`.

### `compression.buffered` (default `{ brotliQuality: 11, gzipLevel: 9 }`)

The cold-start CPU knob. Lower `brotliQuality` to 9–10 on CPU-constrained hosts
to make first requests after a restart cheaper; the output (slightly bigger) is
what gets cached, so this trades steady-state bandwidth for cold-start CPU.

### `compression.streaming` (default `{ brotliQuality: 4, gzipLevel: 6 }`)

The per-request CPU knob, in play above `maxFileSize` and *everywhere* when the
compressed cache is disabled. Lower toward 1 on weak CPUs; raise only when
repeat traffic is rare and bandwidth matters more than CPU. (The streaming
brotli window is pinned at 512 KB internally — that is the per-stream RAM bound
and is deliberately not configurable.)

### `serverCache.compressedFile` (default ON, 100 MB)

The main RAM ↔ CPU trade of the whole middleware.

```js
serverCache: {
  compressedFile: {
    enabled: true,
    maxSize: 32 * 1024 * 1024,   // size to your host: hot compressed working set
    // maxEntrySize: default maxSize/4 — usually right. Lower it if a few big
    // files keep churning the cache; `false` lets one entry fill the cache.
  },
},
```

- **`maxSize`** should approximate the *compressed* size of your hot working
  set. Watch the throttled `maxSize reached` warnings (`warnInterval`): if they
  fire steadily in production, the cache is undersized and you are paying
  recompressions; silence with more RAM, not with `warnInterval: false`.
- **`enabled: false`** makes every compressible response stateless: zero cache
  RAM, but every request pays streaming-quality compression CPU. Only sensible
  when a front cache absorbs repeats, or RAM is scarcer than CPU by a wide
  margin.

### `serverCache.rawFile` (default OFF, 50 MB, files ≤ 1 MB)

Caches *uncompressed* file bytes to skip disk I/O. The compressed cache already
covers compressible hot files end-to-end, so `rawFile` earns its RAM mainly
when:

- clients don't negotiate compression, or content is non-compressible but small
  and hot (icons, thumbnails, small images);
- files below `compression.minFileSize` are requested at high rates;
- template files are rendered often (the cached buffer is handed to your
  `render` as `rawBuffer`, saving a disk read per render);
- the disk is slow (network FS, cold object storage mounts).

On an OS with a healthy page cache the win over `fs` reads is modest; enable it
when profiling shows disk reads in the hot path, and size `maxSize`/
`maxFileSize` to the actual small-file working set.

### `browserCacheEnabled` (default OFF) + `browserCacheMaxAge`

The cheapest optimization in the whole list: no server RAM, no server CPU —
revalidations become 304s and fresh hits don't even reach the server. Turn it
ON in any production deployment; pick `browserCacheMaxAge` by how quickly
content must propagate (86400 for assets is a common choice).

### `dirListing.entriesPerPage` (100) / `maxEntries` (10 000)

Listings stat, sort, and render every visible entry of the requested page's
directory. On huge directories served to real users, pagination keeps the HTML
small; `maxEntries` is the safety net that bounds the work when a directory is
accidentally enormous. If listings are pure debug surface, `enabled: false`
removes the cost entirely.

---

## 5. Ready-made profiles

Pick the closest shape, then adjust `compressedFile.maxSize` to your real
working set. Steady-state middleware RAM ceiling ≈ `compressedFile.maxSize`
(+ `rawFile.maxSize` if enabled); add the transient costs of §2 under load.

### 5.1 Micro host — ≤ 512 MB RAM, 1 weak vCPU (small VPS, Raspberry Pi)

Everything bounded tight; gzip only (brotli CPU is the first thing to hurt):

```js
app.use(koaClassicServer(root, {
  browserCacheEnabled: true,
  browserCacheMaxAge:  86400,
  compression: {
    encodings:   ['gzip'],           // brotli off: biggest CPU saving
    maxFileSize: 2 * 1024 * 1024,    // small buffered window
    buffered:    { gzipLevel: 6 },   // cheap cold starts
    streaming:   { gzipLevel: 4 },
  },
  serverCache: {
    compressedFile: { maxSize: 16 * 1024 * 1024 },  // 16 MB hot set
  },
}));
```

### 5.2 Low RAM, decent CPU — keep the server lean, let the CPU work

```js
app.use(koaClassicServer(root, {
  browserCacheEnabled: true,
  compression: {
    maxFileSize: 2 * 1024 * 1024,    // large files never buffered
  },
  serverCache: {
    compressedFile: { maxSize: 8 * 1024 * 1024 },
    // or, to spend (almost) no cache RAM at all and recompress every time:
    // compressedFile: { enabled: false },
  },
}));
```

With `enabled: false` remember §1: *all* compression becomes per-request at
streaming quality — fine when a CDN absorbs the repeats.

### 5.3 Weak CPU, plenty of RAM — cache everything, compress gently

```js
app.use(koaClassicServer(root, {
  browserCacheEnabled: true,
  compression: {
    buffered:  { brotliQuality: 9, gzipLevel: 6 },  // cold starts several× cheaper
    streaming: { brotliQuality: 2, gzipLevel: 4 },  // per-request path near-free
  },
  serverCache: {
    compressedFile: { maxSize: 256 * 1024 * 1024 }, // let the hot set live in RAM
    rawFile: { enabled: true, maxSize: 64 * 1024 * 1024 },
  },
}));
```

### 5.4 Big dedicated box, large compressible files (logs, datasets)

Maximum ratio and `Content-Length` from the first byte; you accept the one-time
Q11 cost per file:

```js
app.use(koaClassicServer(root, {
  browserCacheEnabled: true,
  compression: {
    maxFileSize: 100 * 1024 * 1024,  // or false — see §4 for the cost of Q11 on big inputs
  },
  serverCache: {
    compressedFile: {
      maxSize:      512 * 1024 * 1024,
      maxEntrySize: 64 * 1024 * 1024, // several big entries can coexist
    },
    rawFile: { enabled: true },
  },
}));
```

Only for trusted `rootDir` content — with untrusted writers, a planted multi-GB
text file would buy Q11 CPU at will (hardening guide §3.10).

### 5.5 Behind a CDN or compressing reverse proxy

Let the edge do the negotiation and the caching; keep the origin stateless and
cheap:

```js
app.use(koaClassicServer(root, {
  browserCacheEnabled: true,          // the CDN honors/propagates the validators
  browserCacheMaxAge:  31536000,      // long — bust via file names/paths
  compression: false,                 // the edge compresses; origin serves identity
  serverCache: {
    compressedFile: { enabled: false },  // nothing to cache without compression
  },
}));
```

If the CDN only caches but does *not* compress, keep compression ON and this
profile collapses into 5.2/5.3.

### 5.6 Development

The defaults *are* the dev profile: `browserCacheEnabled: false` (no stale
files while editing), listings ON, compression ON with its caches — nothing to
tune.

---

## 6. Measuring on your host

Numbers in this guide came from another machine — verify yours:

```bash
npm run benchmark        # built-in benchmark suite
npm run benchmark:save   # save a baseline for before/after comparisons
npm run test:performance # jest performance assertions
```

or externally, against your real deployment:

```bash
npx autocannon -c 32 -d 10 -H 'Accept-Encoding: br, gzip' http://localhost:3000/your/hot/file
```

While load runs, watch:

- **RSS** (`ps -o rss= -p <pid>` or `process.memoryUsage()`): steady growth up
  to the configured cache caps is expected; growth beyond §2's ceiling is not.
- **The middleware's own warnings** through your `logger`: the throttled
  `maxSize reached` messages are the built-in "cache undersized" signal, and
  the `maxEntrySize` skip warning tells you a file is too big to ever be cached
  with the current caps.
- **First-request vs second-request latency** on your biggest compressible
  file: the gap is the compression cost your cold path pays; the profiles above
  are different ways of choosing who pays it, and when.

---

## 7. Related documents

- [DOCUMENTATION.md](./DOCUMENTATION.md) — exact semantics and validation rules of every option
- [SECURITY_HARDENING.md](./SECURITY_HARDENING.md) — the same knobs from the abuse/DoS angle (§3.10)
- [performance_v3_vs_v4.md](./performance_v3_vs_v4.md) — methodology and raw numbers behind the measurements quoted here
- [BENCHMARKS.md](./BENCHMARKS.md) — benchmark harness reference
