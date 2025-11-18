# Guida Template Engine - koa-classic-server

## ❌ Errori Comuni

### 1. `Array("ejs", "EJS")` invece di `["ejs", "EJS"]`

**SBAGLIATO:**
```javascript
ext: Array("ejs", "EJS")  // ❌ Crea solo ["ejs"] - il secondo parametro viene ignorato!
```

**CORRETTO:**
```javascript
ext: ["ejs", "EJS"]  // ✅ Array con 2 elementi
```

**Spiegazione:** `Array("ejs", "EJS")` non fa quello che pensi! Crea un array con un solo elemento. Usa sempre le parentesi quadre `[]`.

---

### 2. Directory sbagliata

**SBAGLIATO:**
```javascript
koaClassicServer(__dirname + '/views', {...})  // ❌ Se la directory non esiste
```

**CORRETTO:**
```javascript
koaClassicServer(__dirname + '/public', {...})  // ✅ Usa la directory corretta
```

**Verifica:** Controlla che la directory esista davvero!

---

### 3. Errore nei template EJS non gestito

Se vedi "Internal Server Error 500" per i file .ejs, probabilmente c'è un errore nel template.

**Soluzione:** Aggiungi gestione errori nella funzione render:

```javascript
const templateRender = async (ctx, next, filePath) => {
  try {
    const html = await ejs.renderFile(filePath, { /* dati */ });
    ctx.type = 'text/html';
    ctx.body = html;
  } catch (error) {
    console.error('❌ Template error:', error);
    ctx.status = 500;
    ctx.body = `Error: ${error.message}`;
  }
};
```

---

## ✅ Esempio Funzionante Completo

### 1. Struttura Directory

```
koa-classic-server/
├── example-ejs-working.js  (server)
└── public/
    ├── index.html          (file statico)
    └── test.ejs            (template EJS)
```

### 2. Server (example-ejs-working.js)

```javascript
const Koa = require('koa');
const koaClassicServer = require('./index.cjs');
const ejs = require('ejs');
const path = require('path');

const app = new Koa();
const port = 3000;

const publicDir = path.join(__dirname, 'public');

const templateRender = async (ctx, next, filePath) => {
  try {
    const html = await ejs.renderFile(filePath, {
      title: 'My Application',
      user: ctx.state.user || { name: 'Guest' },
      path: ctx.path,
      query: ctx.query,
      timestamp: new Date().toISOString(),
      filePath: filePath
    });

    ctx.type = 'text/html';
    ctx.body = html;
  } catch (error) {
    console.error('❌ Template error:', error);
    ctx.status = 500;
    ctx.type = 'text/html';
    ctx.body = `
      <h1>Template Error</h1>
      <pre>${error.message}</pre>
    `;
  }
};

app.use(koaClassicServer(publicDir, {
  showDirContents: true,
  template: {
    render: templateRender,
    ext: ['ejs', 'EJS']  // ✅ Array corretto
  }
}));

app.listen(port, () => {
  console.log(`✅ Server started on http://localhost:${port}`);
  console.log(`📁 Serving files from: ${publicDir}`);
});
```

### 3. Template EJS (public/test.ejs)

```html
<!DOCTYPE html>
<html>
<head>
    <title><%= title %></title>
</head>
<body>
    <h1>EJS Template Funzionante!</h1>
    <p>User: <%= user.name %></p>
    <p>Path: <%= path %></p>
    <p>Timestamp: <%= timestamp %></p>
</body>
</html>
```

---

## 🚀 Come Testare

### 1. Installa dipendenze
```bash
npm install ejs
```

### 2. Avvia il server
```bash
node example-ejs-working.js
```

### 3. Apri il browser

- **File statico**: http://localhost:3000/index.html
- **Template EJS**: http://localhost:3000/test.ejs
- **Con query**: http://localhost:3000/test.ejs?name=Mario
- **Directory listing**: http://localhost:3000/

---

## 🔍 Debug

### Se il server non funziona affatto

**Problema:** Probabilmente la directory non esiste.

**Verifica:**
```javascript
const fs = require('fs');
const publicDir = path.join(__dirname, 'public');

if (!fs.existsSync(publicDir)) {
  console.error('❌ Directory non esiste:', publicDir);
  process.exit(1);
}
```

### Se .ejs restituisce 500 Internal Server Error

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

### Se file statici non vengono serviti

**Verifica che non siano nella lista `ext`:**

```javascript
ext: ['ejs', 'EJS']  // ✅ Solo file .ejs vengono processati dal template engine
```

Se metti `ext: ['html']`, i file .html verranno processati come template invece che serviti staticamente!

---

## 📊 Confronto Sintassi

### ✅ SINTASSI CORRETTA

```javascript
const Koa = require('koa');
const app = new Koa();
const koaClassicServer = require('koa-classic-server');
const ejs = require('ejs');

app.use(koaClassicServer(__dirname + '/public', {
  showDirContents: true,
  template: {
    render: async (ctx, next, filePath) => {
      const html = await ejs.renderFile(filePath, { data });
      ctx.type = 'text/html';
      ctx.body = html;
    },
    ext: ['ejs', 'EJS']  // ✅ Array con parentesi quadre
  }
}));

app.listen(3000);
```

### ❌ SINTASSI SBAGLIATA (da evitare)

```javascript
// ❌ SBAGLIATO 1: Array() invece di []
ext: Array("ejs", "EJS")  // Crea solo ["ejs"]

// ❌ SBAGLIATO 2: Directory inesistente
koaClassicServer(__dirname + '/views', {...})  // Se /views non esiste

// ❌ SBAGLIATO 3: Nessuna gestione errori
render: async (ctx, next, filePath) => {
  ctx.body = await ejs.renderFile(filePath, {});  // Se fallisce, crash!
}

// ❌ SBAGLIATO 4: ctx.type non impostato
render: async (ctx, next, filePath) => {
  ctx.body = await ejs.renderFile(filePath, {});
  // Manca: ctx.type = 'text/html';
}
```

---

## 💡 Tips

1. **Usa sempre `try/catch`** nella funzione render
2. **Verifica che la directory esista** prima di avviare il server
3. **Usa `["ejs"]` non `Array("ejs")`**
4. **Imposta `ctx.type = 'text/html'`** sempre
5. **Passa tutti i dati necessari** al template
6. **Testa prima con un template semplice** senza logica complessa

---

## 📚 Documentazione Completa

Per la guida completa, vedi:
- [TEMPLATE_ENGINE_GUIDE.md](./docs/TEMPLATE_ENGINE_GUIDE.md) - Guida completa con esempi avanzati
- [DOCUMENTATION.md](./docs/DOCUMENTATION.md) - Documentazione API completa
