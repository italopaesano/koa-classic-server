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
- Supporto link simbolici

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
- **koa** (^2.13.4): Framework web minimale per Node.js
- **mime-types**: Riconoscimento automatico MIME types (dependency implicita)

#### Development
- **jest** (^29.7.0): Framework di testing
- **supertest** (^7.0.0): Testing richieste HTTP
- **inquirer** (^12.4.1): CLI interattiva per testing manuale

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
  showDirContents: true,
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
  showDirContents: true,

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

#### `showDirContents` (Boolean)

Controlla se mostrare il contenuto delle directory.

```javascript
// Mostra directory listing
showDirContents: true

// Non mostra directory (restituisce "Not Found")
showDirContents: false
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
3. Altrimenti → mostra directory listing (se `showDirContents: true`)

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
  showDirContents: true,
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
  showDirContents: true
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
  showDirContents: true,
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
  showDirContents: false,
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
  showDirContents: true
}));

// Asset (CSS, JS, images)
app.use(koaClassicServer(__dirname + '/assets', {
  urlPrefix: '/assets',
  showDirContents: false
}));

// Download area
app.use(koaClassicServer(__dirname + '/downloads', {
  urlPrefix: '/downloads',
  showDirContents: true,
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
  showDirContents: process.env.NODE_ENV !== 'production',
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
  showDirContents: true
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
  showDirContents: true
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

#### Caso 1: showDirContents = true, index presente

```
Richiesta: GET /cartella/
Filesystem:
  /cartella/index.html ✓ (esiste)
  /cartella/file1.txt

Risultato: Serve /cartella/index.html
```

#### Caso 2: showDirContents = true, index assente

```
Richiesta: GET /cartella/
Filesystem:
  /cartella/file1.txt
  /cartella/file2.jpg

Risultato: Mostra directory listing HTML
```

#### Caso 3: showDirContents = false

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
      showDirContents: true
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
// ❌ showDirContents disabilitato
showDirContents: false

// ✅ showDirContents abilitato
showDirContents: true
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
showDirContents: false
```

2. Usa file index:
```javascript
showDirContents: true,
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
  showDirContents: process.env.NODE_ENV !== 'production',
  index: 'index.html'
}));
```

---

### 2. Performance

#### Usa Variabili d'Ambiente
```javascript
const isProduction = process.env.NODE_ENV === 'production';

app.use(koaClassicServer(rootDir, {
  showDirContents: !isProduction,
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
    showDirContents: true,
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
  showDirContents: isDev,  // Solo in dev
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
  { name: 'no-listing', options: { showDirContents: false } }
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
  showDirContents: process.env.NODE_ENV !== 'production',

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
**1.1.0**

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

#### v1.1.0
- Versione attuale
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

**Documentazione generata per koa-classic-server v1.1.0**

*Ultimo aggiornamento: 2025-11-17*
