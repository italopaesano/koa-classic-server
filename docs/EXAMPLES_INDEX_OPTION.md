# Enhanced Index Option - Esempi Pratici

## ⚠️ Formato Raccomandato: Array

**IMPORTANTE:** L'opzione `index` deve essere usata in **formato array**. Il formato stringa è **deprecato** e verrà rimosso in versioni future.

```javascript
// ✅ RACCOMANDATO
index: ['index.html']
index: ['index.html', 'index.htm']
index: [/index\.html/i]

// ⚠️ DEPRECATO (genera warning)
index: 'index.html'  // NON usare! Usa ['index.html'] invece
```

---

## Opzione index con RegExp - Casi d'uso reali

### 1. Case-insensitive matching (Windows/Mac filesystems)

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Trova index.html, INDEX.HTML, Index.Html, INDEX.html, etc.
app.use(koaClassicServer('./public', {
    index: [/index\.html/i]
}));

app.listen(3000);
```

**Cosa matcha:**
- `index.html`
- `INDEX.HTML`
- `Index.Html`
- `INDEX.html`
- `InDeX.HtMl`

---

### 2. Multiple estensioni con case-insensitive

```javascript
// Trova index.html, index.htm, INDEX.HTML, Index.HTM, etc.
app.use(koaClassicServer('./public', {
    index: [/index\.(html|htm)/i]
}));
```

**Cosa matcha:**
- `index.html`
- `index.htm`
- `INDEX.HTML`
- `INDEX.HTM`
- `Index.Html`
- `Index.Htm`

---

### 3. Template engines con varianti di case

```javascript
// Trova index.ejs, INDEX.EJS, index.pug, INDEX.PUG, etc.
app.use(koaClassicServer('./views', {
    index: [
        /index\.ejs/i,
        /index\.pug/i,
        /index\.html/i
    ]
}));
```

**Priorità:** Primo match vince
- Prima cerca: index.ejs, INDEX.EJS, Index.Ejs, etc.
- Poi cerca: index.pug, INDEX.PUG, Index.Pug, etc.
- Infine cerca: index.html, INDEX.HTML, Index.Html, etc.

---

### 4. Pattern complessi con numeri

```javascript
// Trova index.html, index1.html, index2.html, INDEX10.HTML, etc.
app.use(koaClassicServer('./public', {
    index: [/index\d*\.html/i]
}));
```

**Cosa matcha:**
- `index.html`
- `index1.html`
- `index2.html`
- `index10.html`
- `INDEX.HTML`
- `INDEX99.HTML`

---

### 5. Default files con varianti

```javascript
// Cerca default.html, default.htm, DEFAULT.HTML, etc.
app.use(koaClassicServer('./public', {
    index: [
        /index\.(html|htm)/i,
        /default\.(html|htm)/i,
        /home\.(html|htm)/i
    ]
}));
```

**Priorità:**
1. index.html/htm (qualsiasi case)
2. default.html/htm (qualsiasi case)
3. home.html/htm (qualsiasi case)

---

### 6. Configurazione tipo Apache (mixed string + RegExp)

```javascript
// Best practice: Stringhe esatte prima, RegExp dopo
app.use(koaClassicServer('./public', {
    index: [
        'index.html',        // 1. Exact match (più veloce)
        'index.htm',         // 2. Exact match
        /INDEX\.HTML/i,      // 3. Case-insensitive fallback
        /default\.html/i     // 4. Default fallback
    ]
}));
```

**Perché questo ordine:**
- String matching è più veloce di RegExp
- Specifico prima (index.html) → generico dopo (/default\.html/i)

---

### 7. Pattern avanzati con gruppi opzionali

```javascript
// Trova: index, index.html, index.htm, INDEX, INDEX.HTML, etc.
app.use(koaClassicServer('./public', {
    index: [/index(\.(html|htm))?/i]
}));
```

**Cosa matcha:**
- `index` (senza estensione!)
- `index.html`
- `index.htm`
- `INDEX`
- `INDEX.HTML`
- `INDEX.HTM`

---

### 8. Prefissi variabili (multilingua)

```javascript
// Supporto multilingua: index_en.html, index_it.html, INDEX_FR.HTML, etc.
app.use(koaClassicServer('./public', {
    index: [
        /index_[a-z]{2}\.html/i,  // index_en.html, INDEX_IT.HTML
        /index\.html/i             // Fallback
    ]
}));
```

**Cosa matcha:**
- `index_en.html`
- `index_it.html`
- `INDEX_FR.HTML`
- `index.html` (fallback)

---

### 9. Configurazione PHP-like

```javascript
// Simula configurazione Apache/PHP con DirectoryIndex
app.use(koaClassicServer('./public', {
    index: [
        'index.php',
        'index.html',
        'index.htm',
        /INDEX\.(PHP|HTML|HTM)/i,
        'default.php',
        'default.html'
    ]
}));
```

---

### 10. Solo file che iniziano con "index"

```javascript
// Matcha qualsiasi file che inizia con "index" (index.*, INDEX.*, Index.*)
app.use(koaClassicServer('./public', {
    index: [/^index\./i]
}));
```

**Cosa matcha:**
- `index.html`
- `index.php`
- `index.ejs`
- `INDEX.CSS` (attenzione!)
- `Index.Anything`

---

## Performance Tips

### ✅ Best Practice: String prima, RegExp dopo

```javascript
// VELOCE ⚡
index: [
    'index.html',      // String match = O(1)
    'index.htm',       // String match = O(1)
    /INDEX\.HTML/i     // RegExp match = O(n)
]

