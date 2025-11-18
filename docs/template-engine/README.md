# 📚 Template Engine - Guida Completa

Guida completa all'integrazione di template engine con koa-classic-server, con esempi progressivi da zero a configurazioni enterprise.

---

## 📑 Indice

- [Introduzione](#introduzione)
- [Quick Start](#quick-start)
- [Esempi Incrementali](#esempi-incrementali) - Da zero a loop
- [Guida Progressiva](#guida-progressiva) - Da semplice a enterprise
- [Integrazione Template Engine](#integrazione-template-engine)
  - [EJS](#ejs)
  - [Pug](#pug)
  - [Handlebars](#handlebars)
  - [Nunjucks](#nunjucks)
- [Esempi Avanzati](#esempi-avanzati)
- [Best Practices](#best-practices)
- [Troubleshooting](#troubleshooting)
- [Performance Tips](#performance-tips)

---

## Introduzione

koa-classic-server supporta l'integrazione con qualsiasi template engine JavaScript (EJS, Pug, Handlebars, Nunjucks, etc.) tramite una configurazione flessibile.

### Come Funziona

Quando una richiesta arriva per un file con estensione specificata in `template.ext`, il middleware:

1. Verifica che l'estensione del file sia nell'array `template.ext`
2. Chiama la funzione `template.render` con il path del file
3. La funzione render processa il template e imposta `ctx.body`
4. Il middleware serve la risposta

### Configurazione Base

La configurazione minima richiede due elementi: l'array `ext` con le estensioni da processare e la funzione `render`.

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

app.use(koaClassicServer(__dirname + '/public', {
  template: {
    // Array di estensioni da processare
    ext: ['ejs', 'EJS'],

    // Funzione di rendering (configurazione minima)
    render: async (ctx, next, filePath) => {
      try {
        // Nessun dato passato - il template deve essere statico
        ctx.body = await ejs.renderFile(filePath, {});
        ctx.type = 'text/html';
      } catch (error) {
        console.error('Template error:', error);
        ctx.status = 500;
        ctx.body = 'Template Error';
      }
    }
  }
}));

app.listen(3000);
```

**Note:**
- Questa configurazione base passa un oggetto vuoto `{}` al template
- Funziona solo con template che non usano variabili
- Per passare dati al template, vedi le sezioni successive: [Quick Start](#quick-start) e [Esempi Incrementali](#esempi-incrementali)

### Parametri

#### `template.ext` (Array)

Array di estensioni file che devono essere processate dal template engine.

**Note importanti:**
- **Case-sensitive**: `'ejs'` e `'EJS'` sono diversi
- **Senza punto**: usa `'ejs'` non `'.ejs'`
- **Sintassi array**: puoi usare sia `['ejs', 'EJS']` che `Array('ejs', 'EJS')` (equivalenti)

#### `template.render` (Function)

Funzione async che riceve il file da renderizzare e imposta il corpo della risposta.

**Signature:**
```javascript
async function render(ctx, next, filePath) { }
```

**Parametri:**
- `ctx`: Contesto Koa completo con request, response, state, etc.
- `next`: Middleware successivo (raramente utilizzato)
- `filePath`: Path assoluto del file template da renderizzare

**Responsabilità:**
- Leggere/processare il file template
- Impostare `ctx.body` con l'HTML renderizzato
- Impostare `ctx.type = 'text/html'`
- Gestire errori di rendering con try/catch

---

## Quick Start

### 1. Installazione

```bash
npm install koa-classic-server ejs
```

### 2. Crea un Server

**server.js:**
```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');
const path = require('path');

const app = new Koa();

app.use(koaClassicServer(path.join(__dirname, 'public'), {
  showDirContents: true,
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      try {
        const html = await ejs.renderFile(filePath, {
          title: 'My Application',
          user: ctx.state.user || { name: 'Guest' },
          path: ctx.path,
          timestamp: new Date().toISOString()
        });
        ctx.type = 'text/html';
        ctx.body = html;
      } catch (error) {
        console.error('Template error:', error);
        ctx.status = 500;
        ctx.body = `<h1>Error</h1><pre>${error.message}</pre>`;
      }
    }
  }
}));

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
```

### 3. Crea un Template

**public/index.ejs:**
```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title><%= title %></title>
</head>
<body>
    <h1>Benvenuto <%= user.name %>!</h1>
    <p>Path: <%= path %></p>
    <p>Generato: <%= timestamp %></p>
</body>
</html>
```

### 4. Avvia il Server

```bash
node server.js
```

Apri http://localhost:3000/index.ejs

---

## Esempi Incrementali

Questa sezione mostra 5 esempi progressivi, dal template più semplice (senza dati) al più complesso (con loop).

> **💡 Regola fondamentale:** Devi passare esattamente i dati che il template usa!

### Esempio 1: Nessun Dato

**Quando usare:** Template completamente statici senza contenuto dinamico.

**Template: `esempio1-nessun-dato.ejs`**
```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Esempio 1</title>
</head>
<body>
    <h1>Ciao Mondo!</h1>
    <p>Questo è un template EJS che non usa nessuna variabile.</p>
    <p>È equivalente a un normale file HTML.</p>
</body>
</html>
```

**Server:**
```javascript
render: async (ctx, next, filePath) => {
  try {
    // Nessun dato passato
    ctx.body = await ejs.renderFile(filePath, {});
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Template error:', error);
    ctx.status = 500;
    ctx.body = `<h1>Error</h1><pre>${error.message}</pre>`;
  }
}
```

**Caratteristiche:**
- ✅ Nessuna variabile dinamica
- ✅ Passa oggetto vuoto `{}`
- ✅ Template rendering gestito con try/catch
- ✅ Content-type impostato correttamente

---

### Esempio 2: Una Variabile

**Quando usare:** Template con un singolo valore dinamico.

**Template: `esempio2-una-variabile.ejs`**
```html
<!DOCTYPE html>
<html>
<head>
    <title>Esempio 2</title>
</head>
<body>
    <h1>Ciao!</h1>
    <p>Il tuo nome è: <strong><%= nome %></strong></p>
</body>
</html>
```

**Server:**
```javascript
render: async (ctx, next, filePath) => {
  try {
    ctx.body = await ejs.renderFile(filePath, {
      nome: 'Mario'  // ✅ Passa UNA variabile
    });
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Template error:', error);
    ctx.status = 500;
    ctx.body = `<h1>Error</h1><pre>${error.message}</pre>`;
  }
}
```

---

### Esempio 3: Più Variabili

**Quando usare:** Template con più valori dinamici.

**Template: `esempio3-piu-variabili.ejs`**
```html
<!DOCTYPE html>
<html>
<head>
    <title>Esempio 3</title>
</head>
<body>
    <h1>Profilo Utente</h1>
    <ul>
        <li>Nome: <%= nome %></li>
        <li>Età: <%= eta %></li>
        <li>Città: <%= citta %></li>
    </ul>
</body>
</html>
```

**Server:**
```javascript
render: async (ctx, next, filePath) => {
  try {
    ctx.body = await ejs.renderFile(filePath, {
      nome: 'Mario',   // ✅ Passa
      eta: 30,         // ✅ PIÙ
      citta: 'Roma'    // ✅ variabili
    });
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Template error:', error);
    ctx.status = 500;
    ctx.body = `<h1>Error</h1><pre>${error.message}</pre>`;
  }
}
```

---

### Esempio 4: Condizionale

**Quando usare:** Template con logica condizionale (login, permessi, etc.).

**Template: `esempio4-condizionale.ejs`**
```html
<!DOCTYPE html>
<html>
<head>
    <title>Esempio 4</title>
</head>
<body>
    <h1>Area Utente</h1>

    <% if (autenticato) { %>
        <p>Benvenuto <%= nome %>!</p>
        <p>Hai accesso completo al sistema.</p>
        <a href="/logout">Logout</a>
    <% } else { %>
        <p>Non sei autenticato.</p>
        <a href="/login">Effettua il login</a>
    <% } %>
</body>
</html>
```

**Server:**
```javascript
render: async (ctx, next, filePath) => {
  try {
    ctx.body = await ejs.renderFile(filePath, {
      autenticato: true,  // ✅ Passa dati
      nome: 'Mario'       // ✅ per la logica
    });
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Template error:', error);
    ctx.status = 500;
    ctx.body = `<h1>Error</h1><pre>${error.message}</pre>`;
  }
}
```

---

### Esempio 5: Loop

**Quando usare:** Template con liste/tabelle dinamiche.

**Template: `esempio5-loop.ejs`**
```html
<!DOCTYPE html>
<html>
<head>
    <title>Esempio 5</title>
</head>
<body>
    <h1>Lista Prodotti</h1>
    <ul>
    <% prodotti.forEach(function(prodotto) { %>
        <li><%= prodotto %></li>
    <% }); %>
    </ul>
    <p>Totale: <%= prodotti.length %> prodotti</p>
</body>
</html>
```

**Server:**
```javascript
render: async (ctx, next, filePath) => {
  try {
    ctx.body = await ejs.renderFile(filePath, {
      prodotti: ['Laptop', 'Mouse', 'Tastiera']  // ✅ Passa un array
    });
    ctx.type = 'text/html';
  } catch (error) {
    console.error('Template error:', error);
    ctx.status = 500;
    ctx.body = `<h1>Error</h1><pre>${error.message}</pre>`;
  }
}
```

---

### Riepilogo Esempi Incrementali

| Esempio | Dati Passati | Usa |
|---------|--------------|-----|
| 1 | `{}` | Nessuna variabile |
| 2 | `{ nome: '...' }` | 1 variabile |
| 3 | `{ nome: '...', eta: ..., citta: '...' }` | N variabili |
| 4 | `{ autenticato: true, nome: '...' }` | Condizionali (if/else) |
| 5 | `{ prodotti: [...] }` | Loop (forEach) |

---

## Guida Progressiva

Questa sezione mostra la progressione da configurazioni semplici a configurazioni enterprise con plugin system e theme system.

### Esempio 1: Configurazione Semplice - Nessun Dato

**Quando usare:** Template completamente statici senza contenuto dinamico.

**Server:**
```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

app.use(
  koaClassicServer(
    __dirname + '/public',
    {
      showDirContents: true,
      template: {
        render: async (ctx, next, filePath) => {
          try {
            // Nessun dato passato
            ctx.body = await ejs.renderFile(filePath, {});
            ctx.type = 'text/html';
          } catch (error) {
            console.error('Template error:', error);
            ctx.status = 500;
            ctx.body = `<h1>Error</h1><pre>${error.message}</pre>`;
          }
        },
        ext: ['ejs', 'EJS'],
      },
    }
  )
);

app.listen(3000);
```

---

### Esempio 2: Configurazione Base - Dati Semplici

**Quando usare:** Pagine con poche informazioni dinamiche (titolo, messaggio, timestamp).

**Server:**
```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

app.use(
  koaClassicServer(
    __dirname + '/public',
    {
      showDirContents: true,
      template: {
        render: async (ctx, next, filePath) => {
          try {
            // Pochi dati semplici
            ctx.body = await ejs.renderFile(filePath, {
              titolo: 'Il Mio Sito',
              messaggio: 'Benvenuto nel mio sito web',
              href: ctx.href,
              path: ctx.path,
              timestamp: new Date().toISOString()
            });
            ctx.type = 'text/html';
          } catch (error) {
            console.error('Template error:', error);
            ctx.status = 500;
            ctx.body = `<h1>Error</h1><pre>${error.message}</pre>`;
          }
        },
        ext: ['ejs', 'EJS'],
      },
    }
  )
);

app.listen(3000);
```

**Template: `public/pagina.ejs`**
```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title><%= titolo %></title>
</head>
<body>
    <h1><%= messaggio %></h1>
    <div class="info">
        <p><strong>URL corrente:</strong> <%= href %></p>
        <p><strong>Path:</strong> <%= path %></p>
        <p><strong>Generato:</strong> <%= timestamp %></p>
    </div>
</body>
</html>
```

---

### Esempio 3: Configurazione Intermedia - Dati Organizzati

**Quando usare:** Applicazioni con più dati da organizzare logicamente.

**Server:**
```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

// Configurazione applicazione
const appConfig = {
  siteName: 'Il Mio Sito',
  version: '1.0.0',
  apiPrefix: 'api',
  adminPrefix: 'admin'
};

app.use(
  koaClassicServer(
    __dirname + '/public',
    {
      showDirContents: true,
      template: {
        render: async (ctx, next, filePath) => {
          try {
            // Dati organizzati in oggetti
            ctx.body = await ejs.renderFile(filePath, {
              config: {
                siteName: appConfig.siteName,
                version: appConfig.version,
                apiPrefix: appConfig.apiPrefix
                // NON passiamo adminPrefix per sicurezza
              },
              request: {
                href: ctx.href,
                path: ctx.path,
                query: ctx.query,
                method: ctx.method
              },
              user: ctx.state.user || null,
              timestamp: new Date().toISOString()
            });
            ctx.type = 'text/html';
          } catch (error) {
            console.error('Template error:', error);
            ctx.status = 500;
            ctx.body = `<h1>Error</h1><pre>${error.message}</pre>`;
          }
        },
        ext: ['ejs', 'EJS'],
      },
    }
  )
);

app.listen(3000);
```

**Template: `public/pagina.ejs`**
```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title><%= config.siteName %> - v<%= config.version %></title>
</head>
<body>
    <header>
        <h1><%= config.siteName %></h1>
        <p>Versione: <%= config.version %></p>
    </header>

    <main>
        <h2>Informazioni Richiesta</h2>
        <ul>
            <li>Metodo: <%= request.method %></li>
            <li>Path: <%= request.path %></li>
            <li>URL completo: <%= request.href %></li>
        </ul>

        <% if (Object.keys(request.query).length > 0) { %>
            <h3>Query Parameters</h3>
            <ul>
            <% Object.keys(request.query).forEach(function(key) { %>
                <li><%= key %>: <%= request.query[key] %></li>
            <% }); %>
            </ul>
        <% } %>

        <% if (user) { %>
            <p>Benvenuto, <strong><%= user.name %></strong>!</p>
        <% } else { %>
            <p>Non sei autenticato.</p>
        <% } %>

        <!-- Esempio chiamata API -->
        <button onclick="fetch('/<%= config.apiPrefix %>/data')">
            Chiama API
        </button>
    </main>

    <footer>
        <p>Generato: <%= timestamp %></p>
    </footer>
</body>
</html>
```

---

### Esempio 4: Configurazione Enterprise Completa

**Quando usare:** Applicazioni enterprise con plugin system, theme system, sessioni e configurazione avanzata.

**Server:**
```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

const app = new Koa();

// Configurazione completa applicazione
const ital8Conf = {
  wwwPath: '/public',
  apiPrefix: 'api',
  adminPrefix: 'admin',
  viewsPrefix: 'views',
  baseThemePath: '../themes/default'
};

// Sistema Plugin (esempio semplificato)
const pluginSys = {
  getPluginList: () => ['plugin1', 'plugin2'],
  isPluginActive: (name) => true,
  // ... altri metodi
};

// Oggetti dei plugin da condividere nelle pagine web
const getObjectsToShareInWebPages = {
  simpleAccess: {
    isLoggedIn: (ctx) => !!ctx.state.user,
    getUserRole: (ctx) => ctx.state.user?.role || 'guest'
  },
  analytics: {
    trackPageView: () => { /* ... */ }
  }
  // ... altri plugin
};

// Sistema Temi
const themeSys = {
  getCurrentTheme: () => 'default',
  getThemePath: () => ital8Conf.baseThemePath,
  // ... altri metodi
};

app.use(
  koaClassicServer(
    __dirname + `${ital8Conf.wwwPath}`,
    {
      showDirContents: true,
      urlsReserved: ['/' + ital8Conf.adminPrefix, '/' + ital8Conf.apiPrefix, '/' + ital8Conf.viewsPrefix],
      template: {
        render: async (ctx, next, filePath) => {
          try {
            ctx.body = await ejs.renderFile(filePath, {
              passData: {
                // Configurazione API
                apiPrefix: ital8Conf.apiPrefix,

                // Sistema Plugin
                pluginSys: pluginSys,
                plugin: getObjectsToShareInWebPages,

                // Sistema Temi
                themeSys: themeSys,

                // Informazioni File
                filePath: filePath,

                // Informazioni Richiesta
                href: ctx.href,
                query: ctx.query,
                path: ctx.path,
                method: ctx.method,

                // Contesto Koa (usa con cautela)
                ctx: ctx,

                // Sessione (se disponibile)
                session: ctx.session || undefined,

                // Utility
                timestamp: new Date().toISOString(),
                env: process.env.NODE_ENV || 'development'
              }
            });

            ctx.type = 'text/html';

          } catch (error) {
            console.error('❌ Template rendering error:', error);
            ctx.status = 500;
            ctx.type = 'text/html';

            // Messaggio diverso in base all'ambiente
            if (process.env.NODE_ENV === 'production') {
              ctx.body = '<h1>Internal Server Error</h1>';
            } else {
              ctx.body = `
                <h1>Template Error</h1>
                <pre>${error.message}</pre>
                <p><strong>File:</strong> ${filePath}</p>
                <pre>${error.stack}</pre>
              `;
            }
          }
        },
        ext: ['ejs', 'EJS'],
      },
    }
  )
);

app.listen(3000, () => {
  console.log('✅ Server started on http://localhost:3000');
  console.log(`📁 Serving from: ${__dirname}${ital8Conf.wwwPath}`);
  console.log(`🔒 Reserved paths: /${ital8Conf.adminPrefix}, /${ital8Conf.apiPrefix}`);
});
```

**Template: `public/pagina-completa.ejs`**
```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Pagina Completa con Plugin System</title>

    <!-- Carica tema corrente -->
    <link rel="stylesheet" href="<%= passData.themeSys.getThemePath() %>/style.css">
</head>
<body>
    <header>
        <h1>Sistema Completo</h1>

        <!-- Verifica login tramite plugin -->
        <% if (passData.plugin.simpleAccess.isLoggedIn(passData.ctx)) { %>
            <p>👤 Utente: <%= passData.ctx.state.user.name %></p>
            <p>🎭 Ruolo: <%= passData.plugin.simpleAccess.getUserRole(passData.ctx) %></p>
        <% } else { %>
            <p><a href="/login">Login</a></p>
        <% } %>
    </header>

    <nav>
        <!-- Chiamate API con prefix configurabile -->
        <button onclick="fetchData('/<%= passData.apiPrefix %>/users')">
            Carica Utenti
        </button>
        <button onclick="fetchData('/<%= passData.apiPrefix %>/posts')">
            Carica Post
        </button>
    </nav>

    <main>
        <h2>Plugin Attivi</h2>
        <ul>
        <% passData.pluginSys.getPluginList().forEach(function(plugin) { %>
            <li>
                <%= plugin %>
                <% if (passData.pluginSys.isPluginActive(plugin)) { %>
                    ✅ Attivo
                <% } else { %>
                    ❌ Disattivo
                <% } %>
            </li>
        <% }); %>
        </ul>

        <h2>Informazioni Richiesta</h2>
        <dl>
            <dt>Path:</dt>
            <dd><%= passData.path %></dd>

            <dt>Metodo:</dt>
            <dd><%= passData.method %></dd>

            <dt>Query:</dt>
            <dd><pre><%= JSON.stringify(passData.query, null, 2) %></pre></dd>

            <% if (passData.session) { %>
            <dt>Session ID:</dt>
            <dd><%= passData.session.id || 'N/A' %></dd>
            <% } %>
        </dl>

        <h2>Tema Corrente</h2>
        <p>Tema: <strong><%= passData.themeSys.getCurrentTheme() %></strong></p>
        <p>Path: <%= passData.themeSys.getThemePath() %></p>
    </main>

    <footer>
        <p>Ambiente: <%= passData.env %></p>
        <p>Generato: <%= passData.timestamp %></p>
        <p>File: <%= passData.filePath %></p>
    </footer>

    <script>
    // Funzione per chiamate API
    function fetchData(endpoint) {
        fetch(endpoint)
            .then(res => res.json())
            .then(data => console.log(data))
            .catch(err => console.error(err));
    }

    // Track page view (se plugin analytics attivo)
    <% if (passData.plugin.analytics) { %>
        passData.plugin.analytics.trackPageView();
    <% } %>
    </script>
</body>
</html>
```

---

### Confronto Configurazioni

| Feature | Es. 1 | Es. 2 | Es. 3 | Es. 4 |
|---------|-------|-------|-------|-------|
| Dati passati | ❌ No | ✅ Sì | ✅ Sì | ✅ Sì |
| Organizzazione | - | Piatta | Oggetti | `passData` |
| Plugin System | ❌ | ❌ | ❌ | ✅ |
| Theme System | ❌ | ❌ | ❌ | ✅ |
| Sessioni | ❌ | ❌ | ❌ | ✅ |
| URL Riservati | ❌ | ❌ | ❌ | ✅ |
| Gestione Errori | Base | Base | Base | Avanzata |
| Complessità | ⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |

### Quale Configurazione Usare?

**Usa Esempio 1 se:**
- Sito completamente statico
- Nessun dato dinamico
- Pagine semplici HTML

**Usa Esempio 2 se:**
- Poche informazioni dinamiche
- Nessun plugin/tema
- Applicazione semplice

**Usa Esempio 3 se:**
- Più dati da organizzare
- Serve configurazione base
- Applicazione media complessità

**Usa Esempio 4 se:**
- Sistema con plugin
- Sistema con temi
- Applicazione enterprise
- Sessioni e autenticazione
- Configurazione avanzata

---

## Integrazione Template Engine

### EJS

EJS (Embedded JavaScript) è uno dei template engine più popolari per Node.js.

#### Installazione

```bash
npm install ejs
```

#### Esempio Completo con Loop e Condizionali

**views/products.ejs:**
```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Catalogo Prodotti</title>
    <style>
        .product { border: 1px solid #ddd; padding: 10px; margin: 10px 0; }
        .price { color: green; font-weight: bold; }
        .discount { color: red; }
        .out-of-stock { color: gray; }
    </style>
</head>
<body>
    <h1>Catalogo Prodotti</h1>

    <% if (products && products.length > 0) { %>
        <div class="products">
        <% products.forEach(function(product) { %>
            <div class="product" data-id="<%= product.id %>">
                <h3><%= product.name %></h3>
                <p><%= product.description %></p>
                <p class="price">€<%= product.price.toFixed(2) %></p>

                <% if (product.discount > 0) { %>
                    <p class="discount">Sconto: <%= product.discount %>%</p>
                    <p>Prezzo finale: €<%= (product.price * (1 - product.discount / 100)).toFixed(2) %></p>
                <% } %>

                <% if (product.inStock) { %>
                    <button onclick="addToCart(<%= product.id %>)">Aggiungi al carrello</button>
                <% } else { %>
                    <p class="out-of-stock">Non disponibile</p>
                <% } %>
            </div>
        <% }); %>
        </div>

        <p>Totale prodotti: <%= products.length %></p>
    <% } else { %>
        <p>Nessun prodotto disponibile.</p>
    <% } %>
</body>
</html>
```

**Server con dati prodotti:**
```javascript
const path = require('path');

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      const basename = path.basename(filePath, '.ejs');

      // Dati specifici per template
      const dataMap = {
        'products': {
          products: [
            { id: 1, name: 'Laptop', description: 'High-performance laptop', price: 999.99, discount: 10, inStock: true },
            { id: 2, name: 'Mouse', description: 'Wireless mouse', price: 29.99, discount: 0, inStock: true },
            { id: 3, name: 'Keyboard', description: 'Mechanical keyboard', price: 149.99, discount: 15, inStock: false }
          ]
        }
      };

      const data = dataMap[basename] || {};
      const html = await ejs.renderFile(filePath, data);

      ctx.type = 'text/html';
      ctx.body = html;
    }
  }
}));
```

#### HTML Escaping e Sicurezza XSS

EJS fornisce protezione XSS automatica con l'escaping HTML:

```html
<!-- Escaped (safe) - use <%= %> -->
<p>User input: <%= userInput %></p>
<!-- Output: <p>User input: &lt;script&gt;alert('XSS')&lt;/script&gt;</p> -->

<!-- Unescaped (unsafe) - use <%- %> -->
<p>HTML content: <%- htmlContent %></p>
<!-- Output: <p>HTML content: <strong>Bold text</strong></p> -->
```

**Best Practice:**
- **Usa sempre `<%= %>`** per output di dati utente
- **Usa `<%- %>` solo** per HTML fidato (es. da CMS, markdown processato)
- **Valida e sanitizza** input utente prima del rendering

---

### Pug

Pug (ex-Jade) è un template engine con sintassi minimalista.

#### Installazione

```bash
npm install pug
```

#### Configurazione

```javascript
const pug = require('pug');

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['pug', 'jade'],
    render: async (ctx, next, filePath) => {
      try {
        const html = pug.renderFile(filePath, {
          title: 'My App',
          user: ctx.state.user,
          pretty: process.env.NODE_ENV === 'development'  // HTML formattato solo in dev
        });

        ctx.type = 'text/html';
        ctx.body = html;
      } catch (error) {
        console.error('Pug error:', error);
        ctx.status = 500;
        ctx.body = 'Template Error';
      }
    }
  }
}));
```

---

### Handlebars

Handlebars è un template engine con sintassi mustache.

#### Installazione

```bash
npm install handlebars
```

#### Configurazione

```javascript
const handlebars = require('handlebars');
const fs = require('fs').promises;

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['hbs', 'handlebars'],
    render: async (ctx, next, filePath) => {
      try {
        const source = await fs.readFile(filePath, 'utf-8');
        const template = handlebars.compile(source);
        const html = template({
          title: 'My App',
          items: ['Item 1', 'Item 2', 'Item 3']
        });

        ctx.type = 'text/html';
        ctx.body = html;
      } catch (error) {
        console.error('Handlebars error:', error);
        ctx.status = 500;
        ctx.body = 'Template Error';
      }
    }
  }
}));
```

---

### Nunjucks

Nunjucks è un template engine potente e flessibile ispirato a Jinja2.

#### Installazione

```bash
npm install nunjucks
```

#### Configurazione

```javascript
const nunjucks = require('nunjucks');
const path = require('path');

