# Diagramma di flusso ASCII — koa-classic-server (V3)

> Diagramma di flusso del progetto in ASCII art, aggiornato al codice V3.1 corrente
> (`index.cjs`). Per il documento storico pre-V3 vedi [FLOW_DIAGRAM.md](FLOW_DIAGRAM.md).

## Indice

- [Vista d'insieme](#vista-dinsieme)
- [1. Fase di inizializzazione (factory)](#1-fase-di-inizializzazione-factory)
- [2. Flusso principale della richiesta](#2-flusso-principale-della-richiesta)
- [3. Gestione directory](#3-gestione-directory)
- [4. Caricamento file — loadFile()](#4-caricamento-file--loadfile)
- [5. Directory listing — show_dir()](#5-directory-listing--show_dir)
- [6. Rendering template — tryRenderTemplate()](#6-rendering-template--tryrendertemplate)

---

## Vista d'insieme

```
                        ┌──────────────────────────────┐
                        │  koaClassicServer(rootDir,   │
                        │           options)           │   FASE 1: factory
                        │  valida opzioni, prepara     │   (una volta sola,
                        │  cache LFU, ritorna il       │    all'avvio)
                        │  middleware async            │
                        └──────────────┬───────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────┐
                        │   async (ctx, next) => {...} │   FASE 2: per ogni
                        │   middleware Koa             │   richiesta HTTP
                        └──────────────┬───────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              ▼                        ▼                        ▼
     ┌─────────────────┐     ┌─────────────────┐      ┌─────────────────┐
     │   loadFile()    │     │   show_dir()    │      │  await next()   │
     │  serve un file  │     │ listing HTML    │      │ passa la mano   │
     │  (cache, range, │     │ (sort, filtri,  │      │ (metodo/prefix/ │
     │  compressione)  │     │  paginazione)   │      │  url riservati) │
     └─────────────────┘     └─────────────────┘      └─────────────────┘
```

---

## 1. Fase di inizializzazione (factory)

Eseguita una sola volta quando l'operatore chiama `koaClassicServer(rootDir, opts)`.

```
START koaClassicServer(rootDir, opts)
  │
  ├─► Valida rootDir
  │     ├─ non stringa / vuoto ──────────► throw TypeError
  │     ├─ non assoluto ────────────────► throw Error
  │     └─ OK → normalizedRootDir = path.resolve(rootDir)
  │
  ├─► normalizeLogger(options.logger)          (default: console)
  │
  ├─► Guardie breaking-change V3 (throw con hint di migrazione):
  │     maxDirEntries, pageSize, cacheMaxAge, enableCaching,
  │     compression.minSize, index come stringa non vuota
  │
  ├─► Namespace dirListing (V3):
  │     enabled: true │ maxEntries: 10000 │ entriesPerPage: 100
  │     (alias v2 showDirContents → dirListing.enabled,
  │      warning di deprecazione una volta per processo)
  │
  ├─► Normalizza opzioni:
  │     ├─ method: ['GET']
  │     ├─ index: []                (array di stringhe/RegExp)
  │     ├─ urlPrefix: ""  /  urlsReserved: []
  │     ├─ template: { render, ext: [], renderTimeout: 30000 }
  │     ├─ browserCacheMaxAge: 3600 / browserCacheEnabled: false
  │     ├─ useOriginalUrl: true
  │     ├─ hideExtension: { ext, redirect: 301 }     (opzionale)
  │     ├─ hidden: { dotFiles, dotDirs, alwaysHide } (default: tutto visibile)
  │     ├─ compression: { enabled: true, encodings: ['br','gzip'],
  │     │                 minFileSize: 1024, mimeTypes: default list }
  │     ├─ serverCache: { rawFile (off, 50MB), compressedFile (on, 100MB) }
  │     ├─ symlinks: 'follow' | 'follow-within-root' | 'deny'
  │     │     (modalità protette → realpathSync di rootDir, deve esistere)
  │     └─ staticSecurityHeaders: { nosniff: false }
  │
  ├─► Crea cache LFU in memoria:
  │     _rawFileCache          (buffer file grezzi)
  │     _compressedFileCache   (buffer compressi br/gzip)
  │
  └─► return async (ctx, next) => { ... }        ══► FASE 2
```

---

## 2. Flusso principale della richiesta

Eseguito per ogni richiesta HTTP che attraversa il middleware.

```
┌─────────────────────────────────────────────────────────────────┐
│                     RICHIESTA HTTP IN ARRIVO                    │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. CONTROLLO METODO                                            │
│     ctx.method ∈ options.method ? (default: ['GET'])            │
│     ├─ NO  ──► await next() ──► EXIT                            │
│     └─ SÌ  ──► continua                                         │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. COSTRUZIONE E PARSING URL                                   │
│     urlToUse = useOriginalUrl ? ctx.originalUrl : ctx.url       │
│     new URL(origin + urlToUse)   (slash finale rimossa)         │
│     ├─ URL invalido (Host malformato) ──► 400 Bad Request ─►EXIT│
│     └─ OK ──► continua                                          │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. CONTROLLO urlPrefix                                         │
│     il pathname inizia con options.urlPrefix ?                  │
│     ├─ NO  ──► await next() ──► EXIT                            │
│     └─ SÌ  ──► pageHrefOutPrefix = URL senza prefisso           │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. CONTROLLO urlsReserved (solo primo livello)                 │
│     primo segmento ∈ options.urlsReserved ?                     │
│     ├─ SÌ  ──► await next() ──► EXIT (riservato ad altri)       │
│     └─ NO  ──► continua                                         │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. DECODIFICA E SANITIZZAZIONE PERCORSO                        │
│     decodeURIComponent(pathname)                                │
│     ├─ percent-encoding malformato ──► 400 Bad Request ──► EXIT │
│     ├─ contiene byte nullo (\0) ─────► 400 Bad Request ──► EXIT │
│     └─ OK ──► normalizedPath = path.normalize(...)              │
│               fullPath = path.join(rootDir, normalizedPath)     │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. PROTEZIONE PATH TRAVERSAL                                   │
│     _isWithinRoot(fullPath, rootDir) ?  (boundary-aware:        │
│     copre ../, %2e%2e%2f, backslash Windows, sibling dirs)      │
│     ├─ NO  ──► 404 Not Found ──► EXIT                           │
│     │          (404 e non 403: "fuori root" indistinguibile     │
│     │           da "non esiste")                                │
│     └─ SÌ  ──► continua                                         │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. CONTROLLO DIRECTORY NASCOSTE NEL PERCORSO                   │
│     ogni segmento intermedio è nascosto secondo                 │
│     hidden.{dotDirs, alwaysHide} ?                              │
│     ├─ SÌ  ──► 404 Not Found ──► EXIT                           │
│     └─ NO  ──► continua                                         │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  8. hideExtension (se configurato)                              │
│     URL termina con l'estensione nascosta (es. .ejs) ?          │
│     ├─ SÌ ──► redirect 301/302 all'URL pulito ──► EXIT          │
│     │         (/index.ejs → /,   /pagina.ejs → /pagina;         │
│     │          slash iniziali collassate anti open-redirect)    │
│     └─ NO ──► URL senza estensione e file+ext esiste su disco?  │
│               ├─ SÌ ──► toOpen = fullPath + ext                 │
│               └─ NO ──► toOpen = fullPath                       │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  9. STAT DEL PERCORSO                                           │
│     await fs.promises.stat(toOpen)                              │
│     ├─ ERRORE ──► 404 Not Found ──► EXIT                        │
│     └─ OK     ──► continua                                      │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 10. CONTROLLO ENTRY NASCOSTA (la risorsa richiesta stessa)      │
│     isHiddenEntry(nome, relPath, isDir) ?                       │
│     priorità: blacklist > whitelist > alwaysHide > default      │
│     ├─ SÌ  ──► 404 Not Found ──► EXIT                           │
│     └─ NO  ──► continua                                         │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│ 11. POLICY SYMLINK (solo modalità protette, V3.1)               │
│     symlinks = 'follow' ──► nessun controllo (zero overhead)    │
│     symlinks = 'follow-within-root' / 'deny':                   │
│       realpath(toOpen) rispetta la policy ?                     │
│       ├─ NO  ──► 404 Not Found ──► EXIT                         │
│       └─ SÌ  ──► continua                                       │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
                        ┌───────┴────────┐
                        │ stat.isDir() ? │
                        └───────┬────────┘
                    ┌───────────┴────────────┐
                 SÌ ▼                        ▼ NO
        ┌────────────────────┐    ┌────────────────────┐
        │ GESTIONE DIRECTORY │    │  loadFile(toOpen,  │
        │    (sezione 3)     │    │       stat)        │
        └────────────────────┘    │    (sezione 4)     │
                                  └────────────────────┘
```

---

## 3. Gestione directory

```
┌─────────────────────────────────────────────────────────────────┐
│                 LA RICHIESTA PUNTA A UNA DIRECTORY              │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │  dirListing.enabled = true ? │
                 └──────────────┬───────────────┘
                     ┌──────────┴──────────┐
                  NO ▼                     ▼ SÌ
          ┌──────────────────┐  ┌──────────────────────────────┐
          │ 404 Not Found    │  │ options.index configurato ?  │
          │ ──► EXIT         │  └──────────────┬───────────────┘
          └──────────────────┘      ┌──────────┴──────────┐
                                 NO ▼                     ▼ SÌ
                    ┌────────────────────┐   ┌─────────────────────────────┐
                    │ show_dir()         │   │ findIndexFile(dir, index)   │
                    │ (sezione 5)        │   │  - stringhe: stat diretto   │
                    └────────────────────┘   │    (fast path, no readdir)  │
                                             │  - RegExp: readdir lazy     │
                                             │    condiviso tra i pattern  │
                                             │  - primo match vince        │
                                             └──────────────┬──────────────┘
                                                 ┌──────────┴──────────┐
                                     NON TROVATO ▼                     ▼ TROVATO
                                    ┌────────────────────┐  ┌─────────────────────────┐
                                    │ show_dir()         │  │ index nascosto (hidden) │
                                    │ (sezione 5)        │  │ o symlink bloccato ?    │
                                    └────────────────────┘  │ ├─ SÌ ► show_dir()/404  │
                                                            │ └─ NO ► loadFile(index) │
                                                            │         (sezione 4)     │
                                                            └─────────────────────────┘
```

---

## 4. Caricamento file — loadFile()

```
┌─────────────────────────────────────────────────────────────────┐
│                  loadFile(toOpen, fileStat)                     │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. CACHE RAW FILE (serverCache.rawFile, default: off)          │
│     abilitata e size ≤ maxFileSize ?                            │
│     ├─ hit fresca (mtime+size+maxAge ok) ──► rawBuffer da RAM   │
│     ├─ miss/stale ──► readFile() da disco + inserimento LFU     │
│     └─ disabilitata ──► rawBuffer = null (si userà lo stream)   │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. TEMPLATE ? ──► tryRenderTemplate() (sezione 6)              │
│     estensione ∈ template.ext e render definito ?               │
│     ├─ SÌ  ──► gestito dal template ──► EXIT                    │
│     └─ NO  ──► continua come file statico                       │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. HEADER DI BASE                                              │
│     Accept-Ranges: bytes                                        │
│     X-Content-Type-Options: nosniff  (solo se opt-in)           │
│     Cache-Control:                                              │
│       browserCacheEnabled ──► public, max-age=N, must-revalidate│
│       altrimenti          ──► no-cache, no-store + Pragma       │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. VERIFICA ACCESSO (protezione race condition)                │
│     saltata se rawBuffer già letto; altrimenti fs.access(R_OK)  │
│     ├─ ERRORE ──► 404 Not Found ──► EXIT                        │
│     └─ OK     ──► continua                                      │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. RICHIESTA RANGE ? (header Range presente)                   │
│     ├─ range insoddisfacibile ──► 416 + Content-Range ──► EXIT  │
│     ├─ range valido e If-Range ok ──► 206 Partial Content       │
│     │     (slice da rawBuffer o createReadStream{start,end};    │
│     │      compressione sempre saltata per i range) ──► EXIT    │
│     └─ range invalido / If-Range mismatch ──► risposta 200 piena│
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. DECISIONE COMPRESSIONE                                      │
│     compression.enabled  E  MIME comprimibile                   │
│     E  size ≥ minFileSize  E  Accept-Encoding compatibile ?     │
│     ├─ SÌ  ──► encoding = 'br' | 'gzip' (ordine di priorità)    │
│     └─ NO  ──► encoding = null                                  │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. CACHING HTTP BROWSER (se browserCacheEnabled)               │
│     ETag = "mtime-size[-br|-gz]"  (specifico per encoding)      │
│     Last-Modified = mtime UTC                                   │
│     If-None-Match coincide ────────► 304 Not Modified ──► EXIT  │
│     If-Modified-Since ≥ mtime ─────► 304 Not Modified ──► EXIT  │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
        Content-Type + Content-Disposition (RFC 5987)
                                │
              ┌─────────────────┴─────────────────┐
   encoding ≠ null                          encoding = null
              ▼                                   ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│ RISPOSTA COMPRESSA            │   │ RISPOSTA NON COMPRESSA        │
│ Content-Encoding + Vary       │   │                               │
│                               │   │  rawBuffer in RAM ?           │
│ cache compressedFile on ?     │   │  ├─ SÌ ► body = buffer,       │
│ ├─ SÌ ► comprimi 1 volta      │   │  │       Content-Length noto  │
│ │  (br q11 / gzip max),       │   │  └─ NO ► createReadStream(),  │
│ │  buffer in LFU cache,       │   │          Content-Length =     │
│ │  Content-Length noto        │   │          stat.size            │
│ │  (fallback non compresso    │   └───────────────────────────────┘
│ │   in caso di errore)        │
│ └─ NO ► streaming: file/RAM   │      Per HEAD: stessi header,
│         │ pipe zlib transform │      body vuoto, Content-Length
│         │ (br q4 / gzip 6),   │      ripristinato (RFC 9110)
│         │ niente Content-Len  │
└───────────────────────────────┘
                                │
                                ▼
                     RISPOSTA INVIATA AL CLIENT
```

---

## 5. Directory listing — show_dir()

```
┌─────────────────────────────────────────────────────────────────┐
│                     show_dir(toOpen, ctx)                       │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. readdir(toOpen, { withFileTypes: true })                    │
│     ├─ ERRORE ──► 500 + pagina errore ──► EXIT                  │
│     └─ OK ──► entries > dirListing.maxEntries (10000) ?         │
│               ├─ SÌ ► slice + banner ⚠ + header X-Dir-Truncated │
│               └─ NO ► tutte le entry                            │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. PARAMETRI QUERY STRING                                      │
│     ?sort=name|type|size   ?order=asc|desc   ?page=N (0-based)  │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. RACCOLTA DATI ENTRY (stat in parallelo, batch da 64)        │
│     per ogni entry:                                             │
│       ├─ tipo effettivo (file/dir/symlink; DT_UNKNOWN → stat)   │
│       ├─ symlink rotto ──► etichetta "( Broken Symlink )"       │
│       ├─ nascosta (isHiddenEntry) ──► SCARTATA dal listing      │
│       ├─ symlink fuori policy ──► "( Blocked Symlink )",        │
│       │                            non cliccabile               │
│       ├─ MIME type, dimensione formattata, URI encodato         │
│       └─ prima riga: ".. Parent Directory" (se non in root)     │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. ORDINAMENTO                                                 │
│     name ──► localeCompare                                      │
│     type ──► directory prima, poi MIME type                     │
│     size ──► directory prima, poi byte                          │
│     order=desc ──► inversione                                   │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. PAGINAZIONE (dirListing.entriesPerPage, default 100)        │
│     entry visibili > entriesPerPage ?                           │
│     ├─ SÌ ► slice della pagina richiesta (clamp silenzioso),    │
│     │       header X-Dir-Pagination, paginatore                 │
│     │       « First ‹ Prev  0 1 [2] 3 …  Next › Last »          │
│     └─ NO ► pagina unica, nessun paginatore                     │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. GENERAZIONE HTML                                            │
│     tabella con colonne ordinabili Name / Type / Size (↑↓),     │
│     escapeHtml() su ogni valore (protezione XSS),               │
│     CSS inline con hash SHA-256 pre-calcolato                   │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. HEADER DI SICUREZZA (pagine generate dal middleware)        │
│     Content-Security-Policy (style-src 'sha256-...'),           │
│     X-Content-Type-Options, X-Frame-Options,                    │
│     Referrer-Policy, Permissions-Policy                         │
│     ──► ritorna l'HTML ──► EXIT                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. Rendering template — tryRenderTemplate()

```
┌─────────────────────────────────────────────────────────────────┐
│   tryRenderTemplate(ctx, next, filePath, rawBuffer, opts, log)  │
└───────────────────────────────┬─────────────────────────────────┘
                                ▼
              ┌─────────────────────────────────────┐
              │ template.render definito E          │
              │ estensione file ∈ template.ext ?    │
              └──────────────────┬──────────────────┘
                      ┌──────────┴──────────┐
                   NO ▼                     ▼ SÌ
        ┌───────────────────────┐  ┌─────────────────────────────────┐
        │ return false          │  │ HEAD ? ──► mascherato come GET  │
        │ (il chiamante continua│  │ per la durata del render        │
        │  col file statico)    │  │ (RFC 9110 §9.3.2)               │
        └───────────────────────┘  └───────────────┬─────────────────┘
                                                   ▼
                                   ┌─────────────────────────────────┐
                                   │ render(ctx, next, filePath,     │
                                   │        rawBuffer, abortSignal)  │
                                   │ con timeout renderTimeout       │
                                   │ (default 30 s; signal aborta    │
                                   │ anche su disconnessione client) │
                                   └───────────────┬─────────────────┘
                          ┌────────────────────────┼────────────────────────┐
                 SUCCESSO ▼                TIMEOUT ▼                 ERRORE ▼
              ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
              │ per HEAD:          │  │ 504 Gateway        │  │ 500 Internal       │
              │ stripBodyForHead() │  │ Timeout            │  │ Server Error       │
              │ (header intatti,   │  │ (se header già     │  │ (se header già     │
              │  body svuotato)    │  │  inviati: socket   │  │  inviati: socket   │
              │ ──► return true    │  │  distrutto)        │  │  distrutto)        │
              └────────────────────┘  └────────────────────┘  └────────────────────┘
```

---

## Riepilogo

```
 richiesta ──► [metodo] ──► [URL] ──► [prefix] ──► [riservati] ──►
 [decodifica+null byte] ──► [anti-traversal] ──► [hidden dirs] ──►
 [hideExtension] ──► [stat] ──► [hidden entry] ──► [policy symlink] ──►

     ├─ directory ──► [index file ?] ──► loadFile(index)
     │                     └─ no ─────► show_dir() (listing paginato)
     │
     └─ file ──► loadFile()
                    ├─ template ──► render con timeout
                    └─ statico ──► rawFile cache → Range/206 →
                                   compressione (br/gzip + cache LFU) →
                                   ETag/304 → buffer RAM o stream
```

- **11 passi di validazione** prima di toccare il filesystem per la risposta.
- **2 gestori finali**: `loadFile()` (file, template, cache, range, compressione)
  e `show_dir()` (listing con ordinamento, filtri hidden, paginazione).
- Errori del client → `400`; risorsa fuori root / nascosta / symlink bloccato →
  sempre `404` (indistinguibile da "non esiste").
