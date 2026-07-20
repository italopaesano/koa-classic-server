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
integrità); **confermato a runtime**, aperto, in attesa di decisione sul fix.

---

## Indice / Checklist

### Minori / conformità / coerenza
- [x] [1. Le pagine d'errore 404 escono senza alcun `Cache-Control` (heuristic caching di un 404)](#1-le-pagine-derrore-404-escono-senza-alcun-cache-control-heuristic-caching-di-un-404) — **RISOLTO** (opzione A: `no-store` su ogni error page, non solo ≥ 500)
- [x] [2. `If-Range` in forma data non onorato → 200 pieno invece di 206](#2-if-range-in-forma-data-non-onorato--200-pieno-invece-di-206) — **CHIUSO / WONTFIX** (opzione A: solo validatore forte per `If-Range`; degrado sicuro al 200; documentato)

### Robustezza / disponibilità
- [ ] [3. Errore di un body-stream dopo l'invio degli header → socket mai chiuso, client appeso fino a `requestTimeout` (5 min)](#3-errore-di-un-body-stream-dopo-linvio-degli-header--socket-mai-chiuso-client-appeso-fino-a-requesttimeout-5-min)

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

**Stato: 🔍 APERTO — CONFERMATO A RUNTIME** — decisione del manutentore sul fix
(vedi "Opzioni" sotto).

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

**Priorità:** Media (disponibilità / resource-leak, non integrità; richiede un
errore di lettura a metà stream — non comune ma reale su storage che cede o FS di
rete; l'impatto è limitato dal `requestTimeout` di 5 min ma 5 min × connessioni è
significativo. Fix a basso rischio, ricalca un pattern già presente nel codice).

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
