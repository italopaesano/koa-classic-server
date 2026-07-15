# Revisione completa del codice — v4.3.0

**Data revisione:** 2026-07-14
**Oggetto:** `index.cjs` (intero file, 2993 righe), `index.mjs`, `package.json`, documentazione in `docs/`
**Stato di partenza:** 963 test verdi (54 suite), ESLint pulito
**Registro precedente:** `docs/revisione_codice_v3.1.md` — tutte le 20 voci risolte e spuntate; questo file è il nuovo registro attivo.

Questo file è il **registro ufficiale dei problemi aperti** emersi dalla revisione.
Ogni voce ha una checkbox nell'indice: va spuntata (`[x]`) quando la tematica viene
affrontata e risolta (o consapevolmente chiusa come "wontfix", annotandolo nella voce).

> I riferimenti a righe di codice (`index.cjs:NNNN`) fotografano lo stato al commit
> della revisione e potrebbero slittare con le modifiche successive.

---

## Indice / Checklist

### Bug confermati (riprodotti con richieste reali)
- [x] [1. File con nome non-latin1 (CJK, emoji) → 500 invece di 200](#1-file-con-nome-non-latin1-cjk-emoji--500-invece-di-200) — **RISOLTO** (fallback quoted-string sanitizzato a latin1 stampabile)
- [ ] [2. Link di ordinamento e paginazione del listing perdono `urlPrefix`](#2-link-di-ordinamento-e-paginazione-del-listing-perdono-urlprefix)
- [ ] [3. `If-Modified-Since` non ignorato quando `If-None-Match` è presente](#3-if-modified-since-non-ignorato-quando-if-none-match-è-presente)

### Robustezza (da lettura del codice, non riprodotti)
- [ ] [4. `refreshOrInsert` con snapshot stale può doppio-inserire la stessa chiave (contabilità LFU corrotta)](#4-refreshorinsert-con-snapshot-stale-può-doppio-inserire-la-stessa-chiave-contabilità-lfu-corrotta)

### Minori / hardening / cosmetici
- [ ] [5. Il listing esce senza alcun `Cache-Control`](#5-il-listing-esce-senza-alcun-cache-control)
- [ ] [6. Link assoluti del listing costruiti dall'header `Host` del client](#6-link-assoluti-del-listing-costruiti-dallheader-host-del-client)
- [ ] [7. `ctx.set('Vary', ...)` sovrascrive un `Vary` preesistente](#7-ctxsetvary--sovrascrive-un-vary-preesistente)
- [ ] [8. `formatSize` oltre il TB produce "N undefined"](#8-formatsize-oltre-il-tb-produce-n-undefined)
- [ ] [9. `hideExtension.redirect` accetta qualsiasi numero](#9-hideextensionredirect-accetta-qualsiasi-numero)
- [ ] [10. `template.ext` con punto iniziale non matcha mai, in silenzio](#10-templateext-con-punto-iniziale-non-matcha-mai-in-silenzio)
- [ ] [11. `parseRangeHeader`: `parseInt` lassista su spec malformate](#11-parserangeheader-parseint-lassista-su-spec-malformate)
- [ ] [12. Parametri query ripetuti (`?sort=a&sort=b`) degradano in silenzio](#12-parametri-query-ripetuti-sortasortb-degradano-in-silenzio)
- [ ] [13. Validazione incoerente (silenzio vs throw) in `serverCache` / `compression`](#13-validazione-incoerente-silenzio-vs-throw-in-servercache--compression)

### Aggiunte 2026-07-15 (follow-up del #1 — audit "encoder totali")
- [x] [14. `encodeURIComponent` non è totale: lone surrogate → 500 (Windows)](#14-encodeuricomponent-non-è-totale-lone-surrogate--500-windows) — **RISOLTO** (`toWellFormedName` prima di ogni encode)
- [x] [15. Spoofing visivo nel listing con caratteri bidi/invisibili](#15-spoofing-visivo-nel-listing-con-caratteri-bidiinvisibili) — **RISOLTO** (U+FFFD visibile + `<bdi>` nella sola resa)

---

## Bug confermati

### 1. File con nome non-latin1 (CJK, emoji) → 500 invece di 200

**Stato: ✅ RISOLTO** (2026-07-14 — fallback quoted-string sanitizzato: i caratteri
fuori dal latin1 stampabile (`[^\x20-\x7E\xA0-\xFF]` — controlli C0/C1, DEL, e tutto
ciò che è > `0xFF`) diventano `?`, stessa policy del pacchetto `content-disposition`
di express/send; i nomi latin1 (`café.txt`) restano letterali come prima — zero
regressione sul range già funzionante. Il nome vero continua a round-trippare via
`filename*` RFC 5987, che era già corretto. Test:
`__tests__/content-disposition-filename.test.js`, 10 test (CJK, emoji, carattere di
controllo, latin1 invariato, escaping `"`/`\`, 206 Range, nessun errore loggato);
verificato che 8/10 falliscono sul codice pre-fix.)

**Posizione:** `index.cjs:1789-1799` (`buildContentDisposition`), usato in `index.cjs:2381` (206) e `index.cjs:2411` (200/streaming).

**Problema:** il fallback quoted-string di `Content-Disposition` mantiene i caratteri
del filename così come sono (`asciiSafe` escapa solo `"` e `\`). Node valida i valori
header con `checkInvalidHeaderChar`: qualunque code point > `0xFF` (CJK, emoji, molte
lingue non europee) fa lanciare `ctx.set(...)` con `ERR_INVALID_CHAR`. L'errore risale
al catch di ultima istanza → **500** (con log di errore per ogni richiesta). Il commento
della funzione dichiara "the value is always valid ASCII", ma non è vero: solo `"` e
`\` vengono trattati.

È una violazione diretta del contratto primario del middleware ("se il file esiste,
`GET` sul suo path lo restituisce"): il file compare nel listing (i link usano
`encodeURIComponent`, corretti) ma cliccarlo dà 500. I nomi latin1 (es. `café.txt`,
≤ `0xFF`) funzionano — il problema colpisce esattamente i nomi oltre latin1.

**Riproduzione (verificata):** file `中文ファイル.txt` in rootDir; `GET /%E4%B8%AD%E6%96%87...`
→ **500** + `[koa-classic-server] Unexpected error...` nel log. `café.txt` → 200.

**Fix proposto:** rendere il fallback davvero ASCII-safe, mantenendo intatto il
`filename*` RFC 5987 (già corretto, e i browser lo preferiscono):

```js
const asciiSafe = filename
    .replace(/[^\x20-\x7E]/g, '?')      // fuori dall'ASCII stampabile → '?'
    .replace(/\\/g, '\\\\').replace(/"/g, '\\"');
```

(equivale alla strategia del pacchetto `content-disposition` usato da express/send).
Test: filename CJK, emoji, e con caratteri di controllo; asserire 200 e che
`filename*` round-trippi il nome vero.

**Priorità:** Alta (contratto primario violato; fix a due righe).

---

### 2. Link di ordinamento e paginazione del listing perdono `urlPrefix`

**Posizione:** `index.cjs:2677` (`const baseUrl = pageHrefOutPrefix.pathname`),
usato da `buildQueryUrl` (`index.cjs:2680-2686`) e `getSortUrl` (`index.cjs:2688-2694`).

**Problema:** i link delle intestazioni di colonna (Name/Type/Size) e del paginatore
sono costruiti dal pathname **senza prefix** (`pageHrefOutPrefix`), mentre il link
"Parent Directory" e i link alle entry usano `pageHref` (**con** prefix). Con
`urlPrefix: '/static'`, il listing di `/static/sub/` emette
`href="/sub?sort=name&order=desc"` e `href="/sub?page=1"`: URL fuori dall'albero
servito → 404 o route di un altro handler. Ordinamento e paginazione sono
inutilizzabili sotto prefix.

**Riproduzione (verificata):** `urlPrefix: '/static'`, `GET /static/sub/` → i link
sort/page nel body puntano a `/sub?...`.

**Perché i test non lo rilevano:** `directory-sorting-links.test.js` e i test di
paginazione non usano mai `urlPrefix` (l'unico incrocio listing×prefix testato è il
link Parent Directory, voce #13 del registro v3.1).

**Fix proposto:** usare `pageHref.pathname` (che conserva il prefix) come `baseUrl`.
Nell'occasione valutare di riappendere lo slash finale (il pathname è già stato
strippato dello slash per il parsing): oggi ogni click su sort/page anche SENZA prefix
costa un hop `301 /sub?sort=... → /sub/?sort=...` per il redirect canonico (la query
sopravvive, quindi funziona, ma è un round-trip evitabile su ogni click).

**Priorità:** Media (funzionalità rotta, ma solo nella combinazione listing + urlPrefix).

---

### 3. `If-Modified-Since` non ignorato quando `If-None-Match` è presente

**Posizione:** `index.cjs:2334-2351` (blocco validatori in `loadFile`).

**Problema:** RFC 9110 §13.1.3: *"A recipient MUST ignore If-Modified-Since if the
request contains an If-None-Match header field"*. Il codice invece, quando
`If-None-Match` è presente ma **non** matcha, cade nel check di `If-Modified-Since`
e può rispondere 304. L'ETag è il validatore forte: se non matcha, il client ha una
rappresentazione diversa e deve ricevere 200.

**Caso concreto:** file modificato due volte nello stesso secondo con cambio di
dimensione → l'ETag cambia (`mtime-size`) ma i secondi dell'mtime no; un client con
l'ETag vecchio e il `Last-Modified` vecchio (stesso secondo) riceve **304** e resta
con il contenuto stale. Lo stesso vale per il suffisso encoding (`-br`/`-gz`): un
client la cui variante negoziata cambia manda un ETag che non matcha, ma la data sì.

**Riproduzione (verificata):** `browserCacheEnabled: true`;
`If-None-Match: "stale-etag"` + `If-Modified-Since: <Last-Modified reale>` → **304**
(atteso 200).

**Fix proposto:** valutare `If-Modified-Since` solo quando l'header `If-None-Match`
è assente:

```js
const inm = ctx.get('If-None-Match');
if (inm) {
    if (ifNoneMatchSatisfied(inm, fullEtag)) { ctx.status = 304; return; }
} else {
    const clientModifiedSince = ctx.get('If-Modified-Since');
    ...
}
```

**Priorità:** Media (non-conformità RFC con scenario di stale-content reale, fix piccolo).

---

## Robustezza

### 4. `refreshOrInsert` con snapshot stale può doppio-inserire la stessa chiave (contabilità LFU corrotta)

**Posizione:** `index.cjs:644-653` (`refreshOrInsert`); call site critici:
callback del tee (`index.cjs:2507-2523`), leader raw (`index.cjs:2236-2245`),
leader compressione bufferizzata (`index.cjs:2543-2554`). Concausa:
`LFUCache.set()` (`index.cjs:493-516`) assume che la chiave non esista.

**Problema:** `refreshOrInsert` decide se fare `delete` in base a `cached`, lo
**snapshot** preso a inizio richiesta (`peek`). Nel percorso tee lo snapshot può
essere vecchio di minuti (streaming di file grandi): se nel frattempo un'altra
richiesta ha inserito un'entry per la **stessa** `cacheKey` (file modificato →
teeKey diverso → secondo leader; oppure file rimpicciolito sotto
`compression.maxFileSize` → insert dal percorso bufferizzato), il callback del primo
leader arriva con `cached === undefined`, **salta il delete** e chiama
`set()` su una chiave già presente. Conseguenze in `LFUCache`:

1. `currentSize += buffer.length` senza sottrarre l'entry sovrascritta →
   dimensione contabile gonfiata per sempre → evizioni premature ("cache piena"
   fittizia);
2. la chiave resta anche nel freq-bucket vecchio (se l'entry sovrascritta aveva
   `freq > 1`) e viene aggiunta al bucket 1 → chiave fantasma: quando
   `_evictOne()` pesca il fantasma, `this._keyMap.get(evictKey)` è `undefined` e la
   destrutturazione `const { buffer } = ...` lancia un TypeError. Nel callback della
   pipeline (tee) quel throw è fuori da ogni try della richiesta →
   **uncaughtException** potenziale.

La stessa finestra esiste, molto più stretta, per i leader single-flight raw e
bufferizzato (due versioni del file in volo simultaneamente: chiavi in-flight
diverse, stessa chiave cache).

**Fix proposto (due cinture):**
1. in `refreshOrInsert`, delete **incondizionato** prima del `set`
   (`cache.delete(key)` è già un no-op sicuro se la chiave manca) — una riga;
2. difensivamente, in `LFUCache.set()`, se la chiave esiste già fare `this.delete(key)`
   in testa, così l'invariante "set = chiave nuova" vale per qualunque chiamante futuro.

Test: unit test su `_internals.LFUCache`/`refreshOrInsert` che simuli
set → set stessa chiave via `refreshOrInsert` con `cached` stantio e asserisca
`currentSize` corretto e nessuna chiave in due bucket.

**Priorità:** Media (race rara ma con esito grave — contabilità permanentemente
corrotta e crash potenziale; fix a bassissimo rischio).

---

## Minori / hardening / cosmetici

### 5. Il listing esce senza alcun `Cache-Control`

**Posizione:** `show_dir` (`index.cjs:2642+`) / `setGeneratedPageHeaders` (`index.cjs:128-134`).

**Problema:** le risposte file impostano sempre una policy esplicita (pubblica con
`browserCacheEnabled: true`, `no-cache/no-store` altrimenti, proprio per evitare
l'heuristic caching — `index.cjs:2271-2279`). Il listing invece non emette nessun
header di caching: browser e shared cache possono applicarvi heuristic caching, su
una pagina che cambia col contenuto della directory (e che riflette `Host`, vedi #6).

**Fix proposto:** in `show_dir` (o in `setGeneratedPageHeaders` per tutte le pagine
generate non-errore) emettere la stessa coppia di rami usata per i file: no-cache di
default; con `browserCacheEnabled: true` valutare se una policy pubblica abbia senso
per il listing o tenerlo comunque no-cache (più semplice e sempre corretto).

**Priorità:** Bassa (comportamento non deterministico dei cache intermedi, nessuna
rottura diretta).

---

### 6. Link assoluti del listing costruiti dall'header `Host` del client

**Posizione:** `index.cjs:2724` (`currentPath = pageHref.origin + ...`),
`index.cjs:2738-2739` (`_listingBaseUrl`/`_listingOriginPrefix`), item URI
`index.cjs:2754-2757`.

**Problema:** Parent Directory e link alle entry sono URL **assoluti** che
incorporano `pageHref.origin`, cioè protocollo+`Host` della richiesta
(client-controlled). L'output è escapato (nessuna XSS), ma con `Host` forgiato i
link puntano a `http://evil.example/...`; combinato con una shared cache che
cachea il listing (possibile per il #5) diventa una superficie di cache poisoning.
Verificato: `GET /sub/` con `Host: evil.example` → `href="http://evil.example"`.

**Fix proposto:** emettere path-relative o path-absolute URL (solo pathname, senza
origin): il browser li risolve contro l'origin reale della pagina. Elimina la
riflessione di `Host` e accorcia l'HTML. In alternativa, documentare in
`SECURITY_HARDENING.md` che il reverse proxy deve validare `Host` (probabilmente
già raccomandato — verificare e linkare).

**Priorità:** Bassa (hardening; nessun exploit diretto senza una cache condivisa
mal configurata).

---

### 7. `ctx.set('Vary', ...)` sovrascrive un `Vary` preesistente

**Posizione:** `index.cjs:2320-2322`.

**Problema:** un middleware a monte che avesse già impostato `Vary` (es.
`Vary: Origin` da un layer CORS che poi delega) se lo vede sovrascrivere con
`Accept-Encoding`. Koa espone `ctx.vary()` che appende deduplicando.

**Fix proposto:** `ctx.vary('Accept-Encoding')`.

**Priorità:** Bassa.

---

### 8. `formatSize` oltre il TB produce "N undefined"

**Posizione:** `index.cjs:366-375`.

**Problema:** `sizes` finisce a `'TB'`; per un file ≥ 1 PB l'indice esce
dall'array → `"2 undefined"` nel listing. Verificato via `_internals.formatSize(2**51)`.

**Fix proposto:** clampare l'indice (`Math.min(i, sizes.length - 1)`) o aggiungere
`'PB'`/`'EB'`.

**Priorità:** Bassa (cosmetico, file irrealistici — ma fix a una riga).

---

### 9. `hideExtension.redirect` accetta qualsiasi numero

**Posizione:** `index.cjs:1116-1122`.

**Problema:** la validazione controlla solo `typeof === 'number'`: `redirect: 200`,
`404`, `3.14`, `999` passano la factory. A request time Koa (in `ctx.redirect`)
sostituisce silenziosamente gli status non-redirect con 302 → l'operatore crede di
avere un 200/404 e ottiene un 302 senza alcun avviso.

**Fix proposto:** validare a factory time intero ∈ [300, 399] (o whitelist
301/302/303/307/308) con l'errore-con-hint standard.

**Priorità:** Bassa (footgun di configurazione).

---

### 10. `template.ext` con punto iniziale non matcha mai, in silenzio

**Posizione:** `index.cjs:293-294` (match: `path.extname(...).slice(1)` → senza
punto), `index.cjs:1050` (normalizzazione: nessun trattamento del punto).

**Problema:** la forma documentata è senza punto (`ext: ['ejs']`), ma
`hideExtension.ext` usa la forma **col** punto (`'.ejs'`) e la normalizza pure
aggiungendolo se manca. Un operatore che per coerenza scrive
`template: { ext: ['.ejs'] }` ottiene un middleware che non renderizza mai i
template, senza alcun segnale.

**Fix proposto:** normalizzare a factory time (strip del punto iniziale con warn
una-tantum, speculare al warn di `hideExtension.ext`).

**Priorità:** Bassa (DX; fix piccolo).

---

### 11. `parseRangeHeader`: `parseInt` lassista su spec malformate

**Posizione:** `index.cjs:395-437`.

**Problema:** `parseInt` accetta prefissi numerici: `Range: bytes=1x-5y` viene
trattato come `1-5` → 206, mentre per RFC 9110 §14.2 una spec malformata va
ignorata (→ 200 full). Nessun rischio (i bound restano validati), pura
non-conformità sugli input garbage.

**Fix proposto:** validare con regex `^\d+$` / `^\d*-\d*$` prima del parse.

**Priorità:** Bassa.

---

### 12. Parametri query ripetuti (`?sort=a&sort=b`) degradano in silenzio

**Posizione:** `index.cjs:2674-2675` (`ctx.query.sort` può essere un array),
`index.cjs:2682-2683` (`encodeURIComponent(array)` → valori uniti da virgola nei link).

**Problema:** con parametri ripetuti `sortBy` diventa un array: nessun crash (i
confronti falliscono e il sort è un no-op), ma i link rigenerati contengono
`sort=a%2Cb`. Robustezza spicciola.

**Fix proposto:** normalizzare all'ingresso: `const sortBy = Array.isArray(q.sort) ? q.sort[0] : ...`.

**Priorità:** Bassa.

---

### 13. Validazione incoerente (silenzio vs throw) in `serverCache` / `compression`

**Posizione:** `index.cjs:1463-1483` (`rawFile.maxSize`/`maxFileSize`,
`compressedFile.maxSize`), `index.cjs:1387-1394` (`compression.minFileSize`/`maxFileSize`).

**Problema:** nello stesso namespace convivono due filosofie: `maxAge`,
`maxEntrySize`, `buffered`/`streaming` (quality) **lanciano** con messaggio-hint,
mentre `maxSize: -5`, `maxFileSize: '10'`, `minFileSize: -1` cadono **in silenzio**
sul default. È la stessa classe del vecchio #12 (registro v3.1): un valore errato
va segnalato.

**Fix proposto:** allineare i fallback silenziosi al pattern `warnConfigDeprecation`
(warn ora, throw nella prossima major), come già fatto per `browserCacheMaxAge`.

**Priorità:** Bassa (coerenza DX).

---

## Aggiunte 2026-07-15 (follow-up del #1 — audit "encoder totali")

Dal brainstorming successivo alla chiusura del #1 (approccio globale: a ogni confine
di output un encoder **totale** — definito e sicuro per qualunque nome il filesystem
consenta — invece di un set di caratteri ammesso, che sarebbe una *restriction* per
la design philosophy). La rete di regressione è la nuova suite
`__tests__/adversarial-filenames.test.js` (~50 nomi × GET diretto + round-trip
`filename*` + click-through dal listing, gate NTFS dichiarativi e test-sentinella
sulla creazione delle fixture). L'audit dei confini ha trovato due lacune residue:

### 14. `encodeURIComponent` non è totale: lone surrogate → 500 (Windows)

**Stato: ✅ RISOLTO** (2026-07-15 — helper module-level `toWellFormedName(name)`:
usa `String.prototype.toWellFormed()` quando disponibile (Node ≥ 20) e altrimenti
il fallback regex sui surrogate spaiati → U+FFFD (Node 18, `engines: >=18`).
Applicato ai due encoder raggiungibili dai nomi file: `itemUri` del listing e
`buildContentDisposition` (hoistata a livello modulo, ora pura e unit-testabile;
il fallback quoted-string era già totale per costruzione). Il redirect
hideExtension non è toccato: il suo input passa da `decodeURIComponent`, che
non può produrre surrogate spaiati (encoding invalido → 400 a monte). Esito su
Windows per un nome WTF-16: la entry appare nel listing con U+FFFD e il suo
href risponde 404 — l'unico esito possibile, dato che un lone surrogate non ha
alcuna rappresentazione percent-encoded valida; prima l'intero listing era un
500. Test: describe `#14` in `__tests__/adversarial-filenames.test.js` (unit
level — le fixture POSIX non possono contenere WTF-16 — incluso il ramo
fallback Node 18 via shadow del metodo nativo); verificato che falliscono sul
codice pre-fix.)

**Posizione:** listing (`itemUri`, `index.cjs` ~2755), redirect hideExtension
(re-encode per segmento, `index.cjs` ~2041); stessa famiglia il `filename*` di
`buildContentDisposition` (`index.cjs` ~1795).

**Problema:** `encodeURIComponent` lancia `URIError` sui surrogate spaiati
(verificato). Su Linux non possono arrivare dai nomi file (Node decodifica i byte
UTF-8 invalidi in U+FFFD), ma su **Windows i filename sono WTF-16** e possono
contenere surrogate spaiati: un file così rende il listing della sua directory un
500 e il file non servibile — stessa classe del #1, un livello più in basso.
Non riproducibile da fixture su Linux/macOS: va coperto con unit test sull'helper.

**Fix proposto:** normalizzare i nomi con `String.prototype.toWellFormed()` prima
di ogni `encodeURIComponent` (helper condiviso; Node ≥ 20 — per Node 18, dichiarato
in `engines`, fallback regex sui surrogate spaiati → U+FFFD).

**Priorità:** Bassa (solo Windows, nomi rarissimi) ma fix piccolo e strutturale.

### 15. Spoofing visivo nel listing con caratteri bidi/invisibili

**Stato: ✅ RISOLTO** (2026-07-15 — mitigazione **solo di resa**, file/href/`filename*`
byte-exact invariati (coperto dal corpus avversariale). Due cinture:
1. `listingDisplayName()`: i controlli bidi espliciti (U+202A–U+202E,
   U+2066–U+2069) diventano un U+FFFD **visibile** nel nome mostrato —
   `evil‮txt.exe` si mostra come `evil�txt.exe`, spoofing disinnescato.
   I direction mark (U+200E/U+200F), legittimi nei nomi RTL, restano intatti.
2. nome avvolto in `<bdi>` (fuori dall'`<a>`, così l'HTML interno del link resta
   `>nome</a>` e l'isolamento copre anche l'etichetta symlink): il run
   direzionale di un nome RTL legittimo non sanguina più sul resto della riga.
Niente modifiche a CSS/CSP. Test: describe `#15` in
`__tests__/adversarial-filenames.test.js`; verificato che falliscono sul codice
pre-fix.)

**Posizione:** righe del listing (`show_dir`, nomi in `escapeHtml`), CSS
`LISTING_CSS`.

**Problema:** un nome con override bidi (es. U+202E RLO: `evil‮txt.exe` viene
**visualizzato** come `evilexe.txt` circa) o zero-width può ingannare l'utente del
listing sul vero nome/estensione del file. Nessun problema tecnico (serving e
href corretti — coperti dalla suite avversariale), solo resa visiva.

**Fix proposto:** isolare la resa del nome: `unicode-bidi: isolate` sulla cella
nome in `LISTING_CSS` (l'hash CSP si aggiorna da solo) oppure avvolgere il nome in
`<bdi>`. Valutare se estendere l'isolamento anche alla riga "Parent Directory".

**Priorità:** Bassa (UI-only).

### Ricetta hardening opt-in (documentazione, non default)

Per gli operatori che vogliono davvero un set di nomi ammesso, la capacità esiste
già senza nuovo codice: `hidden: { alwaysHide: [/[^\x20-\x7E\xA0-\xFF]/] }` nasconde
(404 + esclusione dal listing) ogni nome fuori dal latin1 stampabile.
**Fatto (2026-07-15):** documentata come §3.12 di `SECURITY_HARDENING.md`
(verificata end-to-end: nome CJK → 404 e assente dal listing, latin1 → 200).

---

## Punti di forza rilevati (nessuna azione richiesta)

Registrati per completezza della revisione:

- Tutte le 20 voci del registro v3.1 risultano effettivamente implementate come
  descritto (verificato sul codice, non solo sulle checkbox).
- **Single-flight** ben fatto: chiavi che includono mtime+size (coerenza
  validatori/bytes), errore condiviso tra i waiter, cleanup nel `finally`.
- **Tee streaming** con doppio budget (per-entry e aggregato `_inflightTeeBytes`),
  leader unico per versione di file, nessun insert su stream troncato.
- **Error containment** completo: catch di ultima istanza, scrub degli header di
  rappresentazione sulle error page (`ERROR_PAGE_SCRUB_HEADERS`), `no-store` sui 5xx,
  `ctx.res.destroy()` a header partiti.
- Pagine d'errore custom con refresh mtime/size senza riavvio e fallback throttled.
- Gestione HEAD accurata su tutti i rami (incluso il mirror RFC 9110 §9.3.2 nel
  render template e il 200-senza-Content-Length sul ramo streaming).
- Percorsi traversal/symlink/hidden invariati e solidi (decode→null-byte→normalize→
  boundary check; 404 indistinguibile).
- Documentazione onesta sui trade-off (Caso 3 di `dirListing.enabled`, caveat
  `useOriginalUrl` + `trailingSlash`, requisito self-contained delle error page).
- Suite di 963 test / 54 suite, lint pulito.
