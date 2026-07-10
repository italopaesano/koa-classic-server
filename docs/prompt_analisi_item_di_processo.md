# Prompt — Analisi di *potenzialità* e *fattibilità* di un **item di processo** per koa-classic-server

> **Scopo di questo file.** È un *prompt riutilizzabile*: incollalo (o puntaci l'assistente) quando
> vuoi valutare se e come introdurre un miglioramento di *processo* (non di prodotto) nel progetto.
> È volutamente **autosufficiente** — riporta il contesto necessario a partire da freddo, anche in una
> sessione nuova che non conosce le conversazioni precedenti. Compila la sezione **§2** scegliendo
> l'item da analizzare, poi lascia che l'assistente produca l'analisi descritta in **§4–§6**.
>
> **Questa analisi è la fase PRE-implementazione** (potenzialità + fattibilità): serve ad alimentare la
> fase "domande" del metodo di lavoro (§3). **Non** implementa nulla; si ferma a una raccomandazione
> go/no-go con piano.

---

## 0. Contesto del progetto (non assumerlo già noto)

**Cos'è.** `koa-classic-server` è un middleware Koa che serve file statici da disco su HTTP, con
directory listing classici, integrazione opzionale con template engine e cache compressa lato server.
Comportamento *simile ma non identico* ad Apache 2 (la parità con Apache **non** è un obiettivo).

**Filosofia di design (vincola ogni proposta).**
- *HTTP-file-server-first*: se un file esiste sotto `rootDir`, `GET` sul suo path lo restituisce; una
  directory senza index mostra il listing di ogni entry visibile.
- I default sono **trasparenti / pass-through**. Le *safety net* (proteggono il processo da se stesso)
  sono accettabili; le *restrizioni* (limitano l'intento dell'operatore) devono essere **opt-in**.
- **Proporzionalità**: adegua l'investimento al profilo di rischio. Preferisci *generalizzare il
  meccanismo* invece di aggiungere special-case.
- L'hardening di sicurezza vive nella **documentazione** (`docs/SECURITY_HARDENING.md`), non nei default.

**Stato attuale (baseline).**
- Il registro problemi `docs/revisione_codice_v3.1.md` è **chiuso: 20/20 voci RISOLTE**.
- **717 test** verdi (Jest + supertest), **ESLint pulito**, **0 vulnerabilità npm**.
- Versione **4.0.0** (major motivato dal redirect canonico del trailing slash, finding #3).
- **CI** già presente: matrice `Node 18/20/22/24 × ubuntu/windows/macos` (`.github/workflows/ci.yml`),
  job lint dedicato, job performance/nix informativi, `workflow_dispatch`.
- Pattern **deprecation** riutilizzabile: `warnConfigDeprecation(logger, msg)` (warn una-tantum ora,
  throw nella prossima major).

**File chiave.**
- `index.cjs` — implementazione (~2200 righe); i default sono nel blocco JSDoc della factory (~riga 480).
- `index.mjs` — wrapper ESM. `package.json` — conditional exports, `version`, `types` (assente).
- `__tests__/` — 38 file di test; `npm test` esegue lint (pretest) + Jest.
- `docs/` — `CHANGELOG.md`, `DOCUMENTATION.md`, `SECURITY_HARDENING.md`, `revisione_codice_v3.1.md`.

**Superfici che parsano input ostile (rilevanti per gli item di processo).** Tre parser scritti a mano,
**a livello modulo e attualmente NON esportati**:
- `parseRangeHeader(rangeHeader, fileSize)` — header `Range` → `{start,end}` | `'invalid'` | `'unsatisfiable'`.
- `getClientEncoding(acceptEncoding)` — `Accept-Encoding` (con q-value, `*`, `q=0`) → `'br'|'gzip'|null`.
- `ifNoneMatchSatisfied(headerValue, etag)` — `If-None-Match` (liste, `*`, weak `W/`) → `boolean`.

---

## 1. Cosa si intende per "item di processo"

- **Item di prodotto** — sposta *"è corretto adesso?"*: comportamento osservabile di `GET /file`, header
  HTTP, semantica delle opzioni. (Tutte le 20 voci del registro erano di prodotto, e sono chiuse.)
- **Item di processo** — sposta *"quanto è probabile che RESTI corretto, e che me ne accorga se si
  rompe?"*: strumenti, test, CI, developer-experience. Non sono bug; sono la **rete di sicurezza**.

**Catalogo dei candidati (stato in questo progetto):**

| Item | A cosa serve | Stato |
|---|---|---|
| Fuzzing / property-based test sui parser | *scoprire* bug latenti su input ostile | ⚠️ solo example-based oggi |
| Soglia di coverage in CI | *cricchetto* anti-regressione | ⚠️ coverage calcolabile, nessun gate |
| Typings `index.d.ts` (`types` in package.json) | DX per utenti TypeScript | ⚠️ assente |
| (Mutation testing, audit dipendenze in CI, esempi, …) | qualità test / release hygiene | opzionali |

---

## 2. Item da analizzare  ← **COMPILA QUI**

> Scegli **uno** (o indicane un altro). Cancella gli altri o marca la scelta.

- [ ] **A. Fuzzing / property-based test** sui parser (`parseRangeHeader`, `getClientEncoding`,
  `ifNoneMatchSatisfied`) — *massimo valore di robustezza: è l'unico che può ancora SCOPRIRE bug.*
- [ ] **B. Soglia di coverage in CI** (branch/line) come rete anti-regressione.
- [ ] **C. Typings TypeScript** (`index.d.ts`) per le opzioni annidate.
- [ ] **D. Altro:** ______________________________________________

**Contesto/vincoli aggiuntivi che voglio dare** (facoltativo): ____________________________________

---

## 3. Metodo di lavoro (fasi)

Rispetta il processo consolidato del progetto, un item alla volta:

1. **Spiegazione** del problema/opportunità.
2. **Brainstorming** con piccoli esempi e porzioni di codice.
3. **Domande** per definire il contesto **almeno al ~90%** prima di decidere.
4. **Implementazione** (solo dopo il go).
5. **Test aggiuntivi**.
6. **Revisione**.

> **Questa analisi copre le fasi 1–3** e si ferma prima della 4: produce la raccomandazione e le
> *forcelle di design* che la fase "domande" dovrà sciogliere. Nessun file va modificato in questa fase.

---

## 4. Cosa deve produrre l'analisi

### 4a. Potenzialità (valore)
- Quali **bug latenti** potrebbe scoprire o quali **regressioni** prevenire, con **esempi concreti
  ancorati a questo codice** (es. quali invarianti fuzzare sui tre parser; quali rami oggi scoperti).
- **Leva**: è una libreria condivisa → una regressione colpisce ogni operatore all'upgrade.
- **Allineamento col profilo di rischio**: il progetto parsa input ostile (`Range`, `Accept-Encoding`,
  `If-None-Match`, path URL); una code review passata ha già trovato un open-redirect mancato a mano.

### 4b. Fattibilità (costo / rischio)
- **Effort**: file toccati, ~righe, nuovi dev-dependency, delta tempo di CI.
- **Rischio di manutenzione / drift**: es. un `.d.ts` scritto a mano che diverge da `index.cjs` (un
  `.d.ts` sbagliato è *peggio* di nessuno); una soglia di coverage troppo alta che viene "aggirata".
- **Interazione con la struttura esistente**: Jest, il job lint separato (eslint richiede Node ≥20.19),
  la matrice CI, i conditional exports CJS/ESM.
- **Forcelle di design** da esplicitare, es.:
  - *Fuzzing*: esportare i parser dietro `module.exports._internals` riservato ai test **oppure**
    guidarli via `supertest` (HTTP reale, più lento, `fileSize` fissato dalla fixture)?
  - *Coverage*: quali metriche (branch/line/function) e quale soglia (impostare **appena sotto**
    l'attuale, come cricchetto, non come numero da inseguire)?
  - *Typings*: `.d.ts` a mano **oppure** generato dai JSDoc (`tsc --allowJs --declaration
    --emitDeclarationOnly`, singola fonte di verità)?

### 4c. Guardrail specifici del progetto (verifica sempre)
- L'item **non deve cambiare il comportamento osservabile di default** di `GET /path` o dei listing:
  se lo cambia, è un item di *prodotto*, non di processo → ridiscuterne la natura.
- Deve restare **non invasivo** per gli operatori (idealmente zero impatto runtime).
- **Proporzionalità**: giustifica l'investimento col profilo di rischio; evita il "test-teatro" e le
  soglie-vanità. Coverage = pavimento, non obiettivo.

---

## 5. Deliverable atteso

1. **Raccomandazione go / no-go** con motivazione in 3–5 righe.
2. **Scope minimo vs esteso** (cosa fare subito vs cosa rimandare).
3. **Stima di effort**: file toccati, ~LOC, nuovi dev-dep, delta CI, rischio.
4. **Elenco delle forcelle di design** da sciogliere nella fase "domande" (con la tua raccomandazione
   per ciascuna).
5. Se **go**: un **piano a fasi** pronto per partire, coerente col metodo §3; se **no-go**, il perché.

## 6. Domande-guida (checklist per l'analisi)

- Qual è il **caso peggiore** che questo item avrebbe intercettato tra i bug già chiusi del registro?
- Quanto **spazio di input** copre davvero (per il fuzzing: quali generatori? per la coverage: quali rami)?
- Che **costo ricorrente** aggiunge (CI, manutenzione, rischio di drift)?
- È **proporzionato** al rischio del progetto, o è gold-plating?
- Introduce una **seconda fonte di verità** (es. `.d.ts`)? Come la si mantiene allineata?
- C'è un modo per renderlo un **cricchetto** (impedisce il peggioramento) invece che un obiettivo mobile?
- Serve aggiornare `CHANGELOG.md` / `docs/` / `package.json` (`types`, script, dev-dep)?

---

*Fine del prompt. Compila §2, poi avvia l'analisi (fasi 1–3) e fermati alla raccomandazione (§5).*
