# Security Audit — koa-classic-server v3.0.1

Audit di sicurezza condotto sul branch `claude/koa-classic-security-audit-9oige7`.
Analisi completa di `index.cjs` (2010 righe), della roadmap `docs/security_improvement_for_V3.md`,
dei test in `__tests__/` e verifica empirica delle ipotesi tramite probe reali.

Questo documento è il **piano di lavoro**: ogni voce ha una checkbox che spunteremo man mano
che la vulnerabilità viene affrontata (fix + test + documentazione).

> **Nota sulla design philosophy.** Il middleware segue il principio *"HTTP file server first"*
> (vedi `CLAUDE.md`): la directory dell'operatore è la source of truth e i default sono
> trasparenti/pass-through. Le correzioni qui proposte rispettano questo principio — dove un
> fix cambierebbe il comportamento osservabile di default, viene proposto come **opt-in**.

---

## Indice

### 🔴 Priorità alta
- [x] [V-1] Symlink escape oltre `rootDir` (path traversal via link simbolico) — *risolto in v3.1.0*

### 🟠 Priorità media
- [x] [V-2] URL con percent-encoding malformato → 500 invece di 400 — *risolto in v3.1.0*

### 🟡 Priorità bassa / hardening
- [x] [V-3] Boundary check con `startsWith` senza separatore di path — *risolto in v3.1.0*

### ⚪ Osservazioni minori (già note / documentate altrove)
- [x] [V-4] File statici senza `X-Content-Type-Options: nosniff` *(già `[M-4]`)* — *opzione opt-in aggiunta in v3.1.0*
- [ ] [V-5] Nessuna validazione dell'header `Host` — DNS rebinding *(già `[M-3]`)*
- [ ] [V-6] DoS da directory con milioni di file — `readdir` non bounded *(già `[F-1]`)*

---

## 🔴 Priorità alta

### [V-1] Symlink escape oltre `rootDir`

**Stato:** ✅ Risolto in v3.1.0 (opzione opt-in `symlinks`, default `follow` invariato)

**Descrizione**

Un link simbolico collocato *dentro* `rootDir` che punta a un file o directory *fuori* da
`rootDir` viene servito senza alcun controllo. Il controllo di boundary a `index.cjs:1250`
valida solo la **stringa del path richiesto**, non il **realpath risolto**. Poiché
`fs.promises.stat()` (righe 1346, 960, 1824) segue i symlink, il target reale non viene mai
riverificato contro `normalizedRootDir`.

**Verifica empirica**

```
GET /escape.txt        → 200, body = "ROOT:SECRET:0:0"   (symlink → /tmp/secret/passwd)
GET /escapedir/        → 200, il listing mostra i file esterni
GET /escapedir/passwd  → 200, contenuto esterno servito
```

**Impatto**

Chiunque possa piazzare un symlink nell'albero servito (directory di upload, hosting
multi-tenant, spool, deploy in stile Capistrano) può leggere qualsiasi file accessibile al
processo Node (`/etc/passwd`, chiavi private, `.env` fuori root, ecc.).

Contraddice la proprietà dichiarata in `docs/security_improvement_for_V3.md` [PS-1]:
*"il path risolto deve iniziare con rootDir"* — per i symlink questo non è vero. La roadmap
`[F-1]` copre solo il DoS da directory enormi, **non** l'escape via symlink.

**Correzione proposta**

Opzione `symlinks` **opt-in**, retrocompatibile:

- `'follow'` (default) — comportamento attuale; non rompe i casi Docker / npm-link / NixOS
  buildFHSEnv già coperti dai test in `__tests__/symlink.test.js`.
- `'follow-within-root'` — risolve il target con `fs.realpath()` e verifica che resti sotto
  `normalizedRootDir`; altrimenti 404.
- `'deny'` — i symlink non vengono mai seguiti.

