# DEBUG REPORT - koa-classic-server

**Data Analisi:** 2025-11-17
**Versione Analizzata:** 1.1.0
**Branch:** claude/featuring-koa-smart-server-016TZsdaPURgHLiQHmCFJFsk

---

## Sommario Esecutivo

Sono stati identificati **8 problemi** di cui:
- 🔴 **CRITICI:** 2 (sicurezza)
- 🟠 **ALTA PRIORITÀ:** 3 (funzionalità core)
- 🟡 **MEDIA PRIORITÀ:** 2 (robustezza)
- 🔵 **BASSA PRIORITÀ:** 1 (qualità codice)

---

## 🔴 PROBLEMI CRITICI

### 1. Path Traversal Vulnerability (CRITICO - SICUREZZA)

**Location:** `index.cjs:104`

**Codice:**
```javascript
toOpen = rootDir + decodeURIComponent(pageHrefOutPrefix.pathname);
```

**Problema:**
Non c'è validazione del path per prevenire attacchi di path traversal. Un attaccante può accedere a file al di fuori di `rootDir`.

**Attacco Esempio:**
```
GET /../../../etc/passwd
GET /../config/database.yml
GET /../.env
```

**Impatto:**
- Accesso non autorizzato a file sensibili del server
- Potenziale lettura di credenziali, configurazioni, chiavi private
- Violazione della sicurezza del sistema

**Severità:** 🔴 CRITICA

**Fix Raccomandato:**
```javascript
const path = require('path');

// Normalizza e verifica che il path risultante sia dentro rootDir
const requestedPath = path.normalize(decodeURIComponent(pageHrefOutPrefix.pathname));
const fullPath = path.join(rootDir, requestedPath);

// Verifica che il path finale sia dentro rootDir
if (!fullPath.startsWith(path.resolve(rootDir))) {
    ctx.status = 403;
    ctx.body = 'Forbidden';
    return;
}

toOpen = fullPath;
```

**Riferimenti:**
- OWASP: Path Traversal
- CWE-22: Improper Limitation of a Pathname to a Restricted Directory

---

### 2. Mancanza di Gestione Errori Template Rendering (CRITICO - DISPONIBILITÀ)

**Location:** `index.cjs:167`

**Codice:**
```javascript
await options.template.render(ctx, next, toOpen);
```

**Problema:**
Nessun try-catch attorno alla chiamata `template.render`. Se il rendering fallisce, l'errore non gestito può crashare l'applicazione.

**Impatto:**
- Crash del server su errore di rendering
- Denial of Service potenziale
- Esperienza utente degradata

**Severità:** 🔴 CRITICA

**Fix Raccomandato:**
```javascript
if (options.template.ext.includes(fileExt)) {
    try {
        await options.template.render(ctx, next, toOpen);
        return;
    } catch (error) {
        console.error('Template rendering error:', error);
        ctx.status = 500;
        ctx.body = 'Internal Server Error - Template Rendering Failed';
        return;
    }
}
```

---

## 🟠 PROBLEMI ALTA PRIORITÀ

### 3. Status Code 404 Non Settato (ALTA - STANDARD HTTP)

**Location:**
- `index.cjs:110` (file non esiste)
- `index.cjs:128` (directory listing disabilitato)

**Codice:**
```javascript
// Linea 110
if (!fs.existsSync(toOpen)) {
    ctx.body = requestedUrlNotFound();
    // Manca: ctx.status = 404;
    return;
}

// Linea 128
} else {
    // allora non devo mostrare il contenuto della directory
    ctx.body = requestedUrlNotFound();
    // Manca: ctx.status = 404;
}
```

**Problema:**
Quando una risorsa non viene trovata, viene restituito un body HTML con "Not Found", ma lo status HTTP rimane 200 (OK) invece di 404 (Not Found).

**Impatto:**
- Violazione standard HTTP
- Cache proxy potrebbero cachare errori come successi
- SEO negativo (motori di ricerca indicizzano pagine 404 come valide)
- Client non possono distinguere successo da errore basandosi sullo status code