// Configura Nunjucks
const env = nunjucks.configure(path.join(__dirname, 'views'), {
  autoescape: true,
  noCache: process.env.NODE_ENV === 'development'
});

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['njk', 'html'],
    render: async (ctx, next, filePath) => {
      try {
        const html = await new Promise((resolve, reject) => {
          nunjucks.render(path.relative(path.join(__dirname, 'views'), filePath), {
            title: 'My App',
            user: ctx.state.user
          }, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });

        ctx.type = 'text/html';
        ctx.body = html;
      } catch (error) {
        console.error('Nunjucks error:', error);
        ctx.status = 500;
        ctx.body = 'Template Error';
      }
    }
  }
}));
```

---

## Esempi Avanzati

### Integrazione con Database

```javascript
const { Pool } = require('pg');
const pool = new Pool({ /* config */ });

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      try {
        const templateName = path.basename(filePath, '.ejs');
        let data = {};

        // Carica dati dal database in base al template
        if (templateName === 'users') {
          const result = await pool.query('SELECT * FROM users');
          data.users = result.rows;
        } else if (templateName === 'user-profile') {
          const userId = ctx.query.id;
          const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
          data.user = result.rows[0];
        }

        const html = await ejs.renderFile(filePath, {
          ...getCommonData(ctx),
          ...data
        });

        ctx.type = 'text/html';
        ctx.body = html;
      } catch (error) {
        console.error('Database/Template error:', error);
        ctx.status = 500;
        ctx.body = 'Error loading data';
      }
    }
  }
}));
```

---

### Template con Layouts

Implementazione di un sistema di layout per riutilizzare strutture comuni.

**views/layout.ejs:**
```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title><%= pageTitle %></title>
    <link rel="stylesheet" href="/css/style.css">
