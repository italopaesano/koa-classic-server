# Index Option - Comportamento di Priorità

## ⚠️ Formato Obbligatorio: Array

**L'opzione `index` deve essere un array.** Il default è `[]` (nessun file index: le directory mostrano sempre il listing).

```javascript
// ✅ VALIDO (Array format)
index: ['index.html']
index: ['index.html', 'index.htm', 'default.html']
index: [/index\.html/i]

// ❌ ERRORE (String format - rimosso in v3.0.0)
index: 'index.html'  // Lancia un errore a startup, usa ['index.html'] invece
```

**Nota importante:** dal v3.0.0 il formato stringa (`index: 'index.html'`) non è più accettato e genera un **errore a startup** con hint di migrazione:

```
[koa-classic-server] The "index" option no longer accepts a string in v3.0.0.
  Replace with: index: ["index.html"]
```

---

## Principio Fondamentale: "First Match Wins"

L'opzione `index` utilizza il principio **"first match wins"** (primo match vince): l'array viene cercato **esattamente nell'ordine** specificato, e il **primo file trovato** viene servito.

```javascript
index: [pattern1, pattern2, pattern3, ...]
         ↑         ↑         ↑
      PRIMO    SECONDO    TERZO
   (priorità   (priorità  (priorità
   massima)    media)     bassa)
```

---

## Comportamento di Ricerca

### 1. Ordine di Ricerca Sequenziale

L'algoritmo cerca i file nell'ordine esatto dell'array: `[0] → [1] → [2] → [3] → ...`

```javascript
index: ['index1.html', 'index2.html', 'index3.html']
```

**Passi eseguiti:**
1. Cerca `index1.html` nella directory
   - ✅ Se trovato → **SERVE index1.html** (STOP, ignora index2 e index3)
   - ❌ Se non trovato → Passa al passo 2

2. Cerca `index2.html` nella directory
   - ✅ Se trovato → **SERVE index2.html** (STOP, ignora index3)
   - ❌ Se non trovato → Passa al passo 3

3. Cerca `index3.html` nella directory
   - ✅ Se trovato → **SERVE index3.html** (STOP)
   - ❌ Se non trovato → Passa al passo 4

4. Nessun file trovato → **Mostra directory listing** (se `dirListing: { enabled: true }`)

---

## Comportamento con String

### Esempio 1: Tutti i file presenti

```javascript
// Directory contiene:
// - index1.html
// - index2.html
// - index3.html

app.use(koaClassicServer('./public', {
    index: ['index1.html', 'index2.html', 'index3.html']
}));

// Risultato: Serve index1.html ✅
// Motivo: È il primo nell'array
```

### Esempio 2: Primo file mancante

```javascript
// Directory contiene:
// - index2.html (index1.html NON esiste!)
// - index3.html

app.use(koaClassicServer('./public', {
    index: ['index1.html', 'index2.html', 'index3.html']
}));

// Risultato: Serve index2.html ✅
// Motivo: index1.html non esiste, index2.html è il primo disponibile
```

### Esempio 3: Solo l'ultimo file presente

```javascript
// Directory contiene:
// - index3.html (index1.html e index2.html NON esistono!)

app.use(koaClassicServer('./public', {
    index: ['index1.html', 'index2.html', 'index3.html']
}));

// Risultato: Serve index3.html ✅
// Motivo: È l'unico disponibile nell'array
```

---

## Comportamento con RegExp

**LA PRIORITÀ FUNZIONA ALLO STESSO MODO CON LE REGEXP!**

### Esempio 1: Tutte le RegExp matchano

```javascript
// Directory contiene:
// - index1.html
// - index2.html
// - index3.html

app.use(koaClassicServer('./public', {
    index: [
        /index1\.html/i,  // ← PRIMO pattern
        /index2\.html/i,  // ← SECONDO pattern
        /index3\.html/i   // ← TERZO pattern
    ]
}));

// Risultato: Serve index1.html ✅
// Motivo: Il primo pattern /index1\.html/i matcha index1.html
```

### Esempio 2: Primo pattern non matcha

```javascript
// Directory contiene:
// - index2.html (index1.html NON esiste!)
// - index3.html

app.use(koaClassicServer('./public', {
    index: [
        /index1\.html/i,  // ← PRIMO pattern (non matcha nulla)
        /index2\.html/i,  // ← SECONDO pattern (matcha!)
        /index3\.html/i   // ← TERZO pattern
    ]
}));

// Risultato: Serve index2.html ✅
// Motivo: Primo pattern non matcha, secondo pattern matcha index2.html
```

### Esempio 3: Pattern largo prima di pattern stretto

```javascript
// Directory contiene:
// - index.html
// - index.htm
// - default.html

app.use(koaClassicServer('./public', {
    index: [
        /index\.(html|htm)/i,  // ← Pattern LARGO (matcha .html E .htm)
        /default\.html/i       // ← Pattern STRETTO (mai raggiunto!)
    ]
}));

// Risultato: Serve index.html O index.htm ✅
// Motivo: Primo pattern matcha, secondo pattern viene ignorato
// ⚠️  ATTENZIONE: default.html NON verrà MAI servito!
```

