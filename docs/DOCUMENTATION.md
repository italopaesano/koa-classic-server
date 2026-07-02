# KOA-CLASSIC-SERVER - Documentazione Completa

## Indice

- [Descrizione del Modulo](#descrizione-del-modulo)
- [Installazione](#installazione)
- [Avvio Rapido](#avvio-rapido)
- [Configurazione](#configurazione)
- [Esempi d'Uso](#esempi-duso)
- [API Reference](#api-reference)
- [Comportamento del Middleware](#comportamento-del-middleware)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Problemi Noti](#problemi-noti)
- [Best Practices](#best-practices)

---

## Descrizione del Modulo

### Panoramica

**koa-classic-server** è un middleware per Koa.js che emula il comportamento di Apache 2 per la gestione di file statici. Il modulo permette di servire file e directory con funzionalità avanzate di directory listing, supporto per template engine, gestione di URL riservati e configurazione flessibile.

### Caratteristiche Principali

#### 1. Servizio File Statici
- Serve file statici da una directory specificata
- Riconoscimento automatico dei MIME types
- Gestione corretta di encoding e content-disposition
- Supporto per caratteri speciali e Unicode nei nomi file

#### 2. Directory Listing
- Visualizzazione del contenuto delle directory in formato HTML tabellare
- Navigazione parent directory con link ".. Parent Directory"
- Indicazione chiara del tipo di risorsa (DIR, MIME type)
- Gestione e visualizzazione cartelle riservate
- Supporto completo link simbolici (symlink a file, directory, broken e circolari)

#### 3. Supporto Template Engine
- Integrazione flessibile con motori di template (es. EJS, Pug, Handlebars)
- Rendering personalizzato per estensioni specifiche
- Callback configurabile per il rendering
- Accesso completo al contesto Koa (ctx, next)

#### 4. Gestione URL Avanzata
- Supporto per URL prefix (es. `/public`, `/static`, `/files`)
- URL riservati non accessibili da remoto
- Normalizzazione automatica degli URL (rimozione trailing slash)
- Decodifica URI corretta per spazi e caratteri speciali
- Gestione case-sensitive dei path

#### 5. Compatibilità Moduli
- Supporto CommonJS (`require`)
- Supporto ES Modules (`import`)
- Conditional exports in package.json per massima compatibilità

### Architettura

```
koa-classic-server/
├── index.cjs          # Implementazione principale (CommonJS)
├── index.mjs          # Wrapper ES Modules
├── package.json       # Configurazione con conditional exports
├── __tests__/         # Suite di test Jest
│   ├── index.test.js  # Test completi
│   └── publicWwwTest/ # Cartella di test
├── customTest/        # Utility per test manuali
│   ├── loadConfig.util.js      # Script interattivo
│   └── serversToLoad.util.js   # Configurazioni test
├── LICENSE            # Licenza MIT
├── README.md          # Documentazione base
└── DOCUMENTATION.md   # Questa documentazione
```

### Flusso di Esecuzione

Il middleware segue questo flusso per ogni richiesta HTTP:

1. **Validazione Metodo HTTP**: Verifica che il metodo sia tra quelli ammessi
2. **Normalizzazione URL**: Rimuove trailing slash e normalizza il path
3. **Verifica URL Prefix**: Controlla che la richiesta cada sotto il prefix configurato
4. **Controllo URL Riservati**: Verifica che non sia una risorsa protetta
5. **Risoluzione Path**: Costruisce il path completo file/directory
6. **Esistenza Risorsa**: Verifica che file o directory esistano
7. **Gestione Risorsa**:
   - **File**: Template rendering o servizio statico
   - **Directory**: Index file o directory listing

### Dipendenze

#### Production
- **mime-types** (^2.1.35): Riconoscimento automatico MIME types

#### Peer Dependencies
- **koa** (^2.0.0 || >=3.1.2): Framework web minimale per Node.js

#### Development
- **jest** (^30.2.0): Framework di testing
- **supertest** (^7.2.2): Testing richieste HTTP
- **inquirer** (^13.3.0): CLI interattiva per testing manuale
- **autocannon** (^8.0.0): HTTP benchmarking
- **ejs** (^3.1.10): Template engine per i test

---

## Installazione

### Installazione via npm

```bash
npm install koa-classic-server
```

### Installazione via yarn

```bash
yarn add koa-classic-server
```

### Requisiti

- **Node.js**: 12.20+ (raccomandato 14+)
- **Koa**: 2.x

---

## Avvio Rapido

### Esempio Minimale

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Serve tutti i file dalla cartella "public"
app.use(koaClassicServer(__dirname + '/public'));

app.listen(3000);
console.log('Server avviato su http://localhost:3000');
```

Questa configurazione base:
- Serve tutti i file dalla cartella `public`
- Mostra il contenuto delle directory
- Accetta solo richieste GET
- Nessun URL prefix o percorso riservato

### Esempio con Opzioni

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/public', {
  dirListing: { enabled: true },
  index: 'index.html',
  urlPrefix: '/static'
}));

app.listen(3000);
console.log('Server avviato su http://localhost:3000/static');
```

---

## Configurazione

### Sintassi

```javascript
koaClassicServer(rootDir, options)
```

### Parametri

| Parametro | Tipo | Obbligatorio | Descrizione |
|-----------|------|--------------|-------------|
| `rootDir` | String | Sì | Path assoluto della directory da servire |
| `options` | Object | No | Oggetto di configurazione |

### Opzioni Disponibili

```javascript
const options = {
  // Metodi HTTP ammessi
  // Default: ['GET']
  method: ['GET', 'HEAD'],

  // Mostra il contenuto delle directory
  // Default: true
  dirListing: { enabled: true },

  // Nome del file index da caricare automaticamente nelle directory
  // Se presente, viene caricato invece del directory listing
  // Default: ''
  index: 'index.html',

  // Prefisso URL da rimuovere dal path
  // Es: '/public' significa che i file sono accessibili sotto /public/
  // Default: ''
  urlPrefix: '/public',

  // Array di percorsi riservati (non accessibili da remoto)
  // Funziona solo per directory di primo livello
  // Default: []
  urlsReserved: ['/api', '/admin', '/config'],

  // Configurazione template engine
  template: {
    // Funzione di rendering personalizzata
    // Riceve: ctx (contesto Koa), next (middleware successivo), filePath (path file)
    // Default: undefined
    render: async (ctx, next, filePath) => {
      // Implementazione custom
      // Es: ctx.body = await ejs.renderFile(filePath, data);
    },

    // Array di estensioni file da processare con template.render
    // Se un file ha una di queste estensioni, viene chiamato render()
    // Default: []
    ext: ['ejs', 'EJS', 'pug', 'html']
  }
};
```

### Dettaglio Opzioni

#### `method` (Array)

Specifica i metodi HTTP accettati dal middleware. Se una richiesta usa un metodo non presente nell'array, viene passata al middleware successivo.

```javascript
// Solo GET
method: ['GET']

// GET e HEAD (utile per check esistenza file)
method: ['GET', 'HEAD']

// Multipli metodi (uso avanzato)
method: ['GET', 'HEAD', 'POST']
```

#### `symlinks` (String)

Policy di risoluzione dei link simbolici (V3.1+). Protezione **opt-in** contro il symlink escape (un symlink dentro `rootDir` che punta a un target fuori da `rootDir`).

```javascript
// Default: segue i symlink ovunque, anche fuori da rootDir (comportamento storico)
symlinks: 'follow'

// Segue solo se il target risolto resta dentro rootDir; altrimenti 404
symlinks: 'follow-within-root'

// Non segue mai un symlink risolto sotto rootDir
symlinks: 'deny'
```

Le modalità protette (`'follow-within-root'`, `'deny'`) costano un `realpath()` per path servito e richiedono che `rootDir` esista all'istanziazione. `rootDir` può essere esso stesso un symlink in ogni modalità. Dettagli completi nella sezione *Gestione dei Link Simbolici → Opzione `symlinks`*.

#### `dirListing.enabled` (Boolean)

Controlla se mostrare il contenuto delle directory.

```javascript
// Mostra directory listing
dirListing: { enabled: true }

// Non mostra directory (restituisce "Not Found")
dirListing: { enabled: false }
```

#### `index` (String)

Nome del file da caricare automaticamente quando si accede a una directory.

```javascript
// Carica index.html se presente
index: 'index.html'

// Carica default.htm se presente
index: 'default.htm'

// Nessun index (mostra sempre directory listing)
index: ''
```

**Comportamento:**
1. Utente accede a `/cartella/`
2. Se esiste `/cartella/index.html` → viene servito
3. Altrimenti → mostra directory listing (se `dirListing: { enabled: true }`)

#### `urlPrefix` (String)

Prefisso URL che il middleware deve intercettare. Utile per montare il file server sotto un percorso specifico.

```javascript
// File accessibili sotto /static
// Es: /static/image.png, /static/css/style.css
urlPrefix: '/static'

// File accessibili sotto /public
urlPrefix: '/public'

// Nessun prefix (root del server)
urlPrefix: ''
```

**Importante:**
- Il prefix viene rimosso prima di cercare il file nel filesystem
- Richiesta: `/static/image.png` → cerca `rootDir/image.png`

#### `urlsReserved` (Array)

Array di percorsi protetti, non accessibili da remoto. Utile per proteggere directory sensibili.

```javascript
urlsReserved: ['/config', '/private', '/.env']
```

**Limitazioni:**
- Funziona solo per directory di primo livello
- Non supporta percorsi annidati
- Non supporta wildcard

**Esempio:**
```javascript
// ✅ Funziona
urlsReserved: ['/admin']
// Blocca: /admin, /admin/file.txt, /admin/sub/file.txt

// ❌ Non funziona come ci si aspetta
urlsReserved: ['/folder/subfolder']
// Non blocca percorsi annidati
```

#### `template.render` (Function)

Funzione personalizzata per il rendering di template.

**Firma:**
```javascript
async function render(ctx, next, filePath) {
  // ctx: Contesto Koa
  // next: Middleware successivo
  // filePath: Path completo del file da renderizzare

  // Esempio EJS
  ctx.body = await ejs.renderFile(filePath, {
    // Dati passati al template
    title: 'My Page',
    user: ctx.state.user
  });
}
```

#### `template.ext` (Array)

Array di estensioni file che devono essere processate con `template.render`.

```javascript
// Solo file .ejs
ext: ['ejs']

// File .ejs e .EJS (case-sensitive)
ext: ['ejs', 'EJS']

// Multipli template engine
ext: ['ejs', 'pug', 'html', 'hbs']
```

**Comportamento:**
- Se file ha estensione in `ext` E `render` è definito → esegue rendering
- Altrimenti → serve file normalmente

---

## Esempi d'Uso

### 1. Server Base con Directory Listing

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/public', {
  dirListing: { enabled: true },
  index: 'index.html'
}));

app.listen(3000);
console.log('Server su http://localhost:3000');
```

**Funzionalità:**
- Serve file da `public/`
- Mostra directory listing
- Carica `index.html` automaticamente se presente

---

### 2. Server con URL Prefix

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// File accessibili sotto /static
app.use(koaClassicServer(__dirname + '/public', {
  urlPrefix: '/static',
  method: ['GET', 'HEAD'],
  dirListing: { enabled: true }
}));

// Altri middleware per route diverse
app.use(async (ctx) => {
  ctx.body = 'Homepage del sito';
});

app.listen(3000);
```

**URL esempi:**
- `http://localhost:3000/` → Homepage
- `http://localhost:3000/static/` → Directory listing di public/
- `http://localhost:3000/static/image.png` → public/image.png

---

### 3. Server con Cartelle Protette

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/www', {
  dirListing: { enabled: true },
  // Protegge directory sensibili
  urlsReserved: ['/config', '/private', '/.git', '/node_modules']
}));

app.listen(3000);
```

**Comportamento:**
- `/config/` → Not Found (protetto)
- `/private/secret.txt` → Not Found (protetto)
- `/public/file.txt` → Accessibile

---

### 4. Server con Template Engine (EJS)

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/views', {
  dirListing: { enabled: false },
  template: {
    render: async (ctx, next, filePath) => {
      // Rendering EJS con dati
      ctx.body = await ejs.renderFile(filePath, {
        title: 'My App',
        filePath: filePath,
        href: ctx.href,
        query: ctx.query,
        user: ctx.state.user || 'Guest'
      });
    },
    ext: ['ejs', 'EJS']
  }
}));

app.listen(3000);
console.log('Server con EJS su http://localhost:3000');
```

---

### 5. Server Multi-Directory

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// File statici pubblici
app.use(koaClassicServer(__dirname + '/public', {
  urlPrefix: '/public',
  dirListing: { enabled: true }
}));

// Asset (CSS, JS, images)
app.use(koaClassicServer(__dirname + '/assets', {
  urlPrefix: '/assets',
  dirListing: { enabled: false }
}));

// Download area
app.use(koaClassicServer(__dirname + '/downloads', {
  urlPrefix: '/downloads',
  dirListing: { enabled: true },
  index: 'README.txt'
}));

app.listen(3000);
```

---

### 6. Configurazione Completa Produzione

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');
const path = require('path');

const app = new Koa();

// Logging middleware
app.use(async (ctx, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  console.log(`${ctx.method} ${ctx.url} - ${ms}ms`);
});

// Error handling
app.on('error', (err, ctx) => {
  console.error('Server error:', err);
});

// Template render function
const templateRender = async (ctx, next, filePath) => {
  try {
    ctx.body = await ejs.renderFile(filePath, {
      filePath: filePath,
      href: ctx.href,
      query: ctx.query,
      method: ctx.method,
      env: process.env.NODE_ENV
    });
  } catch (err) {
    console.error('Template render error:', err);
    ctx.status = 500;
    ctx.body = 'Template Error';
  }
};

// File server
app.use(koaClassicServer(path.join(__dirname, 'public'), {
  method: ['GET', 'HEAD'],
  dirListing: { enabled: process.env.NODE_ENV !== 'production' },
  index: 'index.html',
  urlPrefix: '/files',
  urlsReserved: ['/admin', '/private', '/config', '/.env'],
  template: {
    render: templateRender,
    ext: ['ejs', 'html']
  }
}));

// 404 fallback
app.use(async (ctx) => {
  ctx.status = 404;
  ctx.body = 'Pagina non trovata';
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server avviato su http://localhost:${port}`);
  console.log(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
});
```

---

### 7. Integrazione con Router Koa

```javascript
const Koa = require('koa');
const Router = require('@koa/router');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();
const router = new Router();

