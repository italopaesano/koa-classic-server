# Security Improvement for V3

Analisi di sicurezza del progetto `koa-classic-server` v3.0.0-alpha.0, con roadmap degli interventi da effettuare.

---

## Indice

### Punti di Forza (da mantenere e documentare)
- [ ] [PS-1] Path Traversal — protezione multi-layer
- [ ] [PS-2] Hidden Files/Directories — controllo esplicito
- [ ] [PS-3] XSS Prevention — escaping nel directory listing
- [ ] [PS-4] Security Headers — CSP, X-Frame-Options, Referrer-Policy
- [ ] [PS-5] Dipendenze — superficie d'attacco minima

### Miglioramenti Prioritari
- [x] [M-1] Timeout configurabile sul template rendering *(Medio)*
- [x] [M-2] Cache staleness su filesystem NFS/distribuiti *(Medio)*
- [x] [M-3] Documentare il rischio DNS Rebinding *(Basso)*
- [x] [M-4] Documentare i limiti dei security headers sui file statici *(Basso)*

### Nice-to-Have
- [x] [N-1] Logger iniettabile dall'esterno
- [x] [N-2] Protezione contro directory listing con molti file (DoS)

---

## Punti di Forza

### [PS-1] Path Traversal

La protezione è implementata a più livelli in `index.cjs` (righe 884–910):

1. **Null byte guard** — rifiuta con `400 Bad Request` qualsiasi path contenente `\0`
2. **Normalizzazione** — `path.normalize()` applicata prima di qualsiasi `path.join()`
3. **Boundary check** — il path risolto deve iniziare con `rootDir`; altrimenti risponde `403 Forbidden`
4. **URL-encoded variants** — gestite automaticamente dal layer di parsing di Koa (es. `%2e%2e%2f`)

```js
if (requestedPath.includes('\0')) {
    ctx.status = 400;
    ctx.body = 'Bad Request';
    return;
}
const normalizedPath = path.normalize(requestedPath);
const fullPath = path.join(normalizedRootDir, normalizedPath);
if (!fullPath.startsWith(normalizedRootDir)) {
    ctx.status = 403;
    ctx.body = 'Forbidden';
    return;
}
```

Test di copertura: `__tests__/security.test.js` verifica `/../package.json`, `/%2e%2e%2f`, `/../../../etc/hosts`.

---

### [PS-2] Hidden Files/Directories

Introdotta in v3.0.0, l'opzione `hidden` permette un controllo granulare sulla visibilità di file e directory (righe ~537–550, ~760–795 in `index.cjs`):

