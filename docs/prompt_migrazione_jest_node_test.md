# Prompt — Analisi di *fattibilità*: migrazione dei test da **Jest** a **`node:test`** (koa-classic-server)

> **Scopo di questo file.** Prompt *riutilizzabile* e **autosufficiente** per valutare se e come migrare
> la suite di test dal runner **Jest** al test runner nativo di Node (**`node:test`** + `node:assert`).
> Pensato per partire anche da una **sessione nuova** che non conosce le conversazioni precedenti.
> Si ferma a una **raccomandazione go / no-go** con piano: **non** migra nulla.
>
> Companion di `docs/prompt_analisi_item_di_processo.md` (analisi generica di un item di processo).
> Nota di relazione: questo riguarda il **runner** (come esegui/asserisci). È **ortogonale** al fuzzing:
> `fast-check` è agnostico e gira identico con Jest o con `node:test` — migrare il runner **non** è
> un prerequisito per aggiungere il property-based testing, e viceversa.

---

## 0. Contesto del progetto (non assumerlo già noto)

`koa-classic-server` — middleware Koa che serve file statici su HTTP (listing classici, template engine
opzionale, cache compressa). Comportamento *simile ma non identico* ad Apache 2. Filosofia: *HTTP-file-
server-first*, default trasparenti, safety-net accettabili / restrizioni opt-in, **proporzionalità**.

**Stato baseline.**
- Registro `docs/revisione_codice_v3.1.md` **chiuso (20/20)**; **717 test** verdi; ESLint pulito; v**4.0.0**.
- **Runner attuale: Jest** + `supertest`. `npm test` esegue lint (pretest) + Jest; c'è anche
  `test:ci` (`jest --testPathIgnorePatterns=performance`) e `test:performance`.
- **CI** (`.github/workflows/ci.yml`): matrice `Node 18/20/22/24 × ubuntu/windows/macos`
  (18/20 esclusi su windows, 18 su macos), job lint dedicato (eslint richiede Node ≥ 20.19),
  job performance/nix informativi, `workflow_dispatch`.
- `package.json`: conditional exports CJS (`index.cjs`) / ESM (`index.mjs`); campo `types` **assente**.

**Fatto rilevante per la migrazione.** `index.cjs` cattura alcuni riferimenti **al load del modulo**,
in particolare `const _brotliCompressAsync = util.promisify(zlib.brotliCompress)` (righe ~11–12): questo
è il motivo per cui un test che vuole simulare un fallimento di compressione **deve** intercettare il
modulo `zlib` *prima* del `require` di `index.cjs` (vedi §4b, il blocco principale).

---

## 1. Perché valutarla — e cosa NON è

**È un item di *processo*** (cambia *come* testiamo), **non di prodotto**: se fatta bene, il
comportamento osservabile del middleware resta identico e la CI resta verde. Se una migrazione cambiasse
un comportamento osservabile, sarebbe un errore, non un obiettivo.

**Possibili motivazioni (da pesare, non da dare per scontate):**
- **Zero dipendenze di test runtime** (Jest + babel/ts-jest sono un albero di dipendenze grosso).
- **Avvio più veloce**, nessuna trasformazione, nessun file di config.
- Coerenza con l'ethos *"classic / minimal"* del progetto.

**Costi/attriti** (quantificati in §2, blocco in §4b). La migrazione è per lo più **meccanica** tranne
un punto duro (il mock di modulo `zlib`).

---

## 2. Inventario dell'accoppiamento a Jest (dati reali — ri-misurabili)

Snapshot al momento della stesura (38 file di test):

| API Jest | Occorrenze | Traduzione in `node:test` |
|---|---:|---|
| `expect(...)` | **~1232** | `node:assert` (`strictEqual`, `deepStrictEqual`, `match`, `throws`, `ok`) o uno **shim** `expect→assert` |
| `test.each` / `it.each` | **6 file** | nessun equivalente nativo → `for…of` con `test()` dentro |
| `jest.resetModules` | **2 file** | `delete require.cache[require.resolve('../index.cjs')]` + re-require |
| `jest.spyOn` / `jest.fn` | **10 file** | `mock.method` / `mock.fn` di `node:test` |
| `jest.mock('zlib', …)` | **1 file** | **blocco principale — vedi §4b** |

Comando per **ri-misurare** da freddo:
```bash
grep -rho 'expect(' __tests__ | wc -l                       # expect totali
grep -rl 'jest.mock' __tests__                              # module mock (il blocco)
grep -rl 'jest.resetModules' __tests__                      # reset cache moduli
grep -rl 'test.each\|it.each' __tests__                     # parametrizzazione
grep -rl 'jest.spyOn\|jest.fn' __tests__                    # spy/fn
```

`supertest` è **agnostico** rispetto al runner: non richiede modifiche.

---

## 3. Metodo di lavoro (fasi)

Rispetta il processo consolidato del progetto:
1. **Spiegazione** → 2. **Brainstorming** (con esempi/porzioni di codice) → 3. **Domande** per definire
il contesto al **~90%** → 4. **Implementazione** → 5. **Test** → 6. **Revisione**.

> **Questa analisi copre le fasi 1–3** e si ferma alla raccomandazione (§5). Nessun file va modificato.

---

## 4. Cosa deve produrre l'analisi

