# Valutazione delle differenze di performance — v3.1.0 vs v4.0.0

Data: 2026-07-11 · Confronto empirico tra i pacchetti pubblicati su npm
`koa-classic-server@3.1.0` e `koa-classic-server@4.0.0`, entrambi in
**configurazione di default** (compressione ON, cache compressa ON, logger
silenziato per non inquinare le misure).

## Metodologia

- **Ambiente**: Node v22.22.2, Linux (container condiviso), Koa 3, richieste su
  loopback. I valori assoluti vanno letti come ordini di grandezza; i **rapporti
  v3/v4** sono il dato significativo.
- **Strumenti**: `autocannon@8` per il regime (32 connessioni × 6 s, 4 × 8–10 s
  per il file grande, dopo warm-up della cache); script `http` dedicati per gli
  scenari a freddo, con CPU letta da `/proc/<pid>/stat`.
- **Fixture**: `small.html` 1 KB · `medium.txt` 100 KB testo · `photo.jpg`
  500 KB random (non comprimibile) · directory con 200 voci · `big.txt` 20 MB di
  testo simil-log con token ad alta entropia (rapporto brotli reale ≈ 3:1 — un
  primo tentativo con testo ripetitivo comprimeva 20 MB in 110 byte e falsava
  tutto a favore della v3).

## 1. Percorsi caldi: nessuna regressione

Regime a cache calda, `Accept-Encoding: gzip, deflate, br` dove indicato:

| Scenario | v3.1.0 req/s | v4.0.0 req/s | Δ |
|---|---:|---:|---|
| `small.html` 1 KB, hit cache br | 2 526 | 2 723 | +8 % |
| `small.html` 1 KB, identity | 2 961 | 2 824 | −5 % |
| `medium.txt` 100 KB, hit cache br | 6 280 | 6 245 | ≈ 0 |
| `photo.jpg` 500 KB, stream non compr. | 111 | 126 | +14 % |
| Listing directory 200 voci | 136 | 149 | +10 % |

Le differenze rientrano nel rumore del container (±10 %): **il lavoro extra
per-richiesta introdotto dalla v4** (parsing dei q-value di `Accept-Encoding`,
flag trailing-slash, try/catch last-resort, `Vary` anticipato) **non è
misurabile** sul percorso caldo. Nessun prezzo pagato sul caso comune.

## 2. File comprimibile > 10 MB: il trade-off strutturale della v4

È l'unica differenza di comportamento con impatto prestazionale grande, in
entrambe le direzioni. Con `compression.maxFileSize` (default 10 MB) la v4
sposta i file comprimibili sopra la soglia dal percorso bufferizzato
(brotli Q11 + cache) allo streaming (brotli Q4, niente cache, RAM limitata).

`GET /big.txt` (20 MB testo reale, `Accept-Encoding: br`):

| Metrica | v3.1.0 | v4.0.0 |
|---|---:|---:|
| **Prima richiesta — TTFB** | **50 579 ms** | **95 ms** |
| Prima richiesta — totale | 50 606 ms | 544 ms |
| Prima richiesta — CPU processo | 50,7 s | 0,6 s |
| Seconda richiesta — totale | 15 ms (hit RAM) | 485 ms (ricompressione) |
| Regime (4 conn) | 9,5 req/s (p99 4 084 ms) | 4,8 req/s (p99 907 ms) |
| Byte trasferiti per risposta | 5,42 MB (Q11) | 6,45 MB (Q4, +19 %) |

Lettura:

- **v3, primo colpo**: il client aspetta **50 secondi** e il processo brucia 50 s
  di CPU per bufferizzare 20 MB e comprimerli a Q11. Con un file da 200 MB il
  costo scala ×10 (e la RAM allocata è l'intero file + il compresso — su file
  molto grandi è il failure mode da cui `maxFileSize` protegge; in v3, se il
  compresso superava la `maxSize` della cache, il loop di eviction svuotava
  anche **tutta** la cache degli altri file, bug corretto in v4).
- **v3, a regime**: una volta pagato il costo, serve dalla RAM ed è ~2× la v4 in
  req/s, con output ~19 % più piccolo (Q11 vs Q4).
- **v4**: latenza piatta e prevedibile (~0,5 s a richiesta), CPU per richiesta
  costante, RAM per richiesta limitata e indipendente dalla dimensione del file
  — ma ricomprime ogni volta e non emette `Content-Length`.

**Raccomandazione operativa**: chi serve pochi file di testo grandi (10–100 MB)
a molti client e preferisce il comportamento v3 può alzare la soglia o
ripristinarla (`compression: { maxFileSize: false }` o un valore più alto),
accettandone i costi di primo colpo e RAM. Il default v4 privilegia la
prevedibilità e la sopravvivenza del processo, coerentemente con la filosofia
"safety net".

## 3. Cache fredda concorrente (thundering herd): la v4 vince nettamente

100 richieste concorrenti su `medium.txt` (100 KB) a cache fredda — lo scenario
deploy/riavvio. In v3 ogni richiesta eseguiva la propria `readFile()` + brotli
Q11; la v4 introduce il single-flight (un solo leader, gli altri attendono la
stessa Promise):