// LENTO 🐌
index: [
    /index\.html/i,    // RegExp match = O(n)
    /index\.htm/i,     // RegExp match = O(n)
    'index.html'       // Mai raggiunto!
]
```

### ✅ Pattern specifici prima, generici dopo

```javascript
// CORRETTO ✓
index: [
    /^index\.html$/i,     // Specifico: solo index.html
    /^index\./i,          // Generico: qualsiasi index.*
    /\.(html|htm)$/i      // Molto generico: qualsiasi .html/.htm
]
```

---

## Validazione automatica

Il middleware filtra automaticamente elementi non validi:

```javascript
app.use(koaClassicServer('./public', {
    index: [
        'index.html',    // ✓ Valid: string
        /index\.htm/i,   // ✓ Valid: RegExp
        123,             // ✗ Filtrato: number
        null,            // ✗ Filtrato: null
        undefined,       // ✗ Filtrato: undefined
        {},              // ✗ Filtrato: object
        'default.html'   // ✓ Valid: string
    ]
}));

// Risultato effettivo: ['index.html', /index\.htm/i, 'default.html']
```

---

## Testing

Per testare le tue configurazioni:

```javascript
const fs = require('fs');
const path = require('path');

// Crea file di test con vari case
const testDir = './test-index';
fs.mkdirSync(testDir, { recursive: true });
fs.writeFileSync(path.join(testDir, 'index.html'), '<h1>Found index.html</h1>');
fs.writeFileSync(path.join(testDir, 'INDEX.HTML'), '<h1>Found INDEX.HTML</h1>');
fs.writeFileSync(path.join(testDir, 'Index.Html'), '<h1>Found Index.Html</h1>');

// Testa quale viene trovato per primo
app.use(koaClassicServer(testDir, {
    index: [/index\.html/i]
}));

// Apri http://localhost:3000 e verifica quale file viene servito
```

---

## Casi Edge

### File multipli con stesso pattern

Se ci sono più file che matchano lo stesso pattern, viene servito **il primo trovato nell'ordine di lettura della directory** (dipende dal filesystem):

```javascript
// Directory contiene: index.html, INDEX.HTML, Index.Html
app.use(koaClassicServer('./public', {
    index: [/index\.html/i]
}));

// Risultato: Uno dei tre file (ordine non garantito)
// Per controllo deterministico, usa stringhe esatte
```

### Pattern che matchano troppo

```javascript
// ⚠️ ATTENZIONE: Pattern troppo generico!
app.use(koaClassicServer('./public', {
    index: [/index/i]  // Matcha anche: "my_index.txt", "reindex.html"
}));

// ✓ MEGLIO: Pattern specifico
app.use(koaClassicServer('./public', {
    index: [/^index\./i]  // Matcha solo: "index.*"
}));
```

---

## Esempio Completo Real-World

```javascript
const Koa = require('koa');
const koaClassicServer = require('koa-classic-server');

const app = new Koa();

// Configurazione production-ready
app.use(koaClassicServer('./public', {
    method: ['GET', 'HEAD'],
    showDirContents: true,

    // Index configuration con fallback multipli
    index: [
        // 1. Exact matches (fastest)
        'index.html',
        'index.htm',

        // 2. Case-insensitive fallbacks
        /INDEX\.HTML/i,
        /INDEX\.HTM/i,

        // 3. Default files
        /default\.(html|htm)/i,

        // 4. Home fallback
        /home\.html/i
    ],

    // HTTP Caching
    enableCaching: true,
    cacheMaxAge: 3600,

    // URL configuration
    urlPrefix: '/static',
    urlsReserved: ['/api', '/auth']
}));

app.listen(3000, () => {
    console.log('🚀 Server running on http://localhost:3000');
    console.log('📁 Static files: http://localhost:3000/static');
});
```

---

## Supporto completo

L'opzione `index` supporta:

| Tipo | Esempio | Caso d'uso | Stato |
|------|---------|------------|-------|
| **Array di stringhe** | `["index.html", "index.htm"]` | Priorità definita, performance ottimale | ✅ **Raccomandato** |
| **Array di RegExp** | `[/index\.html/i, /default\.htm/i]` | Pattern multipli, case-insensitive | ✅ **Raccomandato** |
| **Mixed array** | `["index.html", /INDEX\.HTM/i]` | Best of both worlds | ✅ **Raccomandato** |
| ~~String~~ | ~~`"index.html"`~~ | Singolo file | ⚠️ **DEPRECATO** |

**Nota:** Il formato stringa (`"index.html"`) è deprecato e genera un warning. Verrà rimosso in versioni future. Usa il formato array `["index.html"]` invece.

---

**Documentazione completa:** `index.cjs:28-48`
**Implementazione:** `index.cjs:205-250` (funzione `findIndexFile`)
**Test suite:** `__tests__/index-option.test.js` (19 test cases)
