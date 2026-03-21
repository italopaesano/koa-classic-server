# Piano d'Azione — koa-classic-server

> Documento di lavoro per il miglioramento progressivo del progetto.
> Ogni fase segue il ciclo: **Descrizione → Soluzioni proposte → Domande → Implementazione → Test → Avanzamento**

---

## Indice delle fasi

| # | Fase | Priorità | Stato |
|---|------|----------|-------|
| 1 | [File nascosti nel directory listing](#fase-1--file-nascosti-nel-directory-listing) | Alta | ⬜ Da fare |
| 2 | [Opzione glob per escludere file sensibili](#fase-2--opzione-glob-per-escludere-file-sensibili) | Alta | ⬜ Da fare |
| 3 | [Content-Security-Policy nell'HTML generato](#fase-3--content-security-policy-nellhtml-generato) | Media | ⬜ Da fare |
| 4 | [Aggiunta ESLint e standardizzazione `===`](#fase-4--aggiunta-eslint-e-standardizzazione-) | Media | ⬜ Da fare |
| 5 | [Range Requests HTTP 206](#fase-5--range-requests-http-206) | Media | ⬜ Da fare |
| 6 | [Gzip / Brotli compression](#fase-6--gzip--brotli-compression) | Media | ⬜ Da fare |
| 7 | [Traduzione commenti in inglese nei test](#fase-7--traduzione-commenti-in-inglese-nei-test) | Bassa | ⬜ Da fare |
| 8 | [Roadmap rimozione opzioni deprecate (v3.0.0)](#fase-8--roadmap-rimozione-opzioni-deprecate-v300) | Bassa | ⬜ Da fare |

---

> **Legenda stato:** ⬜ Da fare · 🔄 In corso · ✅ Completato · ⏸️ In pausa

---

## Processo standard per ogni fase

Per ogni fase si segue sempre questo ciclo:

1. **Descrizione** — Spiegazione del problema e del suo impatto
2. **Soluzioni proposte** — Almeno 2 alternative valutate con pro/contro
3. **Domande** — Se le informazioni disponibili sono < 90%, si chiedono chiarimenti prima di procedere
4. **Implementazione** — Modifica del codice sul branch `claude/project-review-EN6kt`
5. **Test** — Esecuzione della suite di test e verifica regressioni
6. **Avanzamento** — Aggiornamento dello stato in questo file e passaggio alla fase successiva

---

## Fase 1 — File nascosti nel directory listing

**Stato:** ⬜ Da fare
**Priorità:** Alta
**File coinvolti:** `index.cjs` (funzione `show_dir`)

### Descrizione del problema

Il directory listing mostra **tutti** i file e le cartelle presenti nella webroot, inclusi quelli che iniziano con `.` (dot files), come:

- `.env` — variabili d'ambiente con credenziali
- `.gitignore`, `.gitattributes` — metadati Git
- `.htpasswd` — password Apache
- `.DS_Store` — metadati macOS
- `.npmrc` — configurazioni npm con token

Server come Apache e Nginx nascondono questi file per default. Un file dimenticato nella webroot potrebbe esporre informazioni sensibili agli utenti del browser.

### Soluzioni proposte

*Da definire nella sessione di lavoro dedicata a questa fase.*

### Domande

*Da porre prima dell'implementazione se necessario.*

### Implementazione

*Da eseguire dopo la scelta della soluzione.*

### Test

*Da verificare dopo l'implementazione.*

---

## Fase 2 — Opzione glob per escludere file sensibili

**Stato:** ⬜ Da fare
**Priorità:** Alta
**File coinvolti:** `index.cjs` (opzioni di configurazione + `show_dir`)

### Descrizione del problema

Non esiste un'opzione per escludere file o cartelle specifici dal serving e dal directory listing tramite pattern (glob o RegExp). Se un file come `config.json`, `secrets.yaml` o qualsiasi altro file sensibile si trova nella webroot, viene servito senza restrizioni.

Esempi di pattern utili:
- `*.env` — tutti i file .env
- `**/*.secret` — file con estensione .secret
- `private/**` — intera cartella private

### Soluzioni proposte

*Da definire nella sessione di lavoro dedicata a questa fase.*

### Domande

*Da porre prima dell'implementazione se necessario.*

### Implementazione

*Da eseguire dopo la scelta della soluzione.*

### Test

*Da verificare dopo l'implementazione.*

---

## Fase 3 — Content-Security-Policy nell'HTML generato

**Stato:** ⬜ Da fare
**Priorità:** Media
**File coinvolti:** `index.cjs` (funzione `show_dir`)

### Descrizione del problema

Le pagine HTML generate dal directory listing non includono un header `Content-Security-Policy`. Senza CSP, il browser non ha indicazioni su quali risorse sono autorizzate, aumentando il rischio di attacchi XSS in caso di eventuali vulnerabilità future nel codice di generazione HTML.

Il progetto già implementa l'escape HTML (funzione `escapeHtml`), ma aggiungere CSP è un ulteriore livello di difesa in profondità.

### Soluzioni proposte

*Da definire nella sessione di lavoro dedicata a questa fase.*

### Domande

*Da porre prima dell'implementazione se necessario.*

### Implementazione

*Da eseguire dopo la scelta della soluzione.*

### Test

*Da verificare dopo l'implementazione.*

---

## Fase 4 — Aggiunta ESLint e standardizzazione `===`

**Stato:** ⬜ Da fare
**Priorità:** Media
**File coinvolti:** `index.cjs`, `package.json`, nuovi file di config

### Descrizione del problema

Il codice usa `==` (uguaglianza debole con coercizione di tipo) in circa 25 punti, documentati in `docs/CODE_REVIEW.md`. Anche se nel contesto attuale non causano bug, l'uso di `===` è la best practice JavaScript e previene errori sottili in futuro.

Inoltre il progetto non ha alcun linter o formatter configurato, il che rende difficile mantenere la coerenza stilistica nel tempo e nelle contribuzioni esterne.

### Soluzioni proposte

*Da definire nella sessione di lavoro dedicata a questa fase.*

### Domande

*Da porre prima dell'implementazione se necessario.*

### Implementazione

*Da eseguire dopo la scelta della soluzione.*

### Test

*Da verificare dopo l'implementazione.*

---

## Fase 5 — Range Requests HTTP 206

**Stato:** ⬜ Da fare
**Priorità:** Media
**File coinvolti:** `index.cjs` (logica di file serving)

### Descrizione del problema

Il middleware non supporta l'header `Range` delle richieste HTTP. Questo significa che:

- File audio e video non possono essere riprodotti in streaming dai browser
- Download di file grandi non possono essere ripresi dopo interruzione
- Strumenti come `curl --range` non funzionano

Il supporto HTTP 206 (Partial Content) è lo standard per la distribuzione di contenuti multimediali e file di grandi dimensioni.

### Soluzioni proposte

*Da definire nella sessione di lavoro dedicata a questa fase.*

### Domande

*Da porre prima dell'implementazione se necessario.*

### Implementazione

*Da eseguire dopo la scelta della soluzione.*

### Test

*Da verificare dopo l'implementazione.*

---

## Fase 6 — Gzip / Brotli compression

**Stato:** ⬜ Da fare
**Priorità:** Media
**File coinvolti:** `index.cjs`, `package.json`

### Descrizione del problema

Il middleware serve tutti i file senza compressione. Per file di testo (HTML, CSS, JS, JSON, SVG), la compressione può ridurre le dimensioni del 60-80%, con impatto diretto su:

- Velocità di caricamento per gli utenti
- Consumo di banda del server
- Score Lighthouse / Web Vitals

### Soluzioni proposte

*Da definire nella sessione di lavoro dedicata a questa fase.*

### Domande

*Da porre prima dell'implementazione se necessario.*

### Implementazione

*Da eseguire dopo la scelta della soluzione.*

### Test

*Da verificare dopo l'implementazione.*

---

## Fase 7 — Traduzione commenti in inglese nei test

**Stato:** ⬜ Da fare
**Priorità:** Bassa
**File coinvolti:** `__tests__/dt-unknown.test.js` e altri

### Descrizione del problema

Alcuni file di test contengono commenti in italiano, il che riduce l'accessibilità del codice per i contribuenti internazionali. Per un progetto open source pubblicato su npm, la lingua standard della codebase dovrebbe essere l'inglese.

### Soluzioni proposte

*Da definire nella sessione di lavoro dedicata a questa fase.*

### Domande

*Da porre prima dell'implementazione se necessario.*

### Implementazione

*Da eseguire dopo la scelta della soluzione.*

### Test

*Da verificare dopo l'implementazione.*

---

## Fase 8 — Roadmap rimozione opzioni deprecate (v3.0.0)

**Stato:** ⬜ Da fare
**Priorità:** Bassa
**File coinvolti:** `index.cjs`, `docs/CHANGELOG.md`, `README.md`

### Descrizione del problema

Le opzioni legacy `cacheMaxAge` ed `enableCaching` sono ancora supportate con deprecation warning ma non hanno una data di rimozione pianificata. Mantenerle a tempo indeterminato appesantisce il codice e può confondere i nuovi utenti che leggono la documentazione.

Una roadmap chiara verso `v3.0.0` con breaking changes definiti aiuta gli utenti a pianificare la migrazione.

### Soluzioni proposte

*Da definire nella sessione di lavoro dedicata a questa fase.*

### Domande

*Da porre prima dell'implementazione se necessario.*

### Implementazione

*Da eseguire dopo la scelta della soluzione.*

### Test

*Da verificare dopo l'implementazione.*

---

*Documento aggiornato: 2026-03-21*
