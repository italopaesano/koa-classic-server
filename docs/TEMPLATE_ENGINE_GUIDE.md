# Template Engine Integration Guide

Guida completa all'integrazione di template engine con koa-classic-server.

## Indice

- [Introduzione](#introduzione)
- [Configurazione Base](#configurazione-base)
- [Integrazione EJS](#integrazione-ejs)
- [Altri Template Engine](#altri-template-engine)
- [Best Practices](#best-practices)
- [Esempi Avanzati](#esempi-avanzati)
- [Troubleshooting](#troubleshooting)

---

## Introduzione

koa-classic-server supporta l'integrazione con qualsiasi template engine JavaScript (EJS, Pug, Handlebars, Nunjucks, etc.) tramite una configurazione flessibile.

### Come Funziona

Quando una richiesta arriva per un file con estensione specificata in `template.ext`, il middleware:

1. Verifica che l'estensione del file sia nell'array `template.ext`
2. Chiama la funzione `template.render` con il path del file
3. La funzione render processa il template e imposta `ctx.body`
4. Il middleware serve la risposta

---

## Configurazione Base

La configurazione del template engine richiede due parametri nell'oggetto `template`:

```javascript
app.use(koaClassicServer(rootDir, {
  template: {
    // Array di estensioni da processare
    ext: ['ejs', 'pug', 'hbs'],

    // Funzione di rendering
    render: async (ctx, next, filePath) => {
      // ctx: Contesto Koa completo
      // next: Middleware successivo
      // filePath: Path assoluto del file da renderizzare

      ctx.type = 'text/html';
      ctx.body = await yourTemplateEngine.render(filePath, data);
    }
  }
}));
```

### Parametri

#### `template.ext` (Array)

Array di estensioni file che devono essere processate dal template engine.

**Caratteristiche:**
- **Case-sensitive**: `'ejs'` e `'EJS'` sono diversi
- **Senza punto**: usa `'ejs'` non `'.ejs'`
- **Multipli engine**: puoi specificare più estensioni per diversi engine

**Esempi:**
```javascript
// Solo file .ejs
ext: ['ejs']

// File .ejs e .EJS
ext: ['ejs', 'EJS']

// Multipli template engine
ext: ['ejs', 'pug', 'hbs', 'html']
```

#### `template.render` (Function)

Funzione async che riceve il file da renderizzare e imposta il corpo della risposta.

**Signature:**
```javascript
async function render(ctx, next, filePath) { }
```

**Parametri:**
- `ctx` (Object): Contesto Koa completo con request, response, state, etc.
- `next` (Function): Middleware successivo (raramente utilizzato)
- `filePath` (String): Path assoluto del file template da renderizzare

**Responsabilità:**
- Leggere/processare il file template
- Impostare `ctx.body` con l'HTML renderizzato
- Impostare `ctx.type` se necessario
- Gestire errori di rendering

---

## Integrazione EJS

EJS (Embedded JavaScript) è uno dei template engine più popolari per Node.js.

### Installazione

```bash
npm install ejs
```

### Esempio Base

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');
const path = require('path');

const app = new Koa();

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      // Renderizza il template con dati
      const html = await ejs.renderFile(filePath, {
        title: 'My Application',
        user: ctx.state.user || null,
        currentPath: ctx.path
      });

      ctx.type = 'text/html';
      ctx.body = html;
    }
  }
}));

app.listen(3000);
console.log('Server running on http://localhost:3000');
```

### Esempio con Dati Dinamici

```javascript
const fs = require('fs').promises;

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
      // Leggi il template
      const templateContent = await fs.readFile(filePath, 'utf-8');

      // Prepara dati in base al contesto
      const data = {
        // Informazioni dalla richiesta
        path: ctx.path,
        query: ctx.query,
        method: ctx.method,

        // Stato dell'applicazione
        user: ctx.state.user,
        isAuthenticated: !!ctx.state.user,

        // Utility
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV || 'development'
      };

      // Renderizza
      const html = ejs.render(templateContent, data);

      ctx.type = 'text/html';
      ctx.body = html;
    }
  }
}));
```

### File Template EJS

**views/index.ejs:**
```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title><%= title %></title>
</head>
<body>
    <h1>Benvenuto <%= user ? user.name : 'Ospite' %></h1>

    <% if (isAuthenticated) { %>
        <p>Sei autenticato come: <%= user.email %></p>
        <a href="/logout">Logout</a>
    <% } else { %>
        <p>Effettua il login per continuare</p>
        <a href="/login">Login</a>
    <% } %>

    <footer>
        <p>Path corrente: <%= path %></p>
        <p>Generato: <%= timestamp %></p>
    </footer>
