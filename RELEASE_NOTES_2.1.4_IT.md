# Note di Rilascio - koa-classic-server v2.1.4

**Data di Rilascio:** 4 Dicembre 2025
**Tipo:** Patch Release (Correzione Bug)

---

## 🐛 Correzioni Bug

### Correzione Critica: Problema di Caching Euristico del Browser

**Problema:**
Quando `enableCaching: false` era impostato, il server non inviava header anti-cache espliciti. Questo causava l'utilizzo del caching euristico da parte dei browser moderni, servendo contenuti obsoleti anche se il caching era esplicitamente disabilitato. Gli utenti segnalavano di non vedere i file aggiornati nonostante il caching fosse disabilitato.

**Soluzione:**
Aggiunti header HTTP anti-cache espliciti quando `enableCaching: false`:
```http
Cache-Control: no-cache, no-store, must-revalidate
Pragma: no-cache
Expires: 0
```

**Impatto:**
- ✅ I file sono ora sempre aggiornati quando il caching è disabilitato (ambienti di sviluppo)
- ✅ Nessun impatto in produzione quando `enableCaching: true`
- ✅ Risolve il problema segnalato con contenuti obsoleti

**Modifiche al Codice:**
`index.cjs` righe 355-361

---

## ✅ Miglioramenti ai Test

### Suite Completa di Test per il Caching

Aggiunti **14 nuovi test** (totale: 22 test) che coprono tutti gli scenari di caching:

#### 1. Valori Personalizzati di `cacheMaxAge` (3 test)
- `cacheMaxAge: 7200` (2 ore)
- `cacheMaxAge: 0` (rivalidazione immediata)
- `cacheMaxAge: 86400` (1 giorno)

#### 2. Generazione e Validazione ETag (2 test)
- L'ETag cambia quando il contenuto del file viene modificato
- L'ETag cambia quando la dimensione del file cambia

#### 3. Risparmio di Banda (2 test)
- Le risposte 304 non hanno body
- Multiple risposte 304 risparmiano correttamente la banda

#### 4. Supporto per Diversi Tipi MIME (4 test)
- File HTML con header di cache
- File JSON con header di cache
- File CSS con header di cache
- File JavaScript con header di cache

#### 5. Rendering Template (1 test)
- Il caching non interferisce con il rendering dei template

#### 6. Richieste Concorrenti (2 test)
- Richieste concorrenti multiple generano ETag identici
- Risposte 304 concorrenti funzionano correttamente

**Tutti i test passano:** ✅ 22/22

---

## 📦 Istruzioni per l'Aggiornamento

### Da v2.1.3 a v2.1.4

```bash
npm update koa-classic-server
```

**Nessuna breaking change.** Questo è un patch release che corregge un bug e migliora la copertura dei test.

---

## 🔄 Comportamento Prima e Dopo

### Prima della v2.1.4 (Bug)

```javascript
app.use(koaClassicServer('/public', {
    enableCaching: false  // ❌ Il browser può ancora cachare i file
}));
```

**Risultato:** Il browser usa il caching euristico → file obsoleti serviti

### Dopo la v2.1.4 (Risolto)

```javascript
app.use(koaClassicServer('/public', {
    enableCaching: false  // ✅ Il browser non cacha mai i file
}));
```

**Risultato:** Header anti-cache inviati → file sempre aggiornati

---

## 📊 Configurazione Raccomandata

### Ambiente di Sviluppo

```javascript
const koaClassicServer = require('koa-classic-server');

app.use(koaClassicServer(__dirname + '/public', {
    enableCaching: false,  // File sempre aggiornati durante lo sviluppo
    showDirContents: true
}));
```

### Ambiente di Produzione

```javascript
const koaClassicServer = require('koa-classic-server');

app.use(koaClassicServer(__dirname + '/public', {
    enableCaching: true,   // Abilita il caching per le performance
    cacheMaxAge: 86400,    // 24 ore
    showDirContents: false
}));
```

---

## 🔗 Issue Correlate

Questo rilascio risolve il problema segnalato dagli utenti in cui gli aggiornamenti dei file non erano visibili nel browser nonostante `enableCaching: false`.

---

## 📝 Changelog Completo

### Aggiunto
- Header anti-cache espliciti quando `enableCaching: false`
- Suite completa di test per il caching HTTP (22 test)
- Copertura test per generazione e validazione ETag
- Copertura test per diversi tipi MIME
- Copertura test per richieste concorrenti con caching

### Risolto
- Caching euristico del browser quando `enableCaching: false`
- Contenuti obsoleti serviti negli ambienti di sviluppo

### Modificato
- Migliorata la copertura test da 8 a 22 test per la funzionalità di caching

---

## 🙏 Contributori

Ringraziamenti speciali a tutti gli utenti che hanno segnalato il problema di caching e hanno aiutato a identificare il bug.

---

## 📚 Documentazione

Per la documentazione completa, visita:
- [Repository GitHub](https://github.com/italopaesano/koa-classic-server)
- [Pacchetto npm](https://www.npmjs.com/package/koa-classic-server)

---

## 🐛 Segnala Problemi

Hai trovato un bug? Segnalalo qui:
https://github.com/italopaesano/koa-classic-server/issues

---

**Rilascio Precedente:** [v2.1.3](https://github.com/italopaesano/koa-classic-server/releases/tag/v2.1.3)
**Prossimo Rilascio:** Da annunciare
