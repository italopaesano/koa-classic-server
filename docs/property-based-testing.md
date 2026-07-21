# Property-based tests

The `__tests__/*.property.test.js` files use [fast-check](https://fast-check.dev)
to **complement** — not replace — the example-based tests. Where an example test
pins a handful of hand-picked inputs, a property test states an *invariant* and
lets fast-check generate thousands of inputs trying to break it, shrinking any
failure to a minimal counterexample.

They target the pure helpers exposed on `module.exports._internals` (a test-only
seam, no stability guarantee), which are cheap to drive directly and where the
interesting edge cases (lone surrogates, bidi controls, off-file byte ranges,
long cache-mutation sequences) live.

| File | Helper(s) | Core invariant |
|---|---|---|
| `parseRangeHeader.property.test.js` | `parseRangeHeader` | a returned range always sits inside the file: `0 ≤ start ≤ end ≤ fileSize-1` |
| `buildContentDisposition.property.test.js` | `buildContentDisposition` | totality on hostile filenames; output is always a legal HTTP header value; RFC 5987 value round-trips |
| `lfuCache.property.test.js` | `LFUCache` | capacity, size accounting, buffer integrity and frequency-bucket consistency across random `set/get/peek/delete`; LFU + FIFO eviction order |
| `internals-helpers.property.test.js` | `formatSize`, `ifNoneMatchSatisfied`, `toWellFormedName`, `escapeHtml`, `listingDisplayName` | one block of invariants per helper |

## Running

They are ordinary Jest files picked up by the normal suite — no special command:

```bash
npm test                                    # full suite (lints first)
npx jest __tests__/parseRangeHeader.property.test.js   # one file
npx jest -t "bounds invariant"              # one property by name
```

## Seeding: intentionally random

The tests are **not** pinned to a fixed seed. fast-check picks a fresh
time-based seed on every run, so over many CI runs the suite explores a wider
input space and is more likely to surface a latent edge case than a single
frozen seed would. The trade-off is that a rare-input failure may appear
intermittently — but it is always **reproducible**, because fast-check prints
the exact seed and shrink path on failure (see below).

> If you ever prefer bit-for-bit deterministic runs instead, add a Jest
> `setupFiles` entry that calls `fc.configureGlobal({ seed: <n> })`. We chose not
> to, on purpose — this note is the reason.

## Reproducing a failure

On failure fast-check throws with a message like:

```
Property failed after 175 tests
{ seed: 1045230416, path: "174", endOnFailure: true }
Counterexample: [733]
Shrunk 3 time(s)
```

`Counterexample` is the minimal failing input. To replay it deterministically,
copy the printed `seed` and `path` into that test's `fc.assert` options:

```js
fc.assert(
    fc.property(/* …the same arbitraries… */, (/* … */) => { /* … */ }),
    { seed: 1045230416, path: '174', endOnFailure: true },
);
```

Run just that test while you debug:

```bash
npx jest __tests__/<file>.property.test.js -t "<test name>"
```

To see every failing value fast-check tried (not only the shrunk one), add
`verbose: true` to the same options object. Once fixed, delete the temporary
`{ seed, path }` so the test goes back to exploring fresh inputs.