| Metrica | v3.1.0 | v4.0.0 | Rapporto |
|---|---:|---:|---|
| Tempo totale (wall) | 2 575 ms | 252 ms | **~10× più veloce** |
| CPU processo | 9,7 s | 0,3 s | **~32× in meno** |

Il picco di CPU/RAM a freddo della v3 cresceva linearmente con la concorrenza;
in v4 è costante. È il miglioramento di performance più netto della v4 e non ha
alcun costo sul percorso caldo (il single-flight si attiva solo su cache miss).

## 4. Trailing slash: un round-trip in più su `GET /dir`

Differenza semantica con effetto prestazionale lato client:

| Richiesta | v3.1.0 | v4.0.0 |
|---|---|---|
| `GET /dir` (senza slash) | 200, serve subito | **301 → `/dir/`** (+1 round-trip al primo accesso) |
| `GET /file/` (slash spuria) | 200, serve il file | **404** (più economico di servirlo) |

Il redirect costa un RTT aggiuntivo al primo accesso non canonico (i client
tipicamente memorizzano il 301); in cambio le pagine indice servite a `/dir`
non risolvono più i link relativi contro il parent. Correttezza > il RTT.

## 5. Effetti non misurabili in micro-benchmark ma reali in produzione

- **`Vary: Accept-Encoding` completo + ETag corretti sul fallback**: le cache
  condivise (CDN/proxy) non vengono più avvelenate e possono effettivamente
  servire hit — guadagno reale a valle, invisibile su loopback.
- **`If-None-Match` con liste/`*`/tag weak e precedenza validatori su Range**:
  client CDN che prima ricevevano sempre 200 pieni ora ottengono 304 → meno
  banda e meno lavoro.
- **Fix del leak di fd sullo streaming con client disconnessi**
  (`stream.pipeline`): la v3 perdeva un fd per ogni download abbattuto sul
  percorso streaming → degrado progressivo fino a `EMFILE`; la v4 resta stabile
  nel tempo.
- **Costi solo a startup**: copia delle opzioni nella factory, validazioni in
  più — irrilevanti a runtime.

## Conclusione

| Aspetto | Esito |
|---|---|
| Percorso caldo (file piccoli/medi, listing, stream binari) | **Parità** (differenze nel rumore) |
| Cache fredda concorrente | **v4 nettamente migliore** (~10× wall, ~32× CPU) |
| File comprimibili > 10 MB, primo accesso | **v4 ~100× più reattiva** (TTFB 95 ms vs 50,6 s) |
| File comprimibili > 10 MB, a regime | **v3 ~2× più veloce** (cache RAM) e −19 % di banda — ripristinabile in v4 via `maxFileSize` |
| `GET /dir` senza slash | v4 paga 1 RTT di redirect (per correttezza) |
| Stabilità nel tempo (fd leak, LFU flush, herd) | **v4 strutturalmente più robusta** |

In sintesi: **la v4 non è né uniformemente più veloce né più lenta della v3 —
è più prevedibile**. Elimina i tre comportamenti patologici della v3 (50 s di
compressione bloccante sul primo colpo dei file grandi, moltiplicazione
CPU×concorrenza a cache fredda, fd leak sugli abort) al prezzo, configurabile,
del throughput a regime sui file comprimibili sopra i 10 MB e di un redirect
sulle URL di directory non canoniche.

---

# Appendice — proposta "stream + tee in cache" (prototipo validato)

Approfondimento del 2026-07-12 sull'unico margine di miglioramento emerso:
tutti i test in cui la v3 batte la v4 appartengono alla famiglia "file
comprimibile sopra `compression.maxFileSize`", dove la v4 ricomprime in
streaming a ogni richiesta e **butta via l'output**. Il cap della v4 è
sull'*input* (20 MB), ma l'output compresso (~6,5 MB) starebbe comodamente
nella cache compressa da 100 MB.

## Il design

Nel ramo streaming (`index.cjs`, sezione "Streaming mode"), quando
`serverCache.compressedFile.enabled`:

1. **La lookup in cache viene valutata anche sopra il cap** (oggi il gate
   `withinCompressCap` esclude i file grandi dalla cache *in lettura*, non solo
   in scrittura). Hit fresca → risposta bufferizzata dalla RAM, con
   `Content-Length` e stessa logica di staleness (mtime+size+maxAge) del
   percorso bufferizzato.
2. **Su miss, la prima richiesta (leader) fa da "tee"**: un `Transform`
   passthrough inserito nella `pipeline(src, compress, tee, cb)` accumula i
   chunk compressi mentre il client li riceve — zero latenza aggiunta, la
   backpressure resta intatta. Al completamento **pulito** della pipeline
   l'accumulo è inserito in `_compressedFileCache` via `refreshOrInsert`.
