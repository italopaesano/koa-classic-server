# 📚 Guida Progressiva Template Engine

Guida step-by-step per lavorare con i template EJS, partendo da esempi semplici fino a configurazioni complete con plugin system.

---

## 🎯 Indice Esempi

1. **[Esempio 1](#esempio-1-nessun-dato)** - Nessun dato passato
2. **[Esempio 2](#esempio-2-dati-semplici)** - Pochi dati semplici
3. **[Esempio 3](#esempio-3-dati-organizzati)** - Dati organizzati in oggetto
4. **[Esempio 4](#esempio-4-configurazione-completa)** - Configurazione completa con plugin system

---

## Esempio 1: Nessun Dato

**Quando usare:** Template completamente statici senza contenuto dinamico.

### Server

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
        ext: Array("ejs", "EJS"),
      },
    }
  )
);

app.listen(3000);
```

### Template: `public/pagina.ejs`

```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Pagina Statica</title>
</head>
<body>
    <h1>Benvenuto</h1>
    <p>Questa è una pagina statica senza dati dinamici.</p>
    <p>È equivalente a un normale file HTML.</p>
</body>
</html>
```

### Caratteristiche

- ✅ Nessuna variabile dinamica
- ✅ Template rendering gestito con try/catch
- ✅ Content-type impostato correttamente
- ✅ Semplice e diretto

---

## Esempio 2: Dati Semplici

**Quando usare:** Pagine con poche informazioni dinamiche (titolo, messaggio, timestamp).

### Server

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
        ext: Array("ejs", "EJS"),
      },
    }
  )
);

app.listen(3000);
```

### Template: `public/pagina.ejs`

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

### Cosa è cambiato

| Rispetto a Esempio 1 | Aggiunto |
|----------------------|----------|
| `{}` vuoto | Variabili `titolo`, `messaggio`, `href`, `path`, `timestamp` |
| Template statico | Template usa `<%= ... %>` per dati dinamici |

### Caratteristiche

- ✅ Dati semplici e diretti
- ✅ Informazioni dal contesto Koa (`ctx.href`, `ctx.path`)
- ✅ Timestamp dinamico

---

## Esempio 3: Dati Organizzati

**Quando usare:** Applicazioni con più dati da organizzare logicamente.

### Server

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
            // Dati organizzati in oggetto
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
        ext: Array("ejs", "EJS"),
      },
    }
  )
);

app.listen(3000);
```

### Template: `public/pagina.ejs`

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

### Cosa è cambiato

| Rispetto a Esempio 2 | Aggiunto |
|----------------------|----------|
| Dati piatti | Dati organizzati in oggetti (`config`, `request`) |
| Solo variabili base | Configurazione app, info utente, query params |
| Nessuna logica | Condizionali (`if`) e loop (`forEach`) |

### Caratteristiche

- ✅ Dati organizzati logicamente
- ✅ Separazione config/request/user
- ✅ Logica condizionale nel template
- ✅ Sicurezza: adminPrefix non esposto
- ✅ API prefix configurabile

---

## Esempio 4: Configurazione Completa

**Quando usare:** Applicazioni enterprise con plugin system, theme system, e configurazione avanzata.

### Server

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
      urlsReserved: Array(
        `/${ital8Conf.adminPrefix}`,
        `/${ital8Conf.apiPrefix}`,
        `/${ital8Conf.viewsPrefix}`
      ),
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
        ext: Array("ejs", "EJS"),
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

### Template: `public/pagina-completa.ejs`

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

### Cosa è cambiato

| Rispetto a Esempio 3 | Aggiunto |
|----------------------|----------|
| Oggetti semplici | Tutto organizzato in `passData` |
| Config base | Plugin system, Theme system |
| Nessun plugin | Sistema completo con plugin condivisi |
| Nessuna sessione | Supporto sessioni |
| Path non protetti | URL riservati (`urlsReserved`) |
| Errori semplici | Gestione errori con env (production/development) |

### Caratteristiche

- ✅ **Tutto in `passData`** - Organizzazione pulita
- ✅ **Plugin System** - Condivisione oggetti plugin nelle pagine
- ✅ **Theme System** - Caricamento temi dinamici
- ✅ **URL Riservati** - Admin/API/Views protetti
- ✅ **Sessioni** - Supporto sessioni opzionale
- ✅ **Sicurezza** - `adminPrefix` NON esposto nelle pagine pubbliche
- ✅ **Environment-aware** - Errori diversi in prod/dev
- ✅ **Flessibile** - API prefix configurabile

---

## 📊 Confronto Esempi

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

---

## 🎯 Quale Esempio Usare?

### Usa Esempio 1 se:
- Sito completamente statico
- Nessun dato dinamico
- Pagine semplici HTML

### Usa Esempio 2 se:
- Poche informazioni dinamiche
- Nessun plugin/tema
- Applicazione semplice

### Usa Esempio 3 se:
- Più dati da organizzare
- Serve configurazione base
- Applicazione media complessità

### Usa Esempio 4 se:
- Sistema con plugin
- Sistema con temi
- Applicazione enterprise
- Sessioni e autenticazione
- Configurazione avanzata

---

## 💡 Best Practices

### 1. Organizza con `passData`

```javascript
// ✅ BUONO - tutto organizzato
ctx.body = await ejs.renderFile(filePath, {
  passData: {
    config: { ... },
    plugin: { ... },
    request: { ... }
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

### 2. Non Esporre Dati Sensibili

```javascript
// ❌ PERICOLOSO
passData: {
  adminPrefix: ital8Conf.adminPrefix,  // Non esporre!
  databasePassword: '...',             // Mai!
}

// ✅ SICURO
passData: {
  apiPrefix: ital8Conf.apiPrefix,  // OK esporre
  // adminPrefix NON incluso
}
```

### 3. Usa try/catch Sempre

```javascript
// ✅ SEMPRE con try/catch
render: async (ctx, next, filePath) => {
  try {
    ctx.body = await ejs.renderFile(filePath, { ... });
    ctx.type = 'text/html';
  } catch (error) {
    // Gestisci errore
  }
}
```

### 4. Imposta Content-Type

```javascript
// ✅ Imposta sempre il tipo
ctx.type = 'text/html';
```

---

## 🔍 Debug

### Visualizza Dati Disponibili

Nel template, aggiungi temporaneamente:

```html
<pre><%= JSON.stringify(passData, null, 2) %></pre>
```

Questo mostra tutti i dati disponibili per il debug.

### Controlla Errori

Se vedi `ReferenceError: xxx is not defined`:

1. Verifica che passi la variabile nel server
2. Controlla che sia dentro `passData`
3. Nel template usa: `<%= passData.xxx %>`

---

## 📚 Prossimi Passi

1. Inizia con **Esempio 1** - comprendi le basi
2. Passa a **Esempio 2** - aggiungi dati semplici
3. Prova **Esempio 3** - organizza i dati
4. Implementa **Esempio 4** - sistema completo

---

## ✅ Checklist Implementazione

Prima di mettere in produzione:

- [ ] Try/catch in tutte le render function
- [ ] `ctx.type = 'text/html'` impostato
- [ ] AdminPrefix NON esposto nelle pagine pubbliche
- [ ] URL riservati configurati in `urlsReserved`
- [ ] Gestione errori diversa per production/development
- [ ] Dati organizzati in `passData`
- [ ] Testato con e senza sessione
- [ ] Testato con e senza autenticazione

---

**Buon lavoro! 🚀**