</head>
<body>
    <header>
        <nav>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <% if (isAuthenticated) { %>
                <a href="/profile">Profile</a>
                <a href="/logout">Logout</a>
            <% } else { %>
                <a href="/login">Login</a>
            <% } %>
        </nav>
    </header>

    <main>
        <%- content %>
    </main>

    <footer>
        <p>&copy; <%= currentYear %> <%= appName %></p>
    </footer>
</body>
</html>
```

**Server con layout:**
```javascript
const ejs = require('ejs');
const fs = require('fs').promises;
const path = require('path');

const layoutPath = path.join(__dirname, 'views', 'layout.ejs');

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      try {
        // Renderizza il contenuto
        const content = await ejs.renderFile(filePath, {
          ...getCommonData(ctx),
          title: 'Page Title'
        });

        // Renderizza il layout con il contenuto
        const html = await ejs.renderFile(layoutPath, {
          ...getCommonData(ctx),
          content: content,
          pageTitle: 'My App - Page Title'
        });

        ctx.type = 'text/html';
        ctx.body = html;
      } catch (error) {
        console.error('Layout/Template error:', error);
        ctx.status = 500;
        ctx.body = 'Error rendering page';
      }
    }
  }
}));
```

---

## Best Practices

### 1. Gestione Errori

Implementa sempre gestione errori robusta nella funzione render:

```javascript
render: async (ctx, next, filePath) => {
  try {
    const html = await ejs.renderFile(filePath, data);
    ctx.type = 'text/html';
    ctx.body = html;
  } catch (error) {
    console.error('Template rendering error:', error);

    // In development: mostra errore dettagliato
    if (process.env.NODE_ENV === 'development') {
      ctx.status = 500;
      ctx.type = 'text/html';
      ctx.body = `
        <h1>Template Rendering Error</h1>
        <pre>${error.stack}</pre>
      `;
    } else {
      // In production: messaggio generico
      ctx.status = 500;
      ctx.body = 'Internal Server Error';
    }
  }
}
```

---

### 2. Cache dei Template

In produzione, abilita il caching per performance migliori:

```javascript
const ejs = require('ejs');

