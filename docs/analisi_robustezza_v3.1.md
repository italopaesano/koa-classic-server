# Analisi di robustezza — koa-classic-server v3.1.0

**Data analisi:** 2026-07-07
**Oggetto:** `index.cjs` (2192 righe), configurazione CI, processo di sviluppo
**Baseline verificata:** 604/604 test verdi (25 suite, ~9 s), ESLint pulito, working tree pulito
**Documenti correlati:** `docs/revisione_codice_v3.1.md` (registro ufficiale findings aperte),
`docs/security_improvement_for_V3.md` (roadmap sicurezza, `[F-1]`), `docs/SECURITY_HARDENING.md`

> I riferimenti a righe di codice (`index.cjs:NNNN`) fotografano lo stato al commit
> di questa analisi e potrebbero slittare con le modifiche successive.

---

## Sintesi esecutiva

Il progetto è già ben oltre la media per rigore: registro findings mantenuto, filosofia di
design esplicita, 604 test, guardie di path traversal stratificate, policy symlink ben
progettata, escaping XSS coerente, timeout con AbortSignal, cache LFU con eviction O(1).

I tre interventi con il massimo ritorno in robustezza sono:

1. **Tetto sulla compressione + fix eviction LFU** (registro #4) insieme al
   **single-flight** (registro #5) — chiude l'unico vettore DoS rimasto con config di default;
2. **Fix del leak di file descriptor nello streaming compresso** (finding nuova B1);
3. **CI su push/PR con matrice Node/OS** (C1) — trasforma tutto il resto da
   "verificato una volta" a "garantito nel tempo".

Subito dietro: il 304 sub-secondo (registro #2, fix a una riga) e le validazioni
anti-footgun di configurazione (registro #10/#11).

L'analisi è divisa in tre parti:

- **A.** Prioritizzazione delle 15 voci già censite in `revisione_codice_v3.1.md`
- **B.** Problemi **nuovi**, non presenti nel registro
- **C.** Suggerimenti di processo / infrastruttura

---

## Indice / Checklist di lavoro

Spuntare ogni voce (`[x]`) quando la problematica è stata affrontata e chiusa
(fix implementato + test + revisione), annotando accanto il commit di riferimento.
Le voci `#N` rimandano al registro `revisione_codice_v3.1.md` (la cui checkbox va
spuntata in parallelo); le voci `B*`/`C*` sono definite in questo documento.

### Fase 1 — Robustezza del processo
- [x] **#5** Single-flight sulle cache (thundering herd) — risolto 2026-07-07, `__tests__/single-flight.test.js`
- [x] **#4** Tetto `compression.maxFileSize` + early-return in `LFUCache.set()` — risolto 2026-07-07, `__tests__/compression-max-file-size.test.js`
- [x] **B1** Leak di fd nello streaming compresso (`stream.pipeline`) — risolto 2026-07-07, registro §17, `__tests__/streaming-abort.test.js`
- [x] **#2** `If-Modified-Since` mai 304 con mtime sub-secondo — risolto 2026-07-07, test in `caching-headers.test.js`
- [x] **#15** `Buffer.slice()` → `subarray()` — risolto 2026-07-07

### Fase 2 — Infrastruttura + reti di sicurezza
- [x] **C1** Workflow CI su push/PR (matrice Node/OS) — risolto 2026-07-08: Node 18/20/22/24 su Linux + Node 22/24 su Windows + Node 20/22/24 su macOS, **tutti bloccanti** (12 job verdi verificati sul run CI; Windows e macOS introdotti informativi per un run e poi promossi). Windows/Node 18-20 esclusi per flakiness di teardown (`rmSync` ricorsivo vs handle servito, risolta da Node 22+; non un bug del prodotto — coperto su Linux). macOS aggiunge copertura del ramo `darwin` case-insensitive e dei test symlink nativi. Job lint dedicato, job perf e Nix non bloccanti; `engines` resta `>=18`
- [x] **B3** Catch di ultima istanza nel middleware — risolto 2026-07-08, registro §18, `__tests__/error-containment.test.js`
- [x] **B2** try/catch su `new URL()` nel ramo hideExtension — risolto 2026-07-08, registro §19, `__tests__/error-containment.test.js`

### Fase 3 — Footgun config + correttezza
- [x] **#10** Copia di `opts` + errore esplicito su `null` — risolto 2026-07-08, `__tests__/options-immutability.test.js`
- [x] **#11** Validazione `urlPrefix` / `urlsReserved` — risolto 2026-07-08 (deprecation warn una-tantum + comportamento invariato, throw rimandato a v4; entry non-stringa scartata), `__tests__/url-prefix-reserved-validation.test.js`
- [ ] **#3** Redirect canonico `/dir` → `/dir/`

### Fase 4 — Conformità HTTP, minori, processo
- [ ] **#6** q-value di `Accept-Encoding` (`q=0` da onorare)
- [ ] **#7** `Vary: Accept-Encoding` incompleto (304 e risposte non compresse)
- [ ] **#8** Precedenza Range vs validatori; 206 senza ETag/Last-Modified
- [ ] **#9** `If-None-Match`: liste con virgole e `*`
- [ ] **#12** `browserCacheMaxAge` negativo coerciuto silenziosamente
- [ ] **#13** Link "Parent Directory" fuori da `urlPrefix`
- [ ] **#14** `hideExtension`: incoerenza decoded/raw
- [ ] **#16** Riga "empty folder" con entry tutte nascoste
- [ ] **C2** Property-based / fuzz testing sui parser manuali
- [ ] **C3** Soglia di coverage in CI
- [ ] **C4** Typings `index.d.ts`
- [ ] **C5** Allineamento documentazione (conteggio test in CLAUDE.md)

---

## A. Voci del registro: ordine d'attacco consigliato

Dal punto di vista "robustezza e resistenza" le 15 voci aperte non pesano tutte uguale.
Raggruppamento in tre ondate:

### Ondata 1 — robustezza del processo (priorità massima)

#### #4 — Compressione senza tetto di dimensione

È l'unico vero vettore DoS rimasto con la configurazione di default: un file testuale da
GB richiesto con `Accept-Encoding: br` viene bufferizzato interamente in RAM e compresso
a brotli Q11 in un colpo solo. A differenza di `serverCache.rawFile` (che ha
`maxFileSize: 1 MB`), il percorso di compressione non ha alcun limite.

Il fix è duplice e piccolo:

1. `compression.maxFileSize`: sopra soglia si devia sul percorso **streaming già
   esistente** (zlib transform, RAM bounded, brotli Q4) invece del percorso buffer+cache;
2. early-return in `LFUCache.set()` (`index.cjs:423`) **prima** del loop di eviction,
   così un'entry più grande di `maxSize` — che non entrerà mai in cache — non svuota
   la cache di tutti gli altri file nel tentativo di farle spazio.

È il fix col miglior rapporto costo/beneficio dell'intero registro. Rientra nella
categoria "safety net contro i failure mode del processo" della design philosophy
(analogo a `dirListing.maxEntries`), quindi un default protettivo è accettabile.

#### #5 — Single-flight (thundering herd)

Da implementare **nello stesso PR del #4**: N richieste simultanee a un file non ancora
in cache eseguono oggi N `readFile()` + N compressioni brotli Q11 in parallelo per lo
stesso contenuto. Fix: mappa in-flight `key → Promise` condivisa — la prima richiesta
avvia lettura+compressione, le successive attendono la stessa Promise; rimozione
dell'entry in `finally`. Senza questo, una cache fredda al riavvio (deploy, restart)
moltiplica il picco RAM/CPU per il numero di richieste concorrenti.

#### #2 — `If-Modified-Since` mai 304 con mtime sub-secondo

Fix a una riga (troncare l'mtime al secondo prima del confronto, `index.cjs:1730`),
beneficio diretto su banda e caching. `Last-Modified` è emesso con precisione al secondo
(`toUTCString()`), ma il confronto usa i millisecondi dell'mtime: un client che fa echo
esatto dell'header (comportamento standard: `curl -z`, wget, proxy) riceve sempre 200.

Attenzione al test: deve riusare l'header `Last-Modified` **reale** della risposta
precedente (con un file il cui mtime abbia componente sub-secondo, es. via `fs.utimes`),
non una data sintetica "1 secondo nel futuro" come l'attuale
`__tests__/caching-headers.test.js`.

### Ondata 2 — footgun di configurazione e correttezza

#### #10 — `opts: null` → TypeError grezzo; la factory muta l'oggetto del chiamante

`index.cjs:662-663`. La mutazione dell'oggetto di configurazione del chiamante è
particolarmente subdola per chi riusa lo stesso oggetto config su due istanze o lo
ispeziona dopo la creazione. Fix: shallow copy (`{ ...(opts || {}) }` con copia annidata
per `template`) + errore esplicito `[koa-classic-server] ...` se `opts` non è un oggetto.

#### #11 — `urlPrefix` con slash finale / `urlsReserved` senza slash iniziale

Fallimento **silenzioso** in entrambi i casi: il middleware chiama sempre `next()` senza
servire nulla, oppure la riserva non matcha mai. I fallimenti silenziosi di
configurazione sono il peggior tipo di fragilità operativa; normalizzare (o lanciare con
hint) a factory time è coerente con lo stile delle validazioni già presenti.

#### #3 — Redirect canonico `/dir` → `/dir/`

Correttezza "Apache-like" dichiarata dal progetto: oggi `GET /sub` serve l'index con 200
invece del 301 verso `/sub/`, e i riferimenti relativi nella pagina si risolvono contro
la directory sbagliata. Attenzione implementativa: l'informazione "c'era lo slash?" va
catturata **prima** dello strip a `index.cjs:1318`. Edge case da coprire: `urlPrefix`,
percent-encoding, root `/`, interazione con `hideExtension`, metodo HEAD.

### Ondata 3 — conformità HTTP e cosmetici

Nell'ordine: **#6** (q-value di `Accept-Encoding` — `q=0` va onorato), **#7**
(`Vary: Accept-Encoding` mancante su 304 e su risposte non compresse di MIME
comprimibili — rilevante dietro proxy/CDN), **#8** (precedenza validatori vs Range; 206
senza ETag/Last-Modified), **#9** (`If-None-Match` con liste e `*`), poi i minori
**#12–#16**.

Il **#15** (`Buffer.slice` → `subarray`, `index.cjs:1669`) è una sostituzione meccanica
infilabile in qualsiasi PR di passaggio.

---

## B. Problemi nuovi (non censiti nel registro)

> Queste findings andrebbero aggiunte a `docs/revisione_codice_v3.1.md` con relativa
> checkbox, per mantenere il registro come fonte unica.

### B1. Leak di file descriptor nel percorso di compressione streaming

**Posizione:** `index.cjs:1824-1829`.

**Problema:** quando `serverCache.compressedFile.enabled: false`, la risposta compressa
è costruita con:

```js
const src = fs.createReadStream(toOpen);
ctx.body = src.pipe(compress);
```

Se il client disconnette a metà trasferimento, Koa distrugge il body — cioè il transform
zlib (`compress`) — ma `pipe()` **non propaga la distruzione alla sorgente**: la
`fs.ReadStream` resta in pausa con il file descriptor aperto, indefinitamente (le
ReadStream chiudono il fd solo su `end`/`error`, e non esiste un finalizzatore che lo
recuperi). Sotto traffico con molti download interrotti di file grandi il processo
esaurisce i descriptor disponibili (`EMFILE`).

**Impatto:** non tocca la configurazione di default (cache compressa attiva → percorso
bufferizzato), ma è un failure mode del processo esattamente nella categoria che i
"safety net" del progetto vogliono coprire.

**Fix proposto:** sostituire `src.pipe(compress)` con
`stream.pipeline(src, compress, () => {})` (pipeline propaga la destroy in entrambe le
direzioni), oppure agganciare `compress.on('close', () => src.destroy())`. Aggiungere un
test che simula la disconnessione del client a metà stream e verifica la chiusura del fd
(es. contando i fd aperti del processo o spiando `src.destroyed`).

**Priorità:** Alta (nella stessa ondata di #4/#5).

### B2. `new URL()` non protetto nel ramo hideExtension

**Posizione:** `index.cjs:1434`.

**Problema:** il parse iniziale dell'URL è protetto da try/catch (→ 400), ma con
`useOriginalUrl: false` il primo parse valida `ctx.url` (riscritto da middleware a
monte), mentre il ramo `hideExtension` ricostruisce
`new URL(_origin + ctx.originalUrl)` **senza** try/catch: un `originalUrl` malformato
produce un 500 non gestito invece del 400 coerente con gli altri guard (host invalido,
percent-encoding malformato, null byte).

**Fix proposto:** avvolgere la costruzione in try/catch → `sendBadRequest(ctx)`. Tre
righe, più un test con `useOriginalUrl: false` e `originalUrl` malformato.

**Priorità:** Bassa (caso limite), ma il fix è banale.

### B3. Nessun catch "di ultima istanza" nel middleware

**Problema:** ogni percorso noto è protetto, ma un rejection imprevisto (un errore fs
esotico fuori dai try esistenti, un bug futuro) risale al gestore di default di Koa, che
risponde con il suo 500 text/plain **senza** i security header delle pagine generate e
**senza** passare dal `_logger` configurato dall'operatore (finisce su
`app.on('error')` / stderr).

**Fix proposto:** un `try/catch` esterno nel corpo dell'handler restituito dalla factory
che logga via `_logger.error` e risponde con la pagina 500 del middleware (con
`setGeneratedPageHeaders`). È una rete di sicurezza pura: zero impatto sul comportamento
di default, errori uniformi e osservabili nel sistema di logging dell'operatore —
perfettamente in linea con la design philosophy.

**Priorità:** Media (basso costo, migliora l'osservabilità dei failure imprevisti).

---

## C. Processo e infrastruttura

### C1. Non esiste CI sui push/PR

L'unico workflow (`.github/workflows/npm-publish.yml`) gira solo alla pubblicazione di
una release, su un solo Node (20). I 604 test sono il capitale di robustezza del
progetto, ma nessuno li esegue automaticamente sui PR.

**Proposta:** un `ci.yml` su `push`/`pull_request` con matrice:

- **Node 18 / 20 / 22 / 24** — `package.json` dichiara `engines: >=18`, ma Node 18 non
  viene mai testato. Nota: Node 18 è EOL da aprile 2025 → valutare se alzare a `>=20`
  nella prossima major (breaking change da CHANGELOG);
- **ubuntu + windows** — il codice fa un uso delicato di `path.sep`, backslash e
  normalizzazione (traversal check, symlink policy, `_caseInsensitiveFS` a
  `index.cjs:1140`) ma oggi non viene mai eseguito su Windows, dove
  `_caseInsensitiveFS` cambia proprio il comportamento delle guardie di boundary.

### C2. Fuzzing / property-based testing sui parser manuali

`index.cjs` contiene diversi parser scritti a mano: `parseRangeHeader`, la conversione
glob→regex in `nameGlobMatch`/`pathGlobMatch`, il parsing URL/prefix, e presto il
parsing dei q-value di `Accept-Encoding` (registro #6). Sono i punti classici dove un
input adversariale trova il caso non previsto.

**Proposta:** una suite `fast-check` (dev-dependency) che genera input
casuali/malformati e verifica gli **invarianti**:

- i parser non lanciano mai (nessun 500 da input malformato);
- ogni range restituito è dentro i bound del file (`0 ≤ start ≤ end < fileSize`);
- il path risolto è sempre dentro `rootDir` (invariante di `_isWithinRoot`);
- glob→regex: nessun pattern operatore produce regex con backtracking catastrofico.

Copertura che i test esempio-per-esempio non possono dare.

### C3. Soglia di coverage in CI

Jest è già presente: `--coverage` con `coverageThreshold` in `jest.config.js` impedisce
che i fix futuri erodano la copertura — particolarmente utile su un monolite da 2192
righe dove i rami di fallback (es. i percorsi di errore di compressione,
`index.cjs:1773-1801`) sono facili da lasciare scoperti.

### C4. Typings (`index.d.ts`)

La superficie di configurazione è ampia e annidata (`dirListing`, `hidden`,
`serverCache`, `compression`, `template`, ...). Le validazioni runtime sono ottime ma
arrivano solo a startup. Un file di dichiarazioni TypeScript pubblicato nel pacchetto
(aggiunto a `"files"` in `package.json`) intercetta i typo di configurazione
nell'editor dell'operatore prima ancora del throw — robustezza lato DX a costo quasi
nullo, e documentazione machine-readable delle opzioni.

### C5. Allineamento documentazione

Dettaglio: `CLAUDE.md` dice "543+ tests", il registro e la suite reale dicono 604 —
allineare al prossimo giro di documentazione.

---

## Roadmap proposta

| Fase | Interventi | Tipo |
|---|---|---|
| 1 | #5 single-flight; #4 `compression.maxFileSize` + early-return `LFUCache.set()`; **B1** `stream.pipeline`; #2 fix 304 sub-secondo; #15 `subarray` | Robustezza processo |
| 2 | **C1** workflow CI (matrice Node/OS); **B3** catch di ultima istanza; **B2** try/catch hideExtension | Infrastruttura + reti di sicurezza |
| 3 | #10 copia di `opts` + errore su null; #11 validazione `urlPrefix`/`urlsReserved`; #3 redirect canonico `/dir` → `/dir/` | Footgun config + correttezza |
| 4 | #6, #7, #8, #9 (conformità HTTP); #12, #13, #14, #16 (minori); **C2** fuzzing; **C3** coverage; **C4** typings | Conformità + processo |

Ogni fase chiude con: test dedicati, aggiornamento delle checkbox in
`revisione_codice_v3.1.md` (e aggiunta delle voci B1–B3 al registro), aggiornamento del
blocco JSDoc dei default in `index.cjs` per ogni nuova opzione, CHANGELOG.

---

## Punti di forza confermati (nessuna azione richiesta)

Verificati durante questa analisi, in aggiunta a quelli già registrati nella revisione:

- Suite eseguita integralmente in questa sessione: **604/604 verdi** in ~9 s.
- Gestione HEAD accurata su tutti i percorsi (206, compresso, streaming, template).
- Guard 400 coerenti su input malformato (host invalido, percent-encoding, null byte).
- Fallback a risposta non compressa su errore di compressione (`index.cjs:1773`).
- Batching dello stat I/O nel listing (`BATCH_SIZE = 64`) per non saturare il filesystem.
- Workflow di publish con provenance npm e verifica versione/tag.
