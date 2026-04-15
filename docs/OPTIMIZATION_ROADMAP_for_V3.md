# Performance Optimization Roadmap — koa-classic-server v3.0.0

**File:** `docs/OPTIMIZATION_ROADMAP_for_V3.md`  
**Data analisi:** 2026-04-14  
**Versione sorgente analizzata:** branch `claude/koa-v3-preparation-rVXMD`  
**File analizzato:** `index.cjs` (1544 righe)

---

## Indice

1. [Introduzione](#1-introduzione)
   - 1.1 Scopo del documento
   - 1.2 Come usare questo roadmap
   - 1.3 Legenda (impatto / difficoltà / rischio)
2. [Riepilogo generale](#2-riepilogo-generale)
   - 2.1 Tabella dei 15 punti
   - 2.2 Mappa visiva fase → punti → impatto
3. [FASE 1 — Precomputation al factory time](#3-fase-1--precomputation-al-factory-time)
   - [x] 3.1 #2 — `urlPrefix.split()` precompilato
   - [x] 3.2 #11 — `require('stream')` → top-level
   - [x] 3.3 #12 — `Math.log(1024)` → costante di modulo
   - [x] 3.4 #14 — `for...in` su array → loop indicizzato
   - [x] 3.5 #15 — `pageHref.origin+pathname` estratto prima del loop
4. [FASE 2 — Riduzione costruzioni new URL()](#4-fase-2--riduzione-costruzioni-new-url)
   - [x] 4.1 #1a — `new URL()` a riga 744 incondizionata
   - [x] 4.2 #1b — Estrazione `_origin` per evitare concatenazioni ripetute
5. [FASE 3 — Helper puri → scope modulo + string single-pass](#5-fase-3--helper-puri--scope-modulo--string-single-pass)
   - [x] 5.1 #8 — `escapeHtml` e `formatSize` → scope modulo
   - [x] 5.2 #9 — `escapeHtml`: 5 `replace()` → regex single-pass + lookup table
   - [x] 5.3 #10 — HTML 404 → costante pre-calcolata
   - [x] 5.4 #13 — `item[sy_type]` Symbol hack → API dirent ufficiale
6. [FASE 4 — Strutture dati: Array → Set](#6-fase-4--strutture-dati-array--set)
   - [x] 6.1 #7 — `mimeTypes` `Array.includes()` O(n) → `Set.has()` O(1)
7. [FASE 5 — Directory listing: I/O parallelo](#7-fase-5--directory-listing-io-parallelo)
   - [x] 7.1 #4 — Eliminare doppia `stat()` per symlink
   - [x] 7.2 #3 — Loop `for...of` `await` → `Promise.all` per stat parallele
8. [FASE 6 — findIndexFile fast-path](#8-fase-6--findindexfile-fast-path)
   - [x] 8.1 #5 — `stat()` diretto per pattern stringa, `readdir` solo per RegExp
9. [FASE 7 — LFU cache: eviction O(1)](#9-fase-7--lfu-cache-eviction-o1)
   - [x] 9.1 #6 — Struttura LFU classica con bucket di frequenza
10. [Stima impatto complessivo atteso](#10-stima-impatto-complessivo-atteso)
    - 10.1 File serving (rawFile cache warm)
    - 10.2 Directory listing su disco locale
    - 10.3 Directory listing su NFS/SMB
    - 10.4 High-throughput request rate
11. [Note implementative e ordine consigliato](#11-note-implementative-e-ordine-consigliato)

---

## 1. Introduzione

### 1.1 Scopo del documento

Questo documento raccoglie tutte le opportunità di ottimizzazione delle performance
identificate nel sorgente di koa-classic-server durante la preparazione della v3.0.0.
Le ottimizzazioni sono organizzate in 7 fasi ordinate per facilità di implementazione
e impatto, con checkbox per tracciare l'avanzamento.

### 1.2 Come usare questo roadmap

- `[ ]` = da fare
- `[x]` = completato
- Ogni punto riporta: descrizione del problema, riga sorgente, causa root, fix proposto
- Le fasi sono indipendenti tra loro e possono essere eseguite in qualsiasi ordine,
  ma l'ordine proposto minimizza il rischio di regressioni

### 1.3 Legenda

| Simbolo | Significato |
|---------|-------------|
| 🔴 Alto | Impatto misurabile su ogni richiesta o su listing di directory |
| 🟡 Medio | Impatto visibile sotto carico o con directory grandi |
| 🟢 Basso | Micro-ottimizzazione, guadagno marginale |
| ⚙️ Qualità | Migliora robustezza/leggibilità anche senza impatto diretto |
| ★ Difficoltà Bassa | < 1 ora, modifica localizzata, nessun rischio architetturale |
| ★★ Difficoltà Media | Richiede refactor di una funzione, test di verifica necessari |
| ★★★ Difficoltà Alta | Cambiamento algoritmico, struttura dati nuova, test estensivi |

---

## 2. Riepilogo generale

### 2.1 Tabella dei 15 punti

| # | Ottimizzazione | Riga/i | Fase | Impatto | Difficoltà | Rischio |
|---|---------------|--------|------|---------|------------|---------|
| 1a | `new URL()` a riga 744 — incondizionata | 744 | 2 | 🔴 Alto | ★ | Basso |
| 1b | `ctx.protocol+'://'+ctx.host` ripetuto 3+ volte | 660,744,756 | 2 | 🔴 Alto | ★ | Basso |
| 2 | `urlPrefix.split("/")` ad ogni richiesta | 670 | 1 | 🔴 Alto | ★ | Basso |
| 3 | `show_dir`: stat serializzate (`await` in `for...of`) | 1371–1430 | 5 | 🔴 Alto | ★★ | Basso |
| 4 | `show_dir`: doppia `stat()` per symlink | 1396–1420 | 5 | 🔴 Alto | ★ | Basso |
| 5 | `findIndexFile`: readdir + stat tutti + stat secondo | 859–908 | 6 | 🟡 Medio | ★★ | Medio |
| 6 | LFU eviction: scansione lineare O(n) | 577–597 | 7 | 🟡 Medio | ★★★ | Medio |
| 7 | `mimeTypes.includes()`: Array O(n) vs Set O(1) | 1105 | 4 | 🟡 Medio | ★ | Basso |
| 8 | `escapeHtml`, `formatSize` ricreate ad ogni richiesta | 1280,1532 | 3 | 🟡 Medio | ★ | Basso |
| 9 | `escapeHtml`: 5 `.replace()` in catena | 1536–1541 | 3 | 🟡 Medio | ★ | Basso |
| 10 | `requestedUrlNotFound()` rigenera HTML ad ogni 404 | 917–933 | 3 | 🟢 Basso | ★ | Basso |
| 11 | `require('stream')` dentro l'handler | 1234 | 1 | 🟢 Basso | ★ | Basso |
| 12 | `formatSize`: `Math.log(1024)` ricalcolato ad ogni call | 1285 | 1 | 🟢 Basso | ★ | Basso |
| 13 | `item[sy_type]` Symbol interno invece di API dirent | 1366–1373 | 3 | ⚙️ Qualità | ★ | Basso |
| 14 | `for...in` su array invece di loop indicizzato | 672 | 1 | 🟢 Basso | ★ | Basso |
| 15 | `pageHref.origin+pathname` ricalcolato nel loop | 1383–1387 | 1 | 🟢 Basso | ★ | Basso |

### 2.2 Mappa fase → punti → impatto

```
FASE 1 ── Precomputation ──────── #2 #11 #12 #14 #15 ── ★ ── Medio
FASE 2 ── URL reduction ──────── #1a #1b ──────────── ★ ── Alto
FASE 3 ── Helper scope+string ── #8 #9 #10 #13 ──── ★ ── Medio
FASE 4 ── Array → Set ─────────── #7 ─────────────────── ★ ── Medio
FASE 5 ── I/O parallelo ────────── #4 #3 ─────────────── ★★ ── Alto ◄ impatto massimo
FASE 6 ── findIndexFile ────────── #5 ─────────────────── ★★ ── Medio
FASE 7 ── LFU O(1) ─────────────── #6 ─────────────────── ★★★ ── Medio
```

---

## 3. FASE 1 — Precomputation al factory time

**Concetto:** tutto ciò che viene calcolato inutilmente ad ogni richiesta
ma il cui valore non cambia mai dopo l'inizializzazione del middleware.
Queste modifiche sono le più sicure: localizzate, senza effetti collaterali,
verificabili con i test esistenti senza aggiungerne di nuovi.

---

### [x] 3.1 — #2: `urlPrefix.split("/")` precompilato

**Riga:** `670`  
**Problema:**
```js
// ATTUALE — eseguito ad ogni richiesta
const a_urlPrefix = options.urlPrefix.split("/");
```

`options.urlPrefix` non cambia mai dopo la factory. La chiamata `.split()` alloca
un nuovo Array ad ogni richiesta.

**Fix:**
```js
// In factory (una volta sola):
const _urlPrefixParts = options.urlPrefix.split("/");

// Nell'handler — sostituire a_urlPrefix con _urlPrefixParts
```

---

### [x] 3.2 — #11: `require('stream')` → top-level

**Riga:** `1234`  
**Problema:**
```js
// ATTUALE — dentro il corpo della richiesta, ramo streaming+rawBuffer
const { Readable } = require('stream');
```

Node.js cache i moduli, ma la chiamata `require()` è comunque una Map lookup +
destructuring ad ogni esecuzione del branch. Appartiene al top del file.

**Fix:**
```js
// Aggiungere in cima al file, dopo gli altri require:
const { Readable } = require('stream');
```

---

### [x] 3.3 — #12: `Math.log(1024)` → costante di modulo

**Riga:** `1285`  
**Problema:**
```js
function formatSize(bytes) {
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k)); // Math.log(k) ogni volta
```

`Math.log(1024)` è una costante pura. Viene ricalcolata ad ogni chiamata a
`formatSize()`, che viene invocata per ogni entry visibile in ogni listing.

**Fix:**
```js
// A scope di modulo:
const _LOG_1024 = Math.log(1024);

// In formatSize:
const i = Math.floor(Math.log(bytes) / _LOG_1024);
```

---

### [x] 3.4 — #14: `for...in` su array → loop indicizzato

**Riga:** `672`  
**Problema:**
```js
// ATTUALE
for (const key in a_urlPrefix) {
    if (a_urlPrefix[key] !== a_pathname[key]) {
```

`for...in` su Array itera sulle chiavi come stringhe (`"0"`, `"1"`, ...) e in
teoria include proprietà prototipo non standard. La semantica corretta per
iterare un array con indice è il loop indicizzato.

**Fix:**
```js
for (let i = 0; i < _urlPrefixParts.length; i++) {
    if (_urlPrefixParts[i] !== a_pathname[i]) {
        await next();
        return;
    }
}
```

> Dipende dal completamento del punto 3.1 — `_urlPrefixParts` già precompilato.

---

### [x] 3.5 — #15: `pageHref.origin + pageHref.pathname` estratto prima del loop

**Righe:** `1383–1387`  
**Problema:**
```js
// ATTUALE — dentro il for...of, ri-calcolata per ogni item
const baseUrl = pageHref.origin + pageHref.pathname;
if (baseUrl === pageHref.origin + options.urlPrefix + "/" || ...) {
```

La stringa `pageHref.origin + pageHref.pathname` è identica per tutti gli item
della stessa directory listing. Viene ricostruita (e confrontata con altre
concatenazioni) per ogni elemento del loop.

> **Nota:** c'è anche un conflitto di nome — `baseUrl` alla riga 1383 ombreggia
> `baseUrl` dichiarata alla riga 1322 per i link di sorting.

**Fix:**
```js
// Prima del for...of, dopo il calcolo di dirRelPath:
const _listingBaseUrl = pageHref.origin + pageHref.pathname;
const _listingOriginPrefix = pageHref.origin + options.urlPrefix;

// Nel loop, sostituire le concatenazioni ripetute con le variabili pre-calcolate.
// Rinominare anche la variabile locale di sorting in sortBaseUrl per eliminare
// il conflitto di nome.
```

---

## 4. FASE 2 — Riduzione costruzioni `new URL()`

**Concetto:** il costruttore `URL` è significativamente più costoso di operazioni
stringa equivalenti. Fa parsing completo, validazione RFC 3986, canonicalizzazione
e allocazione di un oggetto con molte proprietà. Ogni richiesta subisce almeno
una costruzione; in certi path ne subisce 3–4.

---

### [x] 4.1 — #1a: `new URL()` a riga 744 — incondizionata anche senza `hideExtension`

**Riga:** `744`  
**Problema:**
```js
// ATTUALE — eseguito su OGNI richiesta, indipendentemente da hideExtension
const originalUrlPath = new URL(ctx.protocol + '://' + ctx.host + urlToUse).pathname;
const hadTrailingSlash = originalUrlPath.length > 1 && originalUrlPath.endsWith('/');
```

Questo URL viene costruito esclusivamente per determinare `hadTrailingSlash`,
informazione usata solo dentro il blocco `if (options.hideExtension)`.
Se `hideExtension` non è configurato (caso più comune), l'intera costruzione
è sprecata.

**Fix:**
```js
// Spostare le due righe DENTRO il blocco:
if (options.hideExtension) {
    const originalUrlPath = new URL(ctx.protocol + '://' + ctx.host + urlToUse).pathname;
    const hadTrailingSlash = originalUrlPath.length > 1 && originalUrlPath.endsWith('/');
    // ... resto della logica hideExtension
}
```

**Alternativa zero-URL per il trailing slash:**
```js
// Senza costruire URL, direttamente sulla stringa:
const rawPath = urlToUse.split('?')[0]; // rimuove query string
const hadTrailingSlash = rawPath.length > 1 && rawPath.endsWith('/');
```

---

### [x] 4.2 — #1b: `ctx.protocol + '://' + ctx.host` ripetuto 3+ volte

**Righe:** `660, 744, 756`  
**Problema:**
```js
const fullUrl         = ctx.protocol + '://' + ctx.host + urlToUse;        // riga 660
const originalUrlPath = new URL(ctx.protocol + '://' + ctx.host + urlToUse)...; // riga 744
const originalUrlObj  = new URL(ctx.protocol + '://' + ctx.host + ctx.originalUrl); // riga 756
```

La stringa base `ctx.protocol + '://' + ctx.host` viene concatenata 3 volte
per richiesta, ognuna producendo una stringa temporanea intermedia.

**Fix:**
```js
// All'inizio dell'handler, una sola volta:
const _origin = ctx.protocol + '://' + ctx.host;

// Poi ovunque:
const fullUrl        = _origin + urlToUse;
const originalUrlObj = new URL(_origin + ctx.originalUrl);
// ecc.
```

---

## 5. FASE 3 — Helper puri → scope modulo + string single-pass

**Concetto:** funzioni che non catturano variabili di closure ma sono dichiarate
dentro l'handler (o dentro `show_dir` che è dentro l'handler), venendo ricreate
come nuovi oggetti-funzione ad ogni richiesta o ad ogni listing. Spostare le
funzioni pure a scope di modulo elimina questa allocazione sistematica.

---

### [x] 5.1 — #8: `escapeHtml` e `formatSize` → scope di modulo

**Righe:** `1280` (formatSize), `1532` (escapeHtml)  
**Problema:** entrambe le funzioni sono dichiarate dentro la closure dell'handler.
Non usano alcuna variabile di closure: sono funzioni pure che dipendono solo
dai propri argomenti.

`escapeHtml` viene chiamata per ogni entry di ogni listing. Se una directory
ha 200 file, la funzione viene creata una volta per listing ma chiamata 200+
volte con un oggetto-funzione nato e morto insieme alla richiesta.

**Fix:** spostare entrambe le definizioni a livello di `module.exports`
(scope di modulo), prima della `return async (ctx, next) => {`.

---

### [x] 5.2 — #9: `escapeHtml` single-pass con lookup table

**Righe:** `1536–1541`  
**Problema:**
```js
// ATTUALE — 5 passaggi sulla stringa, 4 stringhe intermedie allocate
return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");
```

**Fix:**
```js
// A scope di modulo (una sola volta):
const _HTML_ESCAPE_MAP = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
};
const _HTML_ESCAPE_RE = /[&<>"']/g;

// Funzione:
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe.replace(_HTML_ESCAPE_RE, c => _HTML_ESCAPE_MAP[c]);
}
```

Un solo passaggio, una sola stringa allocata, regex compilata una volta.

---

### [x] 5.3 — #10: HTML 404 → costante pre-calcolata

**Righe:** `917–933`  
**Problema:**
```js
function requestedUrlNotFound() {
    return `
        <!DOCTYPE html>
        <html>...
        </html>
    `;
}
```

Il template literal produce ogni volta una stringa identica. La funzione viene
chiamata ad ogni 404, ad ogni hidden check, ad ogni path traversal bloccato.

**Fix:**
```js
// A scope di factory (calcolato una volta):
const _NOT_FOUND_HTML = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>URL not found</title>
</head>
<body>
    <h1>Not Found</h1>
    <h3>The requested URL was not found on this server.</h3>
</body>
</html>`;

// sendNotFound diventa:
function sendNotFound(ctx) {
    setGeneratedPageHeaders(ctx, NOT_FOUND_CSP);
    ctx.status = 404;
    ctx.body = _NOT_FOUND_HTML;
}
```

---

### [x] 5.4 — #13: `item[sy_type]` Symbol interno → API dirent ufficiale

**Righe:** `1366–1373`  
**Problema:**
```js
// ATTUALE — accesso a Symbol interno non documentato
let a_sy = Object.getOwnPropertySymbols(dir[0]);
const sy_type = a_sy[0];
// ...
const type = item[sy_type]; // usato per ogni item
```

Questa tecnica legge la proprietà numerica del tipo dirent (`0=DT_UNKNOWN`,
`1=file`, `2=dir`, `3=symlink`) tramite un Symbol privato di Node.js che
potrebbe cambiare in versioni future. L'API pubblica equivalente esiste:
`dirent.isFile()`, `dirent.isDirectory()`, `dirent.isSymbolicLink()`.

**Fix:**
```js
// Helper a scope di modulo:
function getDirentType(dirent) {
    if (dirent.isFile())          return 1;
    if (dirent.isDirectory())     return 2;
    if (dirent.isSymbolicLink())  return 3;
    return 0; // DT_UNKNOWN
}

// Nel loop show_dir, sostituire:
// const type = item[sy_type];
// con:
const type = getDirentType(item);
```

Eliminare anche le righe `Object.getOwnPropertySymbols` e `sy_type`.

---

## 6. FASE 4 — Strutture dati: Array → Set

**Concetto:** sostituire ricerche lineari O(n) con lookup O(1) dove il set
di valori è fisso e costruito una volta sola all'inizializzazione.

---

### [x] 6.1 — #7: `mimeTypes` Array → Set

**Riga:** `1105`  
**Problema:**
```js
// ATTUALE — Array.includes() O(n), chiamato ad ogni richiesta non-Range
const isCompressibleMime = compressionConfig.mimeTypes.includes(mimeType);
```

La lista default ha 11 MIME type. Worst case: 11 confronti string ad ogni
richiesta che potrebbe essere compressa.

**Fix:** in `normalizeCompressionConfig()`, restituire un `Set` invece di un `Array`:
```js
// ATTUALE
return { enabled, encodings, minSize, mimeTypes };

// FIX
return { enabled, encodings, minSize, mimeTypes: new Set(mimeTypes) };

// Nell'handler, aggiornare la call-site:
const isCompressibleMime = compressionConfig.mimeTypes.has(mimeType);
```

> **Attenzione:** aggiornare anche il test `compression.test.js` se verifica
> il tipo di `mimeTypes` direttamente.

---

## 7. FASE 5 — Directory listing: I/O parallelo

**Concetto:** il bottleneck più impattante del middleware. Le `stat` del filesystem
durante la generazione del listing vengono eseguite in modo sequenziale (`await`
in `for...of`), serializzando operazioni che potrebbero essere tutte concorrenti.
Su NFS o filesystem di rete l'impatto è ordini di grandezza.

---

### [x] 7.1 — #4: Eliminare doppia `stat()` per symlink — riutilizzare `realStat`

**Righe:** `1396–1420`  
**Problema:** per ogni entry che è un symlink o `DT_UNKNOWN`, la funzione fa
due chiamate `stat` al filesystem separate sullo stesso path:
```js
// STAT #1 — per determinare il tipo effettivo (riga 1396)
const realStat = await fs.promises.stat(itemPath);
if (realStat.isFile()) effectiveType = 1;
// realStat.size è disponibile ma IGNORATO

// ... hidden check ...

// STAT #2 — per ottenere la size (riga 1420) — RIDONDANTE per symlink
const itemStat = await fs.promises.stat(itemPath);
if (effectiveType === 1) {
    sizeBytes = itemStat.size;
}
```

**Fix:** conservare `realStat` e riutilizzarlo per la size:
```js
let cachedStat = null;

if (type === 3 || type === 0) {
    try {
        cachedStat = await fs.promises.stat(itemPath); // conservato
        if (cachedStat.isFile()) effectiveType = 1;
        else if (cachedStat.isDirectory()) effectiveType = 2;
    } catch { ... }
}

// Per la size: riutilizzare cachedStat se disponibile
if (!isBrokenSymlink) {
    try {
        const itemStat = cachedStat || await fs.promises.stat(itemPath);
        if (effectiveType === 1) {
            sizeBytes = itemStat.size;
            sizeStr = formatSize(sizeBytes);
        }
    } catch { sizeStr = '-'; }
}
```

---

### [x] 7.2 — #3: Loop `for...of` con `await` → `Promise.all` per stat parallele

**Righe:** `1371–1430`  
**Problema:** il loop raccoglie i dati di ogni entry in modo sequenziale.
Ogni `await fs.promises.stat()` blocca l'iterazione finché il filesystem
non risponde. Con N file:

- Disco locale (`stat` ≈ 0.3 ms): 100 file → ~30 ms sequenziali vs ~2 ms paralleli
- NFS (`stat` ≈ 15 ms): 100 file → ~1500 ms sequenziali vs ~20 ms paralleli

**Struttura del fix:** separare la raccolta dati (tutte le stat in parallelo)
dalla generazione HTML (puramente sincrona):

```js
// FASE A: raccogliere tutti i dati in parallelo
const rawItems = await Promise.all(
    dir.map(async (item) => {
        const type = getDirentType(item); // dopo fix #13
        if (type !== 0 && type !== 1 && type !== 2 && type !== 3) return null;

        const s_name  = item.name;
        const itemPath = path.join(toOpen, s_name);

        let effectiveType = type;
        let isBrokenSymlink = false;
        let cachedStat = null;

        // Stat #1: risolvi symlink / DT_UNKNOWN
        if (type === 3 || type === 0) {
            try {
                cachedStat = await fs.promises.stat(itemPath);
                if (cachedStat.isFile()) effectiveType = 1;
                else if (cachedStat.isDirectory()) effectiveType = 2;
            } catch {
                if (type === 3) isBrokenSymlink = true;
                else return null;
            }
        }

        // Hidden check: scarta subito le entry nascoste
        const itemIsDir = effectiveType === 2;
        const itemRelPath = dirRelPath ? dirRelPath + '/' + s_name : s_name;
        if (isHiddenEntry(s_name, itemRelPath, itemIsDir)) return null;

        // Stat #2: size (riutilizza cachedStat se già disponibile)
        let sizeBytes = 0;
        let sizeStr = '-';
        if (!isBrokenSymlink) {
            try {
                const itemStat = cachedStat || await fs.promises.stat(itemPath);
                if (effectiveType === 1) {
                    sizeBytes = itemStat.size;
                    sizeStr = formatSize(sizeBytes);
                }
            } catch { sizeStr = '-'; }
        }

        return { name: s_name, type, effectiveType, isBrokenSymlink,
                 sizeBytes, sizeStr, itemPath };
    })
);

// FASE B: filtrare null e calcolare campi derivati (pura, sincrona)
const items = rawItems
    .filter(Boolean)
    .map(item => ({
        ...item,
        isSymlink: item.type === 3,
        mimeType:  item.effectiveType === 2
            ? 'DIR'
            : (mime.lookup(item.itemPath) || 'unknown'),
        itemUri:   buildItemUri(item.name),
        isReserved: /* ... */
    }));

// FASE C: sort + HTML generation (invariati)
```

> **Attenzione:** `Promise.all` esegue tutte le stat concorrentemente, ma le
> entry risultanti sono nell'ordine originale del `readdir`. Il sort successivo
> rimane invariato.

---

## 8. FASE 6 — `findIndexFile` fast-path

**Concetto:** il caso di gran lunga più comune è un pattern stringa (es. `"index.html"`).
Invece di leggere tutti i file della directory, verificare e poi cercare, è più
efficiente tentare una `stat` diretta sul file candidato.

---

### [x] 8.1 — #5: `stat()` diretto per pattern stringa, `readdir` solo per RegExp

**Righe:** `859–908`  
**Problema attuale:**

1. `readdir()` di tutti i file della directory
2. `Promise.all` con `isFileOrSymlinkToFile` su tutti i file (`stat` per symlink)
3. Filtraggio + ricerca del pattern nella lista
4. Seconda `stat()` sul file trovato per restituire `fileStat`

Per una directory con 500 file e pattern `"index.html"`, questo compie centinaia
di operazioni inutili.

**Fix — fast-path per pattern stringa:**
```js
async function findIndexFile(dirPath, indexPatterns) {
    for (const pattern of indexPatterns) {

        // FAST PATH: pattern stringa → stat() diretto, nessun readdir
        if (typeof pattern === 'string') {
            const candidate = path.join(dirPath, pattern);
            try {
                const fileStat = await fs.promises.stat(candidate);
                if (fileStat.isFile()) {
                    return { name: pattern, stat: fileStat };
                }
            } catch {
                continue; // file non esiste, prova il pattern successivo
            }
        }

        // SLOW PATH: pattern RegExp → readdir necessario (comportamento attuale)
        if (pattern instanceof RegExp) {
            try {
                const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
                // ... logica attuale per RegExp ...
            } catch (error) {
                console.error('Error finding index file:', error);
            }
        }
    }
    return null;
}
```

> Se tutti i pattern sono stringhe (caso tipico), `readdir` non viene mai chiamato.
> Se l'array misto contiene prima stringhe poi RegExp, le stringhe sono risolte
> con O(1) `stat` per pattern e il RegExp usa `readdir` solo se nessuna stringa
> ha trovato corrispondenza.

---

## 9. FASE 7 — LFU cache: eviction O(1)

**Concetto:** l'implementazione attuale di `evictLFU` scansiona l'intera Map
per trovare l'entry con hits minimo. Per cache grandi con frequente pressure
sul `maxSize`, questo degrada a O(n) per eviction, O(n²) ammortizzato.

---

### [x] 9.1 — #6: Struttura LFU classica con bucket di frequenza

**Righe:** `577–597`  
**Problema attuale:**
```js
function evictLFU(cache, ...) {
    let minHits = Infinity, minKey = null;
    for (const [key, entry] of cache) { // O(n) scan
        if (entry.hits < minHits) { minKey = key; }
    }
    // evict minKey
}
```

**Struttura dati proposta:** LFU classico O(1) con:
- `freqMap`: `Map<frequency, Set<key>>` — bucket per frequenza
- `keyFreq`: `Map<key, frequency>` — frequenza corrente di ogni key
- `minFreq`: numero intero — frequenza minima attuale

```js
class LFUCache {
    constructor(maxSize) {
        this.maxSize     = maxSize; // in bytes
        this.currentSize = 0;
        this.keyMap  = new Map(); // key → { buffer, mtime, size, freq }
        this.freqMap = new Map(); // freq → Set<key>
        this.minFreq = 0;
    }

    get(key) {
        if (!this.keyMap.has(key)) return undefined;
        this._incrementFreq(key);
        return this.keyMap.get(key);
    }

    set(key, entry) {
        while (this.currentSize + entry.buffer.length > this.maxSize
               && this.keyMap.size > 0) {
            this._evictOne();
        }
        if (this.currentSize + entry.buffer.length > this.maxSize) return;

        this.keyMap.set(key, { ...entry, freq: 1 });
        this._addToFreqBucket(key, 1);
        this.currentSize += entry.buffer.length;
        if (this.minFreq > 1) this.minFreq = 1;
    }

    delete(key) {
        if (!this.keyMap.has(key)) return;
        const { freq, buffer } = this.keyMap.get(key);
        this.currentSize -= buffer.length;
        this.keyMap.delete(key);
        this.freqMap.get(freq)?.delete(key);
    }

    _incrementFreq(key) {
        const entry   = this.keyMap.get(key);
        const oldFreq = entry.freq;
        const newFreq = oldFreq + 1;
        entry.freq = newFreq;
        this.freqMap.get(oldFreq).delete(key);
        if (this.freqMap.get(oldFreq).size === 0) {
            this.freqMap.delete(oldFreq);
            if (this.minFreq === oldFreq) this.minFreq = newFreq;
        }
        this._addToFreqBucket(key, newFreq);
    }

    _addToFreqBucket(key, freq) {
        if (!this.freqMap.has(freq)) this.freqMap.set(freq, new Set());
        this.freqMap.get(freq).add(key);
    }

    _evictOne() {
        const bucket = this.freqMap.get(this.minFreq);
        if (!bucket || bucket.size === 0) return;
        const evictKey = bucket.values().next().value; // FIFO a parità di freq
        this.delete(evictKey);
    }
}
```

**Integrazione:** sostituire `_rawFileCache` (Map) e `_compressedFileCache` (Map)
con istanze di `LFUCache`. Adattare i siti di chiamata per usare
`cache.get(key)`, `cache.set(key, entry)`, `cache.delete(key)`.
La funzione globale `evictLFU` diventa obsoleta e può essere rimossa.

> **Prerequisito:** aggiornare i test in `server-cache.test.js` che verificano
> il comportamento LFU, in particolare il test `"all files return correct content
> even when eviction occurs"` — la semantica rimane identica, solo l'implementazione
> interna cambia.

---

## 10. Stima impatto complessivo atteso

### 10.1 File serving (rawFile cache warm)

Già ottimale: risposta da buffer in memoria, zero disk I/O.
Le fasi 1 e 2 riducono l'overhead del routing di ~5–10% in termini di allocazioni.

### 10.2 Directory listing su disco locale (ext4/btrfs/xfs)

| Scenario | Attuale | Dopo Fase 5 | Miglioramento |
|----------|---------|-------------|---------------|
| 10 file, 2 symlink | ~5 ms | ~3 ms | –40% |
| 100 file, 10 symlink | ~40 ms | ~5 ms | –87% |
| 1000 file, 50 symlink | ~350 ms | ~15 ms | –96% |

### 10.3 Directory listing su NFS/SMB (latenza stat ≈ 15 ms)

| Scenario | Attuale | Dopo Fase 5 | Miglioramento |
|----------|---------|-------------|---------------|
| 10 file, 2 symlink | ~180 ms | ~25 ms | –86% |
| 100 file, 10 symlink | ~1800 ms | ~25 ms | –99% |
| 1000 file, 50 symlink | ~18 s | ~25 ms | –99.9% |

### 10.4 High-throughput file serving (>1000 req/s)

Le fasi 1, 2, 3, 4 riducono le allocazioni per-richiesta:

- Eliminata 1 chiamata `new URL()` incondizionata (fase 2)
- Eliminati 2 `split`/`join` di array per il prefisso URL (fase 1)
- Eliminata 1 funzione oggetto creata per richiesta (`escapeHtml`/`formatSize`, fase 3)
- Lookup MIME O(1) vs O(n) (fase 4)

Stima: **+8–15% throughput** su workload ad alto req/s con file statici.

---

## 11. Note implementative e ordine consigliato

### Ordine consigliato

Le fasi sono state progettate per essere indipendenti, ma l'ordine seguente
minimizza il rischio e massimizza la verificabilità:

**Fase 1 → Fase 2 → Fase 3 → Fase 4 → Fase 5 → Fase 6 → Fase 7**

- Fasi 1–4 possono essere fatte in un singolo commit ciascuna (sono localizzate).
- Fase 5 richiede un refactor più ampio di `show_dir` — committare separatamente
  i due sotto-punti (7.1 prima, poi 7.2).
- Fase 7 richiede una suite di test aggiuntiva per la classe `LFUCache`.

### Test da eseguire dopo ogni fase

Dopo ogni fase: `npx jest --no-coverage` deve passare tutti i 451 test esistenti
senza modifiche. Le ottimizzazioni sono trasparenti al comportamento osservabile.

**Eccezioni:**

- **Fase 4 (#7):** se un test verifica `compressionConfig.mimeTypes` come Array
  (`.length`, spread), aggiornarlo per usare l'API Set (`.size`, `for...of`).
- **Fase 7 (#6):** i test `server-cache.test.js` sulle eviction LFU rimangono
  validi — la semantica non cambia, solo la velocità.

### Compatibilità Node.js

Tutte le ottimizzazioni richiedono Node.js ≥ 18 (già dichiarato in `engines`).
`Promise.all` su array di Promise (fase 5) e `Set` (fase 4) sono disponibili
da Node.js 10+.
L'API dirent `isFile()` / `isDirectory()` / `isSymbolicLink()` è disponibile
da Node.js 10.10+.