**Verifica:**
```bash
curl -I http://localhost:3000/file-che-non-esiste.txt
# Atteso: HTTP/1.1 404 Not Found
# Attuale: HTTP/1.1 200 OK
```

**Severità:** 🟠 ALTA

**Fix Raccomandato:**
```javascript
// Linea 110
if (!fs.existsSync(toOpen)) {
    ctx.status = 404;
    ctx.body = requestedUrlNotFound();
    return;
}

// Linea 128
} else {
    ctx.status = 404;
    ctx.body = requestedUrlNotFound();
}
```

---

### 4. Race Condition nella Lettura File (ALTA - AFFIDABILITÀ)

**Location:** `index.cjs:107-172`

**Codice:**
```javascript
if (!fs.existsSync(toOpen)) {
    // ...
}
// ... altre operazioni ...
const src = fs.createReadStream(toOpen);  // Linea 172
```

**Problema:**
C'è un gap temporale (TOCTOU - Time-of-check to Time-of-use) tra:
1. Controllo esistenza file (`existsSync`)
2. Lettura file (`createReadStream`)

Se il file viene cancellato tra questi due momenti, `createReadStream` lancia un errore non gestito.

**Impatto:**
- Possibile crash del server
- Errore non gestito raggiunge l'utente
- Log inquinati da stack trace

**Severità:** 🟠 ALTA

**Fix Raccomandato:**
```javascript
async function loadFile(toOpen) {
    // Template rendering logic...

    try {
        // Verifica esistenza prima di stream
        await fs.promises.access(toOpen, fs.constants.R_OK);

        let mimeType = mime.lookup(toOpen);
        const src = fs.createReadStream(toOpen);

        // Gestisci errori stream
        src.on('error', (err) => {
            console.error('Stream error:', err);
            if (!ctx.headerSent) {
                ctx.status = 500;
                ctx.body = 'Error reading file';
            }
        });

        ctx.response.set("content-type", mimeType);
        ctx.response.set("content-disposition",
            `inline; filename=${pageHrefOutPrefix.pathname.substring(1)}`);
        ctx.body = src;
    } catch (error) {
        console.error('File access error:', error);
        ctx.status = 404;
        ctx.body = requestedUrlNotFound();
    }
}
```

---

### 5. Estrazione Estensione File Fragile (ALTA - ROBUSTEZZA)

**Location:** `index.cjs:163-164`

**Codice:**
```javascript
const a_path = toOpen.split(".");
const fileExt = a_path[a_path.length - 1];
```

**Problema:**
Metodo fragile per estrarre l'estensione:
- File senza estensione: `README` → estensione = "README" (errato)
- File con più punti: `archive.tar.gz` → estensione = "gz" (potrebbe essere errato)
- File nascosti Unix: `.gitignore` → estensione = "gitignore" (errato)
- Path con punti: `/folder.backup/file` → estensione = "backup/file" (errato)

**Impatto:**
- Template rendering potrebbe attivarsi su file sbagliati
- File nascosti potrebbero essere processati erroneamente

**Severità:** 🟠 ALTA

**Fix Raccomandato:**
```javascript
const path = require('path');

async function loadFile(toOpen) {
    if (options.template.ext.length > 0) {
        // Usa path.extname che gestisce correttamente tutti i casi
        const fileExt = path.extname(toOpen).slice(1); // .slice(1) rimuove il punto

        if (fileExt && options.template.ext.includes(fileExt)) {
            try {
                await options.template.render(ctx, next, toOpen);
                return;
            } catch (error) {
                console.error('Template rendering error:', error);
                ctx.status = 500;
                ctx.body = 'Internal Server Error';
                return;
            }
        }
    }
    // ... resto del codice
}
```

---

## 🟡 PROBLEMI MEDIA PRIORITÀ

### 6. Mancanza Gestione Errori fs.readdirSync (MEDIA - ROBUSTEZZA)

**Location:** `index.cjs:183`

**Codice:**
```javascript
function show_dir(toOpen) {
    dir = fs.readdirSync(toOpen, { withFileTypes: true }); // possibile error error.code == "ENOENT" ???
```

