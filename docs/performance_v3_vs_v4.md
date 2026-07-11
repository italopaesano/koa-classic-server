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