// API routes
router.get('/api/users', (ctx) => {
  ctx.body = { users: ['Alice', 'Bob'] };
});

router.post('/api/login', (ctx) => {
  ctx.body = { token: 'xyz123' };
});

// Monta il router
app.use(router.routes());
app.use(router.allowedMethods());

// File statici (dopo le route API)
app.use(koaClassicServer(__dirname + '/public', {
  dirListing: { enabled: true }
}));

app.listen(3000);
```

**Ordine importante:**
1. Router con API dinamiche
2. File server statico
3. Questo permette alle API di avere precedenza sui file

---

## API Reference

### koaClassicServer(rootDir, options)

Crea e restituisce un middleware Koa per servire file statici.

**Parametri:**

- `rootDir` (String, required): Path assoluto directory root
- `options` (Object, optional): Oggetto configurazione

**Restituisce:**

- Function: Middleware Koa `async (ctx, next) => {...}`

**Esempio:**

```javascript
const middleware = koaClassicServer('/path/to/files', {
  dirListing: { enabled: true }
});

app.use(middleware);
```

### Oggetto Options

Vedi sezione [Configurazione](#configurazione) per dettagli completi.

### Context (ctx) nel Template Render

Quando usi `template.render`, hai accesso completo al contesto Koa:

```javascript
template: {
  render: async (ctx, next, filePath) => {
    // ctx.request - Oggetto richiesta
    console.log(ctx.request.method);  // 'GET', 'POST', etc.
    console.log(ctx.request.url);     // '/path/to/file'
    console.log(ctx.request.header);  // Headers HTTP

    // ctx.response - Oggetto risposta
    ctx.response.type = 'text/html';
    ctx.response.body = '<html>...</html>';

    // Shortcuts
    console.log(ctx.method);   // 'GET'
    console.log(ctx.url);      // '/path/to/file'
    console.log(ctx.href);     // 'http://localhost:3000/path/to/file'
    console.log(ctx.query);    // { key: 'value' }
    console.log(ctx.path);     // '/path/to/file'

    // State (dati condivisi tra middleware)
    console.log(ctx.state.user);

    // Cookies
    console.log(ctx.cookies.get('session'));

    // filePath - Path completo del file
    console.log(filePath);  // '/var/www/public/page.ejs'
  }
}
```

---

## Comportamento del Middleware

### Gestione delle Directory

#### Caso 1: dirListing.enabled = true, index presente

```
Richiesta: GET /cartella/
Filesystem:
  /cartella/index.html ✓ (esiste)
  /cartella/file1.txt