**Problema:**
Il commento stesso riconosce il problema: `readdirSync` può lanciare errori (permessi insufficienti, directory cancellata, etc.) ma non c'è gestione.

**Errori Possibili:**
- `ENOENT`: Directory non esiste più
- `EACCES`: Permessi insufficienti
- `ENOTDIR`: Path non è una directory

**Impatto:**
- Crash su errori filesystem
- Messaggi di errore criptici all'utente

**Severità:** 🟡 MEDIA

**Fix Raccomandato:**
```javascript
function show_dir(toOpen) {
    let dir;
    try {
        dir = fs.readdirSync(toOpen, { withFileTypes: true });
    } catch (error) {
        console.error('Directory read error:', error);
        return `
            <!DOCTYPE html>
            <html>
            <head><title>Error</title></head>
            <body>
                <h1>Error Reading Directory</h1>
                <p>Unable to access directory contents.</p>
            </body>
            </html>
        `;
    }

    // ... resto della funzione
}
```

---

### 7. Gestione Inconsistente Content-Disposition (MEDIA - QUALITÀ)

**Location:** `index.cjs:174-177`

**Codice:**
```javascript
ctx.response.set(
    "content-disposition",
    `inline; filename=${pageHrefOutPrefix.pathname.substring(1)}`
);
```

**Problema:**
Il filename in Content-Disposition non è quotato e non è sanitizzato:
- Caratteri speciali nel filename potrebbero causare problemi
- Spazi e caratteri non-ASCII non sono gestiti
- Secondo RFC 6266, il filename dovrebbe essere quotato se contiene caratteri speciali

**Impatto:**
- Download file con nomi strani potrebbero fallire
- Alcuni browser potrebbero interpretare male il filename

**Severità:** 🟡 MEDIA

**Fix Raccomandato:**
```javascript
const path = require('path');

// Estrai solo il basename, non l'intero path
const filename = path.basename(pageHrefOutPrefix.pathname);

// Quota il filename per sicurezza
ctx.response.set(
    "content-disposition",
    `inline; filename="${filename.replace(/"/g, '\\"')}"`
);

// O ancora meglio, usa una libreria come content-disposition:
// const contentDisposition = require('content-disposition');
// ctx.response.set("content-disposition", contentDisposition(filename, { type: 'inline' }));
```

---

## 🔵 PROBLEMI BASSA PRIORITÀ

### 8. Uso di Array() Invece di [] (BASSA - STILE)

**Location:** Multiple locations

**Codice:**
```javascript
options.method = Array.isArray( options.method ) ? options.method : Array('GET');
options.urlsReserved = Array.isArray( options.urlsReserved ) ? options.urlsReserved : Array();
options.template.ext = ( Array.isArray(options.template.ext) ) ? options.template.ext : Array();
```

**Problema:**
`Array('GET')` crea un array con un elemento, ma è meno idiomatico di `['GET']`. Inoltre `Array()` è meno leggibile di `[]`.

**Impatto:**
- Nessun impatto funzionale
- Ridotta leggibilità codice

**Severità:** 🔵 BASSA

**Fix Raccomandato:**
```javascript
options.method = Array.isArray(options.method) ? options.method : ['GET'];
options.urlsReserved = Array.isArray(options.urlsReserved) ? options.urlsReserved : [];
options.template.ext = Array.isArray(options.template.ext) ? options.template.ext : [];
```

---

## Test dei Problemi

### Test Path Traversal (Problema #1)

```javascript
// test-path-traversal.js
const supertest = require('supertest');
const Koa = require('koa');
const koaClassicServer = require('./index.cjs');

const app = new Koa();
app.use(koaClassicServer(__dirname + '/public'));
const server = app.listen();

// Test attacco path traversal
supertest(server)
    .get('/../package.json')  // Tenta di accedere fuori da public/
    .end((err, res) => {
        console.log('Status:', res.status);
        console.log('Body contains package.json?', res.text.includes('"name"'));
        // Se vedi il contenuto di package.json, la vulnerabilità è confermata
        server.close();
    });
