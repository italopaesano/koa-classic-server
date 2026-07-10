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
- [x] [2. `If-Modified-Since` non produce mai 304 con mtime sub-secondo](#2-if-modified-since-non-produce-mai-304-con-mtime-sub-secondo) — **RISOLTO** (mtime troncato al secondo nel confronto)
- [x] [3. Manca il redirect canonico `/dir` → `/dir/`](#3-manca-il-redirect-canonico-dir--dir) — **RISOLTO** (opzione `dirListing.trailingSlash`, default on in v4.0.0; `/dir`→301, `/file/`→404)

### Robustezza / DoS
- [x] [4. Compressione: buffering illimitato in RAM + flush della cache LFU](#4-compressione-buffering-illimitato-in-ram--flush-della-cache-lfu) — **RISOLTO** (`compression.maxFileSize` 10 MB + early-return in `LFUCache.set()`)
- [x] [5. Nessuna deduplicazione delle richieste concorrenti (thundering herd)](#5-nessuna-deduplicazione-delle-richieste-concorrenti-thundering-herd) — **RISOLTO** (single-flight su entrambe le cache)
- [x] [17. Leak di file descriptor nello streaming compresso su disconnessione del client](#17-leak-di-file-descriptor-nello-streaming-compresso-su-disconnessione-del-client) — **RISOLTO** (`stream.pipeline`; voce B1 dell'analisi 2026-07-07)
- [x] [18. Nessun catch di ultima istanza nel middleware](#18-nessun-catch-di-ultima-istanza-nel-middleware) — **RISOLTO** (try/catch sulla sezione "owned request"; voce B3 dell'analisi)
- [x] [19. `new URL()` non protetto nel ramo hideExtension](#19-new-url-non-protetto-nel-ramo-hideextension) — **RISOLTO** (400 come gli altri guard; voce B2 dell'analisi)

### Conformità HTTP
- [x] [6. `getClientEncoding` ignora i q-value di Accept-Encoding](#6-getclientencoding-ignora-i-q-value-di-accept-encoding) — **RISOLTO** (parser minimale token+q: `q=0` escluso, match esatto sul token, wildcard `*`; ordine di preferenza server invariato)
- [x] [7. Header `Vary: Accept-Encoding` incompleto](#7-header-vary-accept-encoding-incompleto) — **RISOLTO** (`Vary` settato appena la risorsa è potenzialmente comprimibile, prima del 304 e indipendente da `browserCacheEnabled`; fallback compressione: `Vary` mantenuto + ETag ripristinato senza suffisso)
- [x] [8. Precedenza Range vs validatori; 206 senza ETag/Last-Modified](#8-precedenza-range-vs-validatori-206-senza-etaglast-modified) — **RISOLTO** (validatori valutati prima del ramo Range per RFC §13.2.2; 206 taggata con `baseEtag` + `Last-Modified`)
- [x] [9. `If-None-Match`: niente liste con virgole né `*`](#9-if-none-match-niente-liste-con-virgole-né-) — **RISOLTO** (helper `ifNoneMatchSatisfied`: `*`, liste, weak comparison `W/`)

### Validazione opzioni / API factory
- [x] [10. `opts: null` produce un TypeError grezzo; la factory muta l'oggetto del chiamante](#10-opts-null-produce-un-typeerror-grezzo-la-factory-muta-loggetto-del-chiamante) — **RISOLTO** (throw con hint su non-oggetto; shallow copy + copie annidate)
- [x] [11. `urlPrefix` con slash finale e `urlsReserved` senza slash iniziale: nessuna validazione](#11-urlprefix-con-slash-finale-e-urlsreserved-senza-slash-iniziale-nessuna-validazione) — **RISOLTO** (deprecation warning una-tantum, comportamento invariato; throw rimandato alla prossima major)
- [ ] [12. `browserCacheMaxAge` negativo coerciuto silenziosamente](#12-browsercachemaxage-negativo-coerciuto-silenziosamente)

### Minori / cosmetici
- [x] [13. Link "Parent Directory" alla radice di `urlPrefix` esce dal prefix](#13-link-parent-directory-alla-radice-di-urlprefix-esce-dal-prefix) — **RISOLTO** (link omesso quando `pageHrefOutPrefix.pathname === '/'`, cioè alla radice logica del middleware)
- [x] [14. `hideExtension`: incoerenza decoded/raw nel check dell'estensione](#14-hideextension-incoerenza-decodedraw-nel-check-dellestensione) — **RISOLTO** (check sul path decodificato; target del redirect ricostruito in spazio decodificato e ri-encodato — insieme al #20, Modello B)
- [x] [15. `Buffer.slice()` deprecato](#15-bufferslice-deprecato) — **RISOLTO** (`subarray()`)
- [x] [16. Riga "empty folder" assente se tutte le entry sono nascoste](#16-riga-empty-folder-assente-se-tutte-le-entry-sono-nascoste) — **RISOLTO** (riga mostrata anche quando `items.length === 0` dopo il filtro hidden)
- [x] [20. `hideExtension`: `/foo.ejs/` (slash finale) redirige a `/foo.` (target rotto)](#20-hideextension-fooejs-slash-finale-redirige-a-foo-target-rotto) — **RISOLTO** (Modello B: URL con estensione + slash finale → 404 come da #3; niente più redirect rotto)

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

**Stato: ✅ RISOLTO** (2026-07-07 — mtime troncato al secondo prima del confronto, come
da fix proposto. Test: `__tests__/caching-headers.test.js`, describe "If-Modified-Since
with sub-second mtime" — riusa l'header `Last-Modified` reale della risposta precedente
su un file con mtime a .500 ms via `fs.utimesSync`; verificato che il test fallisce sul
codice pre-fix.)

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

**Stato: ✅ RISOLTO** (2026-07-09 — nuova opzione `dirListing.trailingSlash`, **default
`true`** in **v4.0.0** (il cambio di comportamento osservabile giustifica il major bump;
decisione del manutentore: default-on con escape hatch, coerente con lo standard di fatto
di Apache/nginx/express/Caddy, ma difeso sul merito — non per parità con Apache):
- `GET /dir` (directory senza slash) → `301` verso `/dir/`;
- `GET /file/` (file con slash finale) → `404` (**opzione C** concordata: un file è
  raggiungibile solo al suo URL senza slash);
- `trailingSlash: false` ripristina il comportamento v3.

Lo slash è catturato da `originalUrl` **prima** dello strip nel parsing URL
(`_pathEndsWithSlash`); il redirect è nel ramo directory (prima di index/listing), il 404
nel ramo file. Query string e percent-encoding preservati, `urlPrefix` incluso, radice `/`
mai redirette, guardia anti-open-redirect (`//host` → `/host`), redirect solo quando la
directory renderizzerebbe (listing abilitato), `Location` da `originalUrl` con
`useOriginalUrl:false`. Test: `__tests__/dir-trailing-slash.test.js`, 20 test; aggiornati
`index.test.js` e `directory-sorting-links.test.js` (chiedevano directory senza slash).)

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
`express/serve-static` emettono tutti il 301 con slash aggiunto.

**Nota del manutentore (2026-07-08):** il progetto è dichiaratamente *simile ma non
identico* ad Apache 2 — la parità con Apache NON è un requisito. Questo fix va
giustificato (e lo è) sul merito proprio: senza redirect, i riferimenti **relativi**
dentro la pagina index si risolvono contro la directory sbagliata e l'utente vede la
pagina rotta. Il fatto che Apache/nginx facciano lo stesso è contesto, non motivazione.

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

### 17. Leak di file descriptor nello streaming compresso su disconnessione del client

**Stato: ✅ RISOLTO** (2026-07-07 — `src.pipe(compress)` sostituito con
`stream.pipeline(src, compress, cb)`, che propaga il teardown in entrambe le direzioni;
`ERR_STREAM_PREMATURE_CLOSE` ignorato in silenzio (evento normale, niente log-spam
pilotabile dal client); errori di lettura veri: log + 500 se gli header non sono partiti,
come prima. Test: `__tests__/streaming-abort.test.js` — verificato che senza il fix il
test di abort fallisce.)

**Origine:** voce **B1** di `docs/analisi_robustezza_v3.1.md` (analisi 2026-07-07),
aggiunta al registro come da prassi.

**Posizione:** ramo streaming della compressione (`ctx.body = src.pipe(compress)`).

**Problema:** con la cache compressa disabilitata — o, dopo la voce 4, con file oltre
`compression.maxFileSize` anche in config di default — la risposta compressa era
costruita con `pipe()`. Alla disconnessione del client Koa distrugge il body (il
transform zlib), ma `pipe()` non propaga la distruzione alla sorgente: la
`fs.ReadStream` restava in pausa con il file descriptor aperto per sempre (le ReadStream
chiudono il fd solo su `end`/`error`, e per un fd grezzo non esiste finalizzatore GC).
Ogni download interrotto di un file grande = un fd perso → `EMFILE`.

---

### 18. Nessun catch di ultima istanza nel middleware

**Stato: ✅ RISOLTO** (2026-07-08 — try/catch attorno all'intera sezione in cui il
middleware "possiede" la richiesta: dal termine dei pass-through (method / prefix /
urlsReserved, che escono prima) fino al dispatch file/directory. Su errore imprevisto:
log via `_logger.error`, pagina 500 precompilata (`_INTERNAL_ERROR_HTML`) con i security
header delle pagine generate; se gli header sono già partiti, `ctx.res.destroy()` come
nel pattern di `sendTemplateError`. Gli errori dei middleware A VALLE non vengono
mascherati: nessun `next()` è dentro il try (il `next` passato al render template è già
contenuto dal catch dedicato di `tryRenderTemplate`). Test:
`__tests__/error-containment.test.js`; verificato che i test falliscono sul codice
pre-fix.)

**Origine:** voce **B3** di `docs/analisi_robustezza_v3.1.md` (analisi 2026-07-07).

**Problema:** ogni percorso noto era protetto, ma un rejection imprevisto risaliva al
gestore di default di Koa: 500 text/plain **senza** i security header delle pagine
generate e **senza** passare dal `_logger` configurato (finiva su `app.on('error')` /
stderr, invisibile ai logger strutturati dell'operatore).

---

### 19. `new URL()` non protetto nel ramo hideExtension

**Stato: ✅ RISOLTO** (2026-07-08 — try/catch → `sendBadRequest(ctx)` attorno a
`new URL(_origin + ctx.originalUrl)`, coerente con gli altri guard per input client
malformato. Test in `__tests__/error-containment.test.js` con request-target in forma
assoluta e `useOriginalUrl: false`.)

**Origine:** voce **B2** di `docs/analisi_robustezza_v3.1.md` (analisi 2026-07-07).

**Problema:** il prologo del middleware valida l'URL con try/catch (→400), ma con
`useOriginalUrl: false` valida `ctx.url` (riscritto a monte), mentre il ramo
hideExtension ricostruiva `new URL(_origin + ctx.originalUrl)` senza guardia: un
`originalUrl` malformato (es. request-target in forma assoluta `GET http://evil/x.ejs`,
legale in HTTP/1.1) faceva lanciare il costruttore → errore non gestito invece del 400.

---

## Conformità HTTP

### 6. `getClientEncoding` ignora i q-value di Accept-Encoding

**Stato: ✅ RISOLTO** (2026-07-09 — parser minimale come da fix proposto: split su `,`,
estrazione di `;q=`, esclusione degli encoding con `q=0`; l'ordine di preferenza lato
server (`compression.encodings`) continua a decidere il vincitore tra gli encoding
accettabili — i q-value del client servono solo a **escludere**, non a riordinare. In più,
match **esatto** sul token (`x-gzip` non matcha più `gzip`, bug della vecchia
`includes()`) e gestione del wildcard `*` (fornisce il q-value per gli encoding non
elencati; `*;q=0` rifiuta tutto). Test: `__tests__/encoding-negotiation.test.js`.)

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

**Stato: ✅ RISOLTO** (2026-07-09 — `Vary: Accept-Encoding` viene ora settato non appena
la risorsa è *potenzialmente* comprimibile (MIME comprimibile + compressione abilitata +
supera `minFileSize`), **prima** del ramo 304 e indipendentemente da `browserCacheEnabled`.
Così il 304 di qualsiasi variante porta `Vary` (RFC 9110 §15.4.5) e le risposte identity di
contenuti comprimibili lo espongono ai proxy condivisi. Il `ctx.set('Vary', ...)` ridondante
nel ramo compresso è stato rimosso. Il caso imparentato del **fallback su errore di
compressione** è coperto: ora **mantiene** `Vary` (la risorsa resta comprimibile) e
**ripristina l'ETag** alla forma senza suffisso `-gz`/`-br` (`baseEtag`), così il body
identity non viene cachato sotto la chiave della variante compressa. Test:
`__tests__/encoding-negotiation.test.js` e `__tests__/compression-fallback-vary-etag.test.js`.)

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

**Stato: ✅ RISOLTO** (2026-07-10 — il blocco metadati/`Vary`/validatori è stato spostato
**prima** del ramo Range, così `If-None-Match`/`If-Modified-Since` hanno la precedenza su
`Range` come da RFC 9110 §13.2.2 (una richiesta condizionale che matcha ora dà **304 (Not
Modified)**, non **206 (Partial Content)**). Le 206 ora portano `ETag` + `Last-Modified`
(con `browserCacheEnabled`): l'ETag della 206 è `baseEtag` — la rappresentazione parziale
servita è identity, non compressa — mentre le precondizioni si confrontano con `fullEtag`
(encoding-specifico, coerente col #7). `If-Range` resta un confronto strong ed esatto con
`baseEtag`, invariato. Test: `__tests__/conditional-precedence.test.js`.)

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

**Stato: ✅ RISOLTO** (2026-07-10 — nuovo helper `ifNoneMatchSatisfied(headerValue, etag)`
a livello modulo, accanto a `parseRangeHeader`: gestisce `*` (matcha qualsiasi
rappresentazione esistente → 304), le liste separate da virgola (match per singolo
elemento) e il **weak comparison** (prefisso `W/` ignorato su entrambi i lati, come
richiesto dalla RFC per `If-None-Match`). Il vecchio confronto esatto era un caso
particolare di questo, quindi nessuna regressione sul singolo ETag strong. Test:
`__tests__/conditional-precedence.test.js`, describe "If-None-Match parsing".)

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

**Stato: ✅ RISOLTO** (2026-07-08 — su decisione del manutentore, qualsiasi `opts` non
oggetto — **incluso `null` esplicito** — lancia a factory time un errore
`[koa-classic-server] options must be a plain object`; solo il parametro omesso
(`undefined`) dà i default. La factory ora lavora su una shallow copy con copia
annidata dei due soli oggetti mutati in place (`template` e `hideExtension` — il
secondo non era citato nella proposta originale ma viene riscritto per la
normalizzazione di `.ext`/`.redirect`): l'oggetto del chiamante resta intatto e la
stessa config è riusabile su più istanze, incluso il caso `showDirContents` che prima
faceva lanciare la seconda istanza con "both set". Un test esistente
(`template-timeout.test.js`) asseriva il default 30000 *leggendolo dall'oggetto del
chiamante* — cioè asseriva proprio l'effetto collaterale rimosso — ed è stato riscritto
sul contratto nuovo. Test: `__tests__/options-immutability.test.js`, 8 test; verificato
che 7/8 falliscono sul codice pre-fix.)

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

**Stato: ✅ RISOLTO** (2026-07-08 — approccio **deprecation, non breaking**, dopo
ripensamento del manutentore. Il throw su opzioni **v2-stabili** sarebbe un breaking
change su un upgrade minore, e — punto decisivo — normalizzare il valore potrebbe
cambiare in silenzio il comportamento di codice funzionante: un `urlPrefix: '/static/'`
che oggi "funziona" solo perché cade a un handler a valle, se normalizzato farebbe
servire kcs stesso, dirottando le richieste. Quindi: **warn una-tantum + comportamento
runtime invariato**, e throw rimandato alla prossima major.

- Helper `warnConfigDeprecation(logger, msg)` a livello modulo: dedup once-per-process per
  messaggio (evoluzione del pattern `_showDirContentsDeprecationWarned` a più messaggi); il
  messaggio finale è già scritto, in v4 basta trasformare l'helper in `throw`.
- `urlPrefix` slash finale/iniziale → warn, **lasciato com'è** (matcher cade a `next()`
  come oggi). Non-stringa → warn + coercion a `""` (comportamento già presente).
- `urlsReserved` entry con slash mancante / multi-segmento / vuota → warn, **lasciata
  com'è** (non matcha, come oggi). Non-array → warn + coercion a `[]` (già presente).
- **Unica deviazione voluta** (opzione B concordata): entry **non-stringa** → warn +
  **scartata**, perché a request time farebbe `value.substring is not a function` → 500 su
  ogni richiesta (contenuto dal catch B3 ma comunque rotto); scartarla non può rompere
  codice funzionante. La copia dell'array del chiamante non viene mutata.

JSDoc inline aggiornato. Test: `__tests__/url-prefix-reserved-validation.test.js`,
10 test (warn + comportamento invariato + no-mutazione + dedup verificato).

**Nota di consistenza:** lo stesso approccio warn-in-3.x / throw-in-v4 va applicato a
**#12** (`browserCacheMaxAge` negativo), dove il registro già lo prevedeva.)

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

**Stato: ✅ RISOLTO** (2026-07-10 — la condizione che decide se mostrare il link ora è
`pageHrefOutPrefix.pathname !== "/"` (radice **logica** del middleware) invece di confrontare
il path *con prefix* contro la root assoluta. Con `urlPrefix: '/static'`, il listing di
`/static/` non mostra più il link a `/` (fuori dall'albero servito); un sotto-listing
`/static/sub/` punta correttamente a `/static/` (dentro il prefix). Test:
`__tests__/listing-parent-empty.test.js`.)

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

**Stato: ✅ RISOLTO** (2026-07-10, insieme al #20 — **Modello B** concordato col manutentore).
Il check dell'estensione ora usa `requestedPath` (**decodificato**) in modo uniforme, quindi
`/foo%2Eejs` è riconosciuto come `/foo.ejs`. Il **target del redirect** non viene più
costruito affettando `hideExt.length` caratteri dal path *grezzo* (dove il punto poteva
essere `%2E`, 6 caratteri invece di 4, → target rotto `/foo%2`): ora si **decodifica** il
path, si toglie l'estensione nello spazio decodificato (dove è letterale) e si **ri-encoda
per segmento** (`split('/').map(encodeURIComponent).join('/')`). La guardia anti-open-redirect
è stata **spostata dopo** il re-encode (un `%2F` decodificato potrebbe reintrodurre un `//`
iniziale) e i backslash restano sempre encodati (`%5C`), quindi la `Location` non può diventare
protocol-relative — verificato con probe avversariali (`//`, `/\`, `%2F%2F`, `%5C%5C`, `%09//`,
`///`). Test: `__tests__/hideExtension-trailing-slash.test.js`.

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

**Stato: ✅ RISOLTO** (2026-07-07 — sostituito con `rawBuffer.subarray(start, end + 1)`,
stessa semantica zero-copy.)

**Posizione:** `index.cjs:1666` (`rawBuffer.slice(start, end + 1)`).

**Problema:** `Buffer.prototype.slice` è deprecato (DEP0158); `subarray()` ha la stessa
semantica zero-copy ed è l'API raccomandata.

**Fix proposto:** sostituire con `rawBuffer.subarray(start, end + 1)`.

**Priorità:** Bassa (sostituzione meccanica).

---

### 16. Riga "empty folder" assente se tutte le entry sono nascoste

**Stato: ✅ RISOLTO** (2026-07-10 — la riga "empty folder" viene mostrata anche quando
`items.length === 0` **dopo** il filtro hidden (oltre al caso `dir.length === 0` già gestito).
Una directory con sole entry nascoste è così indistinguibile da una vuota — niente tabella
senza righe, e nessun indizio che esistano file nascosti. Test:
`__tests__/listing-parent-empty.test.js`.)

**Posizione:** `index.cjs:1959` (check `dir.length === 0` fatto **prima** del filtro hidden).

**Problema:** se una directory contiene solo entry nascoste (es. tutte matchate da
`alwaysHide`), il listing mostra una tabella senza righe e senza il messaggio
"empty folder" (che appare solo se la directory è fisicamente vuota).

**Fix proposto:** mostrare la riga "empty folder" quando `items.length === 0` dopo il
filtro (oltre al caso `dir.length === 0`).

**Priorità:** Bassa (cosmetico).

---

### 20. `hideExtension`: `/foo.ejs/` (slash finale) redirige a `/foo.` (target rotto)

**Posizione:** ramo hideExtension del redirect (`index.cjs`, costruzione di `redirectPath`
da `originalUrlObj.pathname` seguita da `slice(0, len - hideExt.length)`).

**Stato: ✅ RISOLTO** (2026-07-10 — **Modello B** concordato col manutentore, coerente col #3.
Chiarimento decisivo: dopo il #3 (V4), *lo slash finale = intento-directory*, e un **file**
richiesto con lo slash → **404 (Not Found)**. Quindi `/foo.ejs/` non va più redirette a `/foo`
(assunzione originale del registro, **precedente** al #3) ma cade nel dispatch file/dir dove il
404-file del #3 lo intercetta. Implementazione: il redirect di `hideExtension` è gated su
`!_pathEndsWithSlash` — **lo stesso flag** che usa il 404-file del #3 — così "salta il redirect"
e "404 a valle" sono la stessa condizione. Risultato: `/foo.ejs/` → 404, `/sub/index.ejs/` → 404,
`/foo%2Eejs/` → 404; mentre senza slash `/foo.ejs` → `/foo`, `/foo%2Eejs` → `/foo` (grazie al fix
del target decoded del #14). Con `dirListing.trailingSlash: false` l'escape hatch fa servire il
file (200) ignorando lo slash. Test: `__tests__/hideExtension-trailing-slash.test.js`.)

**Origine:** emersa dalla code review di #3 (2026-07-09) tracciando l'interazione
hideExtension ↔ trailing-slash. **Non** introdotta da #3 (pre-esistente); orthogonale.

**Problema:** con `hideExtension.ext: '.ejs'`, una richiesta `GET /foo.ejs/` (slash finale)
supera il check di estensione — che strippa lo slash solo per il *confronto*
(`pathForExtCheck`) — ma poi costruisce il target del redirect da
`originalUrlObj.pathname` che **conserva** lo slash (`/foo.ejs/`) e vi applica
`slice(0, length - hideExt.length)`: `'/foo.ejs/'.slice(0, 11 - 4)` = `'/foo.'`. Risultato:
`301 Location: /foo.` (URL morto) invece di `/foo`. **Riprodotto** (2026-07-09):
`GET /foo.ejs/` → `301 /foo.`; `GET /foo.ejs` → `301 /foo` (corretto).

Nota positiva emersa dalla stessa analisi: hideExtension e il redirect trailing-slash di #3
**non** collidono — hideExtension ritorna per primo su `/foo.ejs/`, quindi il 404-file di
#3 non lo doppia.

**Fix proposto:** strippare lo slash finale da `redirectPath` prima dello `slice`
dell'estensione (o usare `pathForExtCheck` come base), coprendo con un test
`/foo.ejs/` → `301 /foo`.

**Priorità:** Bassa (caso limite: slash finale su un URL con estensione nascosta).

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