---

## Comportamento con Mixed Array (String + RegExp)

Stesso principio: l'ordine dell'array determina la priorità, **indipendentemente dal tipo**.

### Esempio 1: String prima di RegExp

```javascript
// Directory contiene:
// - index.html
// - INDEX.HTML (case diverso!)

app.use(koaClassicServer('./public', {
    index: [
        'index.html',      // ← String (case-sensitive, exact match)
        /INDEX\.HTML/i     // ← RegExp (case-insensitive)
    ]
}));

// Risultato: Serve index.html ✅ (se esiste)
// Se index.html non esiste → Serve INDEX.HTML ✅
```

### Esempio 2: RegExp prima di String

```javascript
// Directory contiene:
// - INDEX.HTML (maiuscolo)
// - index.html (minuscolo)

app.use(koaClassicServer('./public', {
    index: [
        /index\.html/i,    // ← RegExp (case-insensitive, primo!)
        'index.html'       // ← String (esatto, secondo)
    ]
}));

// Risultato: Serve INDEX.HTML o index.html ✅
// (dipende da quale il filesystem restituisce per primo)
// La stringa 'index.html' potrebbe non essere mai raggiunta!
```

---

## Pattern Matching e Filesystem Order

⚠️ **IMPORTANTE:** Quando una RegExp matcha **multipli file**, viene servito il **primo file trovato nell'ordine del filesystem**, che NON è garantito essere deterministico.

### Esempio: RegExp matcha multipli file

```javascript
// Directory contiene:
// - INDEX.HTML
// - Index.Html
// - index.html

app.use(koaClassicServer('./public', {
    index: [/index\.html/i]  // Matcha tutti e 3 i file!
}));

// Risultato: Uno dei tre file (ordine NON garantito) ⚠️
// Soluzione: Usa stringhe esatte per controllo deterministico
```

### Soluzione Deterministica

```javascript
// Per controllo esatto dell'ordine, usa stringhe:
app.use(koaClassicServer('./public', {
    index: [
        'index.html',      // 1. Cerca esattamente questo
        'Index.Html',      // 2. Poi questo
        'INDEX.HTML',      // 3. Infine questo
        /index\.html/i     // 4. Fallback per altri casi
    ]
}));
```

---

## Best Practices

### ✅ Raccomandazione 1: Specifico prima, generico dopo

```javascript
// ✓ CORRETTO
index: [
    'index.html',           // Specifico: exact match (veloce)
    /INDEX\.HTML/i,         // Meno specifico: case-insensitive
    /index\.(html|htm)/i,   // Generico: multiple estensioni
    /default\.html/i        // Fallback: file alternativo
]

// ✗ SBAGLIATO
index: [
    /index\.(html|htm)/i,   // Troppo generico per primo!
    'index.html'            // Mai raggiunto se .htm esiste!
]
```

### ✅ Raccomandazione 2: Performance - String prima di RegExp

```javascript
// ✓ OTTIMIZZATO (String = O(1), RegExp = O(n))
index: [
    'index.html',       // O(1) lookup
    'index.htm',        // O(1) lookup
    /INDEX\.HTML/i,     // O(n) regex match
    /default\.html/i    // O(n) regex match
]

// ✗ LENTO
index: [
    /index\.html/i,     // O(n) regex match per primo
    /index\.htm/i,      // O(n) regex match
    'index.html'        // O(1) ma mai raggiunto!
]
```

### ✅ Raccomandazione 3: Evita pattern troppo ampi all'inizio

```javascript
// ✗ PROBLEMATICO
index: [
    /.*\.html/i,        // Matcha QUALSIASI .html (troppo largo!)
    'index.html'        // Mai raggiunto!
]

// ✓ CORRETTO
index: [
    'index.html',       // Prima cerca file specifico
    /^index\./i,        // Poi file che iniziano con "index."
    /.*\.html/i         // Solo come ultimo fallback
]
```

---

## Diagramma di Flusso

```
┌─────────────────────────────┐
│ Richiesta GET /             │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Leggi directory             │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│ Pattern [0] (primo)         │
└──────────┬──────────────────┘
           │
           ▼
    ┌─────┴─────┐
    │ Matcha?   │
    └─────┬─────┘
          │
    ┌─────┴─────┐
    │           │
   SI          NO
    │           │
    │           ▼
    │     ┌───────────────┐
    │     │ Pattern [1]   │
    │     └───────┬───────┘
    │             │
    │             ▼
    │       ┌────┴────┐
    │       │ Matcha? │
    │       └────┬────┘
    │            │
    │       ┌────┴────┐
    │       │         │
    │      SI        NO
    │       │         │
    │       │         ▼
    │       │   ┌───────────┐
    │       │   │Pattern [2]│
    │       │   └─────┬─────┘
    │       │         │
    │       │        ...
    │       │         │
    │       │         ▼
    │       │   ┌───────────────┐
    │       │   │ Nessun match  │
    │       │   └───────┬───────┘
    │       │           │
    │       │           ▼
    │       │   ┌────────────────┐
    │       │   │ Directory      │
    │       │   │ listing        │
    │       │   └────────────────┘
    │       │
    ▼       ▼
┌──────────────────┐
│ Serve il file    │
│ STOP (ignora     │
│ pattern restanti)│
└──────────────────┘
```