```

### Test Status Code 404 (Problema #3)

```javascript
// test-404-status.js
const supertest = require('supertest');
const Koa = require('koa');
const koaClassicServer = require('./index.cjs');

const app = new Koa();
app.use(koaClassicServer(__dirname + '/public'));
const server = app.listen();

supertest(server)
    .get('/file-che-non-esiste.txt')
    .end((err, res) => {
        console.log('Status Code:', res.status);
        console.log('Expected: 404, Got:', res.status);
        console.log('BUG CONFIRMED:', res.status === 200); // true = bug presente
        server.close();
    });
```

### Test Template Error (Problema #2)

```javascript
// test-template-error.js
const Koa = require('koa');
const koaClassicServer = require('./index.cjs');

const app = new Koa();

// Template render che lancia errore
const brokenRender = async (ctx, next, filePath) => {
    throw new Error('Simulated template error');
};

app.use(koaClassicServer(__dirname + '/public', {
    template: {
        render: brokenRender,
        ext: ['html']
    }
}));

const server = app.listen(3000);

// Accedi a un file .html
// Il server crasherà con errore non gestito
```

---

## Priorità di Fix

### Immediate (Prima del Deploy)
1. **Path Traversal** (Problema #1) - CRITICO
2. **Status Code 404** (Problema #3) - ALTA

### Breve Termine (Prossimo Release)
3. **Template Error Handling** (Problema #2) - CRITICO
4. **Race Condition File** (Problema #4) - ALTA
5. **Estrazione Estensione** (Problema #5) - ALTA

### Medio Termine (Miglioramenti)
6. **fs.readdirSync Error** (Problema #6) - MEDIA
7. **Content-Disposition** (Problema #7) - MEDIA

### Opzionale (Refactoring)
8. **Array() vs []** (Problema #8) - BASSA

---

## Miglioramenti Generali Raccomandati

### 1. Aggiungere Validazione Input
```javascript
// All'inizio della funzione principale
if (!rootDir || typeof rootDir !== 'string') {
    throw new TypeError('rootDir must be a non-empty string');
}

if (!path.isAbsolute(rootDir)) {
    throw new Error('rootDir must be an absolute path');
}
```

### 2. Logging Strutturato
```javascript
// Opzione per logging
options.logger = options.logger || console;

// Usa nel codice
options.logger.error('File not found:', toOpen);
options.logger.warn('Template rendering failed:', error);
```

### 3. Timeout per Template Rendering
```javascript
// Previeni template rendering infiniti
const renderWithTimeout = (renderFn, timeout = 5000) => {
    return Promise.race([
        renderFn(),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Render timeout')), timeout)
        )
    ]);
};
```

### 4. Sanitizzazione HTML in Directory Listing
```javascript
// Previeni XSS in nomi file
function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Usa quando mostri nomi file
s_dir += ` <a href="${itemUri}">${escapeHtml(s_name)}</a>`;
```

---

## Metriche Codice

### Complessità Ciclomatica
- **Funzione principale:** ~25 (Alta - da ridurre)
- **show_dir:** ~15 (Media)
- **loadFile:** ~5 (Bassa)

### Raccomandazione
Spezzare la funzione principale in sottofunzioni più piccole:
- `validateRequest()`
- `checkReservedUrls()`
- `resolveFilePath()`
- `handleResource()`

---

## Conclusioni

Il progetto koa-classic-server presenta **2 vulnerabilità critiche di sicurezza** che devono essere risolte immediatamente prima di qualsiasi deploy in produzione:

1. **Path Traversal** - permette accesso a file arbitrari
2. **Template Error Unhandled** - può causare crash del server

Inoltre, ci sono **3 problemi di alta priorità** che impattano conformità agli standard HTTP e affidabilità:

3. Status code 404 mancante
4. Race condition nella lettura file
5. Estrazione estensione fragile

**Raccomandazione:** Implementare i fix per problemi #1, #2, #3 prima del prossimo release.

---

**Report compilato da:** Claude Code Analysis
**Branch analizzata:** claude/featuring-koa-smart-server-016TZsdaPURgHLiQHmCFJFsk
**Commit:** f8693a0
