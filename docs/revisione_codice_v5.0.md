# Revisione completa del codice — v5.0.0

**Data revisione:** 2026-07-19
**Oggetto:** `index.cjs` (intero file, 3228 righe), `index.mjs`, `package.json`, documentazione in `docs/`
**Stato di partenza:** 1249 test verdi (61 suite), ESLint pulito
**Registro precedente:** `docs/revisione_codice_v4.3.md` — tutte le 16 voci risolte e spuntate; questo file è il nuovo registro attivo.

Questo file è il **registro ufficiale dei problemi aperti** emersi dalla revisione.
Ogni voce ha una checkbox nell'indice: va spuntata (`[x]`) quando la tematica viene
affrontata e risolta (o consapevolmente chiusa come "wontfix", annotandolo nella voce).

> I riferimenti a righe di codice (`index.cjs:NNNN`) fotografano lo stato al commit
> della revisione e potrebbero slittare con le modifiche successive.

**Esito complessivo:** il codice è in ottimo stato. Le 16 voci del registro v4.3 e
le 20 del registro v3.1 risultano effettivamente implementate come descritto
(verificato leggendo il codice, non solo le checkbox). I primi due punti emersi
sono **minori** — nessuno dei due è un bug di correttezza: il comportamento servito
non è mai *sbagliato*, solo sub-ottimale o non uniforme rispetto a una decisione già
presa altrove nel codice. Entrambi sono chiusi: il **#1** risolto (opzione A —
`no-store` su ogni error page), il **#2** chiuso come **wontfix documentato**
(opzione A — solo validatore forte per `If-Range`, degrado sicuro al 200).

Un terzo punto (**#3**) è emerso in seguito, indagando perché un test di
robustezza andava in timeout: un body-stream che fallisce **dopo** l'invio degli
header lascia il socket aperto (client appeso fino a `requestTimeout`, 5 min). È
l'unico dei tre con impatto non trascurabile (disponibilità / resource-leak, non
integrità), ma è **specifico di Koa 2** — verificato a runtime che **Koa 3 non è
affetto** (il suo `respond()` usa `Stream.pipeline`, che chiude il socket).
**Risolto** dalla decisione del manutentore di **togliere il supporto a Koa 2 in
v5.0.0** (`peerDependencies.koa: ">=3.1.2"`): la classe di bug è eliminata alla
radice sulla piattaforma supportata, senza portare una toppa per un framework
major non più target. Nella stessa release è stato tolto anche il supporto a
**Node 18** (`engines.node: ">=20"`), permettendo di usare
`String.prototype.toWellFormed()` senza fallback.

**Seconda passata (2026-07-20) — focus sui nuovi requisiti V5 (Koa ≥ 3, Node ≥ 20).**
Rilettura integrale di `index.cjs` con la lente del cambio di piattaforma:
residui di compatibilità Koa 2 / Node 18 da rimuovere, comportamenti che
cambiano su Koa 3, API Node 20 non sfruttate. Baseline: `npm run test:ci`
verde su **Koa 3.2.1 / Node 22** (60 suite, 1243 test; la 61ª suite è
`performance`, esclusa da `test:ci`). Esito: **nessuno shim Koa-2-specifico
residuo nel codice** (il middleware è agnostico rispetto alla major del
framework; i punti sensibili — restore del `Content-Length` sugli HEAD,
`ctx.status` prima di `ctx.redirect()`, teardown degli stream — valgono
identici su Koa 3, verificati sul sorgente 3.2.1 e a runtime); README,
`docs/DOCUMENTATION.md`, CHANGELOG e matrice CI già allineati ai nuovi
requisiti. Emergono due nuove voci: **#4** (artefatti di release non
rigenerati dopo il bump: `package-lock.json` dichiara ancora i vincoli
pre-V5) e **#5** (su Koa 3 il ramo `sendErrorPageSync(ctx, 500)` dei gestori
di stream-error è irraggiungibile lato client: un errore in apertura dello
stream produce ECONNRESET, mai la pagina 500). **Entrambe risolte il
2026-07-20** (#4: lock rigenerato; #5: opzione A, pre-open del file
descriptor — dettagli nelle rispettive voci). Le verifiche senza azione
sono registrate in fondo, sotto *Verifiche della seconda passata*.

