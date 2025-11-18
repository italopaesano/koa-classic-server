# 📚 Esempi Incrementali - Template EJS

Questa guida mostra esempi progressivi di template EJS, dal più semplice al più complesso.

## 🚀 Come Usare gli Esempi

### 1. Avvia il server

```bash
node esempi-incrementali.js
```

### 2. Apri nel browser

```
http://localhost:3000/index-esempi.html
```

Oppure accedi direttamente a un esempio:

- http://localhost:3000/esempio1-nessun-dato.ejs
- http://localhost:3000/esempio2-una-variabile.ejs
- http://localhost:3000/esempio3-piu-variabili.ejs
- http://localhost:3000/esempio4-condizionale.ejs
- http://localhost:3000/esempio5-loop.ejs

---

## 📝 Esempio 1: Nessun Dato

**Template:** `esempio1-nessun-dato.ejs`

```html
<h1>Ciao Mondo!</h1>
<p>Questo template non usa variabili.</p>
```

**Server:**
```javascript
ctx.body = await ejs.renderFile(filePath, {});
// ✅ Nessun dato passato
```

**Quando usare:** Template completamente statici senza dati dinamici.

---

## 📝 Esempio 2: Una Variabile

**Template:** `esempio2-una-variabile.ejs`

```html
<p>Il tuo nome è: <strong><%= nome %></strong></p>
```

**Server:**
```javascript
ctx.body = await ejs.renderFile(filePath, {
  nome: 'Mario'  // ✅ Passa UNA variabile
});
```

**Quando usare:** Template con un singolo valore dinamico.

---

## 📝 Esempio 3: Più Variabili

**Template:** `esempio3-piu-variabili.ejs`

```html
<li>Nome: <%= nome %></li>
<li>Età: <%= eta %></li>
<li>Città: <%= citta %></li>
```

**Server:**
```javascript
ctx.body = await ejs.renderFile(filePath, {
  nome: 'Mario',   // ✅ Passa
  eta: 30,         // ✅ PIÙ
  citta: 'Roma'    // ✅ variabili
});
```

**Quando usare:** Template con più valori dinamici.

---

## 📝 Esempio 4: Condizionale

**Template:** `esempio4-condizionale.ejs`

```html
<% if (autenticato) { %>
  <p>Benvenuto <%= nome %>!</p>
<% } else { %>
  <p>Non sei autenticato.</p>
<% } %>
```

**Server:**
```javascript
ctx.body = await ejs.renderFile(filePath, {
  autenticato: true,  // ✅ Passa dati
  nome: 'Mario'       // ✅ per la logica
});
```

**Quando usare:** Template con logica condizionale (login, permessi, etc.).

---

## 📝 Esempio 5: Loop

**Template:** `esempio5-loop.ejs`

```html
<ul>
<% prodotti.forEach(function(prodotto) { %>
  <li><%= prodotto %></li>
<% }); %>
</ul>
```

**Server:**
```javascript
ctx.body = await ejs.renderFile(filePath, {
  prodotti: ['Laptop', 'Mouse', 'Tastiera']  // ✅ Passa un array
});
```

**Quando usare:** Template con liste/tabelle dinamiche.

---

## 🎯 Regola Fondamentale

> **Devi passare esattamente i dati che il template usa!**

### ❌ Cosa NON fare

```javascript
// Template usa: nome, eta, citta
// Ma passi solo nome → ERRORE!
ctx.body = await ejs.renderFile(filePath, {
  nome: 'Mario'
  // ❌ Mancano eta e citta
});
```

**Errore:** `eta is not defined`

### ✅ Cosa fare

```javascript
// Template usa: nome, eta, citta
// Passa TUTTE le variabili
ctx.body = await ejs.renderFile(filePath, {
  nome: 'Mario',
  eta: 30,
  citta: 'Roma'
  // ✅ Tutte le variabili presenti
});
```

---

## 💡 Strategia Consigliata

### Opzione A: Dati Specifici per Template

Ogni template riceve solo i dati necessari:

```javascript
const fileName = path.basename(filePath);

if (fileName === 'profilo.ejs') {
  ctx.body = await ejs.renderFile(filePath, {
    nome: 'Mario',
    email: 'mario@example.com'
  });
}
else if (fileName === 'prodotti.ejs') {
  ctx.body = await ejs.renderFile(filePath, {
    prodotti: [...],
    totale: 10
  });
}
```

**Vantaggi:** Preciso, nessun dato in più
**Svantaggi:** Devi gestire ogni template

### Opzione B: Dati Comuni + Specifici

Passa sempre un set di dati comuni + dati specifici:

```javascript
const datiComuni = {
  user: ctx.state.user,
  path: ctx.path,
  timestamp: new Date().toISOString()
};

const fileName = path.basename(filePath);
let datiSpecifici = {};

if (fileName === 'prodotti.ejs') {
  datiSpecifici = { prodotti: [...] };
}

ctx.body = await ejs.renderFile(filePath, {
  ...datiComuni,
  ...datiSpecifici
});
```

**Vantaggi:** Flessibile, dati comuni sempre disponibili
**Svantaggi:** Alcuni dati potrebbero essere ignorati

---

## 🔍 Debug

### Come vedere quali variabili usa un template

Apri il file `.ejs` e cerca `<%= ... %>`:

```html
<%= nome %>      <!-- Usa: nome -->
<%= eta %>       <!-- Usa: eta -->
<%= citta %>     <!-- Usa: citta -->
```

### Come vedere l'errore

Se una variabile manca, vedrai:

```
ReferenceError: nome is not defined
    at eval ("/path/to/template.ejs":10:20)
```

→ Il template usa `nome` ma non l'hai passato!

---

## 📂 File Creati

```
public/
├── esempio1-nessun-dato.ejs      # Nessun dato
├── esempio2-una-variabile.ejs    # 1 variabile
├── esempio3-piu-variabili.ejs    # N variabili
├── esempio4-condizionale.ejs     # if/else
├── esempio5-loop.ejs             # forEach
└── index-esempi.html             # Pagina indice

esempi-incrementali.js            # Server
```

---

## ✅ Prossimi Passi

1. Avvia `node esempi-incrementali.js`
2. Apri http://localhost:3000/index-esempi.html
3. Prova ogni esempio
4. Guarda il codice in `esempi-incrementali.js`
5. Modifica i template in `public/`
6. Crea i tuoi template!

---

## 🎓 Ricorda

- **Esempio 1:** Nessun dato → `{}`
- **Esempio 2:** 1 dato → `{ nome: '...' }`
- **Esempio 3:** N dati → `{ nome: '...', eta: ..., citta: '...' }`
- **Esempio 4:** Con if → `{ autenticato: true, ... }`
- **Esempio 5:** Con loop → `{ prodotti: [...] }`

**La chiave:** Passa esattamente quello che il template usa! 🎯