Risultato: Serve /cartella/index.html
```

#### Caso 2: dirListing.enabled = true, index assente

```
Richiesta: GET /cartella/
Filesystem:
  /cartella/file1.txt
  /cartella/file2.jpg

Risultato: Mostra directory listing HTML
```

#### Caso 3: dirListing.enabled = false

```
Richiesta: GET /cartella/

Risultato: "Not Found" (indipendentemente da index)
```

### Gestione dei File

#### File Normale

```
Richiesta: GET /document.pdf
Filesystem: /document.pdf (esiste)

Risultato:
  Status: 200
  Content-Type: application/pdf
  Content-Disposition: inline; filename=document.pdf
  Body: [file stream]
```

#### File Template

```
Richiesta: GET /page.ejs
Filesystem: /page.ejs (esiste)
Config: template.ext = ['ejs'], template.render definito

Risultato:
  Status: 200
  Content-Type: [settato da template.render]
  Body: [output renderizzato]
```

### URL Riservati

```
Config: urlsReserved = ['/admin', '/private']

Richiesta: GET /admin/config.json
Risultato: Passa a middleware successivo (salta koa-classic-server)

Richiesta: GET /admin/
Risultato: Directory listing mostra "DIR BUT RESERVED"

Richiesta: GET /public/file.txt
Risultato: File servito normalmente
```

### Parent Directory Navigation

Nel directory listing, viene sempre mostrato link alla parent directory, tranne nella root:

```html
<!-- Root: http://localhost:3000/ -->
<!-- Nessun parent directory link -->

