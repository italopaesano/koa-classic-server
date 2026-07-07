# Revisione completa del codice — v3.1.0

**Data revisione:** 2026-07-03
**Oggetto:** `index.cjs` (intero file, 2189 righe), `index.mjs`, `package.json`, documentazione in `docs/`
**Stato di partenza:** 604 test verdi, ESLint pulito, 0 vulnerabilità npm

Questo file è il **registro ufficiale dei problemi aperti** emersi dalla revisione.
Ogni voce ha una checkbox nell'indice: va spuntata (`[x]`) quando la tematica viene
affrontata e risolta (o consapevolmente chiusa come "wontfix", annotandolo nella voce).

> I riferimenti a righe di codice (`index.cjs:NNNN`) fotografano lo stato al commit
> della revisione e potrebbero slittare con le modifiche successive.

---

## Indice / Checklist

### Bug confermati (riprodotti con test)
- [x] [1. Default di `index` documentato erroneamente](#1-default-di-index-documentato-erroneamente) — **RISOLTO** (documentazione allineata al default `[]`)
- [ ] [2. `If-Modified-Since` non produce mai 304 con mtime sub-secondo](#2-if-modified-since-non-produce-mai-304-con-mtime-sub-secondo)
- [ ] [3. Manca il redirect canonico `/dir` → `/dir/`](#3-manca-il-redirect-canonico-dir--dir)

### Robustezza / DoS
- [x] [4. Compressione: buffering illimitato in RAM + flush della cache LFU](#4-compressione-buffering-illimitato-in-ram--flush-della-cache-lfu) — **RISOLTO** (`compression.maxFileSize` 10 MB + early-return in `LFUCache.set()`)
- [x] [5. Nessuna deduplicazione delle richieste concorrenti (thundering herd)](#5-nessuna-deduplicazione-delle-richieste-concorrenti-thundering-herd) — **RISOLTO** (single-flight su entrambe le cache)

### Conformità HTTP
- [ ] [6. `getClientEncoding` ignora i q-value di Accept-Encoding](#6-getclientencoding-ignora-i-q-value-di-accept-encoding)
- [ ] [7. Header `Vary: Accept-Encoding` incompleto](#7-header-vary-accept-encoding-incompleto)
- [ ] [8. Precedenza Range vs validatori; 206 senza ETag/Last-Modified](#8-precedenza-range-vs-validatori-206-senza-etaglast-modified)
- [ ] [9. `If-None-Match`: niente liste con virgole né `*`](#9-if-none-match-niente-liste-con-virgole-né-)

### Validazione opzioni / API factory
- [ ] [10. `opts: null` produce un TypeError grezzo; la factory muta l'oggetto del chiamante](#10-opts-null-produce-un-typeerror-grezzo-la-factory-muta-loggetto-del-chiamante)
- [ ] [11. `urlPrefix` con slash finale e `urlsReserved` senza slash iniziale: nessuna validazione](#11-urlprefix-con-slash-finale-e-urlsreserved-senza-slash-iniziale-nessuna-validazione)
- [ ] [12. `browserCacheMaxAge` negativo coerciuto silenziosamente](#12-browsercachemaxage-negativo-coerciuto-silenziosamente)

### Minori / cosmetici
- [ ] [13. Link "Parent Directory" alla radice di `urlPrefix` esce dal prefix](#13-link-parent-directory-alla-radice-di-urlprefix-esce-dal-prefix)
- [ ] [14. `hideExtension`: incoerenza decoded/raw nel check dell'estensione](#14-hideextension-incoerenza-decodedraw-nel-check-dellestensione)
- [ ] [15. `Buffer.slice()` deprecato](#15-bufferslice-deprecato)
- [ ] [16. Riga "empty folder" assente se tutte le entry sono nascoste](#16-riga-empty-folder-assente-se-tutte-le-entry-sono-nascoste)

---

## Bug confermati

### 1. Default di `index` documentato erroneamente

**Stato: ✅ RISOLTO** (stessa sessione della revisione — fix solo documentale).

**Problema:** il blocco JSDoc in `index.cjs` dichiarava il default `index: ["index.html"]`,
ma il codice di normalizzazione fa cadere `undefined` nel ramo `else` → default effettivo `[]`
(nessun file index, le directory mostrano sempre il listing). `docs/DOCUMENTATION.md`
documentava inoltre la forma stringa v2 (che in v3 lancia un errore) e una "Known Limitation"
sul mancato supporto degli array (superata in v3). `docs/INDEX_OPTION_PRIORITY.md` parlava
ancora di "deprecation warning" invece dell'errore a startup.

**Decisione:** il default `[]` è il comportamento voluto; è stata corretta la documentazione
(JSDoc in `index.cjs`, sezione `index` e casi d'uso in `DOCUMENTATION.md`, rimossa la
limitation obsoleta, aggiornata la nota in `INDEX_OPTION_PRIORITY.md`).

---

### 2. `If-Modified-Since` non produce mai 304 con mtime sub-secondo

**Posizione:** `index.cjs:1727` (blocco `If-Modified-Since` dentro `loadFile`).

**Problema:** `Last-Modified` viene emesso con `toUTCString()` (precisione al secondo — il
formato HTTP non ha millisecondi), ma il confronto usa `fileStat.mtime.getTime()` che sui
filesystem moderni (ext4, btrfs, xfs, APFS) include i millisecondi:

```js
if (fileStat.mtime.getTime() <= clientDate.getTime()) { ctx.status = 304; ... }
```

Un client che fa echo esatto dell'header ricevuto (comportamento standard: `curl -z`, wget,
proxy, client HTTP minimali) confronta ad es. `22:13:20.500 <= 22:13:20.000` → falso →
**sempre 200 con body completo**, mai 304. Il 304 via data scatta solo se l'mtime cade
esattamente su un secondo intero.

**Riproduzione (verificata):** `GET /file.txt` → `Last-Modified: Tue, 14 Nov 2023 22:13:20 GMT`;
seconda richiesta con `If-Modified-Since` identico → **200** invece di 304.

**Perché i test non lo rilevano:** `__tests__/caching-headers.test.js:147` usa una data
"1 secondo nel futuro" invece dell'echo dell'header reale. I browser non sono impattati
perché inviano anche `If-None-Match` (controllato prima e funzionante).

**Fix proposto:** troncare l'mtime al secondo prima del confronto:

```js
if (Math.floor(fileStat.mtime.getTime() / 1000) * 1000 <= clientDate.getTime()) { ... }
```

più un test che riusa l'header `Last-Modified` della risposta precedente (con un file il cui
mtime abbia una componente sub-secondo, es. via `fs.utimes`).

**Priorità:** Alta (fix a una riga, beneficio diretto su banda/caching).

---

### 3. Manca il redirect canonico `/dir` → `/dir/`

**Posizione:** `index.cjs:1315` (lo slash finale viene rimosso durante il parsing URL) e
`index.cjs:1515+` (ramo directory: serve l'index senza redirect).

**Problema:** una richiesta a una directory **senza** slash finale (es. `GET /sub` con
`/sub/index.html` esistente) serve direttamente l'index con 200 invece di rispondere
`301 Location: /sub/`. Il contenuto è identico a `/sub/`, ma i riferimenti **relativi**
dentro la pagina si risolvono contro la directory sbagliata: con URL `/sub`,
`<a href="page2.html">` punta a `/page2.html` (404) invece di `/sub/page2.html`; lo stesso
vale per `<img>`, CSS e script relativi. L'utente che digita l'URL senza slash vede la
pagina "rotta".

**Riproduzione (verificata):** `GET /sub` → 200, nessun header `Location`, body = index.html.

**Riferimento:** Apache (`mod_dir`, `DirectorySlash On` di default), nginx ed
`express/serve-static` emettono tutti il 301 con slash aggiunto. È il comportamento
"Apache-like" dichiarato dal progetto.

**Fix proposto:** quando il path risolto è una directory e il path richiesto non termina
con `/`, rispondere `301` verso lo stesso path + `/`, preservando la query string.
Edge case da coprire con test: `urlPrefix`, caratteri percent-encoded nel path, root `/`,
interazione con `hideExtension` (che ha già una propria gestione dello slash finale),
metodo HEAD. Attenzione: l'informazione "c'era lo slash?" va catturata **prima** dello
strip a `index.cjs:1315`. Valutare se dietro opzione (es. `dirRedirect: true` di default è
un breaking change osservabile — da difendere nel PR come fix di correttezza, non
restrizione, coerente con la design philosophy).

**Priorità:** Alta.

---

## Robustezza / DoS

### 4. Compressione: buffering illimitato in RAM + flush della cache LFU

**Stato: ✅ RISOLTO** (2026-07-07 — nuova opzione `compression.maxFileSize`, default
10 MB, `false` = nessun tetto: sopra soglia il file viene comunque compresso ma via la
modalità streaming RAM-bounded esistente (niente buffer intero, niente cache). In
`LFUCache.set()` aggiunto l'early-return per entry più grandi dell'intera cache, PRIMA
del loop di eviction: un'entry che non entrerà mai non svuota più le entry altrui.
Documentato nel blocco JSDoc dei default e in `SECURITY_HARDENING.md` §3.10. Test:
`__tests__/compression-max-file-size.test.js`, 10 test.)

**Posizione:** `index.cjs:1761` (`const rawData = rawBuffer || await fs.promises.readFile(toOpen)`)
e `index.cjs:423-426` (`LFUCache.set`).

**Problema (config di default):** con `compression.enabled: true` +
`serverCache.compressedFile.enabled: true` (entrambi default), un file con MIME comprimibile
di **qualsiasi dimensione** viene letto interamente in RAM e compresso a brotli quality 11
in modo sincrono. A differenza di `serverCache.rawFile` (che ha `maxFileSize: 1 MB`), il
percorso di compressione **non ha alcun tetto di dimensione**. Un file testuale da svariati
GB (log, JSON, SVG, CSV) richiesto con `Accept-Encoding: br` causa allocazione RAM pari al
file + CPU brotli Q11 (misurato: 30 MB → ~850 ms alla prima richiesta).

**Aggravanti:**
1. Se il buffer compresso supera `maxSize` della cache (100 MB default), `LFUCache.set()`
   **svuota l'intera cache** nel loop di eviction prima di scoprire che l'entry non ci sta
   comunque — e ritorna senza inserirla. Ogni richiesta successiva allo stesso file
   rilegge e ricomprime da capo (DoS di CPU/RAM ripetibile) e nel frattempo ha buttato via
   la cache di tutti gli altri file.
2. Nessuna deduplicazione in-flight (vedi voce 5).

**Nota filosofia progetto:** rientra nella categoria "safety net contro i failure mode del
processo" (analogo a `[F-1]` per `readdir()`), quindi un default protettivo è accettabile.
Non è tracciato in `docs/security_improvement_for_V3.md` (che rimanda a questa voce).

**Fix proposto:**
1. Aggiungere `compression.maxFileSize` (o soglia analoga): oltre il limite si usa la
   modalità streaming già esistente (zlib transform, RAM bounded, brotli Q4) invece del
   percorso buffer+cache.
2. In `LFUCache.set()`, early-return se `entry.buffer.length > this.maxSize` **prima** del
   loop di eviction (nessun senso svuotare la cache per un'entry che non entrerà mai).

**Priorità:** Alta.

---

### 5. Nessuna deduplicazione delle richieste concorrenti (thundering herd)

**Stato: ✅ RISOLTO** (2026-07-07 — helper `singleFlight()` a livello modulo + due mappe
in-flight per factory (`_inflightRawReads`, `_inflightCompressions`, chiavi `path` e
`path:encoding`). Il leader esegue lettura (+compressione) e inserimento in cache; i
waiter attendono la stessa Promise. L'errore è condiviso: tutti i waiter cadono insieme
nel fallback non compresso esistente, e l'entry in-flight viene rimossa alla
risoluzione così la richiesta successiva ritenta da zero. Test:
`__tests__/single-flight.test.js`, 5 test.)

**Posizione:** `index.cjs:1743-1799` (popolamento `compressedFile` cache) e
`index.cjs:1568-1592` (popolamento `rawFile` cache).

**Problema:** N richieste simultanee a un file non ancora in cache eseguono N `readFile()` +
N compressioni brotli Q11 in parallelo per lo stesso identico contenuto; solo l'ultima
`set()` "vince". Su file grandi e traffico a raffica (deploy, cache fredda al riavvio) il
picco di CPU/RAM si moltiplica per il numero di richieste concorrenti.

**Fix proposto:** mappa in-flight `key → Promise` condivisa: la prima richiesta avvia
lettura+compressione, le successive attendono la stessa Promise (pattern "single-flight").
Rimuovere l'entry dalla mappa in `finally`.

**Priorità:** Media (mitigato di fatto dal fix della voce 4; da implementare insieme).

---

## Conformità HTTP

### 6. `getClientEncoding` ignora i q-value di Accept-Encoding

**Posizione:** `index.cjs:1212-1218`.

**Problema:** il match è un semplice `acceptEncoding.includes(enc)`. Un client che invia
`Accept-Encoding: br;q=0, gzip` (rifiuto esplicito di brotli, RFC 9110 §12.5.3) riceve
comunque brotli. Analogamente non viene rispettato l'ordine di preferenza espresso dai
q-value (vince sempre l'ordine di `compression.encodings` lato server — questo di per sé è
accettabile, ma `q=0` va onorato).

**Fix proposto:** parsing minimale dei membri di `Accept-Encoding` (split su `,`, estrazione
di `;q=`), escludendo gli encoding con `q=0`. Non serve un parser completo: basta gestire
correttamente presenza/assenza e `q=0`.

**Priorità:** Media.

---

### 7. Header `Vary: Accept-Encoding` incompleto

**Posizione:** `index.cjs:1712-1731` (ramo 304) e `index.cjs:1832+` (ramo non compresso).

**Problema:**
1. Il `304` di una variante compressa viene emesso **prima** di `ctx.set('Vary', ...)`
   (che avviene solo nel ramo `if (encoding)` più in basso) → il 304 è privo di `Vary`,
   mentre RFC 9110 §15.4.5 richiede che il 304 includa gli header che avrebbe avuto il 200.
2. Le risposte **non compresse** di contenuti con MIME comprimibile (client senza
   `Accept-Encoding` compatibile) non hanno `Vary: Accept-Encoding` → un proxy/CDN condiviso
   può cachearle e servirle anche a client che avrebbero ricevuto la variante compressa
   (o viceversa non differenziare le varianti).

**Fix proposto:** impostare `Vary: Accept-Encoding` non appena la risorsa risulta
*potenzialmente* comprimibile (MIME comprimibile + compressione abilitata), indipendentemente
dall'esito della negoziazione, e prima del ramo 304.

**Nota aggiunta 2026-07-07 (dalla code review della fase 1):** caso imparentato da
coprire nello stesso fix — il fallback su errore di compressione (`index.cjs`, catch del
ramo bufferizzato) serve il contenuto **identity** ma lascia impostato l'ETag con
suffisso `-gz`/`-br` già emesso e rimuove `Vary`: il validatore non descrive la
rappresentazione effettivamente servita e un proxy condiviso può cachearla sotto la
chiave della variante compressa. Nel fix di questa voce, resettare l'ETag alla forma
senza suffisso (o ri-emetterlo) nel ramo di fallback.

**Priorità:** Media.

---

### 8. Precedenza Range vs validatori; 206 senza ETag/Last-Modified

**Posizione:** `index.cjs:1636-1689` (ramo Range) vs `index.cjs:1712-1731` (validatori).

**Problema:**
1. Il ramo `Range` viene valutato **prima** di `If-None-Match`/`If-Modified-Since`, mentre
   RFC 9110 §13.2.2 impone la precedenza dei validatori (una richiesta Range con
   `If-None-Match` che matcha dovrebbe rispondere 304, non 206).
2. Le risposte `206` non includono `ETag` né `Last-Modified` (con `browserCacheEnabled: true`
   vengono impostati solo nel percorso full-response, dopo il ramo Range).

**Fix proposto:** spostare la valutazione dei validatori prima del ramo Range (quando
`browserCacheEnabled`), e impostare `ETag`/`Last-Modified` anche sulle 206.

**Priorità:** Media-bassa (i client reali usano `If-Range`, già gestito; l'impatto pratico è
limitato ma è non-conformità RFC).

---

### 9. `If-None-Match`: niente liste con virgole né `*`

**Posizione:** `index.cjs:1717-1721`.

**Problema:** il confronto è un'uguaglianza esatta con l'intero header. RFC 9110 §13.1.2
permette `If-None-Match: "etag1", "etag2"` (lista) e `If-None-Match: *`; entrambi oggi non
matchano mai → 200 invece di 304. Inoltre un ETag weak (`W/"..."`) inviato da un proxy non
matcherebbe (per il 304 è ammesso il weak comparison).

**Fix proposto:** split dell'header su `,`, trim, confronto per singolo elemento gestendo il
prefisso `W/` e il caso `*`.

**Priorità:** Bassa (i browser inviano un singolo ETag; rilevante dietro proxy/CDN).

---

## Validazione opzioni / API factory

### 10. `opts: null` produce un TypeError grezzo; la factory muta l'oggetto del chiamante

**Posizione:** `index.cjs:659-660` e normalizzazioni successive.

**Problema:**
1. `koaClassicServer(root, null)`: il default parameter `opts = {}` scatta solo con
   `undefined`; con `null` la riga `options.template = opts.template || {}` lancia
   `TypeError: Cannot read properties of null` senza messaggio utile — incoerente con le
   altre validazioni che lanciano errori `[koa-classic-server] ...` con hint.
2. `options` è un alias di `opts`: la factory **muta l'oggetto di configurazione del
   chiamante** (riscrive `index`, `dirListing`, `template.renderTimeout`, ecc.). Se
   l'operatore riusa lo stesso oggetto per due istanze o lo ispeziona dopo, osserva
   valori modificati.

**Fix proposto:** `const options = { ...(opts || {}) }` (shallow copy, con copia annidata per
`template`) e messaggio d'errore esplicito se `opts` non è un oggetto.

**Priorità:** Media (fix piccolo, migliora la DX).

---

### 11. `urlPrefix` con slash finale e `urlsReserved` senza slash iniziale: nessuna validazione

**Posizione:** `index.cjs:758-760` (`urlPrefix`), `index.cjs:1350-1358` (`urlsReserved`).

**Problema:**
1. `urlPrefix: '/static/'` (slash finale): lo split produce una parte vuota finale che non
   matcha mai il pathname → il middleware chiama sempre `next()` **silenziosamente**: nessun
   file viene servito e l'operatore non capisce perché.
2. `urlsReserved: ['admin']` (senza `/` iniziale): il confronto usa `value.substring(1)` →
   `'dmin'` non matcha mai → la riserva è silenziosamente inefficace.

**Fix proposto:** a factory time, normalizzare (strip dello slash finale di `urlPrefix`,
aggiunta dello slash iniziale mancante a `urlsReserved`) con un `warn` una-tantum, oppure
lanciare un errore con hint — coerente con lo stile delle altre validazioni.

**Priorità:** Media (footgun silenzioso di configurazione).

---

### 12. `browserCacheMaxAge` negativo coerciuto silenziosamente

**Posizione:** `index.cjs:791`.

**Problema:** `browserCacheMaxAge: -5` (o `NaN`, o una stringa) non supera il check
`typeof === 'number' && >= 0` e ricade **silenziosamente** sul default 3600. Incoerente con
`dirListing.maxEntries`, `renderTimeout`, `serverCache.*.maxAge` che lanciano errori con
messaggio esplicativo.

**Fix proposto:** riusare `validateNonNegativeInt` (o analogo) per lanciare con hint.
Attenzione: è un cambio da "silenzioso" a "throw" per config già deployate errate —
valutare un `warn` in v3.x e throw in v4.

**Priorità:** Bassa.

---

## Minori / cosmetici

### 13. Link "Parent Directory" alla radice di `urlPrefix` esce dal prefix

**Posizione:** `index.cjs:1949-1957`.

**Problema:** con `urlPrefix: '/static'`, il listing di `GET /static/` mostra il link
".. Parent Directory" che punta a `/` (fuori dall'albero servito dal middleware →
tipicamente 404 o altra route). La condizione confronta con `origin + "/"` e non tiene
conto del prefix. Apache omette il link alla parent alla DocumentRoot.

**Fix proposto:** omettere il link quando `pageHrefOutPrefix.pathname === '/'` (radice
logica del middleware), non solo quando il path assoluto è `/`.

**Priorità:** Bassa.

---

### 14. `hideExtension`: incoerenza decoded/raw nel check dell'estensione

**Posizione:** `index.cjs:1422-1429`.

**Problema:** il ramo senza trailing slash confronta l'estensione sul path **decodificato**
(`requestedPath`), quello con trailing slash sul path **raw** (`rawPath`, non decodificato).
Risultato: `/foo%2Eejs` viene riconosciuto e redirretto, `/foo%2Eejs/` no. Caso limite, ma
il comportamento dovrebbe essere uniforme.

**Fix proposto:** usare per entrambi i rami la forma decodificata (con lo slash finale
rimosso prima del confronto).

**Priorità:** Bassa.

---

### 15. `Buffer.slice()` deprecato

**Posizione:** `index.cjs:1666` (`rawBuffer.slice(start, end + 1)`).

**Problema:** `Buffer.prototype.slice` è deprecato (DEP0158); `subarray()` ha la stessa
semantica zero-copy ed è l'API raccomandata.

**Fix proposto:** sostituire con `rawBuffer.subarray(start, end + 1)`.

**Priorità:** Bassa (sostituzione meccanica).

---

### 16. Riga "empty folder" assente se tutte le entry sono nascoste

**Posizione:** `index.cjs:1959` (check `dir.length === 0` fatto **prima** del filtro hidden).

**Problema:** se una directory contiene solo entry nascoste (es. tutte matchate da
`alwaysHide`), il listing mostra una tabella senza righe e senza il messaggio
"empty folder" (che appare solo se la directory è fisicamente vuota).

**Fix proposto:** mostrare la riga "empty folder" quando `items.length === 0` dopo il
filtro (oltre al caso `dir.length === 0`).

**Priorità:** Bassa (cosmetico).

---

## Punti di forza rilevati (nessuna azione richiesta)

Registrati per completezza della revisione:

- **Path traversal:** guardie stratificate (decode → null-byte → normalize →
  `_isWithinRoot` boundary-aware), 404 indistinguibile da "not found".
- **XSS:** `escapeHtml` applicato con coerenza su tutti i dati riflessi nel listing;
  CSP con hash della CSS calcolato a module load; security header su tutte le pagine generate.
- **Symlink policy** (`follow` / `follow-within-root` / `deny`) ben progettata, incluso il
  caso rootDir-symlink e il default a costo zero.
- **LFUCache** con eviction O(1) e `refresh()` che preserva la frequenza.
- Gestione accurata di HEAD (RFC 9110 §9.3.2 nel rendering template), timeout con
  AbortSignal, `DT_UNKNOWN` su filesystem esotici, deprecation warning una-tantum.
- Suite di 604 test, lint pulito, messaggi di migrazione v2→v3 con hint espliciti.