3. **Vincoli di RAM invariati**: accumula solo il leader (un `Set` di chiavi
   `path:encoding:mtime:size` in volo, come il single-flight); l'accumulo si
   interrompe (e si scarta) appena supera la `maxSize` della cache — una voce
   che non può mai entrare non alloca mai più del cap; un errore o un abort del
   client (`ERR_STREAM_PREMATURE_CLOSE`) scarta l'accumulo, mai voci troncate.

Filosofia rispettata: nessun cambiamento alla semantica osservabile di
`GET /file` (stessi byte, a parità di negotiation), RAM e CPU restano limitate
— si smette solo di buttare via lavoro già fatto.

## Risultati del prototipo (kcs4 patchato, stessa sessione di misura)

`GET /big.txt` (20 MB, brotli ≈ 3:1, `Accept-Encoding: br`), run a tre vie:

| Metrica | v3.1.0 | v4.0.0 | v4 + tee |
|---|---:|---:|---:|
| 1ª richiesta — TTFB / totale | 35 500 / 35 511 ms | 67 / 380 ms | **66 / 372 ms** |
| 1ª richiesta — CPU | 35,6 s | 0,43 s | **0,41 s** |
| 2ª richiesta — totale | 14,9 ms | 364 ms | **15,5 ms** |
| 3ª richiesta — totale | 10,6 ms | 355 ms | **9,6 ms** |
| Regime (4 conn) | 9,3 req/s · p99 3 586 ms | 6,8 req/s · p99 691 ms | **7,6 req/s · p99 549 ms** |
| Herd: 20 richieste concorrenti a freddo | 181 385 ms · 717 s CPU | 2 101 ms · 7,2 s CPU | 2 358 ms · 7,9 s CPU |
| RSS dopo il regime | 138 MB | 168 MB | **94 MB** |

- Il **32× della v3 sulla 2ª richiesta è recuperato per intero** (15,5 ms vs
  14,9 ms), mantenendo il primo colpo istantaneo della v4.
- Il gap residuo a regime (7,6 vs 9,3 req/s) è **interamente spiegato dalla
  dimensione del payload**: la voce cached è output Q4 (6,45 MB) contro il Q11
  della v3 (5,42 MB) — 9,3 × 5,42/6,45 ≈ 7,8. La coda p99 è però ~6× migliore
  della v3.
- L'herd a freddo della v3 su questo scenario è **catastrofico** (3 minuti di
  wall, 717 s di CPU, 563 MB di RSS per 20 client): la proposta conserva il
  comportamento v4.

Correttezza verificata sul prototipo: byte identici all'originale dopo
decompressione (br e gzip, voci indipendenti), `Content-Length`/ETag coerenti
dalla 2ª risposta, 10 richieste concorrenti a freddo tutte valide con una sola
voce in cache, abort del client a metà download → nessuna voce inserita e
richiesta successiva corretta.

## Risultati finali — implementazione 4.1.0 (2026-07-12)

La proposta è stata implementata in `index.cjs` e rilasciata come **4.1.0**
(vedi `docs/CHANGELOG.md`). Rispetto al prototipo, la code review ha aggiunto
tre irrobustimenti: un **budget aggregato** per gli accumuli in volo (la somma
non può superare la `maxSize` della cache — N file grandi *distinti*
concorrenti non possono più gonfiare la RAM transiente), i **follower senza
stadio tee** (streaming puro via helper condiviso `streamCompressedBody`, che
deduplica anche il ramo cache-disabilitata), e una guardia sul ciclo di vita
della chiave di leader-election.

Benchmark a tre vie sul pacchetto finale (`big.txt` 20 MB, brotli ≈ 3:1):

| Metrica | v3.1.0 | v4.0.0 | **v4.1.0** |
|---|---:|---:|---:|
| Hot path `small.html` (sanity) | 3 030 req/s | 3 019 req/s | 2 992 req/s |
| 1ª richiesta — TTFB / totale | 44 378 / 44 388 ms | 72 / 389 ms | **90 / 460 ms** |
| 1ª richiesta — CPU | 43,8 s | 0,45 s | 0,54 s |
| 2ª / 3ª richiesta — totale | 11,4 / 18,2 ms | 399 / 373 ms | **11,8 / 9,0 ms** |
| Regime (4 conn) | 10,1 req/s | 6,3 req/s | **8,6 req/s** |
| Herd 20 concorrenti a freddo | 221 221 ms · 869 s CPU · 892 MB RSS | 2 942 ms · 10,3 s | 2 855 ms · 9,8 s |
| Richiesta subito dopo l'herd | 13,4 ms | 387,9 ms | **6,7 ms** (cache già calda) |
| RSS dopo il regime | 148 MB | 208 MB | **136 MB** |

Conclusioni: la 4.1.0 **recupera integralmente il vantaggio v3 dalla seconda
richiesta** (l'unico caso in cui la v3 batteva la v4), mantiene primo colpo,
herd e RAM della v4, e a regime arriva all'85 % della v3 — differenza spiegata
per intero dal payload Q4 (+19 % di byte vs Q11). Il residuo teorico (qualità
più alta per il solo passaggio del leader) resta un raffinamento possibile
futuro, non necessario.
