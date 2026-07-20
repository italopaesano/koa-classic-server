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