const ejsOptions = {
  cache: process.env.NODE_ENV === 'production',
  filename: filePath
};

render: async (ctx, next, filePath) => {
  const html = await ejs.renderFile(filePath, data, ejsOptions);
  ctx.type = 'text/html';
  ctx.body = html;
}
```

---

### 3. Dati Comuni

Crea una funzione helper per dati comuni a tutti i template:

```javascript
function getCommonData(ctx) {
  return {
    // Request info
    path: ctx.path,
    query: ctx.query,
    method: ctx.method,

    // User info
    user: ctx.state.user || null,
    isAuthenticated: !!ctx.state.user,

    // App info
    appName: 'My Application',
    version: '1.0.0',
    env: process.env.NODE_ENV,

    // Utility
    currentYear: new Date().getFullYear(),
    timestamp: new Date().toISOString()
  };
}

// Uso nella funzione render
render: async (ctx, next, filePath) => {
  const commonData = getCommonData(ctx);
  const specificData = { /* dati specifici */ };
  const data = { ...commonData, ...specificData };

  const html = await ejs.renderFile(filePath, data);
  ctx.type = 'text/html';
  ctx.body = html;
}
```

---

### 4. Routing Basato su File

Mappa automaticamente file a dati:

```javascript
const path = require('path');

const dataProviders = {
  'index': () => ({ title: 'Home', message: 'Welcome' }),
  'about': () => ({ title: 'About Us', team: [...] }),
  'products': async () => ({
    title: 'Products',
    products: await fetchProducts()
  })
};