---

## Codice di Implementazione

Il comportamento di priorità è implementato nel file `index.cjs` alla funzione `findIndexFile()` (linee 205-250):

```javascript
// Search with priority order (first pattern wins)
for (const pattern of indexPatterns) {
    let matchedFile = null;

    if (typeof pattern === 'string') {
        // Exact string match (case-sensitive)
        if (fileNames.includes(pattern)) {
            matchedFile = pattern;
        }
    } else if (pattern instanceof RegExp) {
        // RegExp match (supports case-insensitive with /i flag)
        matchedFile = fileNames.find(fileName => pattern.test(fileName));
    }

    // If match found, verify it's a file and return it
    if (matchedFile) {
        // ... verifica e return
        return { name: matchedFile, stat: fileStat };
    }
}

// No match found
return null;
```

**Punti chiave:**
- `for (const pattern of indexPatterns)` → Itera in ordine sequenziale
- `if (matchedFile) { return ... }` → **STOP al primo match**
- Pattern successivi vengono **ignorati completamente**

---

## Test Suite

Il comportamento di priorità è verificato da **24 test** in `__tests__/index-option.test.js`:

### Test con String:
- ✅ `Priority order - index1.html searched before index2.html`
- ✅ `Priority order - index2.html served when index1.html missing`
- ✅ `First match wins - index.html over index.htm`
- ✅ `First match wins - index.htm when index.html missing`

### Test con RegExp:
- ✅ `Priority order - First RegExp pattern searched before second`
- ✅ `Priority order - Second RegExp when first does not match`
- ✅ `Priority order - Broader pattern searched before narrower pattern`

### Test con Mixed Array:
- ✅ `Priority: String before RegExp`
- ✅ `Falls back to RegExp when string doesn't match`
- ✅ `Complex example: Mixed priorities`

---

## Esempi Reali

### Configurazione Apache-like

```javascript
app.use(koaClassicServer('./public', {
    index: [
        'index.html',       // 1. Standard HTML
        'index.htm',        // 2. Legacy HTML
        'index.php',        // 3. PHP (se processato)
        /index\.shtml/i,    // 4. Server-side includes
        'default.html'      // 5. Fallback
    ]
}));
```

### Configurazione Template Engine

```javascript
app.use(koaClassicServer('./views', {
    index: [
        'index.ejs',        // 1. EJS template (priorità)
        'index.pug',        // 2. Pug template
        /index\.html/i,     // 3. HTML statico
        'index.htm'         // 4. Legacy fallback
    ]
}));
```

### Configurazione Multilingua

```javascript
app.use(koaClassicServer('./public', {
    index: [
        'index_it.html',      // 1. Italiano
        'index_en.html',      // 2. Inglese
        /index_[a-z]{2}\.html/i,  // 3. Altre lingue
        'index.html'          // 4. Default
    ]
}));
```

---

## FAQ

### Q: L'ordine conta anche con le RegExp?
**A:** Sì! Le RegExp seguono **esattamente lo stesso comportamento** delle stringhe. Primo match vince, sempre.

### Q: Cosa succede se più file matchano la stessa RegExp?
**A:** Viene servito il primo file trovato nell'ordine del filesystem (non deterministico). Usa stringhe esatte per controllo preciso.

### Q: Posso mixare stringhe e RegExp?
**A:** Assolutamente sì! L'ordine dell'array determina la priorità, indipendentemente dal tipo.

### Q: Qual è più veloce: string o RegExp?
**A:** Le stringhe sono **molto più veloci** (O(1) vs O(n)). Metti sempre le stringhe prima delle RegExp.

### Q: Cosa succede se nessun pattern matcha?
**A:** Se `dirListing: { enabled: true }`, mostra directory listing. Altrimenti restituisce 404.

---

## Riepilogo

| Aspetto | Comportamento |
|---------|--------------|
| **Ordine di ricerca** | Sequenziale: `[0] → [1] → [2] → ...` |
| **Quando si ferma** | Al **primo match** trovato |
| **String vs RegExp** | **Stesso comportamento** di priorità |
| **Mixed array** | Tipo **irrilevante**, conta solo l'ordine |
| **Performance** | String (O(1)) >> RegExp (O(n)) |
| **Deterministico** | String: sì, RegExp multipli: no |
| **Fallback** | Directory listing o 404 |

---

**Documentazione tecnica:** `index.cjs:28-48` (opzioni), `index.cjs:205-250` (implementazione)

**Test suite:** `__tests__/index-option.test.js` (24 test cases)

**Esempi pratici:** `EXAMPLES_INDEX_OPTION.md`
