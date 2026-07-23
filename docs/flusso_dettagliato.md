# Flusso dettagliato di `koa-classic-server` (diagrammi ASCII)

> Documento di riferimento sul **flusso di esecuzione** del middleware, diviso
> per fasi. Ogni sezione è un diagramma ASCII autonomo con i riferimenti alle
> righe di `index.cjs` (versione **5.0.0**). I nomi di funzioni, variabili e
> opzioni sono lasciati in inglese perché corrispondono uno-a-uno al codice.
>
> **Come leggere i diagrammi**
>
> ```
>   ┌──────────────┐        riquadro = passo / blocco di codice
>   │  passo        │
>   └──────┬───────┘
>          │                 │  ▼  = flusso sequenziale (prosegue in basso)
>          ▼
>      ╱decisione╲           ◇ / ╱╲  = ramo condizionale (if/else, switch)
>      ╲         ╱
>          │
>   ── sì ─┤─ no ──▶         etichette sui rami
>
>   ►► next()                 uscita: passa al middleware successivo di Koa
>   ⇒ 4xx / 5xx               uscita: risposta di errore generata dal middleware
>   ⇒ 2xx / 3xx               uscita: risposta servita (file, listing, redirect, 304…)
> ```

---

## Indice

1. [Fase 0 — Inizializzazione a *load-time* del modulo](#fase-0)
2. [Fase 1 — *Startup* / la factory `koaClassicServer()`](#fase-1)
3. [Fase 2 — Il *loop* event-driven: gestione di una richiesta](#fase-2)
   - 2.1 [Prologo: metodo, URL, prefix, reserved](#fase-2-1)
   - 2.2 [Guardie di sicurezza sul path](#fase-2-2)
   - 2.3 [`hideExtension`: redirect e clean URL](#fase-2-3)
   - 2.4 [`stat` + hidden + symlink sul leaf](#fase-2-4)
   - 2.5 [Dispatch directory vs file](#fase-2-5)
4. [Fase 3 — Sotto-flusso `loadFile()`](#fase-3)
5. [Fase 4 — Sotto-flusso compressione (buffered / streaming / tee)](#fase-4)
6. [Fase 5 — Sotto-flusso `show_dir()` (directory listing)](#fase-5)
7. [Fase 6 — Sotto-flusso `tryRenderTemplate()`](#fase-6)
8. [Strutture dati: `LFUCache` e `singleFlight`](#strutture)
9. [Mappa delle uscite (tabella riassuntiva)](#uscite)

---

<a name="fase-0"></a>
## 1. Fase 0 — Inizializzazione a *load-time* del modulo

Eseguita **una sola volta** quando `require('koa-classic-server')` valuta il
file, prima ancora che la factory venga chiamata. Serve a pre-calcolare tutto
ciò che è costante per l'intera vita del processo, così da avere **zero costo
per-richiesta**.

```
  require('./index.cjs')
        │
        ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │  import: url, fs, path, crypto, zlib, util, mime, stream               │
  │  promisify: _brotliCompressAsync, _gzipAsync                    (11-12) │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │  Costanti pure                                                         │
  │   • _LOG_1024              (formatSize)                          (15)   │
  │   • _VALID_REDIRECT_CODES  {300,301,302,303,305,307,308}        (22)   │
  │   • DEFAULT_COMPRESSIBLE_MIME_TYPES                              (45)   │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │  CSS del listing + hash CSP calcolati UNA volta                        │
  │   • LISTING_CSS                                                  (61)   │
  │   • _listingCssHash = 'sha256-' + sha256(LISTING_CSS)          (135)   │
  │   • LISTING_CSP  (usa l'hash → consente <style> inline)        (138)   │
  │   • NOT_FOUND_CSP (default-src 'none', nessun inline)          (141)   │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │  Pagine d'errore pre-costruite (buildErrorHtml, una per stato)         │
  │   • _NOT_FOUND_HTML (404) · _GATEWAY_TIMEOUT_HTML (504)                │
  │   • _TEMPLATE_ERROR_HTML (500 render) · _INTERNAL_ERROR_HTML (500)     │
  │   • _BUILTIN_ERROR_HTML = { 404, 500, 504 }                   (183)   │
  │   • ERROR_PAGE_SCRUB_HEADERS (header da ripulire su errore)    (194)   │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  ▼
  ┌───────────────────────────────────────────────────────────────────────┐
  │  Funzioni pure dichiarate (hoisting): normalizeExtSuffix, escapeHtml,  │
  │  toWellFormedName, listingDisplayName, buildContentDisposition,        │
  │  formatSize, getDirentType, parseRangeHeader, ifNoneMatchSatisfied,    │
  │  class LFUCache, singleFlight, refreshOrInsert, tryRenderTemplate …    │
  └───────────────────────────────┬───────────────────────────────────────┘
                                  ▼
                   module.exports = koaClassicServer   (771)
                   module.exports._internals = {…}    (3262)  ← solo per i test
```

> Nota: `LISTING_CSS` e `_listingCssHash` sono legati — modificare il CSS
> ricalcola automaticamente l'hash CSP. I test che asseriscono l'hash devono
> leggerlo dal `<style>` reale, mai hard-codarlo.

---

<a name="fase-1"></a>
## 2. Fase 1 — *Startup* / la factory `koaClassicServer(rootDir, opts)`

Eseguita **una volta per istanza di middleware** (di solito una sola volta al
boot dell'app). Valida e normalizza le opzioni, costruisce le cache e le
closure, e restituisce la funzione middleware. **Ogni errore di configurazione
viene lanciato QUI** (fail-fast), non alla prima richiesta.

```
  koaClassicServer(rootDir, opts)                                    (771)
        │
        ▼
  ╱ rootDir stringa non vuota? ╲──no──▶ throw TypeError            (974)
        │ sì
        ▼
  ╱ path.isAbsolute(rootDir)?  ╲──no──▶ throw Error               (977)
        │ sì
        ▼
  normalizedRootDir = path.resolve(rootDir)                        (981)
        │
        ▼
  ╱ opts è un plain object?   ╲──no──▶ throw Error (null/array/…) (987)
        │ sì
        ▼
  const options = { ...opts }   ← copia: normalizza SENZA mutare   (1001)
  const _logger = normalizeLogger(options.logger)                  (1009)
        │
        ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │ VALIDAZIONE / NORMALIZZAZIONE (in ordine — throw al primo errore)    │
  ├─────────────────────────────────────────────────────────────────────┤
  │  1. dirListing  (+ alias v2 `showDirContents` → warn)               │
  │        enabled · maxEntries≥0 · entriesPerPage≥0 · trailingSlash    │
  │  2. index (array) · urlPrefix (warn se malformato) · urlsReserved   │
  │        └▶ _urlPrefixParts = options.urlPrefix.split("/")   (1142)    │
  │  3. template.render (fn) · template.ext (normalizeExtSuffix) ·       │
  │        template.renderTimeout                                        │
  │  4. browserCacheMaxAge · browserCacheEnabled                        │
  │  5. hideExtension.ext (normalizeExtSuffix) ·                        │
  │        hideExtension.redirect ∈ _VALID_REDIRECT_CODES → else throw   │
  │  6. hidden → normalizeHiddenConfig()                      (1329)     │
  │        └▶ costruisce isHiddenEntry(name, relPath, isDir) e i         │
  │           matcher glob/RegExp con cache (_nameGlobRegexCache …)      │
  │  7. symlinks → _symlinkMode ∈ {follow, follow-within-root, deny}     │
  │        └▶ se ≠ 'follow': fs.realpath(rootDir) DEVE esistere (1712)   │
  │  8. staticSecurityHeaders.nosniff                        (1782)     │
  │  9. errorPages → legge e valida i file .html A FACTORY-TIME:         │
  │        mancante/illeggibile ⇒ throw; bufferizzati in RAM  (1794)     │
  │ 10. compression → normalizeCompressionConfig()           (1901)     │
  │        encodings · minFileSize · maxFileSize · mimeTypes(Set) ·      │
  │        buffered{Q11/L9} · streaming{Q4/L6}  (out-of-range→throw)     │
  │ 11. serverCache → normalizeServerCacheConfig()           (1902)     │
  │        rawFile{…} · compressedFile{maxEntrySize=undefined→maxSize/4} │
  └─────────────────────────────────────┬───────────────────────────────┘
                                        ▼
  ┌─────────────────────────────────────────────────────────────────────┐
  │  COSTRUZIONE STATO CONDIVISO (vive per tutta l'istanza)              │
  │   • _rawFileCache        = new LFUCache(rawFile.maxSize,…)   (1906)  │
  │   • _compressedFileCache = new LFUCache(compressedFile.…)    (1915)  │
  │   • _inflightRawReads      : Map  (single-flight read)      (1929)  │
  │   • _inflightCompressions  : Map  (single-flight compress)  (1930)  │
  │   • _inflightStreamTees    : Set  (leader tee streaming)    (1934)  │
  │   • _inflightTeeBytes      : number (budget RAM aggregato)  (1939)  │
  │   • closure: streamCompressedBody, getClientEncoding,               │
  │              compressBuffer, findIndexFile, openBodyStream,          │
  │              symlinkAllowed, getCustomErrorPage, sendErrorPage …     │
  └─────────────────────────────────────┬───────────────────────────────┘
                                        ▼
              return async (ctx, next) => { … }              (2056)
                        ▲
                        └── è la Fase 2 (una chiamata per richiesta HTTP)
```

---

<a name="fase-2"></a>
## 3. Fase 2 — Il *loop* event-driven: gestione di una richiesta

Questa è la funzione restituita dalla factory: Koa la invoca **una volta per
ogni richiesta HTTP** in ingresso. È il cuore "event-driven" del server. Vista
d'insieme (i dettagli dei blocchi sono nelle sotto-sezioni 2.1–2.5):

```
                         RICHIESTA HTTP (ctx, next)                   (2056)
                                   │
        ┌──────────────────────────┴───────────────────────────┐
        │  2.1  PROLOGO (pass-through possibili → ►► next())    │
        │   method · URL parse · urlPrefix · urlsReserved       │
        └──────────────────────────┬───────────────────────────┘
                                   │  (da qui il middleware "possiede" la richiesta)
                                   ▼
        ┌──────────────────────────────────────────────────────┐
        │  try { … }   ← rete di sicurezza: nessun errore       │
        │              inatteso deve raggiungere Koa (2130)     │
        │                                                        │
        │  2.2  GUARDIE PATH: decode · null-byte · within-root  │
        │       · hidden sui segmenti genitori                  │
        │                          │                            │
        │  2.3  hideExtension: redirect .ext → clean / prova    │
        │       ad aggiungere .ext                              │
        │                          │                            │
        │  2.4  stat(toOpen) · hidden sul leaf · symlink        │
        │                          │                            │
        │              ╱ isDirectory()? ╲                       │
        │        ── sì ─┤              ├─ no ──                 │
        │              ▼                ▼                        │
        │  2.5  [dir branch]      [file branch]                 │
        │   trailingSlash 301      trailing-slash 404?          │
        │   index → loadFile        │                           │
        │   show_dir → body         ▼                           │
        │                       loadFile(toOpen, stat)  ──▶ Fase 3
        │                                                        │
        │ } catch (err) → log · headerSent? destroy : ⇒ 500     │
        └────────────────────────────────────────────────────────┘
```

---

<a name="fase-2-1"></a>
### 3.1 Prologo: metodo, URL, prefix, reserved

Tutte le vie di *pass-through* (`►► next()`) sono qui, **prima** che il
middleware assuma la proprietà della richiesta. Nessun `next()` viene chiamato
dopo questo blocco (a parte quello interno al render del template).

```
  ╱ options.method.includes(ctx.method)? ╲──no──▶ ►► next()          (2057)
        │ sì   (default: solo 'GET')
        ▼
  urlToUse = useOriginalUrl ? ctx.originalUrl : ctx.url               (2063)
  _origin  = ctx.protocol + '://' + ctx.host
  fullUrl  = _origin + urlToUse
  _pathEndsWithSlash = originalUrl(senza query).endsWith('/')        (2072)
        │
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ new URL(fullUrl)   (toglie la '/' finale prima del parse)     │
  │   throw (Host header invalido, ecc.) ──▶ ⇒ 400 sendBadRequest │  (2083)
  └──────────────────────────────┬───────────────────────────────┘
        │ ok
        ▼
  ╱ pathname combacia con _urlPrefixParts? ╲──no──▶ ►► next()        (2091)
        │ sì
        ▼
  costruisci pageHrefOutPrefix (rimuove urlPrefix)                   (2098)
        │  new URL(...) throw ──▶ ⇒ 400
        ▼
  ╱ primo segmento ∈ urlsReserved? ╲──sì──▶ ►► next()                (2113)
        │ no
        ▼
     entra nel try { }  (2.2)  ── il middleware ora "possiede" la richiesta
```

---

<a name="fase-2-2"></a>
### 3.2 Guardie di sicurezza sul path

Prima riga di difesa contro path traversal, byte nulli e attraversamento di
directory nascoste. Tutte le uscite "negate" restituiscono **404** (non 403):
"fuori root" è indistinguibile da "non trovato", coerentemente con symlink e
hidden.

```
  pageHrefOutPrefix.pathname === "/"?
        │                    │
       sì │                  │ no
        ▼                    ▼
  requestedPath=""    ┌──────────────────────────────────────────────┐
        │             │ decodeURIComponent(pathname)                 │
        │             │   URIError (%zz, UTF-8 troncato) ──▶ ⇒ 400   │  (2139)
        │             └──────────────────┬───────────────────────────┘
        └───────────────────────────────┤
                                        ▼
  ╱ requestedPath contiene '\0'? ╲──sì──▶ ⇒ 400 sendBadRequest        (2149)
        │ no
        ▼
  normalizedPath = path.normalize(requestedPath)                     (2154)
  fullPath       = path.join(normalizedRootDir, normalizedPath)
        │
        ▼
  ╱ _isWithinRoot(fullPath, root)? ╲──no──▶ ⇒ 404                     (2165)
        │ sì   (copre ../, %2e%2e%2f, backslash su Windows)
        ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ per ogni segmento GENITORE (esclude il leaf):                 │
  │   ╱ isHiddenEntry(seg, relPath, isDir=true)? ╲──sì──▶ ⇒ 404   │  (2173)
  └──────────────────────────────┬───────────────────────────────┘
        │ nessun genitore nascosto
        ▼
  toOpen = fullPath   →  (2.3)
```

---

<a name="fase-2-3"></a>
### 3.3 `hideExtension`: redirect e clean URL

Attivo solo se `options.hideExtension` è configurato. Due comportamenti
speculari (modello "B" della V4): l'URL *con* estensione viene ridiretto alla
forma pulita; l'URL *senza* estensione prova a risolvere il file `+ ext`.

```
  hideExtension attivo?                                              (2188)
        │ sì
        ▼
  ╱ !_pathEndsWithSlash  AND  requestedPath.endsWith(hideExt)? ╲     (2204)
        │ sì                                          │ no
        ▼                                             │
  ┌───────────────────────────────────────────┐       │
  │ REDIRECT verso la forma pulita:           │       │
  │  • new URL(_origin+originalUrl) throw→400  │       │
  │  • decodedPath = decode(pathname)          │       │
  │  • cleanPath = decoded senza hideExt       │       │
  │  • se baseName+ext ∈ index → /dir/  (2236) │       │
  │  • re-encode per-segmento                  │       │
  │  • open-redirect guard: collassa '//' iniz.│  (2255)
  │  • ctx.status = hideRedirect (301 def.)    │       │
  │  • ctx.redirect(cleanPath + query)         │       │
  └───────────────────┬───────────────────────┘       │
                     ▼                                 │
                  ⇒ 3xx redirect                       │
                                                       ▼
                        ╱ nessuna estensione  AND  no trailing slash? ╲  (2270)
                              │ sì                             │ no
                              ▼                                │
                  pathWithExt = fullPath + hideExt             │
                        │                                      │
                  ╱ _isWithinRoot(pathWithExt)? ╲──no──────────┤
                        │ sì                                    │
                        ▼                                       │
                  stat(pathWithExt)                             │
                        │  isFile()? ── sì ──▶ toOpen=pathWithExt
                        │  (altrimenti/errore: prosegui)        │
                        └───────────────┬──────────────────────┘
                                        ▼
                                   (2.4)  stat(toOpen)
```

---

<a name="fase-2-4"></a>
### 3.4 `stat` + hidden + symlink sul *leaf*

Il nodo effettivamente richiesto (file o directory) viene ora `stat`-ato e
sottoposto alle guardie finali prima del dispatch.

```
  ┌────────────────────────────────────────────────┐
  │ stat = await fs.promises.stat(toOpen)           │
  │   throw (non esiste / EACCES) ──▶ ⇒ 404          │  (2289)
  └──────────────────────┬─────────────────────────┘
                        ▼
  ╱ isHiddenEntry(leaf name, relPath, isDir)? ╲──sì──▶ ⇒ 404          (2298)
        │ no
        ▼
  ╱ _symlinkMode ≠ 'follow'  AND  !symlinkAllowed(toOpen)? ╲──sì──▶ ⇒ 404  (2312)
        │ no  (in 'follow', default, lo short-circuit evita ogni await)
        ▼
  ╱ stat.isDirectory()? ╲
     ── sì ──┤       ├── no ──
             ▼         ▼
          (2.5-dir) (2.5-file)
```

`symlinkAllowed()` (definita a factory-time, righe 1747-1780):

```
  symlinkAllowed(resolvedPath)
        │
  ╱ _symlinkMode === 'follow'? ╲──sì──▶ return true  (zero overhead)
        │ no
        ▼
  real = await fs.realpath(resolvedPath)     ← 1 syscall per path servito
        │
  ╱ 'deny':  qualsiasi symlink sotto root risolto? ╲──sì──▶ false
  ╱ 'follow-within-root': real esce da rootDir?    ╲──sì──▶ false
        │ altrimenti
        ▼
     return true
```

---

<a name="fase-2-5"></a>
### 3.5 Dispatch: directory vs file

```
  ┌───────────────────────── isDirectory() === true ─────────────────────────┐
  │                                                                            │
  │  ╱ dirListing.enabled? ╲──no──▶ ⇒ 404                            (2319)   │
  │        │ sì                                                                │
  │        ▼                                                                   │
  │  ╱ trailingSlash  AND  !_pathEndsWithSlash? ╲──sì──▶ ⇒ 301 /dir → /dir/   │
  │        │ no                                          (2325, apre index UI  │
  │        ▼                                             con base corretta)    │
  │  ╱ index configurato? ╲                                                    │
  │        │ sì                                                                │
  │        ▼                                                                   │
  │  indexFile = findIndexFile(toOpen, index)   ← string=stat, RegExp=readdir  │
  │        │                                                          (2352)   │
  │  ╱ trovato  AND  !hidden  AND  symlinkAllowed? ╲──sì──▶ loadFile ──▶ Fase 3│
  │        │ no                                                                │
  │        ▼                                                                   │
  │  listing = await show_dir(toOpen, ctx)   ──▶ Fase 5              (2374)   │
  │        │  (su errore readdir, show_dir scrive già ⇒ 500 e ritorna undef)  │
  │        ▼                                                                   │
  │  se listing ≠ undefined → ctx.body = listing         ⇒ 200 HTML listing   │
  └────────────────────────────────────────────────────────────────────────────┘

  ┌───────────────────────── isDirectory() === false (FILE) ─────────────────┐
  │                                                                            │
  │  ╱ trailingSlash  AND  _pathEndsWithSlash? ╲──sì──▶ ⇒ 404        (2387)   │
  │        │ no   (un file è raggiungibile solo all'URL senza slash)          │
  │        ▼                                                                   │
  │  await loadFile(toOpen, stat)   ──▶ Fase 3                       (2391)   │
  └────────────────────────────────────────────────────────────────────────────┘
```

---

<a name="fase-3"></a>
## 4. Fase 3 — Sotto-flusso `loadFile(toOpen, fileStat)`

È il percorso di servizio di un singolo file: cache raw → template → header →
condizionali (304) → Range (206) → compressione / corpo. `fileStat` è passato
già pronto per evitare una `stat` ridondante.

```
  loadFile(toOpen, fileStat)                                         (2409)
        │  (se manca fileStat → stat; errore ⇒ 404)
        ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ rawFile CACHE (serverCache.rawFile)                          (2421)   │
  │   attiva  AND  size ≤ maxFileSize?                                     │
  │     ├─ hit fresco (mtime+size uguali, non stale-by-age):              │
  │     │     _rawFileCache.get() (freq++), rawBuffer = cached.buffer     │
  │     └─ miss/stale:                                                     │
  │           singleFlight(_inflightRawReads, key) {                     │
  │              buf = readFile(toOpen); refreshOrInsert(cache,…)         │
  │           }  → rawBuffer (o null se readFile fallisce → disco dopo)   │
  └──────────────────────────────┬───────────────────────────────────────┘
                                ▼
  ╱ tryRenderTemplate(...) === true? ╲──sì──▶ RITORNA (Fase 6)      (2460)
        │ no (nessun match ext o nessun render)
        ▼
  baseEtag = "mtimeMs-size"                                          (2465)
  set Accept-Ranges: bytes  ·  [nosniff se opt-in]                  (2468)
  set Cache-Control:                                                 (2479)
     browserCacheEnabled ? "public, max-age=…, must-revalidate"
                         : "no-cache, no-store, …" + Pragma + Expires
        │
        ▼
  ╱ rawBuffer già in RAM? ╲──no──▶ access(toOpen, R_OK)  errore ⇒ 404 (2497)
        │ sì (la readFile riuscita è prova equivalente)
        ▼
  mimeType = mime.lookup(toOpen) || 'application/octet-stream'       (2508)
        │
        ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ RISOLUZIONE COMPRESSIONE                                     (2511)   │
  │   enabled  AND  encodings≠[]  AND  mime compressibile  AND            │
  │   size ≥ minFileSize?                                                  │
  │      → potentiallyCompressible = true                                 │
  │      → encoding = getClientEncoding(Accept-Encoding)  (br|gzip|null)  │
  │   fullEtag = "mtimeMs-size[-br|-gz]"   (specifico per encoding)       │
  │   se potentiallyCompressible → ctx.vary('Accept-Encoding')           │
  └──────────────────────────────┬───────────────────────────────────────┘
                                ▼
  ┌──────────────────── PRECONDIZIONI (solo se browserCacheEnabled) ─────┐
  │  set ETag=fullEtag · Last-Modified                          (2546)   │
  │  If-None-Match presente?                                              │
  │     ├─ soddisfatta (weak compare) ──▶ ⇒ 304                           │
  │     └─ presente ma non soddisfatta → risposta piena (data ignorata)  │
  │  altrimenti If-Modified-Since (secondi troncati) ≥ mtime ──▶ ⇒ 304    │
  └──────────────────────────────┬───────────────────────────────────────┘
                                ▼
  ┌──────────────────── RANGE (Range: bytes=…) ─────────────────────────┐
  │  parseRangeHeader(header, size)                             (2581)   │
  │    'unsatisfiable' ──▶ ⇒ 416 + Content-Range: bytes */size            │
  │    'invalid'       ──▶ fall-through alla 200 piena                    │
  │    { start, end }  AND (no If-Range  OR  If-Range==baseEtag):         │
  │        ⇒ 206  ETag=baseEtag · Content-Range · Content-Length          │
  │        body = rawBuffer.subarray()  |  openBodyStream({start,end})    │
  │        (HEAD → header 206 senza corpo)                                │
  └──────────────────────────────┬───────────────────────────────────────┘
                                ▼
  set Content-Type · Content-Disposition (buildContentDisposition)  (2641)
        │
        ▼
  ╱ encoding impostato? ╲
     ── sì ─┤        ├── no ──
            ▼          ▼
       [Fase 4]   ┌──────────────────────────────────────────────┐
     compressione │ RISPOSTA NON COMPRESSA                        │  (2852)
                  │  rawBuffer? → Content-Length + body=rawBuffer │
                  │  altrimenti → openBodyStream → ctx.body=stream│
                  │  (HEAD → Buffer.alloc(0), Content-Length fixed)│
                  └──────────────────────────────────────────────┘
                                ⇒ 200
```

---

<a name="fase-4"></a>
## 5. Fase 4 — Sotto-flusso compressione

Raggiunto da `loadFile` quando `encoding ∈ {br, gzip}`. Tre modalità a seconda
di `serverCache.compressedFile.enabled` e della dimensione del file rispetto a
`compression.maxFileSize` (la *safety net* del percorso bufferizzato).

```
  encoding ≠ null  →  set Content-Encoding: encoding                (2647)
        │
        ▼
  withinCompressCap = (maxFileSize===false) || size ≤ maxFileSize   (2657)
        │
        ▼
  ╱ serverCache.compressedFile.enabled? ╲
        │                                 └── no ──┐
        │ sì                                       ▼
        ▼                            ┌─────────────────────────────────────┐
  cacheKey = `${toOpen}:${encoding}` │ MODALITÀ STREAMING (cache disattiva)│
  peek(cacheKey) → cached            │  streamCompressedBody():            │
        │                            │   src(disco|rawBuffer)→zlib→pipeline │
        ▼                            │   Content-Length ignoto, nulla in    │
  ╱ hit fresco? ╲──sì──▶ buf=cached  │   cache.  (HEAD → status 200 secco)  │  (2838)
        │ no                          └─────────────────────────────────────┘
        ▼
  ╱ withinCompressCap? ╲
        │            └──────────────── no ───────────────┐
        │ sì                                              ▼
        ▼                              ┌───────────────────────────────────────────┐
  ┌────────────────────────────────┐   │ MODALITÀ TEE (input grande, cache attiva) │  (2675)
  │ MODALITÀ BUFFERED (Q11/L9)     │   │  teeKey = cacheKey:mtime:size             │
  │  single-flight su inflightKey: │   │  ╱ teeKey già in volo? ╲                  │
  │   rawData = rawBuffer||readFile│   │     ├─ sì (FOLLOWER):                     │
  │   compressed = compressBuffer  │   │     │   streamCompressedBody() e basta     │
  │   refreshOrInsert(cache,…)     │   │     └─ no (LEADER):                        │
  │  su errore compress:           │   │         src = rawBuffer|openBodyStream     │
  │   remove Content-Encoding,     │   │         _inflightStreamTees.add(teeKey)    │
  │   ETag→baseEtag, fallback      │   │         pipeline(src, zlib, TEE):          │
  │   identity (buffer|stream)     │   │            accumula OUTPUT finché sotto:    │
  └───────────────┬────────────────┘   │              • maxEntrySize (per-entry)    │
                  │                     │              • _inflightTeeBytes ≤ maxSize │
                  │                     │            over budget → abbandona acc.    │
                  │                     │         on close pulito → refreshOrInsert  │
                  │                     │         (HEAD → status 200, niente tee)    │
                  ▼                     └───────────────────┬───────────────────────┘
  set Content-Length = buf.length                          │
  body = buf   (HEAD → Buffer.alloc(0), CL ripristinato)    │
        │                                                    │
        └──────────────────────┬─────────────────────────────┘
                              ▼
                          ⇒ 200 (Content-Encoding: br|gzip)
```

Selezione dell'encoding — `getClientEncoding(Accept-Encoding)` (righe 1973-1995):

```
  Accept-Encoding assente ──▶ null
        │
        ▼
  parse token;q=…  →  Map(token → q)
        │
        ▼
  per enc in compressionConfig.encodings (ordine di PREFERENZA server):
        q = qValues[enc]  (o qValues['*']  o  "non offerto")
        q > 0 ? ──▶ return enc          ← la preferenza server vince,
                                          i q-value servono solo a ESCLUDERE (q=0)
        │
        ▼
     nessuno accettabile ──▶ null
```

---

<a name="fase-5"></a>
## 6. Fase 5 — Sotto-flusso `show_dir()` (directory listing)

Genera l'HTML del listing quando nessun index file combacia. Il costo è
limitato da `dirListing.maxEntries` (*safety net*) e da `entriesPerPage`
(paginazione).

```
  show_dir(toOpen, ctx)                                              (2887)
        │
        ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ all = readdir(toOpen, { withFileTypes:true })                  │
  │   throw ──▶ ⇒ 500 (sendErrorPage) · return undefined  (2903)   │
  │ maxEntries>0 && all.length>maxEntries?                          │
  │   → dir = all.slice(0,maxEntries); truncated=true               │
  │   → altrimenti dir = all                                        │
  └──────────────────────────────┬─────────────────────────────────┘
                                ▼
  leggi ctx.query.sort / order (prima occorrenza se array)  (2918)
  baseUrl = pathname con esattamente una '/' finale
  helper: buildQueryUrl · getSortUrl · getSortIndicator
        │
        ▼
  ╱ truncated? ╲──sì──▶ banner ⚠ + header X-Dir-Truncated           (2966)
        │
        ▼
  emetti <table><thead> con link di ordinamento (Name/Type/Size)    (2970)
        │
        ▼
  ╱ non è la root logica? ╲──sì──▶ riga ".. Parent Directory"       (2990)
        │
        ▼
  ╱ dir vuota? ╲──sì──▶ riga "empty folder"
        │ no
        ▼
  ┌────────────────────────────────────────────────────────────────┐
  │ STAT IN PARALLELO a batch di BATCH_SIZE=64                (3011) │
  │   per ogni dirent:                                             │
  │     type = getDirentType (1=file 2=dir 3=symlink 0=UNKNOWN)    │
  │     symlink/UNKNOWN → stat per risolvere il tipo effettivo     │
  │        broken symlink → flag · UNKNOWN non-statabile → skip    │
  │     dir → aggiunge '/' all'URI (canonical, niente 301)        │
  │     isHiddenEntry(...) ? → skip                                │
  │     symlink boundary (modi protetti) → flag                   │
  │     costruisce riga: nome (listingDisplayName+<bdi>) · href    │
  │        (path-absolute, encodeURIComponent(toWellFormedName))  │
  │        · tipo · size (formatSize)                             │
  └──────────────────────────────┬─────────────────────────────────┘
                                ▼
  ORDINAMENTO per sortBy/sortOrder (name|type|size)
        │
        ▼
  PAGINAZIONE: se voci > entriesPerPage → slice per ?page=N (clamp)
        │        + controlli paginatore (buildQueryUrl)
        ▼
  setGeneratedPageHeaders(ctx, LISTING_CSP)  ·  <style>LISTING_CSS
        │
        ▼
  return HTML  ──▶ il chiamante fa ctx.body = listing   ⇒ 200
```

---

<a name="fase-6"></a>
## 7. Fase 6 — Sotto-flusso `tryRenderTemplate()`

Invocato all'inizio di `loadFile`. Restituisce `true` se ha *gestito* la
risposta (il chiamante deve fermarsi), `false` se il file non è un template.

```
  tryRenderTemplate(ctx, next, filePath, rawBuffer, templateOpts,…)  (319)
        │
  ╱ ext.length===0  OR  !render? ╲──sì──▶ return false
        │ no
        ▼
  ╱ baseName combacia con un suffisso ext? ╲──no──▶ return false     (327)
        │ sì   (length guard: '.ejs' esatto NON combacia — è un dotfile)
        ▼
  ╱ metodo HEAD? ╲──sì──▶ ctx.method = 'GET' (render come GET)       (336)
        │
        ▼
  controller = new AbortController()
  ctx.req.on('close', () => controller.abort())   ← abort su disconnessione
        │
        ▼
  renderPromise = render(ctx, next, filePath, rawBuffer, signal)     (347)
        │
        ▼
  ╱ renderTimeout > 0? ╲
        │ sì                                    │ no
        ▼                                       ▼
  Promise.race([ renderPromise ,          await renderPromise
     setTimeout(abort + reject) ])              │
        │                                       │
        ├───────────── catch ───────────────────┤
        ▼                                        ▼
   timeout?  ──▶ sendTemplateError ⇒ 504    errore render ──▶ ⇒ 500
        │
        ▼
  finally: clearTimeout · removeListener('close')
           se era HEAD → ctx.method='HEAD'; stripBodyForHead(ctx)    (380)
        │
        ▼
     return true   (il chiamante ritorna: risposta gestita dal render)
```

> `sendTemplateError` (righe 273-286): se gli header sono già stati inviati dal
> render, non può più cambiare status/body → **distrugge il socket**; altrimenti
> serve la pagina d'errore (custom o built-in).

---

<a name="strutture"></a>
## 8. Strutture dati condivise

### 8.1 `LFUCache` (righe 563-709)

Cache LFU con eviction O(1) tramite *frequency buckets*. Usata sia per i buffer
raw (`_rawFileCache`) sia per le risposte compresse (`_compressedFileCache`).

```
  _keyMap:  key → { buffer, mtime, size, insertedAt, freq }
  _freqMap: freq → Set<key>        (bucket per frequenza)
  _minFreq: frequenza minima corrente (per trovare la vittima in O(1))

  get(key) ──▶ _incrementFreq: sposta key dal bucket freq → freq+1
                                aggiorna _minFreq se il vecchio bucket si svuota

  set(key, entry)                                                    (594)
     ├─ key già viva? → delete(key)  (invariante: mai set su key live)
     ├─ buffer > maxSize?      → warn throttled, NON inserisce
     ├─ buffer > maxEntrySize? → warn throttled, NON inserisce
     ├─ while(currentSize+len > maxSize && size>0): _evictOne()
     │         └▶ vittima = primo elemento del bucket _minFreq (FIFO)
     └─ inserisce con freq=1, currentSize += len, _minFreq=1

  refresh(key, fields)  ── update in-place preservando freq          (633)
       (usato quando un'entry stale-by-age torna fresca senza cambiare
        mtime/size, così i file popolari non ricadono in fondo alla LFU)
```

### 8.2 `singleFlight` + `refreshOrInsert`

Protezione *thundering-herd*: N miss concorrenti sulla stessa chiave
condividono **un solo** lavoro (read / compress), rigetto incluso.

```
  singleFlight(map, key, work)                                       (717)
        │
  ╱ map.has(key)? ╲
     ── sì ──▶ ritorna la Promise in volo  (JOIN: nessun lavoro extra)
     ── no ──▶ job = work(); map.set(key, job)
               job.then(clean, clean)   ← rimossa appena settla (retry pulito)
               ritorna job

  Chiavi (includono mtime+size → versioni diverse non condividono il job):
    _inflightRawReads      `${path}:${mtime}:${size}`
    _inflightCompressions  `${path}:${encoding}:${mtime}:${size}`
    _inflightStreamTees    `${path}:${encoding}:${mtime}:${size}`  (Set)

  refreshOrInsert(cache, key, newEntry, cached, staleByAge)          (754)
     stale solo per età (mtime+size invariati) → cache.refresh() in-place
     altrimenti → delete + set  (freq riparte da 1)
```

---

<a name="uscite"></a>
## 9. Mappa delle uscite (riepilogo)

| Uscita | Quando | Righe (indicative) |
|---|---|---|
| `►► next()` | metodo non gestito · prefix non combacia · URL riservato | 2057 · 2091 · 2113 |
| `⇒ 400` | Host invalido · %-encoding rotto · null byte · originalUrl malformato | 2083 · 2139 · 2149 · 2213 |
| `⇒ 404` | fuori root · genitore/leaf nascosto · symlink fuori root · non esiste · dirListing off · trailing-slash su file · file con `/` finale | 2165 · 2173/2298 · 2312 · 2289 · 2378 · 2387 |
| `⇒ 301 / 3xx` | `hideExtension` redirect · trailing-slash `/dir → /dir/` | 2262 · 2346 |
| `⇒ 304` | If-None-Match o If-Modified-Since soddisfatti | 2560 · 2574 |
| `⇒ 206` | Range valido (e If-Range ok) | 2601 |
| `⇒ 416` | Range non soddisfacibile | 2588 |
| `⇒ 200` | file servito (raw / compresso / stream) · directory listing | 2829/2854 · 2374 |
| `⇒ 500` | errore readdir · errore inatteso nel `try` esterno · render template fallito | 2910 · 2403 · 374 |
| `⇒ 504` | timeout del render template | 371 |

> Tutte le pagine generate dal middleware (listing + errori) passano da
> `setGeneratedPageHeaders` / `writeErrorPage`, che impostano gli header di
> sicurezza (CSP, nosniff, X-Frame-Options…) e ripuliscono gli header di
> rappresentazione/cache lasciati da una risposta parzialmente costruita. I
> **file utente serviti dal disco NON** ricevono la CSP del middleware.

---

*Documento generato dall'analisi di `index.cjs` (v5.0.0). I numeri di riga sono
indicativi: se il file viene modificato, verificare i riferimenti prima di
citarli in altra documentazione.*