render: async (ctx, next, filePath) => {
  const templateName = path.basename(filePath, '.ejs');
  const dataProvider = dataProviders[templateName] || (() => ({}));
  const specificData = await dataProvider();

  const data = {
    ...getCommonData(ctx),
    ...specificData
  };

  const html = await ejs.renderFile(filePath, data);
  ctx.type = 'text/html';
  ctx.body = html;
}
```

---

### 5. Organizzazione con passData

Per applicazioni complesse, organizza tutti i dati in un oggetto `passData`:

```javascript
// ✅ BUONO - tutto organizzato
ctx.body = await ejs.renderFile(filePath, {
  passData: {
    config: { ... },
    plugin: { ... },
    request: { ... },
    user: { ... }
  }
});

// ❌ CATTIVO - dati sparsi
ctx.body = await ejs.renderFile(filePath, {
  apiPrefix: '...',
  pluginSys: { ... },
  href: '...',
  // ... tutto mescolato
});
```

---

### 6. Non Esporre Dati Sensibili

```javascript
// ❌ PERICOLOSO
passData: {
  adminPrefix: ital8Conf.adminPrefix,  // Non esporre!
  databasePassword: '...',             // Mai!
  secretKey: '...'                     // Mai!
}

// ✅ SICURO
passData: {
  apiPrefix: ital8Conf.apiPrefix,  // OK esporre
  // adminPrefix NON incluso
}
```

---

### 7. Imposta Content-Type

```javascript
// ✅ Imposta sempre il tipo
ctx.type = 'text/html';
```

---

## Troubleshooting

### Problema: Template non viene renderizzato

**Causa:** Estensione file non è in `template.ext`

**Soluzione:**
```javascript
// Verifica che l'estensione sia corretta (case-sensitive)
ext: ['ejs', 'EJS']  // Riconosce sia .ejs che .EJS
```

---

### Problema: Errore "Cannot find module 'ejs'"

**Causa:** Template engine non installato

**Soluzione:**
```bash
npm install ejs
```

---

### Problema: Dati non disponibili nel template

**Causa:** Dati non passati alla funzione render

**Esempio errore:**
```
ReferenceError: nome is not defined
    at eval ("/path/to/template.ejs":10:20)