<!-- Sub-directory: http://localhost:3000/folder/ -->
<table>
  <tr><td><a href="http://localhost:3000"><b>.. Parent Directory</b></a></td><td>DIR</td></tr>
  <!-- altri file... -->
</table>
```

### Normalizzazione URL

Il middleware normalizza automaticamente gli URL:

```
http://localhost:3000/folder/  → http://localhost:3000/folder
http://localhost:3000/file.txt/ → http://localhost:3000/file.txt
```

Questo assicura comportamento coerente indipendentemente dal trailing slash.

### Gestione dei Link Simbolici (Symlink)

Il middleware supporta completamente i link simbolici (symlink). Questo è fondamentale in ambienti dove i file serviti sono symlink anziché file regolari, come ad esempio:

- **NixOS con buildFHSEnv** (chroot-like): i file nella directory www/ appaiono come symlink al Nix store
- **Docker bind mounts**: i file montati possono risultare come symlink
- **npm link**: i pacchetti linkati sono symlink
- **Deploy Capistrano-style**: la directory `current` è un symlink alla release attiva

#### Comportamento

Il middleware segue i symlink in modo trasparente tramite `fs.promises.stat()` (che risolve il symlink al target reale), ma solo quando `dirent.isSymbolicLink()` è `true`. Per i file regolari non viene effettuata alcuna chiamata aggiuntiva (zero overhead).

#### Risoluzione Index File

Quando il middleware cerca un file index in una directory (opzione `index`), i symlink che puntano a file regolari vengono inclusi nella ricerca, sia con pattern stringa che RegExp:

```
Directory:
  index.ejs → /nix/store/.../index.ejs  (symlink a file)
  style.css                              (file regolare)

Config: index: ['index.ejs']
Risultato: Serve index.ejs attraverso il symlink ✓
```

#### Directory Listing

Nel directory listing, i symlink sono identificati visivamente:

| Caso | Indicatore | Cliccabile | Tipo mostrato |
|------|-----------|------------|---------------|
| Symlink a file | `( Symlink )` | Sì | MIME type del target |
| Symlink a directory | `( Symlink )` | Sì | `DIR` |
| Symlink rotto/circolare | `( Broken Symlink )` | No | `unknown` |
| Symlink bloccato dalla policy | `( Blocked Symlink )` | No | MIME guess, size nascosta |
| File/directory regolare | nessuno | Sì | tipo reale |

#### Casi Limite

- **Broken symlink** (target inesistente): il GET diretto restituisce 404; nel listing il nome appare senza link
- **Symlink circolare** (A → B → A): trattato come broken symlink, nessun loop infinito
- **Symlink a directory**: navigabile come una directory regolare, i file al suo interno sono accessibili

#### Opzione `symlinks` — protezione contro il symlink escape (V3.1+)

Di default (`symlinks: 'follow'`) un symlink dentro `rootDir` viene seguito **anche se il target è fuori da `rootDir`** — coerente con la filosofia *"file server first"*. Se `rootDir` contiene directory scrivibili da terzi non fidati (upload, spool, hosting multi-tenant), un symlink piazzato ad arte può leggere qualsiasi file accessibile al processo. Per contenere questo rischio:

| Valore | Comportamento | Overhead |
|--------|---------------|----------|
| `'follow'` *(default)* | Segue i symlink ovunque, anche fuori da `rootDir`. Comportamento storico. | nessuno |
| `'follow-within-root'` | Segue solo finché il `realpath` risolto resta dentro `rootDir`; link che escono → **404**. | un `realpath()` per path servito |
| `'deny'` | Non segue mai un symlink risolto **sotto** `rootDir`. | un `realpath()` per path servito |

```javascript
app.use(koaClassicServer(rootDir, { symlinks: 'follow-within-root' }));
```

- **`rootDir` può essere esso stesso un symlink** (deploy atomico / Capistrano / Nix) in ogni modalità: il confine è ancorato a `realpath(rootDir)` risolto una sola volta all'init.
- Le modalità protette richiedono che `rootDir` **esista al momento dell'istanziazione** (risolvono subito il realpath) e lanciano un errore altrimenti.
- Nel listing i symlink bloccati appaiono come `( Blocked Symlink )`, non cliccabili, senza esporre la size del target.
- **Rischio residuo**: il controllo è basato su `realpath`, quindi non previene del tutto un TOCTOU (symlink scambiato tra il controllo e l'apertura del file). Per scenari multi-tenant ostili combinare con isolamento a livello OS (chroot, mount per-tenant, `nosymfollow`).

### MIME Types

MIME types riconosciuti automaticamente tramite estensione file:

```javascript
.html → text/html
.css  → text/css
.js   → application/javascript
.json → application/json
.png  → image/png
.jpg  → image/jpeg
.pdf  → application/pdf
.txt  → text/plain
// ... e molti altri
```

Se MIME type non riconosciuto:
```
Estensione sconosciuta → 'unknow' (nel directory listing)
```

---

## Testing

### Test Automatici (Jest)

Il progetto include una suite completa di test.

```bash
# Esegui tutti i test
npm test

# Test con coverage
npm test -- --coverage

# Test in watch mode
npm test -- --watch
```

### Test Coverage

I test coprono:

- ✅ Servizio file statici
- ✅ Directory listing
- ✅ URL prefix
- ✅ URL riservati
- ✅ File index
- ✅ Percorsi non esistenti
- ✅ Metodi HTTP
- ✅ Caratteri speciali nei nomi file
- ⚠️ Template rendering (parziale)
- ⚠️ Directory listing completo (parziale)

### Test Manuali Interattivi

Per testare manualmente diverse configurazioni:

```bash
npm run loadConfig
```

Questo comando:
1. Mostra menu interattivo con configurazioni predefinite
2. Avvia server con configurazione scelta
3. Permette test manuale via browser

**Configurazioni disponibili:**
- Test generico base
- Test con URL prefix `/public`
- Test con file index
- Test con percorsi riservati

### Struttura Test

```
__tests__/
├── index.test.js       # Suite principale
└── publicWwwTest/      # Cartella test con file/directory campione
    ├── file.txt
    ├── image.png
    ├── subfolder/
    └── ...
```

### Scrivere Nuovi Test

Esempio test personalizzato:

```javascript
const supertest = require('supertest');
const koaClassicServer = require('../index.cjs');
const Koa = require('koa');