### 4a. Potenzialità / benefici
- Riduzione dipendenze (misura l'albero rimosso), tempo di avvio, semplicità di config.
- Allineamento con l'ethos del progetto. **Onestà**: se il beneficio è marginale rispetto al costo,
  dirlo e raccomandare *no-go* o *rinvio*.

### 4b. Fattibilità (costo / rischio) — con il **blocco** in evidenza
- **Volume meccanico**: ~1232 `expect` da tradurre. Valutare uno **shim** `expect()` minimale sopra
  `node:assert` (riduce il churn e il rischio di errori di traduzione) vs riscrittura piena.
- **`test.each` (6 file)**, **`jest.spyOn/fn` (10 file)**, **`jest.resetModules` (2 file — servono per il
  dedup una-tantum di `warnConfigDeprecation`, Set a livello modulo `_configDeprecationsWarned`)**.
- **★ Blocco principale — `jest.mock('zlib')` in `compression-fallback-vary-etag.test.js`:**
  il test forza il fallimento di `brotliCompress` per esercitare il fallback identity (finding #7).
  Poiché `index.cjs` fa `util.promisify(zlib.brotliCompress)` **al load**, serve un vero **module-mock**
  intercettato *prima* del require. In `node:test` il module-mocking (`mock.module`) è **sperimentale**
  (`--experimental-test-module-mocks`, **Node ≥ 22.3**) → **non gira sui leg CI Node 18/20**.
  Uscite possibili (è una **forcella**, §4c):
  - **(a)** *dependency injection*: rendere il compressore iniettabile/override-abile così il test non
    deve mockare il modulo (fix strutturale, tocca `index.cjs`);
  - **(b)** *gate/skip* di quel singolo test sotto una certa versione di Node;
  - **(c)** *alzare il Node minimo* (Node 18 è comunque EOL da aprile 2025).
- **Impatto CI**: rivedere la matrice. `node:test` è **stabile da Node 20** (sperimentale su 18);
  decidere il destino del leg **Node 18**. Il job **lint** resta invariato.
- **Coverage**: Jest usa istanbul (`--coverage`); `node:test` ha `--experimental-test-coverage` (Node 20+,
  migliorata in 22) oppure si affianca `c8`. Se in futuro vuoi anche il *coverage gate*
  (vedi `docs/prompt_analisi_item_di_processo.md`, item B), tienine conto qui.

### 4c. Forcelle di design da sciogliere (da portare alla fase "domande")
1. **Come gestiamo `jest.mock('zlib')`?** → (a) DI, (b) skip condizionale, (c) alzare Node minimo.
2. **Assertion layer**: shim `expect→assert` (churn minimo, familiare) **oppure** riscrittura piena in
   `node:assert` (nessuno strato, ma ~1232 modifiche)?
3. **Strategia di transizione**: *big-bang* (tutto in una volta) **oppure** *incrementale* (Jest e
   `node:test` in parallelo, migrando file per file finché Jest non è rimovibile)?
4. **Matrice CI**: si mantiene Node 18? (impatta la scelta 1).

### 4d. Guardrail specifici del progetto
- Il comportamento osservabile del middleware **non cambia**: la suite deve restare verde a parità di
  asserzioni (nessuna copertura persa nella traduzione).
- Non introdurre regressioni sulla **matrice CI** senza deciderlo esplicitamente.
- **Proporzionalità**: se il costo (soprattutto i ~1232 `expect` + il blocco zlib) supera il beneficio,
  la raccomandazione onesta può essere *no-go* o *rinvio*.

---

## 5. Deliverable atteso

1. **Raccomandazione go / no-go / rinvio** con motivazione (3–5 righe).
2. **Scope**: cosa migrare subito vs dopo; se incrementale, l'ordine dei file.
3. **Stima di effort**: ~LOC toccate, file, delta dipendenze, delta CI, rischio.
4. **Forcelle di design** risolte o portate alla fase "domande" (con raccomandazione per ciascuna).
5. Se **go**: piano a fasi coerente col metodo §3 (es. Fase 1 = shim + 1 file pilota; Fase 2 = blocco
   zlib; Fase 3 = migrazione di massa; Fase 4 = rimozione Jest + aggiornamento `package.json`/CI/docs).

## 6. Domande-guida (checklist)

- Il beneficio (dipendenze rimosse, velocità) **giustifica** ~1232 traduzioni + il blocco zlib?
- Meglio uno **shim** `expect→assert` o la riscrittura piena? (churn vs pulizia)
- Come risolviamo il **module-mock di `zlib`** senza perdere il test del fallback #7 e senza rompere
  Node 18/20? È l'occasione per una **dependency injection** utile anche al di là dei test?
- **Big-bang** o **incrementale** con i due runner in parallelo?
- Che ne facciamo del leg **Node 18** (EOL)?
- Serve toccare `package.json` (script `test`/`test:ci`, `types`), `.github/workflows/ci.yml`, `docs/`?
- La coverage attuale resta **identica** dopo la migrazione (nessuna asserzione persa)?

---

*Fine del prompt. Avvia l'analisi (fasi 1–3), risolvi/segnala le forcelle §4c e fermati alla
raccomandazione (§5). Ricorda: aggiungere `fast-check` (fuzzing) NON richiede questa migrazione.*