- **Default `'visible'`** per dot-files e dot-directory (allineato alla *design philosophy* — vedi `CLAUDE.md`)
- **Blacklist assoluta** per pattern come `.git`, `.svn` (prevale su whitelist e default)
- **Whitelist** per `.well-known` (sempre visibile; utile per ACME / Let's Encrypt)
- **Pattern `alwaysHide`** — supporta glob e `RegExp` per match path-aware

Priority logic: `blacklist > whitelist > alwaysHide > default`.

> **Cambio rispetto al ciclo v3-alpha:** una prima implementazione di PS-2 aveva impostato `dotFiles.default: 'hidden'` come hardening-by-default + un warning runtime se omesso. Quella scelta è stata revertita alla finale v3.0.0 perché violava il principio "HTTP file server first" (`GET /.env` ritornava 404 anche se il file esisteva — sorpresa per l'operatore). PS-2 ora fornisce *meccanismi* di hardening; la *policy* (cosa nascondere) è scelta esplicita dell'operatore, documentata nella **Security Checklist** di `README.md` e `DOCUMENTATION.md`.

Test di copertura: `__tests__/hidden-option.test.js` — copre sia il default `'visible'` (system behavior) sia il path opt-in `default: 'hidden'`.

---

### [PS-3] XSS Prevention

Tutti i nomi file nel directory listing passano per `escapeHtml()` (righe 119–125):

```js
const _HTML_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    return unsafe.replace(_HTML_ESCAPE_RE, c => _HTML_ESCAPE_MAP[c]);
}
```

L'header `Content-Disposition` usa encoding RFC 5987 (percent-encoding UTF-8) con fallback ASCII quoted-string.

---

### [PS-4] Security Headers

Applicati alle pagine generate dal middleware (directory listing, pagine di errore):

| Header | Valore |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; style-src '<hash>'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |

Il CSP usa un hash SHA-256 del CSS inline invece di `'unsafe-inline'`.

Test di copertura: `__tests__/security-headers.test.js`.

---

### [PS-5] Dipendenze — Superficie d'Attacco Minima

| Pacchetto | Tipo | Note |
|---|---|---|
| `mime-types ^3.0.2` | Runtime | Unica dipendenza runtime |
| `koa >=3.1.2` | Peer | Aggiornato in v5.0.0 (Koa 2 non più supportato); sicurezza dipende dalla versione scelta dall'utente |
| `jest`, `supertest`, `eslint`, `ejs`, `autocannon`, `inquirer` | Dev only | Non impattano il bundle di produzione |

Superficie d'attacco della supply chain: **molto ridotta**.

---

## Miglioramenti Prioritari

### [M-1] Timeout configurabile sul template rendering *(Priorità: Media)*

**Problema**

Il callback `template.render` viene eseguito senza alcun timeout. Se la funzione esegue operazioni async lente (query DB, fetch remoti), la connessione rimane aperta indefinitamente, esponendo il server a un potenziale DoS per esaurimento di connessioni.

**Soluzione proposta**

Aggiungere un'opzione `template.renderTimeout` (default: `5000` ms) e wrappare la chiamata:

```js
const TIMEOUT_MS = options.template?.renderTimeout ?? 5000;

const renderWithTimeout = Promise.race([
    options.template.render(ctx, next, filePath, rawBuffer),
    new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Template render timeout')), TIMEOUT_MS)
    )
]);

try {
    await renderWithTimeout;
} catch (err) {
    ctx.status = 500;
    ctx.body = 'Internal Server Error';
}
```

**Impatto:** basso (aggiunta opzionale, backward-compatible).

---

### [M-2] Cache staleness su filesystem NFS/distribuiti *(Priorità: Media)*

**Problema**

La validazione della cache server-side si basa esclusivamente su `mtime + size` (righe 1055–1058). Su filesystem NFS o distribuiti (es. container con volumi montati), `mtime` può non aggiornarsi immediatamente dopo una modifica, portando il middleware a servire contenuti obsoleti.

**Soluzione proposta**

1. Aggiungere un'opzione `serverCache.maxAge` (in ms) per l'invalidazione time-based come secondo layer di controllo.
2. Documentare chiaramente la limitazione nella documentazione e nei JSDoc.

```js
serverCache: {
    rawFile: {
        enabled: false,
        maxSize: 52428800,
        maxFileSize: 1048576,
        maxAge: 0   // 0 = disabilitato, altrimenti ms
    }
}
```

**Impatto:** medio (richiede modifica alla logica LFU cache).

---

### [M-3] Documentare il rischio DNS Rebinding *(Priorità: Bassa)*

**Problema**

Il middleware non valida l'header `Host`. In scenari intranet/localhost senza reverse proxy davanti, un attaccante può eseguire attacchi di DNS rebinding per accedere al server come se fosse un'origine fidata.

**Soluzione proposta**

Non è necessario implementarlo nel middleware (responsabilità del reverse proxy o di Koa stesso), ma va documentato come prerequisito di deployment:

> **Nota di sicurezza:** questo middleware non valida l'header `Host`. In produzione, è necessario configurare un reverse proxy (nginx, Caddy) che accetti solo gli hostname attesi, oppure usare [`koa-host-header-safe`](https://github.com/search?q=koa+host+header) o simili.

**Stato V3:** documentato in `docs/DOCUMENTATION.md` → *Best Practices → Sicurezza → DNS Rebinding*, con esempio nginx e middleware Koa di allowlist su `ctx.host`.

---

### [M-4] Documentare i limiti dei security headers sui file statici *(Priorità: Bassa)*

**Problema**

I security headers (CSP, X-Frame-Options, ecc.) vengono aggiunti **solo** alle pagine generate dal middleware (directory listing, errori 404/500). I file statici serviti direttamente (HTML, JS, CSS dell'utente) non ricevono alcun header di sicurezza aggiuntivo.

Questo comportamento è by-design ma può generare false aspettative negli utenti che si aspettano una protezione automatica su tutti i file.

**Soluzione proposta**

Aggiungere nella documentazione una sezione dedicata che spieghi:
- Quali pagine ricevono i security headers
- Come aggiungere headers custom sui file statici tramite Koa middleware separato
- Esempio con `ctx.set()` a monte di `koa-classic-server`

**Stato V3:** documentato in `docs/DOCUMENTATION.md` → *Best Practices → Sicurezza → Limiti dei Security Headers sui file statici*, con tabella degli header impostati automaticamente, esempio di middleware Koa upstream con CSP/HSTS/Referrer-Policy, e note operative su CSP report-only e COOP/COEP.

---

## Nice-to-Have

### [N-1] Logger iniettabile dall'esterno

**Problema**

Gli errori interni (stream error, file access error) vengono scritti direttamente su `console.error`. In produzione, con sistemi di log aggregati, questo può esporre stack trace o percorsi file in output non controllati.

**Soluzione proposta**

Aggiungere un'opzione `logger` che accetti un oggetto compatibile con l'interfaccia standard (`{ error, warn, info }`):

```js
koaClassicServer(rootDir, {
    logger: pinoInstance  // o winston, console, ecc.
})
```

Default: `console` (backward-compatible).

---

### [N-2] Protezione contro directory listing con molti file

**Problema**

Il directory listing processa le entry in batch da 64 elementi con `Promise.all()`. Con directory contenenti decine di migliaia di file, la generazione della risposta può occupare molta memoria e CPU, contribuendo a un DoS indiretto.

**Soluzione proposta**

1. Aggiungere un'opzione `dirListing.maxEntries` (default: es. `10000`) che tronca il listing e mostra un avviso.
2. Aggiungere paginazione opzionale al directory listing.

---

## Riepilogo

| ID | Descrizione | Priorità | Stato |
|---|---|---|---|
| PS-1 | Path Traversal multi-layer | — | Implementato |
| PS-2 | Hidden Files/Directories | — | Implementato |
| PS-3 | XSS Prevention nel listing | — | Implementato |
| PS-4 | Security Headers CSP/HSTS | — | Implementato |
| PS-5 | Dipendenze minimali | — | Implementato |
| M-1 | Timeout template rendering | Media | Implementato |
| M-2 | Cache staleness NFS | Media | Implementato |
| M-3 | Documentare DNS Rebinding | Bassa | Documentato |
| M-4 | Documentare limiti security headers | Bassa | Documentato |
| N-1 | Logger iniettabile | Nice-to-have | Implementato |
| N-2 | Protezione DoS directory listing | Nice-to-have | Implementato (con caveat — vedi sotto) |

---

## Future Work — v3.1

> **Nota:** ulteriori problemi emersi dalla revisione completa del codice (2026-07-03) sono
> tracciati in [`docs/revisione_codice_v3.1.md`](./revisione_codice_v3.1.md) — in particolare
> la voce **#4** (compressione: buffering illimitato in RAM + flush della cache LFU), affine
> per natura a [F-1]. Quella voce non è duplicata qui: il registro della revisione è la
> fonte unica.

### [F-1] Opt-in streaming read per directory adversarial *(rimandato a v3.1)*

**Contesto**

La prima implementazione di N-2 (v3.0.0-alpha.0) usava `fs.promises.opendir()` con async iterator per limitare la lettura a `dirListing.maxEntries` entry e bounded la RAM indipendentemente dalla dimensione su disco. I benchmark hanno mostrato una regressione di latenza di 3-4× sui listing rispetto a v2 (es. dir 10k file: 90 ms → 405 ms), dovuta all'overhead di una `Promise` per ogni entry nell'async iterator.

Prima del rilascio è stato applicato un fix (vedi commit di v3.0.0-alpha.0): la lettura è tornata a usare `fs.promises.readdir({ withFileTypes: true })` seguita da `slice(0, dirListing.maxEntries)`. Recupera le performance v2, ma **rinuncia alla garanzia "RAM bounded regardless of disk size"**: una directory con milioni di file alloca milioni di Dirent prima dello slicing.

**Decisione v3.0**

Per il caso d'uso primario (servire asset statici controllati dall'operatore) la nuova implementazione è ottimale. Il caso edge — directory scrivibile da utenti non fidati, attaccante che crea milioni di file — non è la modalità d'uso dichiarata del middleware e va affrontata a livello applicativo / OS.

**Proposta per v3.1**

Aggiungere un'opzione `dirListing.readMode` (`'fast' | 'bounded'`, default `'fast'`):

```javascript
app.use(koaClassicServer(rootDir, {
  dirListing: {
    maxEntries: 1000,
    readMode:   'bounded',   // opendir() streaming, RAM bounded a O(maxEntries)
  }
}));
```

- `'fast'` (default) — comportamento v3.0: readdir + slice, performance v2-class
- `'bounded'` — opendir async iterator: lettura interrotta a `dirListing.maxEntries`, RAM bounded indipendentemente dalla dimensione su disco, latenza più alta sui listing

Trade-off documentato chiaramente nella user-facing doc. Da valutare prima del freeze 3.1:
- Test simmetrici nelle due modalità
- Validazione factory (`dirListing.readMode` ∈ `{'fast', 'bounded'}`)
- Aggiornamento README + DOCUMENTATION.md con esempio di scelta

Il caso d'uso target di `'bounded'`: hosting multi-tenant con directory scrivibili da utenti (es. `/uploads`), backup server, log shipper con cartelle spool.

**Rinviato perché**

- Non è regressione rispetto a v2 (v2 aveva esattamente questo profilo memoria)
- Caso d'uso adversarial-directory minoritario nel target del middleware
- Aggiungere un'opzione API non banale richiede design review e test approfonditi, meglio non aggiungerla in fretta nel rush release di 3.0

---

### [F-1bis] Brainstorm — hybrid automatico fast/bounded *(da decidere in v3.1)*

In sede di discussione dei default v3.0 è emersa la richiesta di valutare un **terzo modo**: una scelta automatica fra `fast` e `bounded` basata sulla dimensione effettiva della directory, in modo che 99% degli operatori non debbano configurare nulla. Documento qui i risultati del brainstorm così la decisione finale per v3.1 ha già contesto.

#### Vincolo tecnico: chicken-and-egg

Per scegliere il path PRIMA di leggere serve un modo *economico* di stimare il numero di entry. `readdir()` (fast) lo scopri solo *dopo* aver pagato l'allocazione completa — quindi il danno è già fatto. `opendir()` (bounded) lo scopri streamando — ma se stai streamando hai già pagato l'overhead per-entry, non c'è più nulla da salvare.

L'hybrid puramente automatico richiede una di queste premesse:

1. **Size hint dal FS** (`fs.stat().size` su directory)
2. **Probe-and-commit** (leggi le prime N entry, poi decidi)
3. **Cache di metadati da richieste precedenti**

Tutte e tre hanno problemi.

#### Approccio A — `fs.stat()` size hint

Su ext4/xfs/tmpfs la `size` di una directory è grossolanamente correlata col numero di entry (~24-64 byte per entry). Una stat() extra costa ~0.1 ms.

```javascript
const dirStat = await fs.promises.stat(toOpen);
if (dirStat.size > THRESHOLD_BYTES) {
    return streamingRead(toOpen, maxEntries);  // bounded
} else {
    return fastRead(toOpen, maxEntries);       // readdir + slice
}
```

**Pro:** decisione *prima* dell'allocazione, costo ridotto, semplice.
**Contro decisivo:**
- **FS-dependent**: NFS / remote FS / FUSE / overlayfs spesso ritornano `size: 0` o valori non significativi per le directory.
- **False negative**: dir con `size` piccola ma molte entry (nomi corti, hash table compatta) → bypassa il safe path → OOM possibile.
- **False positive**: dir con `size` grande ma poche entry (nomi molto lunghi) → safe path inutile → 3-4× più lento del necessario.
- Soglia magica filesystem-dependent.

Funziona ~85% dei casi su FS POSIX locali, ma "85%" su un comportamento di sicurezza non è abbastanza.

#### Approccio B — Probe-and-commit

Apri sempre con `opendir()`. Leggi le prime N entry (es. 5000) via streaming, poi decidi:

```javascript
const handle = await fs.opendir(toOpen);
const buffer = [];
for await (const entry of handle) {
    buffer.push(entry);
    if (buffer.length >= PROBE_LIMIT) break;
}
// dir piccola → buffer è già il risultato finale
// dir grande → continua streaming (slow) o butta e ricomincia con readdir (work duplicato)
```

**Pro:** niente heuristica FS-dependent, decisione basata su dato reale.
**Contro decisivo:**
- Paghi sempre l'overhead opendir per le prime N entry (N=5000 → ~155 ms anche su dir di 100 file).
- Per dir piccole è una regressione netta.
- Se sopra threshold devi scegliere fra continuare streaming (lento) o re-leggere via readdir (lavoro duplicato).

Non hybridizza davvero: regressione per i casi piccoli.

#### Approccio C — Cache di metadati

Ricorda il numero di entry dalla richiesta precedente alla stessa directory.

**Contro:**
- Prima richiesta sempre slow.
- Stale cache su FS che cambiano.
- Multi-process unsafe.
- Memory overhead.

Scartato in fase di brainstorm.

#### Cosa fanno nginx e Apache

Ricerca rapida sul comportamento di altri server statici:

| Server | Modulo | Strategia | Note |
|---|---|---|---|
| **nginx** | `autoindex` | `opendir()` + iterazione sempre | Performance "decente, non eccellente". Documentazione raccomanda di disabilitarlo in produzione. |
| **Apache HTTPd** | `mod_autoindex` | `opendir()` + iterazione sempre | Idem. Considerato feature di dev/admin, non hot path. |
| **lighttpd** | `mod_dirlisting` | `opendir()` + iterazione | Stesso pattern. |
| **caddy** | listing module | `os.ReadDir()` (Go), che è l'equivalente di readdir+slice | Niente hybrid. |

**Pattern industria**: nessuno fa hybrid automatico. La scelta universale è **`opendir()` sempre** (accetta la lentezza come prezzo della sicurezza) oppure **`readdir()` sempre** (caddy, accetta la potenziale RAM exhaustion).

La motivazione consensuale: *autoindex non è un hot path. Chi serve milioni di file con autoindex acceso o ha una specifica esigenza (lo configurerà) o sta abusando della feature (servirà disabilitarlo).*

#### Conclusione del brainstorm

L'hybrid automatico ha tre realizzazioni teoriche, **nessuna soddisfacente**:

| Approccio | Pro | Contro decisivo |
|---|---|---|
| A — stat() heuristic | trasparente | FS-dependent, soglia magica, false-negative pericolosi |
| B — probe-and-commit | non heuristica | overhead sempre, lavoro duplicato |
| C — cache | trasparente per richieste successive | prima sempre slow, stale, unsafe |

Le opzioni *robuste* restano due:

1. **`readMode: 'fast' | 'bounded'` esplicito** (la proposta originale [F-1]) — operatore sceglie consapevolmente
2. **`readMode: 'auto' | 'fast' | 'bounded'`** con `auto` = approccio A — friendly per i casi POSIX comuni, escape hatch per workload critici

**Raccomandazione per v3.1:** preferire (1) — è quello che fanno tutti gli altri server. La variante (2) con `auto` come default amichevole è tecnicamente possibile ma il caveat "best-effort, fragile su NFS/FUSE" rende l'opzione `auto` più rumorosa da documentare di quanto valga.

**Decisione finale rimandata al freeze 3.1.**

---