In alternativa minima (se non si vuole toccare l'API): documentare esplicitamente il rischio
nella Security Checklist di `README.md` e `docs/DOCUMENTATION.md`.

**Definition of done**
- [x] Opzione implementata e validata a factory-time (`symlinks: 'follow' | 'follow-within-root' | 'deny'`)
- [x] Test per file-symlink e dir-symlink che escono da root (deny + within-root + follow) — `__tests__/symlinks-policy.test.js` (19 test)
- [x] Caso `rootDir` che è esso stesso un symlink coperto (pin di `realpath(rootDir)` all'init)
- [x] Listing: symlink bloccati non-cliccabili, size del target non esposta
- [x] Voce aggiunta alla Security Checklist (`README.md`)
- [x] Changelog aggiornato (`docs/CHANGELOG.md` → 3.1.0)

**Decisioni di design (v3.1.0)**
- Default `follow` (retrocompatibile, nessun breaking change) — coerente con la design philosophy *"hardening opt-in, non nei default"*.
- `realRootDir` pinnato all'init (`fs.realpathSync.native`); protezione a costo zero in modalità `follow`.
- Overhead misurato delle modalità protette: ~8% (file top-level) / ~17% (path annidati) di throughput, ~2.4 µs/op per `realpath`. Accettato come costo della sicurezza opt-in.
- Escape → 404; confronto case-insensitive su macOS/Windows.
- Rischio residuo TOCTOU documentato (serve isolamento OS per multi-tenant ostile).

---

## 🟠 Priorità media

### [V-2] URL con percent-encoding malformato → 500

**Stato:** ✅ Risolto in v3.1.0

**Descrizione**

`decodeURIComponent(pageHrefOutPrefix.pathname)` a `index.cjs:1233` lancia `URIError` su input
malformato; l'eccezione non è gestita e arriva all'error handler di default di Koa come
**500 Internal Server Error**. È incoerente col trattamento del null-byte, che restituisce un
pulito **400 Bad Request** (righe 1238–1242).

**Verifica empirica**

```
GET /%          → 500
GET /%E0%A4%A   → 500
```

**Impatto**

Basso, ma reale: un 500 su input controllato dal client è rumore nei log e una superficie di
probing. Il comportamento corretto è 400 Bad Request.

**Correzione proposta**

Avvolgere il `decodeURIComponent` in try/catch e rispondere 400, coerentemente con la guardia
null-byte già presente.

**Definition of done**
- [x] try/catch attorno al decode con risposta 400
- [x] Scope esteso: anche `new URL()` sull'Host header malformato (secondo vettore di 500 emerso in analisi) → 400
- [x] Helper `sendBadRequest()` condiviso; guardia null-byte rifattorizzata per usarlo
- [x] Test per `/%`, `/%zz`, `/%E0%A4%A`, `/a%2fb%`, `/%c3%28`, Host malformato, null-byte (regressione), path validi, urlPrefix — `__tests__/malformed-request.test.js` (13 test)

**Decisioni di design (v3.1.0)**
- Scope completo: preambolo di parsing URL (`new URL` + `decodeURIComponent`) protetto → 400.
- Risposta plain text `'Bad Request'`, coerente con le guardie null-byte (400) e traversal esistenti.
- Nessun logging delle richieste malformate (evita log-spam / DoS da input client-controllato).
- Accumulato nella release 3.1.0 dell'audit.

---

## 🟡 Priorità bassa / hardening

### [V-3] Boundary check con `startsWith` senza separatore

**Stato:** ✅ Risolto in v3.1.0

**Descrizione**

`index.cjs:1250` usa `fullPath.startsWith(normalizedRootDir)` senza `path.sep` finale.
**Non è sfruttabile oggi**: `normalizedPath` deriva sempre da un `pathname` che inizia con `/`,
quindi `path.join` inserisce sempre un separatore e non può produrre una sibling-dir tipo
`/srv/www-private` a partire da root `/srv/www`. È però fragile: un refactoring che alteri
l'invariante lo renderebbe una vulnerabilità classica di prefix-matching.

**Correzione proposta**

Confrontare con `normalizedRootDir + path.sep`, gestendo il caso `fullPath === normalizedRootDir`
(richiesta della root stessa). Applicare lo stesso hardening al check di `hideExtension`
(`index.cjs:1329`).

**Definition of done**
- [x] Boundary check irrobustito con separatore — riuso di `_isWithinRoot()` (creato nella V-1) su entrambi i punti: check principale (`index.cjs`) e check di `hideExtension` (`pathWithExt`)
- [x] Test di regressione per la richiesta della root e per sibling-dir — `__tests__/boundary-check.test.js` (9 test)

**Decisioni di design (v3.1.0)**
- Riuso di `_isWithinRoot()` invece di un helper dedicato: un solo meccanismo "path dentro root" (generalizzazione anziché caso speciale), con confine `=== root || startsWith(root + path.sep)` e gestione case-insensitive su macOS/Windows.
- Status code del boundary check testuale portato da **403 → 404** per coerenza con symlink-escape e hidden (superficie "non raggiungibile" uniforme e opaca; i test accettavano già `[403, 404]`).
- Non sfruttabile prima del fix (il caso sibling non era producibile via `path.join`): intervento di pura difesa in profondità.

---

## ⚪ Osservazioni minori (già note / documentate)

### [V-4] File statici senza `X-Content-Type-Options: nosniff`

**Stato:** ✅ Risolto in v3.1.0 (opzione opt-in `staticSecurityHeaders.nosniff`, default off)

I security header venivano impostati solo sulle pagine generate dal middleware (listing/errori),
non sui file statici serviti da disco. Già documentato come `[M-4]` in
`docs/security_improvement_for_V3.md`. Rilevante quando si servono contenuti caricati da utenti
(MIME sniffing → content-sniffing XSS).

**Correzione (v3.1.0)**

Nuova opzione opt-in `staticSecurityHeaders: { nosniff: true }` che aggiunge
`X-Content-Type-Options: nosniff` alle risposte statiche (200/206/304). Default `false`
(nessun cambio di comportamento). Non si applica all'output del template engine (responsabilità
dell'operatore nella sua `render`). Gli altri header restano al reverse proxy (coerente con `[M-3]`/`[M-4]`).

**Definition of done**
- [x] Opzione `staticSecurityHeaders` validata a factory-time (throw se non-oggetto)
- [x] `nosniff` applicato a 200/206/304, escluso il template render, escluse le pagine generate (che già lo hanno)
- [x] Test `__tests__/static-security-headers.test.js` (7 test)
- [x] Security Checklist + DOCUMENTATION + CHANGELOG aggiornati

**Decisioni di design (v3.1.0)**
- Opzione dedicata built-in (non hook generico né solo-doc): mirata, semplice, testabile.
- Default off (opt-in) — coerente con la design philosophy "hardening opt-in, non nei default".
- Solo `nosniff` in scope; X-Frame-Options/Referrer-Policy/HSTS restano al reverse proxy.

---

### [V-5] Nessuna validazione dell'header `Host` (DNS rebinding)

**Stato:** ⬜ Da valutare

Il middleware non valida `Host`. Già documentato come `[M-3]`, delegato al reverse proxy.
Nessuna azione sul codice prevista; verificare solo che la documentazione sia adeguata.

---

### [V-6] DoS da directory con milioni di file

**Stato:** ⬜ Da valutare

`show_dir` esegue `fs.promises.readdir()` senza bound sull'allocazione iniziale (lo slice
avviene dopo). Già tracciato come `[F-1]` (proposta `dirListing.readMode`) per la v3.1.
Nessuna azione immediata; qui solo per completezza.

---

## Riepilogo

| ID  | Descrizione                                   | Priorità | Stato        |
|-----|-----------------------------------------------|----------|--------------|
| V-1 | Symlink escape oltre `rootDir`                | Alta     | ✅ Risolto (v3.1.0) |
| V-2 | Percent-encoding malformato → 500             | Media    | ✅ Risolto (v3.1.0) |
| V-3 | Boundary check `startsWith` senza separatore  | Bassa    | ✅ Risolto (v3.1.0) |
| V-4 | File statici senza `nosniff`                  | Minore   | ✅ Risolto (v3.1.0) |
| V-5 | Nessuna validazione `Host` (DNS rebinding)    | Minore   | Da valutare   |
| V-6 | DoS da directory enormi                       | Minore   | Da valutare   |
