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

Introdotta in v3.0.0, l'opzione `hidden` permette un controllo granulare (righe 334–346, 602–616):

- **Dot-files nascosti di default** (`hidden.dotFiles.default = 'hidden'`)
- **Dot-directory visibili di default** (`hidden.dotDirs.default = 'visible'`)
- **Blacklist assoluta** per `.git`, `.svn` (prevalenza su qualsiasi altra regola)
- **Whitelist** per `.well-known` (sempre visibile)
- **Pattern `alwaysHide`** — supporta glob e `RegExp`

Priority logic: `blacklist > whitelist > alwaysHide > default`.

Test di copertura: `__tests__/hidden-option.test.js`.

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
| `koa ^2.16.4 \|\| >=3.1.2` | Peer | Sicurezza dipende dalla versione scelta dall'utente |
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

1. Aggiungere un'opzione `maxDirEntries` (default: es. `1000`) che tronca il listing e mostra un avviso.
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
| N-2 | Protezione DoS directory listing | Nice-to-have | Implementato |