**Terza passata (2026-07-20) — revisione completa da sessione separata.**
Rilettura integrale di `index.cjs` (3287 righe) con verifica sul codice di tutti
i registri precedenti (v3.1 / v4.3 / v5.0 #1–#5): tutti confermati implementati
come descritto. Baseline verde (60 suite / 1249 test, lint pulito, coverage
98.46% stmts / 98.34% branch / 99% funcs / 98.49% lines, sopra soglia). Emerge
**una sola voce nuova, #6** (minore, conformità): `Accept-Ranges: bytes` è
annunciato anche sulle risposte compresse, ma un Range su quella URL è servito
dalla rappresentazione identity — sicuro per i client conformi e per chi usa
`If-Range`, ma divergente da nginx. **Chiusa come wontfix documentato (opzione A)**
il 2026-07-20: nessuna modifica al codice; comportamento documentato in
`docs/DOCUMENTATION.md` (sottosezione *"Richieste Range e `If-Range`"*), coerente
con la chiusura del #2. Nessun altro problema di correttezza, disponibilità o
integrità rilevato.

---

## Indice / Checklist

### Minori / conformità / coerenza
- [x] [1. Le pagine d'errore 404 escono senza alcun `Cache-Control` (heuristic caching di un 404)](#1-le-pagine-derrore-404-escono-senza-alcun-cache-control-heuristic-caching-di-un-404) — **RISOLTO** (opzione A: `no-store` su ogni error page, non solo ≥ 500)
- [x] [2. `If-Range` in forma data non onorato → 200 pieno invece di 206](#2-if-range-in-forma-data-non-onorato--200-pieno-invece-di-206) — **CHIUSO / WONTFIX** (opzione A: solo validatore forte per `If-Range`; degrado sicuro al 200; documentato)

### Robustezza / disponibilità
- [x] [3. Errore di un body-stream dopo l'invio degli header → socket mai chiuso, client appeso fino a `requestTimeout` (5 min)](#3-errore-di-un-body-stream-dopo-linvio-degli-header--socket-mai-chiuso-client-appeso-fino-a-requesttimeout-5-min) — **RISOLTO** togliendo il supporto a Koa 2 in v5.0.0 (era specifico di Koa 2; Koa 3 chiude il socket via `Stream.pipeline`)

### Seconda passata (2026-07-20) — focus Koa ≥ 3 / Node ≥ 20
- [x] [4. `package-lock.json` non rigenerato dopo il bump dei requisiti V5 (dichiara ancora `node >=18` e `koa ^2.16.4 || >=3.1.2`)](#4-package-lockjson-non-rigenerato-dopo-il-bump-dei-requisiti-v5-dichiara-ancora-node-18-e-koa-2164--312) — **RISOLTO** (lock rigenerato con `npm install --package-lock-only`; solo i due campi root, nessuna nuova entry; allineata anche la tabella in `security_improvement_for_V3.md`)
- [x] [5. Su Koa 3 la pagina 500 dei gestori stream-error è irraggiungibile: errore in apertura dello stream → ECONNRESET al client, log duplicato su stderr](#5-su-koa-3-la-pagina-500-dei-gestori-stream-error-è-irraggiungibile-errore-in-apertura-dello-stream--econnreset-al-client-log-duplicato-su-stderr) — **RISOLTO** (opzione A: pre-open via `fs.promises.open` + `fs.createReadStream(path, { fd })`; errore di apertura → 404 pulita con `errorPages` onorate; ramo morto `sendErrorPageSync` rimosso)

### Terza passata (2026-07-20) — revisione completa (sessione separata)
- [x] [6. `Accept-Ranges: bytes` annunciato sulle risposte compresse, mentre il Range è servito dalla rappresentazione identity](#6-accept-ranges-bytes-annunciato-sulle-risposte-compresse-mentre-il-range-è-servito-dalla-rappresentazione-identity) — **CHIUSO / WONTFIX** (opzione A: comportamento sicuro per i client conformi; nessuna modifica al codice; documentato in `docs/DOCUMENTATION.md`)

### Quarta passata (2026-08-07) — segnalazione esterna sul dispatch directory
- [x] [7. `dirListing.enabled: false` inghiotte anche il file index: una directory con `index.html` risponde 404](#7-dirlistingenabled-false-inghiotte-anche-il-file-index-una-directory-con-indexhtml-risponde-404) — **RISOLTO in 5.2.0** (dispatch ristrutturato con `resolveIndexFile()`; indice risolto prima del redirect quando il listing è off; suite di regressione dedicata)

### Quinta passata (2026-08-07) — revisione della copertura dei test
- [x] [8. Listing: `?order=` con valore non riconosciuto ordina in modo ASCENDENTE ma disegna la freccia DISCENDENTE](#8-listing-order-con-valore-non-riconosciuto-ordina-in-modo-ascendente-ma-disegna-la-freccia-discendente) — **RISOLTO** (normalizzazione unica di `sortOrder` a `'asc' | 'desc'`)
- [ ] [9. `loadFile()`: il ramo `if (!fileStat)` è irraggiungibile — entrambi i call site passano già lo stat](#9-loadfile-il-ramo-if-filestat-è-irraggiungibile--entrambi-i-call-site-passano-già-lo-stat) — **APERTO** (nessun impatto funzionale; decisione del manutentore: rimuovere o marcare come difensivo)

### Sesta passata (2026-08-22) — conformità HEAD (RFC 9110 §9.1 / §9.3.2)
- [x] [10. Il default `method: ['GET']` rende il server non conforme: `HEAD` risponde 404 su OGNI path mentre `GET` risponde 200](#10-il-default-method-get-rende-il-server-non-conforme-head-risponde-404-su-ogni-path-mentre-get-risponde-200) — **RISOLTO in 5.3.0** (default `['GET', 'HEAD']`; normalizzazione maiuscola; matrice di parità HEAD/GET verificata per mutazione; documentazione riscritta)
- [ ] [11. `method` era l'unica opzione a valori enumerati senza guardia: verificare che non ce ne siano altre](#11-method-era-lunica-opzione-a-valori-enumerati-senza-guardia-verificare-che-non-ce-ne-siano-altre) — **PARZIALE**: `method` chiuso in 5.3.0 (maiuscolo forzato + voci inutilizzabili scartate, entrambi segnalati); resta l'audit sulle opzioni a forma libera
- [ ] [12. Con un `Transfer-Encoding` impostato da un middleware a monte, i rami statici emettono anche `Content-Length` (illegale, RFC 9112 §6.1)](#12-con-un-transfer-encoding-impostato-da-un-middleware-a-monte-i-rami-statici-emettono-anche-content-length-illegale-rfc-9112-61) — **APERTO** (preesistente e simmetrico GET/HEAD, quindi non una violazione di §9.3.2)
- [ ] [13. `stripBodyForHead()` reimplementa il dimensionamento del body di Koa: valutare di eliminarla](#13-stripbodyforhead-reimplementa-il-dimensionamento-del-body-di-koa-valutare-di-eliminarla) — **APERTO** (rimuove alla radice una classe di difetti recidiva, ma reintroduce un costo: da misurare prima di procedere)

### Settima passata (2026-09-01) — copertura: configurazioni e combinazioni non testate
- [x] [14. `hidden` con la forma sbagliata fallisce APERTO e in silenzio: il file resta servito](#14-hidden-con-la-forma-sbagliata-fallisce-aperto-e-in-silenzio-il-file-resta-servito) — **RISOLTO in 5.3.1** (ogni forma scartata ora avvisa via `warnConfigDeprecation`, con la promessa di throw in 6.0.0; comportamento servito invariato)
- [ ] [15. `compression.mimeTypes`: una lista non vuota di voci invalide sostituisce i default e spegne la compressione in silenzio](#15-compressionmimetypes-una-lista-non-vuota-di-voci-invalide-sostituisce-i-default-e-spegne-la-compressione-in-silenzio) — **APERTO** (asimmetria `[]` = "non impostato" vs `[123]` = "lista deliberata")
- [ ] [16. Due convenzioni opposte per le opzioni booleane, entrambe silenziose](#16-due-convenzioni-opposte-per-le-opzioni-booleane-entrambe-silenziose) — **APERTO** (`dirListing.enabled: 'false'` accende il listing, `browserCacheEnabled: 'yes'` spegne la cache)
- [ ] [17. La sonda di leggibilità è saltata su un HIT della cache `rawFile`, contro l'intento dichiarato dal suo stesso commento](#17-la-sonda-di-leggibilità-è-saltata-su-un-hit-della-cache-rawfile-contro-lintento-dichiarato-dal-suo-stesso-commento) — **APERTO** (asimmetria con la cache `compressedFile`, che invece risponde 404)

---

## Minori / conformità / coerenza

### 1. Le pagine d'errore 404 escono senza alcun `Cache-Control` (heuristic caching di un 404)

**Stato: ✅ RISOLTO** (2026-07-19 — **opzione A, variante `no-store` semplice**,
decisa dal manutentore. In `writeErrorPage` la riga `if (status >= 500)
ctx.set('Cache-Control', 'no-store')` è diventata un `ctx.set('Cache-Control',
'no-store')` **incondizionato**: ogni error page generata (404 / 500 / 504) è ora
non-cacheabile, chiudendo l'unico punto in cui il middleware lasciava la decisione
di caching all'euristica di un proxy. Scelto `no-store` — non la tripla no-cache
del listing — perché di un error page non c'è nulla da conservare per una futura
revalidation; `Pragma`/`Expires` restano quindi scrubbati (non reimpostati). Il
400 di `sendBadRequest` è deliberatamente lasciato fuori: resta minimale/header-light
come da design (i 400 sono raramente cachati dai proxy). Test:
describe "#1 error pages carry no-store on every handled status" in
`__tests__/error-pages.test.js` — 404 da file mancante (con `browserCacheEnabled`
sia false che true), 404 da traversal, 404 da `dirListing.enabled:false`, e
invarianza del 500; aggiornati i due test che codificavano il vecchio esito
(404 → `cache-control` undefined) alla nuova asserzione `no-store`.)

**Posizione:** `writeErrorPage` (`index.cjs:204-218`); lista di scrub
`ERROR_PAGE_SCRUB_HEADERS` (`index.cjs:194-198`).

**Problema:** `writeErrorPage` **rimuove** ogni `Cache-Control` che una risposta
parzialmente costruita avesse lasciato (giusto: uno `public, max-age=...`
ereditato non deve finire su un 404), ma imposta un `Cache-Control` nuovo **solo
per gli status ≥ 500** (`no-store`). Una **404** (file mancante, traversal,
entry nascosta, `dirListing.enabled: false`, file richiesto con trailing slash)
esce quindi **senza alcun header di caching**.

Per RFC 7231 §6.1 il **404 è tra gli status euristicamente cacheabili** (insieme
a 200, 203, 204, 206, 300, 301, 405, 410, 414, 501). Senza un `Cache-Control`
esplicito una shared cache/CDN può quindi cachare il 404 con la propria
freshness euristica: un file **creato dopo** continua a risultare 404 per i
client serviti dalla cache finché la finestra euristica non scade. Su un file
server — dove i file compaiono e scompaiono — è esattamente lo scenario di
staleness che il progetto ha già scelto di prevenire altrove.

**Perché è una vera incoerenza (non solo un nit):** il progetto ha una posizione
netta *contro* l'heuristic caching delle proprie risposte generate:

- le risposte file con `browserCacheEnabled: false` emettono la tripla esplicita
  `no-cache, no-store, must-revalidate` + `Pragma` + `Expires` proprio per
  disinnescare l'heuristic caching (`index.cjs:2450-2453`, commento: *"without
  these headers browsers may use heuristic caching"*);
- il **listing** (registro v4.3 #5) è stato reso `no-cache` esplicito *sempre*,
  con la motivazione "pagina dinamica → un contenuto stale è solo confusione"
  (`index.cjs:3190-3192`).

Un 404 è dinamico nello stesso senso del listing (diventa 200 quando il file
viene creato), eppure è l'unica risposta generata dal middleware che lascia la
porta aperta all'euristica.

**Riproduzione (verificata a runtime):** `browserCacheEnabled: true`,
`GET /nope.txt` → **404 senza `Cache-Control`** (né `Pragma`); `GET /exists.txt`
→ 200 con `Cache-Control: public, max-age=3600, must-revalidate`. Stesso esito
sui 404 da traversal (`GET /../etc/passwd`) e sul 400 da encoding malformato
(`GET /%`).

**Opzioni:**
- **A — uniformare a no-store/no-cache** (coerente col #5 e con il ramo
  `browserCacheEnabled: false`): estendere in `writeErrorPage` la policy anche ai
  4xx (es. `no-store` per *ogni* status gestito, non solo ≥ 500; oppure la tripla
  `no-cache, no-store, must-revalidate` come il listing). Fix a una-due righe.
  Effetto: nessun 404/500/504 più euristicamente cacheabile — comportamento
  deterministico end-to-end.
- **B — wontfix consapevole:** cachare i 404 è una tecnica *legittima* di
  load-shedding contro flood di bot su URL inesistenti. Se è desiderato, annotarlo
  qui come scelta e — coerenza documentale — menzionarlo in `SECURITY_HARDENING.md`
  / `DOCUMENTATION.md` così che non sembri una svista rispetto al #5.

Nota: il 400 di `sendBadRequest` (`index.cjs:216-219`) è deliberatamente
minimale/header-light (documentato) — se si sceglie A, valutare se includerlo o
lasciarlo fuori (i 400 sono raramente cachati dai proxy; l'inclusione è per pura
uniformità).

**Priorità:** Bassa-Media (staleness reale ma solo dietro una shared cache che
applica freshness euristica ai 404; nessuna rottura diretta).

---

### 2. `If-Range` in forma data non onorato → 200 pieno invece di 206

**Stato: 🚫 CHIUSO — WONTFIX consapevole** (2026-07-19 — **opzione A** decisa dal
manutentore: nessuna modifica al codice; comportamento documentato). `If-Range`
resta un confronto **strong ed esatto con l'entity-tag base**; la forma HTTP-date
non viene onorata e la richiesta degrada in sicurezza al `200` con l'intero file
(risposta sempre corretta a una richiesta Range, RFC 9110 §14.2). Motivazione della
scelta: una data ha risoluzione al secondo e **non** distingue due modifiche nello
stesso secondo, mentre l'ETag `mtime-size` è un validatore forte per costruzione —
onorare la forma data riaprirebbe (in modo stretto ma reale) la finestra in cui un
`206` incollerebbe byte di due versioni diverse, esattamente il rischio che l'ETag
forte chiude (coerente col v4.3 #3). I client che riprendono un download e ricevono
l'ETag (cioè con `browserCacheEnabled: true`) usano già la forma entity-tag, che è
pienamente supportata; la forma data è un fallback che qui costa un re-download
completo, mai dati incoerenti. Documentazione: nuova sottosezione *"Richieste Range
e `If-Range`"* in `docs/DOCUMENTATION.md`. Nessun test aggiunto (nessun cambiamento
di comportamento; il 200 sulla forma data è già coperto dal probe di revisione).

**Posizione:** `index.cjs:2565` (`const ifRange = ctx.get('If-Range'); if (!ifRange || ifRange === baseEtag)`), fall-through a `index.cjs:2600`.

**Problema:** RFC 9110 §13.1.5 ammette per `If-Range` **due** forme: un entity-tag
(confronto *strong*) **oppure** un HTTP-date. Il codice confronta `If-Range`
esclusivamente per uguaglianza esatta con `baseEtag` (una entity-tag quotata):
un client che invia `If-Range: <HTTP-date>` insieme a un `Range` non matcha mai
la condizione e cade sul **200 pieno** invece del **206**.

Non è mai *scorretto* (servire la rappresentazione completa è sempre una risposta
valida a una richiesta Range), ma è un'occasione mancata: il senso di `If-Range`
è "mandami il range se la risorsa non è cambiata, altrimenti tutto"; con la forma
data il client ottiene sempre "tutto", vanificando la ripresa di download
condizionale per i client che usano la data.

**Riproduzione (verificata a runtime):** `browserCacheEnabled: true`,
`GET /big.txt` con `Range: bytes=0-9` + `If-Range: <Last-Modified reale>` →
**200** (atteso 206). Con `If-Range: <baseEtag>` → **206** (corretto).

**Contesto storico:** il registro v3.1 #8 documenta esplicitamente
*"`If-Range` resta un confronto strong ed esatto con `baseEtag`, invariato"* — la
forma data non è mai stata affrontata, quindi questa è la prima volta che viene
messa a registro come lacuna nota (non una regressione).

**Opzioni:**
- **A — wontfix documentato (consigliato):** la policy "solo validatore forte"
  è difendibile — un `If-Range` a data ha risoluzione di 1 secondo e uno strong
  validator è più sicuro contro le modifiche sub-secondo. Basta annotarlo qui e,
  se si vuole essere espliciti, una riga in `DOCUMENTATION.md`. Costo zero.
- **B — implementare la forma data:** quando `If-Range` non parsa come entity-tag
  (non inizia con `"` o `W/`), interpretarlo come HTTP-date e servire il 206 se
  `mtime` (troncato al secondo, come già fatto per `If-Modified-Since` a
  `index.cjs:2533`) **non** è successivo alla data. Attenzione: §13.1.5 richiede
  che un `If-Range` a data sia usato **solo** se il validatore è un "strong
  validator" — l'mtime al secondo lo è considerato tale dalla RFC solo con la
  cautela dei 2 secondi (già nota nel dominio HTTP). Più codice e più superficie
  di test per un beneficio marginale.

**Priorità:** Bassa (conformità/ottimizzazione; nessuno scenario in cui la
risposta sia scorretta).

---

## Robustezza / disponibilità

### 3. Errore di un body-stream dopo l'invio degli header → socket mai chiuso, client appeso fino a `requestTimeout` (5 min)

**Stato: ✅ RISOLTO** (2026-07-20 — **decisione del manutentore: togliere il
supporto a Koa 2 in v5.0.0** anziché portare una toppa `ctx.res.destroy()`. Il
problema era **specifico di Koa 2** (il suo `respond()` usa un bare
`body.pipe(res)` che non chiude `res` sull'errore della sorgente); **Koa 3 non è
affetto** perché usa `Stream.pipeline(stream, res, …)`, che distrugge la
destinazione — verificato a runtime che il socket si chiude in ~59 ms su Koa 3
contro l'hang su Koa 2. Con il `peerDependencies` ristretto a `koa: ">=3.1.2"` il
ramo di codice appeso non è più raggiungibile su una piattaforma supportata,
quindi la classe di bug è eliminata alla radice invece che mascherata da un
workaround per un framework major non più target. `package.json` →
`peerDependencies.koa: ">=3.1.2"`, sezione ⚠️ Breaking Changes nel CHANGELOG con
guida di migrazione. Nessuna modifica al codice del middleware: l'API è
invariata. Il test `robustness-misc.test.js:202`, che si appendeva 120 s su Koa 2,
passa in ~2 s su Koa 3 — la piattaforma ora supportata. La sezione qui sotto
resta come analisi/prova del problema.)

**Nota storica (analisi che ha portato alla decisione):** confermato a runtime
prima della scelta.

**Provenienza:** emerso indagando (opzione B della discussione sul #1/#2) perché
il test `__tests__/robustness-misc.test.js:202` *("readFile rejection →
uncompressed fallback; its stream dying mid-flight is logged, response torn
down")* si appende fino al `testTimeout` di 120 s di Jest. Il test si appende
perché **il prodotto lascia davvero il socket aperto** — non è un artefatto del
mock: il mock sostituisce solo la sorgente di byte, l'intera catena Koa→socket
è reale.

**Posizione (tutti i rami che assegnano uno stream a `ctx.body`):**
- `streamCompressedBody` — callback di `pipeline` (`index.cjs:1938`);
- ramo **206 Range** identity (`index.cjs:2586-2587`);
- **tee leader** compresso — callback di `pipeline` (`index.cjs:2717`);
- fallback **identity post-errore-compressione** (`index.cjs:2771-2772`);
- ramo **identity non compresso** (`index.cjs:2823-2824`).

Tutti condividono lo stesso gestore: `_logger.error('Stream error:', err);
if (!ctx.headerSent) sendErrorPageSync(ctx, 500);`.

**Problema:** quando lo stream del body fallisce **dopo** che gli header sono
già stati flushati (caso tipico: il `Content-Length` è annunciato, alcuni byte
sono già partiti, poi il read fallisce a metà — EIO su disco che cede, blip
NFS/SMB), la guardia `if (!ctx.headerSent)` è **falsa** e il gestore **non fa
nulla**. Koa serve gli stream con un bare `body.pipe(res)` (koa 2.16.4,
`application.js:303`): sull'errore della **sorgente**, `.pipe()` di Node fa
`unpipe` ma **non** chiude `res`. Risultato: la risposta resta half-open con un
`Content-Length` che non sarà mai soddisfatto, e **il client resta appeso** in
attesa dei byte mancanti. L'unico backstop è `server.requestTimeout` (default
**300 000 ms = 5 min** su Node ≥ 18); `server.timeout` è 0 (disabilitato). Sotto
errori ripetuti (storage che cede, mount di rete instabile) le connessioni
appese si accumulano per 5 minuti ciascuna → pressione su socket/fd, superficie
di esaurimento risorse.

Non è un problema di **integrità** dei dati (il client non riceve mai byte
sbagliati — riceve una risposta *incompleta*); è un problema di **disponibilità
/ resource-leak**.

**Riproduzione (verificata a runtime, socket raw):** file servito via ramo
identity non compresso; `fs.createReadStream` che emette `partial` (7 byte) e
poi `destroy(EIO)`. Osservato sul socket client:
- header + `Content-Length: 4096` + 7 byte inviati, poi `Stream error: EIO`
  loggato;
- **socket ancora aperto dopo 12 s** (nessun FIN dal server), `writable=true` —
  chiuso solo dal guard di test;
- `server.requestTimeout = 300000ms`, `server.timeout = 0`.
Stessa evidenza sui rami 206 Range e compresso-in-streaming (tutti e tre
"STILL OPEN after 5s"). Il ramo fallback-identity condivide il codice del ramo
identity, quindi è coperto per costruzione.

**⚠️ Specifico di Koa 2 — Koa 3 non è affetto (verificato a runtime).** Il
`peerDependencies` dichiara `koa: "^2.16.4 || >=3.1.2"`. La differenza è nel
`respond()` del framework:
- **Koa 2.16.4** serve gli stream con `body.pipe(res)` (`application.js:303`):
  sull'errore della sorgente `res` **non** viene chiuso → hang (socket ancora
  aperto dopo 12 s nel repro).
- **Koa 3.2.1** usa `Stream.pipeline(stream, res, …)` (`application.js:326`):
  `pipeline` **distrugge la destinazione** sull'errore della sorgente → il socket
  è chiuso subito (**59 ms** nel repro, il server manda FIN).

Conseguenza sulla suite di test: lo stesso `robustness-misc.test.js:202`
**passa in ~2 s su Koa 3** e **si appende 120 s su Koa 2** — il "timeout" osservato
dipende dalla versione di Koa con cui si esegue la suite (koa è una peerDependency
e **non** viene installata da `npm ci`: va scelta a mano). Chi esegue i test su
Koa 2 vede il timeout; su Koa 3 no.

Il finding resta **valido e da correggere**: il pacchetto **supporta
esplicitamente Koa 2.16.4+**, e molti deployment sono ancora su Koa 2 — un hang su
una configurazione ufficialmente supportata è un difetto reale per quegli utenti.
Il fix proposto sotto è a beneficio di Koa 2 ed è un **no-op innocuo su Koa 3**
(`res.destroy()` è idempotente: quando `pipeline` ha già distrutto `res`, una
seconda `destroy()` non fa nulla).

**Contesto (perché il caso `!ctx.headerSent` funziona ma questo no):** se lo
stream fallisce **prima** di flushare gli header, `sendErrorPageSync` produce un
500 pulito — corretto. Il buco è solo il ramo header-già-inviati, dove non è più
possibile cambiare status/body ma **si può e si deve** chiudere il socket: è
esattamente ciò che il middleware fa già altrove nella stessa situazione — il
catch di ultima istanza e `sendTemplateError` chiamano `ctx.res.destroy()` quando
`ctx.headerSent || ctx.res.writableEnded`.

**Fix proposto:** allineare i gestori di stream-error al pattern già usato dal
resto del codice — quando gli header sono partiti, **distruggere il socket**
invece di non far nulla, così il client riceve subito una premature-close (segnale
onesto: la risposta è troncata) invece di appendersi. Helper condiviso (i 5 siti
sono identici):

```js
// Body stream fallito: se gli header non sono ancora partiti servi un 500 pulito;
// altrimenti la risposta è già a metà sul filo con un Content-Length che non sarà
// mai soddisfatto → distruggi il socket, così il client vede una premature-close
// immediata invece di appendersi fino a server.requestTimeout.
function onBodyStreamError(ctx, err) {
    _logger.error('Stream error:', err);
    if (!ctx.headerSent) sendErrorPageSync(ctx, 500);
    else ctx.res.destroy();
}
```

Applicato ai tre `src.on('error', …)` diretti; per le due callback di `pipeline`
la stessa logica va innestata dopo l'early-return su `ERR_STREAM_PREMATURE_CLOSE`
(un abort del client non è un errore da segnalare). Rete di regressione: oltre a
far passare (in fretta) il test esistente `robustness-misc:202`, un test a socket
raw che asserisca la chiusura entro pochi secondi (non l'attesa dei 5 min).

**Priorità:** Media **solo su Koa 2** / non-applicabile su Koa 3 (disponibilità /
resource-leak, non integrità; richiede un errore di lettura a metà stream — non
comune ma reale su storage che cede o FS di rete; l'impatto è limitato dal
`requestTimeout` di 5 min ma 5 min × connessioni è significativo. Fix a basso
rischio, ricalca un pattern già presente nel codice, e innocuo su Koa 3).

---

## Seconda passata (2026-07-20) — focus Koa ≥ 3 / Node ≥ 20

### 4. `package-lock.json` non rigenerato dopo il bump dei requisiti V5 (dichiara ancora `node >=18` e `koa ^2.16.4 || >=3.1.2`)

**Stato: ✅ RISOLTO** (2026-07-20 — lock rigenerato con `npm install
--package-lock-only`: il diff tocca **solo** i due campi della entry root
(`engines.node` → `">=20"`, `peerDependencies.koa` → `">=3.1.2"`); nessuna
entry `koa` è stata aggiunta al lock, quindi il workflow documentato — koa è
una peer da installare a mano per i test — e il comportamento di `npm ci`
restano identici. Verificato `npm ci` + suite completa verde dopo la
rigenerazione. Allineata anche la riga §PS-5 di
`docs/security_improvement_for_V3.md` (annotata come aggiornata in v5.0.0).
Nota in `docs/CHANGELOG.md` sotto 5.0.0 → Housekeeping.)

**Posizione:** `package-lock.json:23` (`"node": ">=18"`) e `package-lock.json:26`
(`"koa": "^2.16.4 || >=3.1.2"`), nella entry root `packages[""]`. Correlato:
`docs/security_improvement_for_V3.md:114`, la cui tabella delle dipendenze
riporta ancora il range peer pre-V5 (`koa ^2.16.4 || >=3.1.2`).

**Problema:** il commit `892fecb` (v5.0.0) ha aggiornato `engines.node` a
`">=20"` e `peerDependencies.koa` a `">=3.1.2"` in `package.json`, ma il
lockfile non è stato rigenerato: la sua entry root fotografa ancora i vincoli
di v4.x. Verificato che **`npm ci` oggi non fallisce** (npm 10 non valida
engines/peerDependencies della entry root contro `package.json`), quindi non
c'è rottura funzionale — ma:

- il lockfile **mente** sui vincoli della piattaforma a chiunque lo legga
  (umani e tooling: auditor di supply-chain, Dependabot/Renovate, `npm query`);
- il primo `npm install` per qualunque altra ragione riscriverà quelle righe,
  producendo un **diff spurio** dentro un PR che non c'entra nulla — lo stesso
  tipo di drift documentale che il progetto ha già scelto di prevenire altrove
  (cfr. il mismatch `maxEntries` 10000/100000 citato in CLAUDE.md).

**Fix proposto:** rigenerare il lock (`npm install --package-lock-only`, poi
verifica `npm ci` + `npm run test:ci`) e allineare la riga della tabella in
`docs/security_improvement_for_V3.md` (annotandola come aggiornata in v5.0.0 —
il documento è storico ma è ancora referenziato da CLAUDE.md per il Future
Work `[F-1]`). I documenti di lavoro `docs/prompt_migrazione_jest_node_test.md`
e `docs/prompt_analisi_item_di_processo.md` citano ancora la matrice CI con
Node 18: sono snapshot di pianificazione, nessuna azione richiesta, ma chi li
riprende in mano deve sapere che la domanda aperta sul "leg Node 18" è stata
chiusa da v5.0.0 (leg rimosso, commit `a0e2904`).

**Priorità:** Bassa (igiene di release; nessun impatto runtime) — ma da fare
**prima del publish** di 5.0.0, perché il tarball/repo taggato non deve uscire
con un lockfile che contraddice `package.json`.

---

### 5. Su Koa 3 la pagina 500 dei gestori stream-error è irraggiungibile: errore in apertura dello stream → ECONNRESET al client, log duplicato su stderr

**Stato: ✅ RISOLTO** (2026-07-20 — **opzione A, pre-open del file
descriptor**, decisa dal manutentore. Nuovo helper di istanza
`openBodyStream(ctx, filePath, streamOpts)`: apre il file con
`await fs.promises.open(filePath, 'r')` **prima** che il body venga
assegnato — un fallimento di apertura diventa `sendErrorPage(ctx, 404)`
regolare (pagina custom `errorPages[404]` onorata, header sporchi scrubbati,
`no-store`), mentre la risposta è ancora pienamente scrivibile — e in caso di
successo restituisce `fs.createReadStream(filePath, { fd: handle, ... })`:
lo stream legge dal descriptor **già aperto** (l'open non può più fallire a
valle), il path resta il primo argomento così i mock path-based dei test
continuano a funzionare, e `autoClose` chiude l'handle a fine stream o alla
distruzione (incluso l'abort del client). Zero syscall aggiuntivi: l'open
che prima faceva `createReadStream` internamente ora è semplicemente
anticipato. Applicato ai 5 rami: identity, 206 Range, streaming compresso
(`streamCompressedBody`, ora async), tee leader (open PRIMA del bookkeeping
del tee, così un fallimento non lascia chiavi appese), fallback identity
post-errore-compressione. Il ramo morto `if (!ctx.headerSent)
sendErrorPageSync(ctx, 500)` è stato rimosso dai 5 gestori (restano i log
`Stream error:` sul logger dell'operatore per gli errori mid-flight, dove
Koa 3 abbatte il socket — comportamento voluto, #3) e la funzione
`sendErrorPageSync` è stata eliminata.

**Due deviazioni consapevoli dallo sketch originale dell'opzione A:**
1. il check `fs.promises.access(toOpen, R_OK)` **NON** è stato rimosso:
   toglierlo avrebbe cambiato la semantica dei percorsi che non aprono mai il
   file (hit della cache compressa, 304, HEAD) — un file reso illeggibile
   dopo il caching avrebbe continuato a essere servito dalla RAM. Il probe
   resta quindi come guardia per quei percorsi; sui rami streaming il TOCTOU
   residuo access→open è chiuso dal pre-open (commento aggiornato in codice);
2. si usa `fs.createReadStream(path, { fd })` invece di
   `handle.createReadStream()` per **preservare il seam di test**: ~8 suite
   instrumentano/mockano `fs.createReadStream` per path. Semantica di
   `{ fd: FileHandle }` + `start`/`end` + `autoClose` verificata con probe a
   runtime su Node 22 prima dell'adozione.

Test: nuovo describe *"open-time failures → clean 404 error page (pre-open
contract)"* in `__tests__/io-failure-paths.test.js` — 6 casi: identity, Range
(header 206 scrubbati), streaming compresso (niente `Content-Encoding`
stantio), tee leader (404 + recovery del tee alla richiesta successiva),
fallback con `readFile` e open entrambi falliti, `errorPages[404]` custom
onorata. Gli helper di failure-injection che sostituiscono stream finti
(`io-failure-paths`, `robustness-misc`, `error-pages`,
`compression-fallback-deep`, `compression-stream-tee`) ora chiudono il
`FileHandle` ricevuto in `options.fd` per non trattenere il descriptor
(teardown Windows). Suite completa: 60 suite / 1249 test verdi su Koa 3.2.1;
coverage 98.46% stmts / 98.34% branch sopra le soglie. CHANGELOG aggiornato
sotto 5.0.0 → Fixed.)

**Posizione (i 5 gestori condividono lo stesso pattern
`if (!ctx.headerSent) sendErrorPageSync(ctx, 500)`):**
- `streamCompressedBody` — callback di `pipeline` (`index.cjs:1936`);
- ramo **206 Range** identity (`index.cjs:2585`);
- **tee leader** compresso — callback di `pipeline` (`index.cjs:2715`);
- fallback **identity post-errore-compressione** (`index.cjs:2770`);
- ramo **identity non compresso** (`index.cjs:2822`).

**Problema:** su Koa 3 quel ramo non può più produrre una 500 visibile al
client, in **nessuna** finestra temporale:

- se lo stream fallisce **dopo** l'invio degli header, la guardia è falsa e
  `Stream.pipeline` di Koa 3 abbatte il socket (esito corretto — è la
  risoluzione del #3);
- se lo stream fallisce **prima di produrre il primo byte** (errore in
  apertura: file sparito/`EACCES` tra il check e l'open, `EIO` all'open), la
  guardia è vera e `sendErrorPageSync` scrive status/headers/body — ma a quel
  punto `respond()` di Koa ha **già consumato** `ctx.body` (il middleware è
  già ritornato: l'errore di open arriva dal threadpool su un tick successivo)
  e ha già avviato `Stream.pipeline(stream, res, …)`. La pagina 500 scritta
  non verrà mai spedita; `pipeline` distrugge `res` e il client riceve
  **ECONNRESET** senza alcuna risposta HTTP.

A differenza del #3 (che su Koa 2 era un hang, un problema reale di
disponibilità), qui l'esito è "onesto" — connessione chiusa subito — ma
**incoerente con il contratto interno del middleware** su tre punti:

1. il ramo `!ctx.headerSent` è **codice morto** rispetto al client: dà
   l'impressione (anche a chi legge) che un errore di apertura produca una 500
   pulita, e non è così;
2. `errorPages[500]` (pagina custom dell'operatore) **non viene mai servita**
   da questi rami, silenziosamente;
3. l'errore viene loggato **due volte su stderr dal default handler di Koa**
   (via `ctx.onerror` → `app.emit('error')`), **fuori** dal `logger`
   configurato — esattamente ciò che il catch di ultima istanza dichiara di
   voler evitare ("logged outside the operator's logger"), oltre al log già
   corretto emesso dal middleware stesso (`Stream error:` sul logger
   dell'operatore).

**Riproduzione (verificata a runtime, Koa 3.2.1 / Node 22):** file `.bin`
(ramo identity), `fs.createReadStream` sostituito con uno stream che si
distrugge con `EIO` prima del primo byte (equivale al file che sparisce tra
`fs.promises.access` e l'open). Osservato sul client: **ECONNRESET**, nessuno
status; `logger.error('Stream error:', …)` chiamato 1 volta (corretto); due
stack `Error: EIO` addizionali su **stderr** dal default handler di Koa.

**Nota:** il check `fs.promises.access(toOpen, R_OK)` (`index.cjs:2465`,
commentato "race condition protection") restringe questa finestra ma non la
chiude: è un TOCTOU per costruzione.

**Opzioni:**
- **A — pre-open del file descriptor (consigliata):** nei rami che oggi fanno
  `fs.createReadStream(toOpen)`, aprire prima il file con
  `await fs.promises.open(toOpen, 'r')` e assegnare come body
  `handle.createReadStream()` (Node ≥ 16.11, ampiamente dentro `engines
  >=20`). Gli errori di apertura diventano una rejection **prima**
  dell'assegnazione del body → `sendErrorPage(ctx, 404/500)` regolare, con
  pagina custom e header corretti. Chiude anche il TOCTOU: il check
  `fs.promises.access` diventa superfluo (l'open **è** la prova di
  leggibilità — un syscall in meno sul percorso caldo). Gli errori a metà
  stream restano teardown via `pipeline` (comportamento voluto, #3). I rami
  morti `sendErrorPageSync` si semplificano di conseguenza.
- **B — wontfix documentato:** la finestra è stretta (richiede la sparizione
  del file o un errore I/O esattamente tra stat/access e open) e l'esito
  ECONNRESET è un segnale onesto. In tal caso, però, coerenza impone di
  **rimuovere il ramo morto** `if (!ctx.headerSent) sendErrorPageSync(...)`
  dai 5 gestori (lasciando il solo log) e di annotare qui e in
  `DOCUMENTATION.md` (sezione errorPages) che le pagine 500 custom non
  coprono i fallimenti degli stream.

**Priorità:** Bassa-Media (coerenza + qualità dell'errore lato client in una
race rara; nessun problema di integrità né di disponibilità — il socket viene
chiuso subito).

---

## Terza passata (2026-07-20) — revisione completa (sessione separata)

Rilettura integrale di `index.cjs` (3287 righe) da sessione pulita, con la lente
della correttezza HTTP e del contenimento errori. Baseline: `test:ci` verde su
Koa 3.2.1 / Node 22 (60 suite / 1249 test), lint pulito, coverage 98.46% stmts /
98.34% branch / 99% funcs / 98.49% lines (sopra soglia). Confermate sul codice
(non solo dalle checkbox) tutte le voci dei registri v3.1 (20), v4.3 (16) e v5.0
(#1–#5): implementate come descritto. Nessun bug di correttezza, nessun residuo
Koa-2 / Node-18, nessun marcatore `TODO/FIXME` pendente (l'unico `TODO` è il noto
`[F-1]` sulla `readdir` non limitata, già tracciato). Emerge **una sola voce
nuova**, minore.

### 6. `Accept-Ranges: bytes` annunciato sulle risposte compresse, mentre il Range è servito dalla rappresentazione identity

**Stato: 🚫 CHIUSO — WONTFIX consapevole** (2026-07-20 — **opzione A** decisa dal
manutentore: nessuna modifica al codice; comportamento documentato). I Range
restano serviti dalla rappresentazione **identity** e `Accept-Ranges: bytes` resta
annunciato su ogni risposta file, comprese quelle compresse. Documentazione: nuovo
paragrafo nella sottosezione *"Richieste Range e `If-Range`"* di
`docs/DOCUMENTATION.md` (accanto alla nota del #2). Nessun test aggiunto (nessun
cambiamento di comportamento; l'esito è già coperto dal probe di revisione).

**Posizione:** `index.cjs:2468` (`ctx.set('Accept-Ranges', 'bytes')`, impostato
**incondizionatamente** su ogni risposta file, prima che l'encoding sia risolto
alle righe 2512-2522); ramo Range `index.cjs:2581-2638` (la compressione è
**saltata** per i Range: un `206` serve sempre byte identity con `baseEtag`).

**Problema:** una risposta `200` compressa dichiara `Accept-Ranges: bytes` ma il
suo `Content-Length` è la dimensione **compressa**, mentre una richiesta Range su
quella stessa URL viene servita dalla rappresentazione **identity** (dimensione
diversa). Un client che riprende il download della rappresentazione compressa via
byte-range **senza `If-Range`** riceve quindi byte identity — un cambio di
rappresentazione a metà trasferimento.

**Riproduzione (verificata a runtime, Koa 3.2.1 / Node 22):** file compressibile
da 10001 byte, `browserCacheEnabled: true`.

| Richiesta | Esito osservato |
|---|---|
| `GET` + `Accept-Encoding: gzip` | `200` · `Content-Encoding: gzip` · **`Content-Length: 49`** (compresso) · `Accept-Ranges: bytes` · `ETag "…-gz"` |
| `GET` + `Range: bytes=0-99` + `Accept-Encoding: gzip` (senza If-Range) | `206` · **nessun `Content-Encoding`** (identity) · `Content-Range: bytes 0-99/10001` (dimensione identity) · `Content-Length: 100` · `ETag "…-10001"` (baseEtag) |
| stessa Range + `If-Range: "…-gz"` (l'ETag ricevuto) | `200` pieno ri-compresso — **degrado sicuro** |

**Perché non è un bug di integrità:** un client che onora `Content-Encoding` lo
rileva senza corrompere nulla — la `206` **non** porta `Content-Encoding` (quindi
è identity) e il denominatore del suo `Content-Range` (10001) è diverso dal
`Content-Length` della `200` (49); i client di resume ben educati inviano
`If-Range` e ottengono un `200` pieno. È una **divergenza da nginx**, che quando
comprime al volo **non** annuncia `Accept-Ranges`. Il framing è identico al #2
(una lacuna di conformità su Range/validatori, chiusa lì come wontfix-documentato).

**Sotto-nota (cosmetica):** il `206` identity eredita anche `Vary: Accept-Encoding`
dal ramo `potentiallyCompressible` (impostato a `index.cjs:2534-2538`, prima del
ramo Range). È un over-vary innocuo — una shared cache lo indicizza per
`Accept-Encoding` pur essendo sempre identity: costa un cache-miss in più, mai una
risposta scorretta.

**Opzioni (per contesto storico):**
- **A — wontfix documentato (scelta adottata, coerente col #2):** i Range in
  identity sono un comportamento legittimo e sicuro per i client conformi; una
  sottosezione in `docs/DOCUMENTATION.md` che dichiari esplicitamente che i Range
  sono serviti dalla rappresentazione identity e che `Accept-Ranges: bytes` resta
  annunciato anche sulle risposte compresse. Costo zero, nessun test.
- **B — allineare a nginx:** omettere `Accept-Ranges: bytes` quando la risposta
  effettiva porta `Content-Encoding` (spostare/condizionare il set di
  `index.cjs:2468` dopo la risoluzione dell'encoding, così le risposte identity —
  inclusi i client senza gzip, i `304` e i `206` — continuano ad annunciarlo).
  Chiude la finestra alla radice; costo: un piccolo riordino + un test.

**Priorità:** Bassa (conformità/coerenza; nessuno scenario in cui la risposta
servita sia scorretta — i client conformi distinguono le due rappresentazioni, i
client di resume usano `If-Range`).

---

## Quarta passata (2026-08-07) — segnalazione esterna sul dispatch directory

### 7. `dirListing.enabled: false` inghiotte anche il file index: una directory con `index.html` risponde 404

**Stato: RISOLTO in 5.2.0.**

**Sintomo.** Con `dirListing: { enabled: false }` e `index: ['index.html']`, una
directory che *contiene* `index.html` risponde **404** invece di servire
l'indice.

**Causa.** In `index.cjs` (stato pre-fix, righe 2317-2379) l'intera risoluzione
dell'indice era annidata dentro `if (options.dirListing.enabled)`; il ramo
`else` faceva `sendErrorPage(ctx, 404)` senza mai guardare se un indice
esistesse. Il nome dell'opzione dice `dirListing` — governa il *listing* — ma di
fatto governava anche la risoluzione dell'indice.

**Perché è un bug e non una scelta.** Tre elementi convergono:

1. **Il 404 non proteggeva nulla.** Con `enabled: false`, `GET /docs/index.html`
   restituiva comunque `200`. Veniva negato solo l'URL canonico della directory,
   cioè l'URL *corretto* di un file che il server serviva comunque.
2. **Viola il contratto dichiarato** in `CLAUDE.md`: *"If a file exists in the
   served directory, `GET` on its path returns it."*
3. **La documentazione si contraddiceva.** `docs/CHANGELOG.md` (voce 3.0.0, che
   introduce l'opzione) descrive `enabled: false` come *"requests for a
   directory **without a matching index file** return 404"* — cioè il
   comportamento corretto — mentre `docs/DOCUMENTATION.md` (Caso 3) documentava
   quello implementato, *"indipendentemente da index"*. La discrepanza è
   probabilmente il motivo per cui il difetto è sopravvissuto a tre revisioni.
4. **La guida di hardening raccomandava la configurazione rotta.** Prova
   decisiva: `docs/SECURITY_HARDENING.md` prescriveva `dirListing: { enabled:
   false }, index: ['index.html']` in **due** punti — la raccomandazione §3.3
   (*"disable them and rely on an index file"*) e la config
   *maximally-hardened* di chiusura (*"no listings; rely on index files"*). Un
   operatore che seguiva alla lettera la guida di sicurezza canonica del
   progetto otteneva un sito interamente **404**. Nessuno può aver inteso
   quel comportamento come corretto.

**Il comportamento era pinnato da tre test**, il che conferma che era stato
asserito consapevolmente ma sulla base dell'assunzione sbagliata — il commento
in `dir-trailing-slash.test.js` la esplicita: *"no redirect (would 404
anyway)"*.

**Fix (opzione scelta: ristrutturazione del dispatch, minor 5.2.0).**

- Nuovo helper interno **`resolveIndexFile(dirPath)`** (`index.cjs:2075`) che
  applica all'indice le stesse regole di visibilità di un file richiesto
  direttamente e ritorna `{ file }`, `{ file: null }` (assente **oppure**
  nascosto) o `{ file: null, rejected: true }` (fuori dal boundary symlink).
- Con il listing **off** la risoluzione gira **prima** del redirect canonico
  (`index.cjs:2364`): è lì che la decisione redirect-vs-404 dipende
  dall'esistenza dell'indice.
- Con il listing **on** la risoluzione resta **dopo** il redirect
  (`index.cjs:2417`): la directory renderizza comunque qualcosa, quindi il
  redirect è incondizionatamente corretto e la richiesta pre-redirect non paga
  lo `stat()`/`readdir()` aggiuntivo. **Il percorso di default non cambia
  costo.**

**Due invarianti preservate deliberatamente** (entrambe pinnate dalla nuova
suite):

- **Mai 301-poi-404.** Una directory che non renderizza nulla risponde con un
  solo 404, senza redirect: due risposte al posto di una, e la prima
  confermerebbe l'esistenza della directory. "Niente da renderizzare" resta
  indistinguibile da "non esiste" — asserito confrontando status **e body** con
  quelli di una directory inesistente.
- **Indice nascosto ≡ assente.** Un indice filtrato da `isHiddenEntry` non viene
  mai servito: cade sul listing se il listing è on, sul 404 se è off. Stesso
  trattamento per un indice che esce dal boundary symlink, che però è un 404
  *duro* — mai un fall-through che finirebbe per elencare la directory.

**Nota sul costo, per il verbale.** La segnalazione originale stimava «una
`readdir` in più sulla richiesta pre-redirect». In realtà `findIndexFile` usa
`stat()` per i pattern stringa e ricorre a `readdir()` solo per i pattern
RegExp; con `index: []` (default) non viene chiamata affatto. Il costo reale
sarebbe stato **una `stat`**, e comunque non viene pagato: con il listing
abilitato il lookup resta dopo il redirect.

**Test.** Nuova suite `__tests__/dirlisting-index-resolution.test.js` con la
matrice completa `enabled` × `index` × stato-su-disco, entrambe le forme dello
slash finale, `trailingSlash: false`, la root, i pattern RegExp e le due
invarianti. Aggiornati `dir-trailing-slash.test.js` e `index.test.js` dove
pinnavano il vecchio comportamento; in quest'ultimo è emersa e stata corretta
una svista di copia-incolla preesistente (il terzo `describe` monta `options3`
ma passava `options2` all'helper condiviso — invisibile finché l'helper leggeva
solo `dirListing.enabled`, identico nelle due config).

**Priorità:** Media-alta (correttezza: una richiesta legittima riceveva 404 per
un file esistente e servito al suo URL diretto).

---

## Quinta passata (2026-08-07) — revisione della copertura dei test

Rilettura integrale di `index.cjs` e delle 65 suite con una domanda sola: *quali
comportamenti reali non sono asseriti da nessun test?* La copertura di riga era
già al 98.5% stmts / 98.4% branch, quindi le lacune non erano di riga ma
**semantiche**: rami eseguiti da un test che ne asserisce un altro aspetto.

Esito: **4 nuove suite** (71 test) e **due voci** qui sotto. Nessuna delle due è
una vulnerabilità; la #8 è un difetto di coerenza dell'interfaccia del listing,
la #9 è codice morto.

### 8. Listing: `?order=` con valore non riconosciuto ordina in modo ASCENDENTE ma disegna la freccia DISCENDENTE

**Stato: RISOLTO.**

**Sintomo.** `GET /?sort=size&order=DESC` (maiuscolo, o qualsiasi valore diverso
da `desc`) restituisce le righe in ordine **ascendente** ma intesta la colonna
Size con la freccia **↓**, e il link della colonna attiva ripropone `order=asc`
— cioè cliccarlo non cambia nulla. Lo stato disegnato mente su quello servito.

**Causa.** `sortOrder` conservava il valore grezzo del parametro e i tre
consumatori lo testavano con **polarità opposta**:

| consumatore | test | valore ignoto ⇒ |
|---|---|---|
| comparatore `items.sort` | `sortOrder === 'desc'` | ascendente |
| `getSortIndicator` | `sortOrder === 'asc'` | ↓ (discendente) |
| `getSortUrl` (toggle) | `sortOrder === 'asc'` | link a `asc` |

Con `'asc'` e `'desc'` le tre letture coincidono, per questo il difetto non è
mai emerso: la suite copriva entrambi i valori validi e — in
`listing-special-entries.test.js` — il fatto che un `order` ignoto *ordina*
ascendente, ma nessun test confrontava l'ordine delle righe con la freccia
renderizzata.

**Fix.** Normalizzazione unica a monte:

```js
const sortOrder = orderParam === 'desc' ? 'desc' : 'asc';
```

I tre consumatori restano invariati e ora concordano per costruzione.
Comportamento identico a prima per `'asc'` / `'desc'` / parametro assente; cambia
solo il rendering dei valori non riconosciuti (freccia ↓ → ↑, toggle
`asc` → `desc`), che ora descrive le righe effettivamente mostrate.

**Test.** `__tests__/listing-sort-and-cap.test.js` — l'ordine delle righe è
confrontato con la freccia e con il target del link per ognuno di
`asc` / `desc` / `DESC` / valore ignoto / parametro assente. La stessa suite pinna
anche un'asimmetria preesistente ma non asserita: `compareDirsFirst` è cablato
nei comparatori `type` e `size` ma **non** in `name`, quindi una directory
ordinata per nome può finire dopo un file.

**Priorità:** Bassa (coerenza dell'interfaccia; nessun impatto su cosa viene
servito).

### 9. `loadFile()`: il ramo `if (!fileStat)` è irraggiungibile — entrambi i call site passano già lo stat

**Stato: APERTO** (nessuna azione presa: è una decisione di stile del manutentore).

`loadFile(toOpen, fileStat)` (`index.cjs:2467`) apre con un fallback che rifà
lo `stat()` quando il secondo argomento manca:

```js
if (!fileStat) {
    try { fileStat = await fs.promises.stat(toOpen); }
    catch (error) { _logger.error('File stat error:', error); await sendErrorPage(ctx, 404); return; }
}
```

I due soli call site lo passano sempre — `loadFile(path.join(toOpen,
indexFile.name), indexFile.stat)` (`index.cjs:2429`) e `loadFile(toOpen, stat)`
(`index.cjs:2449`) — quindi il ramo non è mai eseguito. È esattamente ciò che
resta scoperto nel report di coverage (righe 2470-2475): non una lacuna dei
test, ma codice morto. È l'**unico** blocco scoperto che non sia già
documentato come difensivo-per-scelta (gli altri: comparazione case-insensitive
riservata a darwin/win32, `_isWithinRoot` come difesa in profondità dopo
`path.normalize`, il `catch` del `decodeURIComponent` già validato dal
costruttore `URL`, il `catch` sincrono attorno alla pipeline del tee).

Due opzioni, entrambe legittime:

- **A — rimuovere il ramo** e rendere `fileStat` un parametro obbligatorio: −7
  righe, coverage a 100% su quel tratto, e un futuro call site che dimenticasse
  lo stat fallirebbe rumorosamente invece di pagare silenziosamente una `stat`
  in più.
- **B — tenerlo** come rete per un futuro call site, annotandolo con un commento
  `defensive:` come gli altri rami scoperti, così il report di coverage resta
  leggibile.

**Priorità:** Molto bassa (nessun impatto funzionale).

---

## Sesta passata (2026-08-22) — conformità HEAD (RFC 9110 §9.1 / §9.3.2)

### 10. Il default `method: ['GET']` rende il server non conforme: `HEAD` risponde 404 su OGNI path mentre `GET` risponde 200

**Problema:** con la configurazione di default il middleware rifiutava `HEAD`, che
cadeva in `next()` e finiva sul 404 di default di Koa. Misurato su server reale:

```
GET  /        -> 200   HEAD /        -> 404
GET  /a.txt   -> 200   HEAD /a.txt   -> 404
GET  /sub/    -> 200   HEAD /sub/    -> 404
```

Non è una funzione in meno: un 404 **afferma che la risorsa non esiste**, ed è falso.
RFC 9110 **§9.1** rende `GET` e `HEAD` il minimo che ogni server generalista **DEVE**
supportare; **§9.3.2** impone che `HEAD` rispecchi `GET` — stesso status, stessi header,
nessun body. Lo status di `HEAD` e quello di `GET` non possono divergere.

**Il punto dirimente:** il modello `next()` è corretto per POST/PUT/DELETE — un router a
valle può legittimamente gestirli — ma **nessun middleware a valle potrà mai servire
`HEAD` su un file statico, perché solo questo middleware sa che quel file esiste.** Per
`HEAD` il fall-through non delega nulla: produce solo un 404 falso.

**Incoerenza interna:** il progetto aveva già corretto **due volte** la divergenza
HEAD/GET trattandola come bug e citando §9.3.2 — in **3.0.1** (ramo template, impatto
dichiarato MEDIO) e in **4.0.0** (ramo streaming compression). Erano stati riparati due
rami periferici mentre il default riproduceva lo stesso difetto su ogni path.

**Costo di migrazione misurato:** con `HEAD` nel default la suite dava **1380 test verdi
su 1381**. L'unico fallimento era `option-boundary-values.test.js:229`, un test
**tautologico** che asseriva che il default esclude `HEAD`. Zero test comportamentali.

**Perché non è una "restrizione" secondo la filosofia del progetto:** il criterio di
`CLAUDE.md` è *«does this change the default observable behavior of `GET /path/to/file`?»*
— no, `GET` resta identico al byte. Cambia solo `HEAD`, da sbagliato a corretto. È lo
stesso inquadramento di `dirListing.trailingSlash` in 4.0.0 (*correctness fix, not a
restriction*), con un argomento più forte: quello modificava `GET`, questo no.

**Nessuna nuova esposizione:** il gate del metodo è il **primo** controllo; `urlPrefix`,
`urlsReserved`, path traversal, `isHiddenEntry` e `symlinkAllowed` stanno tutti a valle e
non sono condizionati al metodo. Una `HEAD` ammessa percorre la stessa identica pipeline
di autorizzazione di una `GET`, e rivela solo un sottoinsieme di ciò che `GET` già rivela
allo stesso chiamante.

**Risolto (opzione A — cambio di default in minor):**

1. `index.cjs` — default `['GET', 'HEAD']` + normalizzazione `.toUpperCase()` (vedi #11);
   blocco `opts STRUCTURE` riscritto con l'obbligo RFC e l'avvertenza sulla via di fuga.
2. La via di fuga resta onorata: `method: ['GET']` esplicito continua a escludere `HEAD`.
   La non conformità diventa una **scelta esplicita e documentata** invece di un incidente
   di default — coerente con «l'operatore è la fonte di verità». Nessun warning a runtime:
   sarebbe rumore su una configurazione legittima.
3. Il `next()` sui verbi non ammessi **resta invariato**. Rispondere `405` di propria
   iniziativa romperebbe ogni app `app.use(static); app.use(router)`; il `405` con `Allow`
   di §15.5.6 è responsabilità dell'applicazione composta, non del middleware. Documentato.
4. Costo accettato e documentato: con `serverCache.compressedFile.enabled` attivo, una
   `HEAD` a freddo su file comprimibile esegue la compressione completa, perché un
   `Content-Length` accurato è conoscibile solo comprimendo. Mitigato da single-flight e
   cache. I rami streaming short-circuitano invece (200, niente `Content-Length`: la deroga
   di §9.3.2 per gli header calcolabili solo generando il contenuto). Documentata anche
   l'implicazione: `serverCache.compressedFile.enabled` decide implicitamente il costo di
   una `HEAD`.
5. Test — `__tests__/head-parity-matrix.test.js`: una tabella, una riga per ramo di
   risposta, ciascuna annotata con il ramo che pinna. **Validata per mutazione** contro
   build deliberatamente rotte:
   - riprodotto il bug 3.0.1 (rimosso il mascheramento di `ctx.method`) → **catturato**
   - riprodotto il bug 4.0.0 (rimosso lo status 200 su HEAD nello streaming) → **catturato**
   - buffered che perde il `Content-Length` reale → **catturato**
   - default che torna a `['GET']` → **catturato** (13 righe su 14)
   - rami streaming che perdono lo short-circuit **interno** → **NON catturato**: la
     risposta resta identica byte per byte (Node stripa il body di una `HEAD` a livello di
     trasporto, e il tee abbandonato non arriva mai in cache), quindi la CPU sprecata non
     ha firma black-box. Limite dichiarato nel docblock del file: quell'ottimizzazione è
     protetta dai commenti al codice, non dai test.

**Revisione post-implementazione (stessa data).** Una revisione completa del diff ha
prodotto due rilievi, entrambi verificati e corretti nello stesso PR:

1. **`stripBodyForHead()` pubblicava un `Content-Length` che `GET` non inviava.** La
   funzione sostituiva qualunque body di render con un `Buffer` vuoto; il `respond()`
   di Koa, su HEAD, riempie un `Content-Length` mancante da `ctx.response.length`, che
   su un buffer vuoto vale **0**. Risultato misurato: body stream senza lunghezza
   dichiarata → `GET` chunked ma `HEAD: Content-Length: 0`; body stream con
   `ctx.length = 3` → `GET: 3` ma **`HEAD: 0`**; body oggetto → `GET: 24` ma
   `HEAD: 0`. Il caso intermedio è il dannoso: un client che dimensiona la risorsa con
   `HEAD` leggeva 0 byte. §9.3.2 consente di **omettere** un header calcolabile solo
   generando il contenuto, non di inviarne uno **diverso** da quello di `GET`.
   Un quarto caso emerso completando la copertura: body **non serializzabile**
   (circolare) → `GET: 500` ma `HEAD: 200` con corpo vuoto, cioè una divergenza di
   **status**, non solo di header. Corretto lasciando il body al suo posto, così Koa
   fallisce su `HEAD` esattamente dove fallisce su `GET`: rispecchiare il **fallimento**
   fa parte di §9.3.2 quanto rispecchiare il successo.
   Il bug è antecedente (arrivato con `stripBodyForHead()` in 3.0.1) ma richiedeva
   `method: ['GET','HEAD']` per essere raggiunto: corretto qui perché è questa release
   a renderlo raggiungibile di default. Corpo vuoto ora scelto per forma: `Buffer` dove
   la lunghezza è conoscibile, stream già terminato dove non lo è (per uno stream
   `ctx.response.length` è `undefined`, quindi l'header resta sotto controllo della
   funzione). Nessuna crescita di descrittori su 200 HEAD con stream di file reali.
2. **Le etichette di riga nella matrice erano sbagliate all'atto del merge.** Erano
   state scritte sui numeri di riga PRE-modifica, e la stessa commit aveva aggiunto 24
   righe sopra: una etichetta indicava un ramo diverso da quello che la sua riga
   esercita. Sostituite con **àncore grep-abili**, più un test che verifica che ogni
   àncora corrisponda esattamente una volta in `index.cjs` — così il marcire di un
   puntatore diventa un fallimento di test invece di una bugia silenziosa.

**Seconda revisione (stessa data), ambito allargato a tutto il payload della 5.3.0
(`469cde9..HEAD`).** Ha trovato due difetti **nella correzione stessa del punto 1**,
entrambi riprodotti e corretti:

3. **Le forme di body non-Node-stream di Koa 3 finivano nel ramo JSON.** Koa 3
   accetta anche `Blob`, `ReadableStream` (web) e `Response` (fetch); nessuna è
   uno stream Node, quindi `JSON.stringify()` le riduceva a `"{}"` →
   `Content-Length: 2`. Misurato: `Blob` da 32 byte → `GET: 32` ma `HEAD: 2`;
   `ReadableStream` e `Response` → `GET` chunked ma `HEAD: 2`. Errore di metodo:
   avevo enumerato le forme di body **a intuito** invece di rispecchiare la
   classificazione del setter di Koa.
4. **Un `Content-Length` dichiarato pari a 0 veniva scartato perché falsy.** Il
   ramo stream faceva `if (declaredLength)`. Misurato: stream su file da 0 byte con
   `ctx.length = 0` → `GET: Content-Length: 0` ma `HEAD` senza header.

Correzione strutturale: la lunghezza viene ora presa dal `Content-Length` **già
dichiarato dalla risposta** quando c'è, confrontato con `undefined` e mai
truth-testato. Questo copre più dell'esplicito `ctx.length`: il setter di Koa
dimensiona da solo stringhe, Buffer e `Blob` all'assegnazione. Solo in assenza di
un header dichiarato conta la forma, e l'insieme "non dimensionabile" ora nomina
tutte e tre le forme streaming di Koa. Otto righe di matrice coprono le otto forme,
validate per mutazione con la specificità attesa.

**Quarta passata (stessa data) — esame sistematico della copertura dei test.**
Invece di elencare a memoria i casi mancanti, è stato costruito un differenziale
GET/HEAD sul prodotto cartesiano configurazioni × richieste: **409 coppie
confrontate, 28 divergenze, tutte riconducibili a due classi già documentate come
benigne** (il 404 sintetico di Koa, che Koa non dimensiona mai su HEAD — riprodotto
su Koa nudo; e l'omissione di `Transfer-Encoding` sui rami streaming, deroga
§9.3.2). **Nessun difetto nuovo.**

Il confronto fra i 9 rami HEAD di `index.cjs` e le righe della matrice ha però
mostrato tre rami non pinnati: il 206 servito da `rawBuffer`, il non-compresso da
`rawBuffer` (entrambi raggiungibili solo a cache `rawFile` **calda**, mentre la
matrice usa istanze fredde per costruzione) e il fallback di compressione — che è
però già coperto su HEAD da `compression-fallback-deep.test.js`. Aggiunte cinque
righe con un meccanismo `warm` dedicato, più 304 via `If-Modified-Since`,
`If-Range` non corrispondente e range suffisso.

Lo sweep è stato reso permanente (`__tests__/head-parity-sweep.test.js`, ~450
coppie in ~3 s) e **validato per mutazione**: sei build rotte di proposito, sei
catturate. L'esercizio ha scoperto un buco reale nello sweep stesso — non aveva
alcuna configurazione con template engine, quindi la mutazione del bug 3.0.1 lo
lasciava completamente verde. Aggiunte due configurazioni template.

**Esito:** 72 suite / 1439 test verdi, lint pulito, coverage sopra le soglie.

---

### 11. `method` era l'unica opzione a valori enumerati senza guardia: verificare che non ce ne siano altre

**Problema:** prima della 5.3.0, `options.method` non aveva né normalizzazione né
validazione sul contenuto dell'array. Conseguenza:

```js
method: ['get', 'head']   // → 404 su TUTTO, GET compreso: middleware spento in silenzio
```

Nessun warning, nessun throw. `ctx.method` è sempre il token maiuscolo grezzo, quindi una
voce minuscola non corrisponde mai. Risolto in 5.3.0 con `.map(v => String(v).toUpperCase())`.

**Perché resta aperta:** verificando il resto della superficie di configurazione, `method`
è risultata l'**anomalia**, non la regola — le altre opzioni a valori enumerati hanno già
una guardia forte:

| Opzione | Valore invalido | Comportamento |
|---|---|---|
| `symlinks` | `'Follow'` | **throw** con messaggio guida (`index.cjs:1714`) |
| `hidden.*.default` | `'Hidden'` | **throw** (`index.cjs:1317`) |
| `hideExtension.redirect` | `999` | **throw** (`_VALID_REDIRECT_CODES`) |
| `compression.buffered/streaming` | fuori range | **throw** |
| `method` (pre-5.3.0) | `['get']` | **silenzio, middleware spento** |

**Parte `method`: CHIUSA in 5.3.0.** Decisione del manutentore (2026-08-23): la forma
corretta è **tutta maiuscola per ogni verbo**, non solo `GET`/`HEAD`; il minuscolo va
corretto **e segnalato**; la validazione copre anche le voci non utilizzabili.

Implementato con un canale nuovo, `warnConfigNotice()`. Non si poteva riusare
`warnConfigDeprecation()`: quel canale chiude da sé ogni messaggio con «WILL throw in a
future major version» ed è destinato a diventare un throw nella 6.0.0. Qui l'intento
dell'operatore è inequivocabile (`['get']` significa palesemente GET) e la correzione è
meccanica, quindi si è scelto un **avviso permanente** senza promessa di throw.

- valore non-array (`method: 'POST'`, `null`, `42`) → ricade sul default + notice. È la
  forma più dannosa delle tre, perché **scarta un intento dichiarato** invece di storpiarlo:
  `'POST'` chiede palesemente di servire POST, e il fallback silenzioso rispondeva 404
  proprio al verbo richiesto. Emersa dalla revisione del commit, non dall'implementazione
  iniziale — che aveva dichiarato chiusa la parte `method` lasciandolo aperto
- voce minuscola o mista → upper-case + notice che elenca le correzioni
- voce non utilizzabile (non stringa, oppure stringa fuori dal `token` di RFC 9110
  §5.6.2, es. `'BAD METHOD'`, `''`, `'a,b'`) → **scartata** + notice; i primitivi sono
  nominati per valore (`42`, non `number`)
- verbo valido ma inusuale (`'PURGE'`) → **nessun avviso**: il middleware serve
  qualunque verbo elencato, segnalarlo sarebbe rumore e contraddirebbe «l'operatore è
  la fonte di verità»
- dedupe once-per-process per messaggio distinto, come il resto

Test: `__tests__/method-normalization.test.js` (11 casi), validati per mutazione — sei
build rotte di proposito, sei catturate, inclusa quella che sostituisce il notice con una
deprecation.

**Resta da fare:** l'audit sulle opzioni **a forma libera** dove un valore malformato
degrada in silenzio anziché fallire — `urlPrefix`, `urlsReserved` con voci senza slash
iniziale, `index`, `template.ext` / `hideExtension.ext` rispetto al case — e la decisione
se il progetto voglia una politica uniforme o caso per caso.

**Aggiornamento 2026-09-01 — l'audit ora esiste, ed è eseguibile.**
`__tests__/option-shape-audit.test.js` percorre l'intera superficie a forma libera e,
per ogni valore malformato, fissa **due cose**: che cosa il middleware effettivamente
*serve*, e che cosa l'operatore viene a sapere (oggi: nulla). Il file è l'inventario di
ciò che dovrà cambiare quando la 6.0.0 promuoverà questi casi a warning o throw: ogni
asserzione che fallirà nominerà l'opzione interessata. Dall'audit sono emerse tre voci
che meritano un numero proprio perché non sono solo "robustezza di configurazione":
**#14** (le forme di `hidden` che lasciano il file servito), **#15**
(`compression.mimeTypes` che spegne la compressione) e **#16** (le due convenzioni
booleane opposte). La decisione sulla politica uniforme resta al manutentore.

**Priorità:** Bassa (nessun impatto noto sul comportamento servito; è robustezza di
configurazione).

---

### 12. Con un `Transfer-Encoding` impostato da un middleware a monte, i rami statici emettono anche `Content-Length` (illegale, RFC 9112 §6.1)

**Problema:** RFC 9112 §6.1 vieta di inviare `Content-Length` in un messaggio che porta
`Transfer-Encoding`. Se un middleware a monte imposta `Transfer-Encoding: chunked` e poi
delega al file server, i rami statici impostano comunque il proprio `Content-Length`.
Misurato su socket grezzo:

```
file semplice   GET TE=chunked CL=11  <ILLEGALE>  | HEAD TE=chunked CL=11  <ILLEGALE>
range 206       GET TE=chunked CL=100 <ILLEGALE>  | HEAD TE=chunked CL=100 <ILLEGALE>
gzip buffered   GET TE=chunked CL=41  <ILLEGALE>  | HEAD TE=chunked CL=41  <ILLEGALE>
listing         GET TE=chunked CL=-               | HEAD TE=chunked CL=-
```

Il parser HTTP del client rifiuta l'intera risposta (`HPE_INVALID_CONTENT_LENGTH`), quindi
la richiesta fallisce del tutto, non degrada.

**Perché NON è stato corretto nella 5.3.0:** è **simmetrico** — colpisce `GET` e `HEAD`
identicamente — quindi non è una violazione di §9.3.2 e non rientra nell'oggetto di quella
release. Ed è **preesistente**: non introdotto dal cambio di default. Il caso analogo sul
percorso template *era* asimmetrico (`GET` legale perché Node scarta la lunghezza sul
percorso di scrittura, `HEAD` illegale perché non scrive corpo e nulla riconcilia) ed è
stato corretto lì, dove ricadeva nell'oggetto della release.

**Da valutare:** se il file server debba rispettare un `Transfer-Encoding` deciso a monte
rinunciando al proprio `Content-Length`, oppure se impostare `Transfer-Encoding` prima di
un file server sia semplicemente un errore dell'operatore da documentare. Node gestisce da
sé il transfer encoding, quindi il caso è raro.

**Priorità:** Bassa (richiede un middleware a monte che faccia una cosa inusuale).

---

### 13. `stripBodyForHead()` reimplementa il dimensionamento del body di Koa: valutare di eliminarla

**Problema strutturale.** La funzione deve sapere, per conto proprio, come Koa
dimensiona **ogni** forma di body. È una conoscenza duplicata di una decisione che
Koa prende altrove, e ogni divergenza fra le due implementazioni è un difetto.
Non è un timore teorico: tre revisioni consecutive del PR della 5.3.0 hanno
prodotto **sei difetti, tutti in questa sola funzione**, tutti con la stessa
radice.

| Passata | Difetto | Sintomo |
|---|---|---|
| 1ª | body stream sostituito da `Buffer` vuoto | `GET` chunked, `HEAD: Content-Length: 0` |
| 1ª | body non serializzabile (circolare) | `GET: 500`, `HEAD: 200` — divergenza di **status** |
| 2ª | `Blob` / `ReadableStream` / `Response` nel ramo JSON | `GET: 32`, `HEAD: 2` |
| 2ª | `Content-Length` dichiarato pari a 0 truth-testato | `GET: 0`, `HEAD` senza header |
| 3ª | `isStream()` di Koa è strutturale, non `instanceof` | `GET` chunked, `HEAD: Content-Length: 62` |
| 3ª | `Content-Length` accanto a `Transfer-Encoding` | risposta illegale, il parser del client la rifiuta |

La gravità è calante e la terza passata è stata guidata dal sorgente di Koa
anziché dall'intuizione, quindi la copertura attuale è argomentabile. Ma la
funzione resta il punto di contatto più fragile fra middleware e framework, e
ogni nuova forma di body accettata da Koa è un difetto potenziale.

**Proposta: non ricalcolare la lunghezza affatto.** Lasciare il body al suo posto
e far dimensionare la risposta a Koa con la **propria** logica — che per
costruzione non può divergere da `GET`.

Il meccanismo, verificato a runtime su Koa 3.2.1 nudo:

- `respond()` ha un ramo `HEAD` che fa `return res.end()` **prima** della logica
  di dimensionamento: è per questo che oggi la lunghezza non viene mai calcolata
  e qualcuno deve farlo al posto suo.
- `res._hasBody` è deciso da Node al parsing della richiesta, **prima** che
  qualsiasi middleware giri, e non cambia se `ctx.method` viene riscritto dopo.
- Quindi, lasciando `ctx.method === 'GET'` fino a `respond()`, Koa prende il ramo
  `GET` e dimensiona da sé, mentre Node continua a non inviare corpo.

Misurato (Koa nudo, middleware che imposta `ctx.method = 'GET'` e un body da 10 byte):

```
GET   -> Content-Length: 10   byte di corpo ricevuti: 10
HEAD  -> Content-Length: 10   byte di corpo ricevuti: 0
```

`stripBodyForHead()` sparirebbe, e con lei l'intera classe di difetti della tabella
sopra.

**La tensione, che è reale.** Con `respond()` sul ramo `GET`, gli stream vengono
**effettivamente pipati**: Node scarta i byte, ma la sorgente viene letta. È
esattamente il lavoro che gli short-circuit HEAD odierni esistono per evitare —
sul ramo streaming della compressione, sul ramo sopra `compression.maxFileSize`, e
sui rami statici che oggi non aprono nemmeno il file. Non è un guadagno gratuito:
si rimuove una classe di difetti e si reintroduce una classe di costo.

**Mitigazione suggerita:** applicarlo **solo al percorso template**, dove
`stripBodyForHead()` vive e dove sono nati tutti e sei i difetti, lasciando
intatti gli short-circuit espliciti dei rami statici e di compressione. Sul
percorso template il render viene comunque eseguito per intero anche su `HEAD`
(è il mascheramento di `ctx.method` della 3.0.1), quindi il body è già prodotto e
pipare il risultato costa relativamente poco.

**Da verificare prima di procedere:**

1. Che lasciare `ctx.method === 'GET'` non rompa nulla a valle. Il setter di Koa
   scrive su `req.method`, quindi la modifica è **visibile all'esterno**: logger,
   gestori d'errore e middleware a valle vedrebbero `GET` su una richiesta `HEAD`.
   È il rischio principale della proposta.
2. Quanto costa davvero pipare-e-scartare un render che produce uno stream grande.
3. Che la gestione degli errori di `respond()` si comporti allo stesso modo.
4. Che le **dieci righe** di `__tests__/head-parity-matrix.test.js` restino verdi:
   la matrice è precisamente lo strumento per validare lo scambio, ed è il motivo
   per cui questa proposta è affrontabile con una rete sotto.

**Priorità:** Media. Nessun difetto aperto oggi, ma la recidiva è documentata e la
proposta la elimina alla radice invece di aggiungere righe di matrice a ogni giro.

---

## Settima passata (2026-09-01) — copertura: configurazioni e combinazioni non testate

Passata mirata sulla **copertura comportamentale**, non sulle righe: `index.cjs` era già
al 98.4% stmts / 98.25% branch, quindi le lacune residue non sono rami irraggiungibili ma
**combinazioni** di configurazione e forma della richiesta che nessuna suite attraversava.
Metodo: enumerazione della superficie di opzioni dal blocco `opts STRUCTURE`, confronto
con quello che le 72 suite esistenti effettivamente istanziano, e sonda empirica di ogni
combinazione scoperta.

Baseline di partenza (`npm run test:ci`): 72 suite / 1446 test verdi. Esito: **7 nuove
suite, 175 nuovi test** — 79 suite / 1621 test con `test:ci`, 80 / 1631 con la suite
completa; tutti verdi, lint pulito, coverage invariata (98.4% stmts / 98.25% branch),
come atteso trattandosi di combinazioni e non di righe nuove. Le lacune chiuse:

| Suite | Superficie che nessun test attraversava |
|---|---|
| `urlprefix-multisegment.test.js` | `urlPrefix` a **più segmenti** (`/a/b`): ogni test precedente usava un segmento solo, quindi il ciclo di matching girava solo nel caso degenere a un'iterazione. Include la superficie di bypass (segmento parziale, case, `%2F`, `//` iniziale, dot-segment) |
| `listing-pagination-params.test.js` | coercizione di `?page` (float, esponente, negativo, ripetuto, non numerico), clamp, e l'interazione `maxEntries × entriesPerPage` (paginazione calcolata sull'insieme troncato) |
| `server-cache-staleness.test.js` | i casi in cui il validatore `mtime`+`size` **diverge dai byte su disco**: riscrittura atomica a parità di dimensione, `mtime` che torna indietro, file reso illeggibile dopo il caching |
| `option-shape-audit.test.js` | l'audit a forma libera del **#11**, reso eseguibile (vedi sopra) |
| `hideextension-name-shapes.test.js` | nomi che la regola del suffisso non prevedeva: una **directory** che finisce col suffisso nascosto, un suffisso composto, un file il cui nome *è* il suffisso, nomi non-ASCII |
| `symlink-cycles.test.js` | cicli e auto-riferimenti nei **tre** modi di `symlinks` (il test circolare esistente era una richiesta sola, un modo solo, soddisfatta da qualunque `[404, 500]`) |
| `template-response-contract.test.js` | che cosa il middleware fa con quello che il render lascia su `ctx`, e che cosa **smette** di fare una volta che un render è girato |

Quattro voci nuove, tutte di **robustezza di configurazione**: nessuna è un bug di
correttezza sul percorso servito, ma tre delle quattro degradano **in silenzio** e una
di quelle tre degrada nella direzione insicura.

---

### 14. `hidden` con la forma sbagliata fallisce APERTO e in silenzio: il file resta servito

**Stato: ✅ RISOLTO in 5.3.1** (2026-09-01 — opzione «avvisare, non rifiutare»,
richiesta dal manutentore). Ogni ramo di `normalizeHiddenConfig` che **scarta**
quello che l'operatore ha scritto ora lo segnala tramite `warnConfigDeprecation`,
il canale che chiude da sé ogni messaggio con «WILL throw in a future major
version» — quindi l'avviso porta con sé la promessa del throw in 6.0.0, come
richiesto. Il **comportamento servito è invariato**: `hidden` è v2-stable, e
cambiare ciò che serve su una patch sarebbe esattamente il breaking change che
l'avviso esiste per evitare.

I messaggi non si limitano a nominare il tipo atteso: nominano la **conseguenza**,
perché è quella che l'operatore deve capire —

```
[koa-classic-server] DEPRECATION: hidden.dotFiles must be an object like
  { default: "hidden", whitelist: [], blacklist: [] }; got string ("hidden" —
  did you mean { default: "hidden" }?) — it is IGNORED, so hidden.dotFiles.default
  stays "visible" and those entries remain SERVED.
  This is tolerated for now and WILL throw in a future major version.
```

Coperti: namespace non-oggetto; categoria (`dotFiles`/`dotDirs`) non-oggetto;
lista di pattern (`whitelist`/`blacklist`/`alwaysHide`) non-array; voce dentro
una lista valida che non è né stringa né RegExp. Il caso `undefined` (opzione
semplicemente non configurata) **non** avvisa: assente non è malformato.

Test: `__tests__/hidden-shape-warnings.test.js` (33 casi) fissa il contratto del
messaggio — path dell'opzione, forma arrivata, conseguenza «stays SERVED»,
annuncio del 6.0.0, dedupe once-per-process — e, per ogni forma, che ciò che il
middleware **serve** non si è mosso. Le quattro asserzioni sul silenzio in
`__tests__/option-shape-audit.test.js` sono passate da «non viene segnalato
nulla» all'avviso: è esattamente il lavoro per cui quell'inventario era stato
scritto, ed è servito da checklist della modifica.

Restano aperte, per scelta, le due voci sorelle emerse dallo stesso audit:
**#15** (`compression.mimeTypes`) e **#16** (le due convenzioni booleane opposte).
Costano banda e sorpresa, ma **nessuna delle due fallisce aperto** — è quella la
differenza che ha fatto passare la #14 per prima.

Documentazione: `docs/SECURITY_HARDENING.md` §3.1 elenca ora i quattro
near-miss e raccomanda di **verificare l'esito** (`curl … /.env` → `404`)
invece di fidarsi della configurazione.

**Posizione:** `normalizeHiddenConfig` / `normalizeCategory` / `filterPatternList`
(`index.cjs:1519-1554`).

**Problema:** tutte e tre le normalizzazioni del namespace `hidden` scartano un valore
della forma sbagliata e **ricadono sul default di sistema**, che è `'visible'` / lista
vuota. L'effetto è che una configurazione *quasi* corretta non protegge niente:

```js
hidden: { dotFiles: 'hidden' }              // invece di { default: 'hidden' } → .env SERVITO
hidden: { dotFiles: { blacklist: '.env' } } // invece di ['.env']              → .env SERVITO
hidden: { alwaysHide: '*.key' }             // invece di ['*.key']             → secret.key SERVITO
hidden: 'yes'                               // namespace intero scartato        → .env SERVITO
```

Nessun warning, nessun throw: `logger.warn` non viene chiamato in nessuno dei quattro casi.

**Perché è diverso dalle altre coercizioni silenziose:** è l'**unica** che fallisce nella
direzione insicura. `dirListing.enabled: 'false'` mostra un listing che l'operatore voleva
spegnere — visibile alla prima richiesta. `hidden` malformato lascia servito un file che
l'operatore credeva nascosto — invisibile finché qualcuno non lo chiede. E la guardia
esiste già, un livello più sotto: `hidden.dotFiles.default: 'maybe'` **throwa**. È solo la
forma del *contenitore* a non essere controllata, non quella del valore.

**Nota sulla filosofia di progetto:** questo NON è un caso di "il default deve proteggere".
I dot-file visibili di default sono una scelta deliberata e documentata. Il punto è
un altro: qui l'operatore ha **espresso un'intenzione**, e l'intenzione viene scartata
senza dirlo. Segnalarlo non cambia nessun default.

**Test:** describe *"hidden — a wrong shape fails OPEN, in silence"* in
`__tests__/option-shape-audit.test.js` — i quattro casi sopra, ciascuno con
l'asserzione sul corpo servito **e** su `logger.warns`, più il contrasto col caso
guardato (`dotFiles.default` invalido → throw) e con quello che funziona (voci
invalide *dentro* una lista valida: scartate, le valide continuano ad applicarsi).

**Proposta (implementata in 5.3.1):** `warnConfigDeprecation()` sui quattro casi
(canale già esistente, dedupe once-per-process, promessa di throw in 6.0.0 già nel
messaggio). Nessun cambio di comportamento servito.

**Priorità:** Media — nessun impatto sul percorso servito con configurazione corretta,
ma è l'unica coercizione silenziosa il cui esito è "il segreto è esposto".

---

### 15. `compression.mimeTypes`: una lista non vuota di voci invalide sostituisce i default e spegne la compressione in silenzio

**Posizione:** `normalizeCompressionConfig` (`index.cjs:1813-1815`).

```js
const mimeTypes = Array.isArray(compression.mimeTypes) && compression.mimeTypes.length > 0
    ? compression.mimeTypes
    : DEFAULT_COMPRESSIBLE_MIME_TYPES;
```

**Problema:** la condizione tratta `[]` e i non-array come «non impostato» (ricade sui
default — ragionevole), ma tratta **qualunque** array non vuoto come una lista deliberata,
senza guardare che cosa contiene. Una lista con un refuso — `['text/plian']`, `[123]`, o
un array di estensioni invece di MIME type — sostituisce i default con una lista che non
corrisponde a niente: **la compressione si spegne per l'intero deployment**, senza warning
e senza nemmeno un `Vary: Accept-Encoding` che lasci intuire che una negoziazione è
avvenuta. Su un file server è una regressione di banda invisibile fino a che qualcuno non
misura.

**Test:** describe *"compression.mimeTypes — empty falls back, garbage replaces"* in
`__tests__/option-shape-audit.test.js` — i due lati dell'asimmetria, il caso garbage con
asserzione su `content-encoding`, `vary` e `logger.warns`, e il caso legittimo (una lista
custom valida sostituisce i default: quello è l'intento documentato e resta).

**Proposta:** filtrare le voci non-stringa e avvisare, oppure avvisare quando la lista
normalizzata risulta vuota. Nessun cambio per le liste valide.

**Priorità:** Bassa-Media (nessun impatto su correttezza; impatto su prestazioni/banda).

---

### 16. Due convenzioni opposte per le opzioni booleane, entrambe silenziose

**Problema:** le opzioni booleane del middleware si dividono in due gruppi che coercono
un valore non booleano in **direzioni opposte**:

| Convenzione | Opzioni | `'false'` (stringa) | `'yes'` (stringa) |
|---|---|---|---|
| truthiness (`!!x`) | `dirListing.enabled`, `dirListing.trailingSlash` | **true** (listing acceso) | true |
| tipo stretto (`typeof x === 'boolean' ? x : default`) | `browserCacheEnabled`, `serverCache.*.enabled`, `compression.enabled` | default | **default** (cache spenta) |

Quindi `dirListing.enabled: 'false'` **accende** il listing che l'operatore voleva
spegnere, mentre `browserCacheEnabled: 'yes'` **spegne** la cache che voleva accendere.
Entrambe le forme arrivano naturalmente da una configurazione letta da variabili
d'ambiente o da un file `.env` senza cast — il caso d'uso più comune per cui un booleano
arriva come stringa. Nessuna delle due avvisa.

**Test:** describe *"boolean options coerce by truthiness — the classic 'false' string
trap"* in `__tests__/option-shape-audit.test.js`, con le due convenzioni messe a
confronto nello stesso blocco.

**Nota:** `compression.enabled` non booleano è già coperto da
`__tests__/config-normalization-more.test.js`; qui interessa il **contrasto** fra le due
regole, non i singoli casi.

**Proposta:** scegliere una convenzione e avvisare sull'altra forma, oppure — a costo
zero e senza breaking — avvisare in entrambi i gruppi quando il valore non è booleano.

**Priorità:** Bassa (robustezza di configurazione).

---

### 17. La sonda di leggibilità è saltata su un HIT della cache `rawFile`, contro l'intento dichiarato dal suo stesso commento

**Posizione:** `loadFile` (`index.cjs:2771-2782`).

```js
// Skip if rawBuffer already loaded — the successful readFile() is equivalent proof.
// [...] this probe is kept for the outcomes that never open the file
// (compressed-cache hits, 304s, HEAD): dropping it would let a file made
// unreadable after caching keep being served from RAM.
if (!rawBuffer) {
    await fs.promises.access(toOpen, fs.constants.R_OK);
}
```

**Problema:** il commento formula **due** giustificazioni che non coincidono. La prima
(«una readFile appena riuscita è prova equivalente») vale solo quando `rawBuffer` viene da
una lettura fatta *in questa richiesta*. La seconda dice esplicitamente che la sonda
esiste perché «un file reso illeggibile dopo il caching non deve continuare a essere
servito dalla RAM». Ma la guardia è `if (!rawBuffer)`, e su un **hit** della cache
`rawFile` il buffer arriva dalla RAM, non da una readFile: la sonda viene saltata proprio
nel caso che la seconda giustificazione voleva coprire.

Ne risulta un'asimmetria fra le due cache, verificata a runtime:

| Situazione | Sonda `R_OK` | Esito |
|---|---|---|
| nessuna cache | eseguita | **404** |
| hit cache `compressedFile` | eseguita | **404** |
| hit cache `rawFile` | **saltata** (0 chiamate) | **200 dalla RAM** |

**Non è necessariamente un difetto:** «la cache è uno snapshot, resta valida finché
`mtime`/`size` non si muovono» è una posizione difendibile, e coerente con il fatto che
un `chmod` non cambia né mtime né size (quindi *nessun* validatore lo vedrebbe: renderla
simmetrica costerebbe una `access()` per ogni hit, cioè il costo che la cache esiste per
evitare). La voce è aperta perché **codice e commento affermano cose diverse**, e va
deciso quale delle due è la specifica.

**Test:** describe *"a file made unreadable AFTER it was cached"* in
`__tests__/server-cache-staleness.test.js` — i tre casi della tabella, con
`expect(spy).not.toHaveBeenCalled()` sull'hit `rawFile` per rendere esplicito che la
sonda non viene proprio raggiunta.

**Proposta:** a costo zero, correggere il commento perché descriva la guardia reale
(la sonda copre gli esiti *senza buffer*: hit compressi, 304, HEAD). Se invece si
sceglie la simmetria, la sonda va spostata dopo il lookup e prima del ramo `fresh`,
misurando il costo per hit.

**Priorità:** Bassa (nessun impatto su integrità; documentazione interna divergente).

---

## Punti di forza rilevati (nessuna azione richiesta)

Registrati per completezza della revisione:

- **Tutti i registri precedenti onorati:** le 16 voci del v4.3 e le 20 del v3.1
  sono implementate come descritto (verificato sul codice).
- **Negoziazione encoding** (`getClientEncoding`) conforme a RFC 9110 §12.5.3:
  preferenza server, esclusione q=0, `*` come fallback, match token esatto
  (`x-gzip` ≠ `gzip`). Verificati i casi `identity`, `*`, `gzip;q=0, *`, `br;q=0, gzip`.
- **Precedenza validatori/Range e ramo esclusivo `If-None-Match`/`If-Modified-Since`**
  (v4.3 #3) corretti; il cross-encoding ETag (`-br`/`-gz`) evita falsi 304 tra
  rappresentazioni.
- **Tee streaming**: contabilità `_inflightTeeBytes` bilanciata su tutti i rami
  (chunk over-budget, completamento pulito, errore, abbandono a metà) —
  ri-verificata riga per riga; nessun insert su stream troncato; `abandonAccumulation`
  idempotente.
- **LFUCache** con le due cinture del v4.3 #4 (delete incondizionato in
  `refreshOrInsert` + guardia in `set()`): l'invariante "set = chiave nuova" vale
  per costruzione, niente chiavi-fantasma in due bucket.
- **Encoder totali ai confini di output** (v4.3 #14/#15): `toWellFormedName`
  prima di ogni `encodeURIComponent`, `listingDisplayName` con U+FFFD visibile +
  `<bdi>`. Le regex globali (`_HTML_ESCAPE_RE`, `_LONE_SURROGATE_RE`,
  `_BIDI_CONTROLS_RE`) sono usate **solo** in `.replace()` — nessun bug di
  `lastIndex` stateful da `.test()`.
- **Percorsi traversal/symlink/hidden** invariati e solidi: decode → null-byte →
  normalize → boundary check `_isWithinRoot` (con sep, case-insensitive su
  darwin/win32); 404 indistinguibile; open-redirect guard su `//`/`/\` sia in
  hideExtension che nel redirect trailing-slash.
- **Error containment** completo: catch di ultima istanza, scrub degli header di
  rappresentazione, `no-store` sui 5xx, `ctx.res.destroy()` a header partiti,
  pagine d'errore custom con refresh mtime/size senza riavvio e fallback throttled.
- **Gestione HEAD** accurata su tutti i rami (mirror RFC 9110 §9.3.2 nel render
  template via `stripBodyForHead`, e il 200-senza-Content-Length sui rami streaming
  compressi bufferizzato/tee).
- **Immutabilità della config del chiamante** (`options = { ...opts }` + copia
  mirata di `template`/`hideExtension`); validazione a factory time con hint di
  migrazione; deprecazioni warn-ora/throw-in-6.0.0 coerenti.
- Suite di 1249 test / 61 suite, lint pulito.

---

## Verifiche della seconda passata (2026-07-20) — nessuna azione richiesta

Controlli mirati al cambio di piattaforma V5 (Koa ≥ 3.1.2, Node ≥ 20),
eseguiti sul sorgente di **Koa 3.2.1** installato e a runtime dove indicato:

- **Suite verde su Koa 3:** `npm run test:ci` → 60 suite / 1243 test passati
  su Koa 3.2.1 + Node 22 (inclusa `robustness-misc.test.js:202`, che su Koa 2
  si appendeva — conferma della risoluzione del #3 sulla piattaforma
  supportata).
- **Nessuno shim Koa-2 residuo:** il codice non contiene rami condizionati
  alla versione di Koa; i pattern storicamente delicati valgono identici su
  Koa 3, verificati sul sorgente 3.2.1: il restore del `Content-Length` dopo
  `ctx.body = Buffer.alloc(0)` sugli HEAD resta necessario (il body setter
  azzera la length anche in Koa 3, e `respond()` non la sovrascrive se già
  presente: `!ctx.response.has('Content-Length')`); `ctx.status = code` prima
  di `ctx.redirect()` resta il modo corretto di scegliere il codice
  (`statuses.redirect[this.status]`); la distruzione automatica del vecchio
  stream quando `ctx.body` viene riassegnato (su cui conta
  `stripBodyForHead`) esiste ancora (`cleanupPreviousStream` nel body setter).
- **`_VALID_REDIRECT_CODES` allineato a Koa 3:** `statuses.redirect` del
  pacchetto `statuses` usato da Koa 3.2.1 è esattamente
  {300, 301, 302, 303, 305, 307, 308} — il commento in `index.cjs:17-22`
  resta accurato.
- **Query parser Koa 3 (URLSearchParams):** Koa 3 ha sostituito
  `querystring` con un parser basato su `URLSearchParams`
  (`koa/lib/search-params.js`), ma i parametri ripetuti (`?sort=a&sort=b`)
  arrivano ancora come **array** (`getAll`) — la guardia `firstQueryValue`
  del listing (v4.3 #12) resta necessaria e corretta. `?sort` senza valore →
  `''` → fallback a `name`, come prima.
- **`Readable.from(rawBuffer)`:** semantica confermata su Node ≥ 20 — un
  Buffer non viene iterato byte-per-byte ma emesso come singolo chunk
  (comportamento documentato di `stream.Readable.from`).
- **`String.prototype.toWellFormed()` nativo senza fallback** (`index.cjs:406`)
  — coerente con `engines >=20`; `Buffer.subarray` già usato al posto del
  deprecato `Buffer.slice` (DEP0158).
- **Documentazione allineata:** README (badge `koa >=3.1.2`, riga "Requires
  Node ≥ 20 and Koa ≥ 3.1.2"), `docs/DOCUMENTATION.md` (sezione Requisiti),
  CHANGELOG (⚠️ Breaking Changes v5.0.0) e matrice CI (Node 20/22/24, niente
  18) sono coerenti con `package.json`. Unica eccezione: il lockfile e una
  riga di `security_improvement_for_V3.md` → voce **#4**.
- **Modernizzazioni Node 20 valutate e NON adottate** (nessun beneficio
  funzionale, solo churn): prefisso `node:` sugli import core e rimozione del
  ridondante `const { URL } = require('url')` (la classe `URL` è globale) —
  cosmetici, eventualmente da accorpare a un futuro intervento sul file;
  `AbortSignal.any()` / `AbortSignal.timeout()` semplificherebbero
  `tryRenderTemplate`, ma richiedono Node ≥ 20.3 — non adottabili finché
  `engines` dichiara `>=20` senza patch minima (alzare il floor per un
  refactor cosmetico non vale il breaking); `Array.prototype.toSorted` non
  porta nulla rispetto agli usi attuali di `.sort()` su array già effimeri.