describe('My custom test', () => {
  let app, server;

  beforeAll(() => {
    app = new Koa();
    app.use(koaClassicServer(__dirname + '/test-files', {
      dirListing: { enabled: true }
    }));
    server = app.listen();
  });

  test('should serve HTML file', async () => {
    const res = await supertest(server).get('/index.html');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/text\/html/);
  });

  afterAll(() => {
    server.close();
  });
});
```

---

## Troubleshooting

### File non viene servito

**Problema:** Richiesta a file esistente restituisce 404

**Soluzioni:**

1. Verifica path assoluto:
```javascript
// ❌ Path relativo
koaClassicServer('./public')

// ✅ Path assoluto
koaClassicServer(__dirname + '/public')
koaClassicServer(path.join(__dirname, 'public'))
```

2. Controlla URL prefix:
```javascript
// Config
urlPrefix: '/static'

// ❌ URL sbagliato
http://localhost:3000/file.txt

// ✅ URL corretto
http://localhost:3000/static/file.txt
```

3. Verifica URL riservati:
```javascript
// Config
urlsReserved: ['/protected']

// ❌ File in cartella protetta
GET /protected/file.txt → 404

// ✅ File fuori da cartella protetta
GET /public/file.txt → 200
```

---

### Template non viene renderizzato

**Problema:** File template viene servito come testo invece di essere renderizzato

**Soluzioni:**

1. Verifica estensione in `template.ext`:
```javascript
// File: page.ejs

// ❌ Estensione mancante
template: {
  render: renderFunction,
  ext: ['html']  // manca 'ejs'
}

// ✅ Estensione presente
template: {
  render: renderFunction,
  ext: ['ejs', 'EJS']
}
```

2. Verifica `template.render` sia funzione:
```javascript
// ❌ render non definito
template: {
  ext: ['ejs']
  // render mancante!
}

// ✅ render definito
template: {
  render: async (ctx, next, filePath) => {
    ctx.body = await ejs.renderFile(filePath, {});
  },
  ext: ['ejs']
}
```

3. Installa template engine:
```bash
npm install ejs
```

---

### Directory listing non funziona

**Problema:** Accesso a directory restituisce "Not Found"

**Soluzione:**

```javascript
// ❌ dirListing.enabled disabilitato
dirListing: { enabled: false }

// ✅ dirListing.enabled abilitato
dirListing: { enabled: true }
```

---

### URL riservati non proteggono

**Problema:** File in cartelle riservate sono accessibili

**Cause comuni:**

1. **Percorsi annidati non supportati:**
```javascript
// ❌ Non funziona
urlsReserved: ['/path/to/protected']

// ✅ Solo primo livello
urlsReserved: ['/protected']
```

2. **Spazi nei nomi (bug noto):**
```javascript
// ⚠️ Problematico
urlsReserved: ['/percorso riservato']

// ✅ Usa underscore o trattini
urlsReserved: ['/percorso_riservato', '/percorso-riservato']
```

---

### Metodo HTTP non accettato

**Problema:** Richieste POST/PUT/DELETE non funzionano

**Soluzione:**

```javascript
// ❌ Solo GET (default)
method: ['GET']

// ✅ Aggiungi metodi necessari
method: ['GET', 'POST', 'PUT', 'DELETE']
```

**Nota:** Di solito file server necessita solo GET e HEAD

---

### Caratteri speciali in nomi file

**Problema:** File con spazi o caratteri speciali non accessibili

**Soluzione:**

Il middleware gestisce automaticamente URI encoding. Assicurati che il client codifichi correttamente:

```javascript
// ❌ Non encodato
GET /my file.txt

// ✅ Encodato (automatico nei browser)
GET /my%20file.txt
```

In JavaScript:
```javascript
const filename = 'my file.txt';
const url = '/' + encodeURIComponent(filename);
// url = '/my%20file.txt'
```

---

### Performance con molti file

**Problema:** Directory listing lento con migliaia di file

**Soluzioni:**

1. Disabilita directory listing:
```javascript
dirListing: { enabled: false }
```

2. Usa file index:
```javascript
dirListing: { enabled: true },
index: 'index.html'  // Carica index invece di listing
```

3. Considera soluzioni alternative per grandi quantità di file (es. nginx, CDN)

---

## Problemi Noti

### 1. Status Code 404 Mancante

**Problema:** Quando una risorsa non viene trovata, lo status code è 200 invece di 404

**File:** `index.cjs:110`

```javascript
if (!fs.existsSync(toOpen)) {
  ctx.body = requestedUrlNotFound();
  // Manca: ctx.status = 404;
  return;
}
```

**Workaround:**
```javascript
// Middleware successivo per gestire 404
app.use(async (ctx) => {
  if (!ctx.body) {
    ctx.status = 404;
    ctx.body = 'Not Found';
  }
});
```

---

### 2. URL Riservati con Spazi

**Problema:** Il controllo URL riservati non funziona con percorsi contenenti spazi

**File:** `index.cjs:87-96`

**Limitazione:** Problemi con URI encoding negli URL riservati

**Workaround:** Evita spazi nei nomi delle cartelle riservate:
```javascript
// ❌ Non funziona
urlsReserved: ['/percorso riservato']

// ✅ Funziona
urlsReserved: ['/percorso_riservato', '/percorso-riservato']
```

---

### 3. URL Riservati Solo Primo Livello

**Problema:** URL riservati funzionano solo per directory di primo livello, non per percorsi annidati

**File:** `index.cjs:87-96`

**Limitazione:** Design della funzionalità

```javascript
// ❌ Non supportato
urlsReserved: ['/path/to/protected']

// ✅ Supportato
urlsReserved: ['/protected']
// Blocca: /protected, /protected/file.txt, /protected/sub/file.txt
```

---

### 4. Test Coverage Incompleto

**Problema:** Test non coprono completamente:
- Contenuto HTML del directory listing
- Tutti i casi di template rendering

**File:** `__tests__/index.test.js:1-11`

**Impatto:** Possibili bug non rilevati in queste aree

---

### 5. Single Index File

**Problema:** Supporto per un solo nome file index, non array di fallback

**Limitazione:** Design attuale

```javascript
// ❌ Non supportato
index: ['index.html', 'index.htm', 'default.html']

