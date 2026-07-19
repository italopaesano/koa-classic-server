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
(verificato leggendo il codice, non solo le checkbox). I due punti sotto sono
**minori** e, per entrambi, la decisione se intervenire spetta al manutentore:
non sono bug di correttezza — il comportamento servito non è mai *sbagliato*, è
solo sub-ottimale o non uniforme rispetto a una decisione già presa altrove nel
codice.

---

## Indice / Checklist

### Minori / conformità / coerenza
- [ ] [1. Le pagine d'errore 404 escono senza alcun `Cache-Control` (heuristic caching di un 404)](#1-le-pagine-derrore-404-escono-senza-alcun-cache-control-heuristic-caching-di-un-404)
- [ ] [2. `If-Range` in forma data non onorato → 200 pieno invece di 206](#2-if-range-in-forma-data-non-onorato--200-pieno-invece-di-206)

---

## Minori / conformità / coerenza

### 1. Le pagine d'errore 404 escono senza alcun `Cache-Control` (heuristic caching di un 404)

**Stato: 🔍 APERTO** — decisione del manutentore (vedi "Opzioni" sotto).

**Posizione:** `writeErrorPage` (`index.cjs:204-211`); lista di scrub
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

**Stato: 🔍 APERTO** — probabile wontfix consapevole (vedi sotto).

**Posizione:** `index.cjs:2557-2558` (`const ifRange = ctx.get('If-Range'); if (!ifRange || ifRange === baseEtag)`).

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