```

**Soluzione:**
```javascript
render: async (ctx, next, filePath) => {
  // Assicurati di passare i dati
  const html = await ejs.renderFile(filePath, {
    nome: 'Mario',  // ✓ Passa i dati richiesti dal template
    eta: 30,
    citta: 'Roma'
  });
  ctx.body = html;
}
```

**Come vedere quali variabili usa un template:**

Apri il file `.ejs` e cerca `<%= ... %>`:

```html
<%= nome %>      <!-- Usa: nome -->
<%= eta %>       <!-- Usa: eta -->
<%= citta %>     <!-- Usa: citta -->
```

---

### Problema: Server crash su errore template

**Causa:** Errori non gestiti nella funzione render

**Soluzione:**
```javascript
render: async (ctx, next, filePath) => {
  try {
    const html = await ejs.renderFile(filePath, data);
    ctx.body = html;
  } catch (error) {
    console.error('Rendering error:', error);
    ctx.status = 500;
    ctx.body = 'Template Error';
  }
}
```

---

### Problema: Internal Server Error 500 con .ejs

**Possibili cause:**

1. **Variabile non definita nel template**
   ```html
   <!-- ❌ SBAGLIATO - 'user' potrebbe non esistere -->
   <p><%= user.name %></p>

   <!-- ✅ CORRETTO - controlla prima -->
   <p><%= user ? user.name : 'Guest' %></p>
   ```

2. **Dati non passati alla render function**
   ```javascript
   // ❌ SBAGLIATO - 'user' non passato
   ejs.renderFile(filePath, { title: 'App' })

   // ✅ CORRETTO - passa tutti i dati necessari
   ejs.renderFile(filePath, {
     title: 'App',
     user: { name: 'Guest' },
     path: ctx.path
   })
   ```

3. **Sintassi EJS sbagliata**
   ```html
   <!-- ❌ SBAGLIATO -->
   <%= <%= user.name %> %>

   <!-- ✅ CORRETTO -->
   <%= user.name %>
   ```

---

### Problema: Directory non trovata

**Causa:** La directory specificata non esiste

**Verifica:**
```javascript
const fs = require('fs');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(publicDir)) {
  console.error('❌ Directory non esiste:', publicDir);
  process.exit(1);
}
```

---

### Problema: File statici processati come template

**Causa:** Estensione HTML nella lista `ext`

**Soluzione:**
```javascript
ext: ['ejs', 'EJS']  // ✅ Solo file .ejs vengono processati dal template engine
// NON includere 'html' se vuoi servire file .html staticamente
```

---

### Problema: Cache non funziona in produzione

**Causa:** Cache non abilitata nelle opzioni EJS

**Soluzione:**
```javascript
const html = await ejs.renderFile(filePath, data, {
  cache: true,  // Abilita cache
  filename: filePath  // Necessario per cache
});
```

---

## Performance Tips

### 1. Abilita cache in produzione

```javascript
cache: process.env.NODE_ENV === 'production'
```

---

### 2. Pre-compila template comuni

```javascript
const compiledTemplates = new Map();