</body>
</html>
```

### Esempio con Loop e Condizionali

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
        },
        'index': {
          title: 'Home Page',
          user: ctx.state.user,
          isAuthenticated: !!ctx.state.user,
          path: ctx.path,
          timestamp: new Date().toISOString()
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

### HTML Escaping e Sicurezza XSS

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

## Altri Template Engine

### Pug (ex-Jade)

```bash
npm install pug
```

```javascript
const pug = require('pug');

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['pug', 'jade'],
    render: async (ctx, next, filePath) => {
      const html = pug.renderFile(filePath, {
        title: 'My App',
        user: ctx.state.user,
        pretty: true  // HTML formattato (solo development)
      });

      ctx.type = 'text/html';
      ctx.body = html;
    }
  }
}));
```

### Handlebars

```bash
npm install handlebars
```

```javascript
const handlebars = require('handlebars');
const fs = require('fs').promises;

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['hbs', 'handlebars'],
    render: async (ctx, next, filePath) => {
      const source = await fs.readFile(filePath, 'utf-8');
      const template = handlebars.compile(source);
      const html = template({
        title: 'My App',
        items: ['Item 1', 'Item 2', 'Item 3']
      });

      ctx.type = 'text/html';
      ctx.body = html;
    }
  }
}));
```

### Nunjucks

```bash
npm install nunjucks
```

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

### 2. Cache dei Template

In produzione, abilita il caching per performance migliori:

```javascript
const ejs = require('ejs');

// EJS cache automatica in produzione
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

## Esempi Avanzati

### Integrazione con Database

```javascript
const { Pool } = require('pg');
const pool = new Pool({ /* config */ });

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
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
    }
  }
}));
```

### Template con Layouts

```javascript
const ejs = require('ejs');
const fs = require('fs').promises;
const path = require('path');

const layoutPath = path.join(__dirname, 'views', 'layout.ejs');

app.use(koaClassicServer(path.join(__dirname, 'views'), {
  template: {
    ext: ['ejs'],
    render: async (ctx, next, filePath) => {
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
    }
  }
}));
```

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

---

## Troubleshooting

### Problema: Template non viene renderizzato

**Causa:** Estensione file non è in `template.ext`

**Soluzione:**
```javascript
// Verifica che l'estensione sia corretta (case-sensitive)
ext: ['ejs', 'EJS']  // Riconosce sia .ejs che .EJS
```

### Problema: Errore "Cannot find module 'ejs'"

**Causa:** Template engine non installato

**Soluzione:**
```bash
npm install ejs
```

### Problema: Dati non disponibili nel template

**Causa:** Dati non passati alla funzione render

**Soluzione:**
```javascript
render: async (ctx, next, filePath) => {
  // Assicurati di passare i dati
  const html = await ejs.renderFile(filePath, {
    user: ctx.state.user,  // ✓ Passa i dati
    title: 'My Page'
  });
  ctx.body = html;
}
```

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

1. **Abilita cache in produzione**
   ```javascript
   cache: process.env.NODE_ENV === 'production'
   ```

2. **Pre-compila template comuni**
   ```javascript
   const compiledTemplates = new Map();

   // Pre-compila all'avvio
   compiledTemplates.set('index', ejs.compile(indexTemplate));
   ```

3. **Usa async/await correttamente**
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

4. **Minimizza accesso al filesystem**
   ```javascript
   // Cache template content in memoria in produzione
   const templateCache = new Map();
   ```

---

## Link Utili

- [EJS Documentation](https://ejs.co/)
- [Pug Documentation](https://pugjs.org/)
- [Handlebars Documentation](https://handlebarsjs.com/)
- [Nunjucks Documentation](https://mozilla.github.io/nunjucks/)
- [koa-classic-server Documentation](./DOCUMENTATION.md)
- [koa-classic-server Examples](./EXAMPLES_INDEX_OPTION.md)