// ✅ Supportato
index: 'index.html'
```

**Workaround:** Standardizza su un solo nome file index

---

## Best Practices

### 1. Sicurezza

#### Usa Path Assoluti
```javascript
// ✅ Corretto
const path = require('path');
app.use(koaClassicServer(path.join(__dirname, 'public')));

// ❌ Evita path relativi
app.use(koaClassicServer('./public'));
```

#### Proteggi Directory Sensibili
```javascript
app.use(koaClassicServer(__dirname + '/www', {
  urlsReserved: [
    '/config',
    '/.env',
    '/.git',
    '/node_modules',
    '/private',
    '/admin'
  ]
}));
```

#### Limita Metodi HTTP
```javascript
// Solo lettura
method: ['GET', 'HEAD']

// Evita metodi di scrittura per file server
// method: ['POST', 'PUT', 'DELETE']  ❌
```

#### Disabilita Directory Listing in Produzione
```javascript
app.use(koaClassicServer(rootDir, {
  dirListing: { enabled: process.env.NODE_ENV !== 'production' },
  index: 'index.html'
}));
```

#### DNS Rebinding — valida l'header `Host` a monte

`koa-classic-server` **non valida l'header `Host`** delle richieste in entrata. Questo è intenzionale: la validazione del Virtual Host appartiene allo strato di rete (reverse proxy o middleware Koa applicativo), non a un file server.

In assenza di tale validazione, un host LAN/loopback (es. `127.0.0.1`, `192.168.x.x`) è vulnerabile a **DNS rebinding**: un attaccante remoto può far risolvere il proprio dominio all'IP della vittima ed eseguire richieste cross-origin verso il server locale come se provenissero da un'origine legittima del browser.

**Quando è un problema concreto**
- Server raggiunto da `localhost` / IP privati senza reverse proxy davanti.
- Browser dell'utente che visita pagine non fidate mentre il server è attivo.

**Quando NON è un problema**
- Deploy dietro reverse proxy (nginx, Caddy, Apache, Traefik) configurato con allowlist di `server_name` / hostname.
- Server raggiungibile solo da IP pubblico dietro CDN/WAF.
- Binding esplicito a interfaccia non instradabile (`app.listen(port, '127.0.0.1')`) e nessun browser locale espone l'utente a pagine ostili.

**Mitigazione 1 — reverse proxy (raccomandato in produzione)**

Esempio nginx:
```nginx
server {
    listen 80;
    server_name app.example.com;      # ← allowlist
    location / { proxy_pass http://127.0.0.1:3000; }
}
# Tutte le richieste con Host diverso da app.example.com vengono rifiutate qui.
```

**Mitigazione 2 — middleware Koa applicativo (utile in dev/LAN)**

Antepone una guardia su `ctx.host` PRIMA di `koa-classic-server`:

```javascript
const ALLOWED_HOSTS = new Set([
  'app.example.com',
  'localhost:3000',
  '127.0.0.1:3000',
]);

app.use(async (ctx, next) => {
  // ctx.host include la porta (es. "localhost:3000")
  if (!ALLOWED_HOSTS.has(ctx.host)) {
    ctx.status = 421; // Misdirected Request
    ctx.body = 'Host not allowed';
    return;
  }
  await next();
});

app.use(koaClassicServer(rootDir));
```

> ⚠️ Se il proxy a monte termina TLS e inoltra all'app, configura `app.proxy = true` e usa `ctx.hostname` con `X-Forwarded-Host` solo se il proxy è fidato.

#### Limiti dei Security Headers sui file statici

`koa-classic-server` imposta automaticamente i seguenti header SOLO sulle **risposte generate** dal middleware (directory listing HTML, pagine di errore 400/403/404/405/500):

| Header | Valore |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; ...` (hash-based per il listing, fully restrictive per gli errori) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |

**Cosa NON riceve questi header**

I **file statici** serviti dal disco (HTML, JS, CSS, immagini, font, video, qualsiasi altra estensione) sono restituiti **senza** alcun header di sicurezza aggiunto. Questo è **by-design**:

- Le policy di sicurezza appropriate sono diverse caso per caso (CSP per app SPA, sandbox per documenti, COEP/COOP per pagine con SharedArrayBuffer, ecc.).
- Imporre una CSP rigida di default romperebbe la maggior parte dei siti reali (script inline, CDN, Google Fonts, ecc.).
- L'utente possiede la propria policy e deve dichiararla esplicitamente.

> ⚠️ Non assumere che il middleware "metta in sicurezza" i tuoi file: gli header sopra elencati vengono inviati **solo** quando la risposta è generata dal middleware stesso.

**Come aggiungere security headers ai file statici**

Inserisci un middleware Koa **prima** di `koa-classic-server`. Il middleware si applica a ogni risposta uscente, statica o generata che sia, e i `ctx.set()` rimangono attivi anche dopo che il file server scrive il body:

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// 1) Header globali su TUTTE le risposte (statiche + generate).
app.use(async (ctx, next) => {
  // Header sempre validi per un file server pubblico:
  ctx.set('X-Content-Type-Options', 'nosniff');
  ctx.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  ctx.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');

  // CSP per file HTML serviti dall'utente (mantieni il file server per gli altri MIME).
  // Esempio strict-by-default per un sito statico moderno:
  if (ctx.path.endsWith('.html') || ctx.path === '/' || ctx.path.endsWith('/')) {
    ctx.set('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
      "script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    );
  }

  await next();
});

// 2) Quindi il file server.
app.use(koaClassicServer(__dirname + '/public'));

app.listen(3000);
```

**Note operative**

- Il middleware sopra **non sovrascrive** gli header che `koa-classic-server` imposta sulle proprie pagine (listing/errori): Koa preserva il primo `set()`, ma se vuoi essere esplicito puoi applicare le tue policy solo a `ctx.status < 400` e a `Content-Type` HTML.
- Una CSP rigida con `default-src 'self'` rompe pagine che usano script inline o CDN: parti **report-only** (`Content-Security-Policy-Report-Only`) per rilevare le violazioni prima di enforce-arla.
- Per progetti SPA/PWA che richiedono `SharedArrayBuffer`, considera anche `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: require-corp`.

#### Security Checklist & Suggested Configuration

`koa-classic-server` parte dal principio **"file server first"** (vedi [`CLAUDE.md`](../CLAUDE.md)): i default servono i file senza restrizioni di policy nascoste. L'operatore irrobustisce il deploy tramite **configurazione esplicita**.

##### Checklist per categoria

**Static site / public asset serving**

| ✓ | Cosa | Snippet |
|---|---|---|
| ☐ | Nascondi dot-files con potenziali segreti | `hidden: { dotFiles: { default: 'hidden', whitelist: ['.well-known'] } }` |
| ☐ | Blocca dot-directories tipo `.git` | `hidden: { dotDirs: { default: 'hidden', whitelist: ['.well-known'] } }` |
| ☐ | Disabilita listing in produzione | `dirListing: { enabled: false }` + `index` |
| ☐ | Abilita HTTP caching | `browserCacheEnabled: true, browserCacheMaxAge: 86400` |
| ☐ | Restringi i metodi | `method: ['GET', 'HEAD']` |
| ☐ | Riserva path applicativi | `urlsReserved: ['/api', '/admin']` |
| ☐ | Aggiungi security headers upstream sui file utente | middleware Koa upstream (vedi *Limiti dei Security Headers* sopra) |

**User uploads / multi-tenant / directory scrivibili da terzi**

| ✓ | Cosa | Snippet |
|---|---|---|
| ☐ | Cap entries più stretto contro dir gonfiate | `dirListing: { maxEntries: 1000 }` |
| ☐ | Hide dot-files a ogni profondità | `hidden: { dotFiles: { default: 'hidden' }, dotDirs: { default: 'hidden' } }` |
| ☐ | Blocklist path-aware per pattern noti | `hidden: { alwaysHide: ['*.key', '*.pem', /\.secret$/, 'config/secrets/**'] }` |
| ☐ | Monitora la crescita dir esternamente (cron + alert) | — |

> **Caveat v3.0:** `dirListing.maxEntries` bounda rendering/CPU ma NON la lettura iniziale `readdir()`. Per workload adversarial (utenti non fidati che possono creare milioni di file) la protezione RAM completa arriverà con il `readMode: 'bounded'` di v3.1 (vedi `[F-1]` in `docs/security_improvement_for_V3.md`).

**Production hygiene (qualsiasi deploy)**

| ✓ | Cosa | Snippet |
|---|---|---|
| ☐ | Allowlist Host upstream | nginx `server_name` o middleware Koa allowlist su `ctx.host` |
| ☐ | Disabilita template engine se non SSR | ometti `template` |
| ☐ | Tune `template.renderTimeout` | abbassa da 30 s per SLA stretti |
| ☐ | Logger strutturato (Pino/Winston) | `logger: pino()` |
| ☐ | Pin patch version + `npm audit` in CI | `package.json` + workflow CI |

##### Suggested production security configuration

Una sola configurazione di partenza che copre l'80% dei deploy. Tweak per workload specifici.

```javascript
const Koa  = require('koa');
const pino = require('pino')({ level: 'info' });
const path = require('path');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// 1) Host allowlist — mitiga DNS rebinding su esposizione LAN/loopback.
const ALLOWED_HOSTS = new Set([
  'app.example.com',
  'localhost:3000',
]);
app.use(async (ctx, next) => {
  if (!ALLOWED_HOSTS.has(ctx.host)) {
    ctx.status = 421;
    ctx.body = 'Misdirected Request';
    return;
  }
  await next();
});

// 2) Security headers sui file utente (il middleware li imposta solo su
//    listing/errori, NON sui file statici — by design).
app.use(async (ctx, next) => {
  ctx.set('X-Content-Type-Options',    'nosniff');
  ctx.set('Referrer-Policy',           'strict-origin-when-cross-origin');
  ctx.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  await next();
});

// 3) Il file server con default irrobustiti per produzione.
app.use(koaClassicServer(path.join(__dirname, 'public'), {
  method: ['GET', 'HEAD'],

  index: ['index.html'],

  dirListing: {
    enabled:        process.env.NODE_ENV !== 'production',
    maxEntries:     10000,                // più stretto del default 100000 anti-OOM
    entriesPerPage: 100,
  },

  hidden: {
    dotFiles: {
      default:   'hidden',                // hardening esplicito vs default 'visible' filosofico
      whitelist: ['.well-known'],         // ACME / Let's Encrypt
    },
    dotDirs: {
      default:   'hidden',
      whitelist: ['.well-known'],
    },
    alwaysHide: ['*.key', '*.pem', /^backup-/, /\.secret$/],
  },

  browserCacheEnabled: true,
  browserCacheMaxAge:  86400,             // 24 h cache

  logger: pino,                           // structured logging

  urlsReserved: ['/api', '/admin'],       // route applicative gestite altrove
}));

app.listen(3000);
```

Per **user-uploads / multi-tenant**: oltre al blocco sopra, riduci `dirListing.maxEntries` a `1000` e monitora la dimensione della directory dall'esterno fino a quando v3.1 non aggiunge il `readMode: 'bounded'`.

---

### 2. Performance

#### Usa Variabili d'Ambiente
```javascript
const isProduction = process.env.NODE_ENV === 'production';

app.use(koaClassicServer(rootDir, {
  dirListing: { enabled: !isProduction },
  method: ['GET', 'HEAD']
}));
```

#### Middleware Logging Efficiente
```javascript
// Solo in development
if (process.env.NODE_ENV !== 'production') {
  app.use(async (ctx, next) => {
    console.log(`${ctx.method} ${ctx.url}`);
    await next();
  });
}
```

#### Cache Headers (middleware aggiuntivo)
```javascript
// Aggiungi cache headers per file statici
app.use(async (ctx, next) => {
  await next();
  if (ctx.method === 'GET' && ctx.status === 200) {
    ctx.set('Cache-Control', 'public, max-age=86400'); // 24h
  }
});

app.use(koaClassicServer(rootDir));
```

---

### 3. Organizzazione Codice

#### Separa Configurazione
```javascript
// config/fileServer.js
const path = require('path');

module.exports = {
  rootDir: path.join(__dirname, '../public'),
  options: {
    method: ['GET', 'HEAD'],
    dirListing: { enabled: true },
    index: 'index.html',
    urlPrefix: '/static',
    urlsReserved: ['/admin', '/config']
  }
};

// app.js
const fileServerConfig = require('./config/fileServer');
app.use(koaClassicServer(
  fileServerConfig.rootDir,
  fileServerConfig.options
));
```

#### Template Rendering Modulare
```javascript
// lib/templateRenderer.js
const ejs = require('ejs');

module.exports = async function renderTemplate(ctx, next, filePath) {
  try {
    ctx.body = await ejs.renderFile(filePath, {
      title: getPageTitle(filePath),
      user: ctx.state.user,
      ...ctx.state.templateData
    });
  } catch (error) {
    console.error('Template error:', error);
    ctx.status = 500;
    ctx.body = 'Rendering Error';
  }
};

function getPageTitle(filePath) {
  // Logica per estrarre titolo
  return 'My Page';
}

// app.js
const templateRenderer = require('./lib/templateRenderer');

app.use(koaClassicServer(rootDir, {
  template: {
    render: templateRenderer,
    ext: ['ejs', 'html']
  }
}));
```

---

### 4. Error Handling

#### Global Error Handler
```javascript
app.on('error', (err, ctx) => {
  console.error('Server error:', {
    error: err.message,
    stack: err.stack,
    url: ctx.url,
    method: ctx.method,
    ip: ctx.ip
  });
});
```

#### Try-Catch in Template Render
```javascript
template: {
  render: async (ctx, next, filePath) => {
    try {
      ctx.body = await ejs.renderFile(filePath, data);
    } catch (error) {
      console.error('Render error:', error);
      ctx.status = 500;
      ctx.body = 'Template Error';
    }
  },
  ext: ['ejs']
}
```

#### 404 Fallback
```javascript
// Ultimo middleware
app.use(async (ctx) => {
  ctx.status = 404;
  ctx.type = 'html';
  ctx.body = `
    <!DOCTYPE html>
    <html>
      <head><title>404</title></head>
      <body>
        <h1>Pagina Non Trovata</h1>
        <p>La risorsa richiesta non esiste.</p>
      </body>
    </html>
  `;
});
```

---

### 5. Development vs Production

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const path = require('path');

const app = new Koa();
const isDev = process.env.NODE_ENV !== 'production';

// Logging solo in development
if (isDev) {
  app.use(async (ctx, next) => {
    const start = Date.now();
    await next();
    console.log(`${ctx.method} ${ctx.url} - ${Date.now() - start}ms`);
  });
}

// File server con configurazione ambiente-specifica
app.use(koaClassicServer(path.join(__dirname, 'public'), {
  dirListing: { enabled: isDev },  // Solo in dev
  index: 'index.html',
  urlPrefix: isDev ? '' : '/static',  // Prefix solo in prod
  urlsReserved: ['/admin', '/config', '/.env'],
  template: {
    render: isDev ? devTemplateRender : prodTemplateRender,
    ext: ['ejs']
  }
}));

// Error details solo in development
app.on('error', (err, ctx) => {
  if (isDev) {
    console.error('Error details:', err);
  } else {
    console.error('Error:', err.message);
  }
});

app.listen(process.env.PORT || 3000);
```

---

### 6. Testing

#### Testa Configurazioni Diverse
```javascript
// __tests__/server.test.js
const configs = [
  { name: 'base', options: {} },
  { name: 'with-prefix', options: { urlPrefix: '/public' } },
  { name: 'no-listing', options: { dirListing: { enabled: false } } }
];

configs.forEach(({ name, options }) => {
  describe(`Config: ${name}`, () => {
    let server;

    beforeAll(() => {
      const app = new Koa();
      app.use(koaClassicServer(testDir, options));
      server = app.listen();
    });

    test('serves files', async () => {
      // test...
    });

    afterAll(() => server.close());
  });
});
```

---

### 7. Documentazione

#### Commenta Configurazioni Complesse
```javascript
app.use(koaClassicServer(__dirname + '/public', {
  // Mostra directory solo in development per sicurezza
  dirListing: { enabled: process.env.NODE_ENV !== 'production' },

  // Protegge configurazioni sensibili
  // Nota: funziona solo per directory di primo livello
  urlsReserved: ['/config', '/private'],

  // Template EJS per pagine dinamiche
  // Rendering con dati utente e query params
  template: {
    render: ejsRenderer,
    ext: ['ejs']
  }
}));
```

---

## Informazioni Aggiuntive

### Versione
**2.4.0**

### Autore
**Italo Paesano**

### Licenza
**MIT**

### Keywords
- file
- server
- koa
- middleware
- static
- apache

### Compatibilità

#### Node.js
- **Minimo:** 12.20+
- **Raccomandato:** 14+
- **Testato:** 14, 16, 18, 20

#### Koa
- **Versione:** 2.x

### Conditional Exports

Il modulo usa conditional exports per supportare sia CommonJS che ES Modules:

```json
{
  "main": "index.cjs",
  "exports": {
    "import": "./index.mjs",
    "require": "./index.cjs"
  }
}
```

Questo permette:
```javascript
// CommonJS
const koaClassicServer = require('koa-classic-server');

// ES Modules
import koaClassicServer from 'koa-classic-server';
```

### Repository

Segnala bug o richiedi funzionalità tramite GitHub Issues.

### Contributing

Contributi benvenuti! Per favore:
1. Fork del repository
2. Crea branch per feature (`git checkout -b feature/AmazingFeature`)
3. Commit modifiche (`git commit -m 'Add AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Apri Pull Request

### Changelog

#### v1.2.0
- Fix: supporto completo link simbolici in `findIndexFile()` e directory listing
- Nuovi helper `isFileOrSymlinkToFile()` / `isDirOrSymlinkToDir()` (zero overhead per file regolari)
- Directory listing: indicatori `( Symlink )` e `( Broken Symlink )`, tipo effettivo (MIME/DIR) per symlink
- 17 nuovi test per tutti gli scenari symlink (NixOS, Docker, npm link, broken, circular)

#### v1.1.0
- Supporto conditional exports
- Test suite completa

---

## Risorse Aggiuntive

### Link Utili

- [Documentazione Koa](https://koajs.com/)
- [MIME Types](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types)
- [Node.js Path Module](https://nodejs.org/api/path.html)
- [EJS Documentation](https://ejs.co/)

### Esempi Completi

Repository con esempi completi disponibile nella cartella `customTest/` del progetto.

---

**Documentazione generata per koa-classic-server v2.4.0**

*Ultimo aggiornamento: 2026-02-28*