// Pre-compila all'avvio
compiledTemplates.set('index', ejs.compile(indexTemplate));

// Usa template pre-compilato
const html = compiledTemplates.get('index')(data);
```

---

### 3. Usa async/await correttamente

```javascript
// ✓ Buono - parallelo
const [users, products] = await Promise.all([
  fetchUsers(),
  fetchProducts()
]);

// ✗ Cattivo - sequenziale
const users = await fetchUsers();
const products = await fetchProducts();
```

---

### 4. Minimizza accesso al filesystem

```javascript
// Cache template content in memoria in produzione
const templateCache = new Map();

if (process.env.NODE_ENV === 'production') {
  if (!templateCache.has(filePath)) {
    const content = await fs.readFile(filePath, 'utf-8');
    templateCache.set(filePath, content);
  }
  const content = templateCache.get(filePath);
  const html = ejs.render(content, data);
}
```

---

## Checklist Pre-Produzione

Prima di mettere in produzione:

- [ ] Try/catch in tutte le render function
- [ ] `ctx.type = 'text/html'` impostato
- [ ] AdminPrefix NON esposto nelle pagine pubbliche
- [ ] URL riservati configurati in `urlsReserved` (se necessario)
- [ ] Gestione errori diversa per production/development
- [ ] Dati organizzati (opzionale: usa `passData`)
- [ ] Cache abilitata in produzione
- [ ] Testato con e senza sessione
- [ ] Testato con e senza autenticazione
- [ ] Input utente sempre escaped (usa `<%= %>` non `<%- %>`)
- [ ] Validazione input utente implementata

---

## Debug Tips

### Visualizza Dati Disponibili

Nel template, aggiungi temporaneamente:

```html
<pre><%= JSON.stringify(passData, null, 2) %></pre>
```

Questo mostra tutti i dati disponibili per il debug.

---

### Verifica Errori

Se vedi `ReferenceError: xxx is not defined`:

1. Verifica che passi la variabile nel server
2. Controlla che sia dentro l'oggetto dati
3. Nel template usa la variabile correttamente

---

## Link Utili

- [EJS Documentation](https://ejs.co/)
- [Pug Documentation](https://pugjs.org/)
- [Handlebars Documentation](https://handlebarsjs.com/)
- [Nunjucks Documentation](https://mozilla.github.io/nunjucks/)
- [koa-classic-server Documentation](../DOCUMENTATION.md)

---

## Esempi Pratici

Tutti gli esempi pratici sono disponibili nella cartella `examples/`:

- `examples/esempio1-nessun-dato.ejs` - Template statico
- `examples/esempio2-una-variabile.ejs` - Una variabile
- `examples/esempio3-piu-variabili.ejs` - Più variabili
- `examples/esempio4-condizionale.ejs` - Logica condizionale
- `examples/esempio5-loop.ejs` - Iterazione array
- `examples/index-esempi.html` - Pagina indice interattiva

Per eseguire gli esempi:

```bash
node esempi-incrementali.js
```

Poi apri http://localhost:3000/index-esempi.html

---

**Buon lavoro con i template engine! 🚀**
