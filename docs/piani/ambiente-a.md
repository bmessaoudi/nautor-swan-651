# Report A: mare FFT

Aggiornato al 4 ottobre 2026. Branch `worktree-agent-a280cef872411d02e`, nato da `feature/ambiente-realistico` (36a8d18).

## Cosa ho fatto

Le 4 onde di Gerstner di `ocean.js` sono sostituite da un oceano FFT calcolato sulla GPU in WebGL2, con render target in ping-pong e nessun compute shader.

- **Spettro**: JONSWAP limitato dal fetch (Hasselmann 1973), con un tetto allo stato pienamente sviluppato di Pierson-Moskowitz e una distribuzione per direzione a coseno quadro più un 12% in tutte le direzioni (mare incrociato). Lo spettro iniziale h0 si calcola sulla CPU a ogni `setConditions`, con il seme delle condizioni: lo stesso `?seed=N` dà lo stesso mare.
- **Tre cascate** (233 m, 41 m, 9,7 m di lato, non multipli fra loro), ognuna con la sua banda di numeri d'onda, impilate in un'unica texture N × 3N. Così una sola serie di passi FFT le trasforma tutte e tre.
- **FFT inversa** Stockham a radice 2: 8 passi orizzontali e 8 verticali per N = 256. Due segnali reali per numero complesso: (h + i·Dx) e Dz.
- **Mappe per cascata**, a mezza precisione con mipmap e ripetizione: spostamento (Dx, h, Dz) già moltiplicato per la ripidità (choppy), e pendenze, Jacobiano e schiuma per differenze finite. La schiuma nasce dove il Jacobiano scende sotto una soglia e si spegne in circa due secondi (ping-pong), così dietro un frangente resta la traccia.
- **Condizioni**: i nodi danno energia e lunghezza delle onde (vento dello spettro), la costa il fetch (arcipelago 25 km, costa alta 60 km, mare aperto 120 km), `waveScale` la ripidità delle creste (choppy 0,9-1,28), `crestFoam` la soglia della schiuma (niente fino a forza 3), `streaks` le strisce come prima. Altezze significative risultanti: circa 0,5 m a 8 nodi, 1 m a 12 nodi in costa, 1,5-2 m a 18-24 nodi, fino a 3 m a 24 nodi in mare aperto.
- **Mantenuto**: griglia radiale fino all'orizzonte, riflesso del sole come disco (`areaSpec`), subsurface sulle creste (ora dalla maschera del Jacobiano FFT), riflesso planare e schiuma di scia di `seafx.js`, foschia, dissolvenza con `uOpacity`, attenuazione delle onde attorno allo scafo e in lontananza. Le increspature a rumore del fragment shader sono sparite: le fa la terza cascata.
- **Parte cielo intatta**: chunk `SKY`, `skyVert`, `skyFrag`, `envMap` sono identici (verificato con diff).

## Galleggiamento: lettura asincrona dalla GPU

`float()` legge l'altezza dell'acqua dalla GPU. Ogni fotogramma, dopo la FFT, un passo minuscolo (16 × 1 pixel) calcola l'altezza nei 15 punti dello scafo con la **stessa funzione GLSL del vertex shader** (`waterOffset` in `WATER_GLSL`), compresa la ricerca del punto di partenza (lo spostamento orizzontale) e l'attenuazione attorno allo scafo. Il risultato torna con `readRenderTargetPixelsAsync` (PBO e fence di WebGL2), senza fermare la GPU. Poi il piano ai minimi quadrati e l'inerzia sono quelli di prima.

Perché questa strada e non una FFT sulla CPU:
- la barca galleggia esattamente sull'acqua disegnata, cascate fini comprese, e su qualunque cambio futuro allo shader senza doppioni da tenere allineati;
- costa una lettura di 256 byte per fotogramma; una FFT 64 × 64 ripetuta in JavaScript avrebbe dato solo un'approssimazione (le alte frequenze tagliate) e qualche millisecondo di CPU;
- il ritardo è di uno o due fotogrammi (16-33 ms), molto meno del filo d'inerzia che `float()` aggiunge comunque (0,2 s per il sollevamento, 0,5 s per beccheggio e rollio). Nella virata del gioco la barca resta coerente con l'acqua: i punti dello scafo si ricalcolano con la rotta di ogni fotogramma.

## File toccati

- `web/src/fft/spectrum.js` (nuovo): JONSWAP, spreading, h0 con il seme.
- `web/src/fft/simulation.js` (nuovo): passi GPU (spettro al tempo t, FFT, mappe), campionamento asincrono per il galleggiamento, `debug()` per la console.
- `web/src/ocean.js`: parte acqua riscritta, `WATER_GLSL` esportato, `createOcean(renderer)`.
- `web/src/main.js`, `web/src/bordo/scena.js`: `createOcean(renderer)` (una riga ciascuno). In `main.js` anche `__ocean` fra gli oggetti esposti in sviluppo.
- `web/src/materials.js`: la fascia bagnata dello scafo usa `WATER_GLSL` e le uniformi di `ocean.waves` al posto delle onde di Gerstner rifatte. Non era nella lista dei miei file, ma senza questa modifica la fascia avrebbe seguito onde che non esistono più. In più ora segue anche la rotta del gioco (`uOff`), cosa che prima non faceva.

## Interfacce

Tutte quelle del piano restano: `mesh`, `sky`, `shared`, `waves`, `linkSeaFx(u)`, `envMap(pmrem)`, `setConditions(c)`, `setCourse(heading, pos)`, `float(t, dt)`, `update(t, opacity, foam, cam)`. Cambiano:
- `createOcean(renderer)` vuole il renderer (serve per la FFT).
- `waves` non è più l'uniforme `uWaves` ma un oggetto di uniformi (mappe di spostamento, lati delle cascate, `uOff`, `uHeading`) da usare con `WATER_GLSL`, che dà `waterHeight(xz)`, `waterOffset(xz, passo)` e `waterFade(xz)`.
- In più: `fft` (la simulazione) e l'export `WATER_GLSL`.
- `update()` ora esegue la FFT e il campionamento: va chiamato prima del rendering, come già avviene. Con il mare invisibile (`opacity` vicina a 0, capitoli 1-3) la FFT non gira.

## Qualità e prestazioni

- Manopola: `?fft=128` (o 64, 256, 512) nell'URL; base 256. Sul Mac di sviluppo il costo GPU della FFT è circa 1,4 ms a 256 e quasi uguale a 128: pesa il numero di passi (25 disegni a schermo pieno su texture piccole), non la risoluzione.
- Misure fatte con il browser condiviso con altri tre agenti che disegnavano scene pesanti in contemporanea, quindi gli fps assoluti oscillano molto. Confronto A/B nello stesso momento, landing, passo 13, `?seed=4821`, alternando il codice vecchio e il nuovo:

| | fps (5 finestre da 120 fotogrammi) | GPU del fotogramma, mediana (timer query di post.js) | FFT |
|---|---|---|---|
| Prima (Gerstner) | 43-48 | 10,8-11,2 ms | |
| Dopo (FFT 256) | 37-58 | 10,8-11,2 ms | +1,4 ms GPU |

  Il fotogramma principale costa uguale (il fragment shader legge tre texture invece di calcolare il rumore delle increspature), in più c'è la FFT. A browser libero, prima del lavoro degli altri agenti, la stessa scena andava a 98 fps (limite dello schermo) con 9,9 ms di GPU: c'è margine per restare sopra i 50. `/bordo/?passo=13&seed=89` dopo: 46-59 fps con il browser carico.
- Nessun errore di shader in console, né nella landing né in `/bordo/`.

## Screenshot (`renders/ambiente/`)

- Prima: `A-prima-mattino-landing.png` (passo 14), `A-prima-tramonto-landing.png`, `A-prima-pioggia-bordo.png`.
- Dopo: `A-dopo-mattino-landing.png`, `A-dopo-tramonto-landing.png` (forza 6, creste con schiuma), `A-dopo-pioggia-bordo.png`, `A-dopo-virata-gioco.png` (navigazione libera mentre la barca vira).

## Cosa non ha funzionato o resta aperto

- La prima taratura della schiuma era sbagliata in tutte e due le direzioni: con le soglie "fisiche" (Jacobiano sotto 0) non frangeva niente, perché le cascate prese da sole raramente si ripiegano. Ora la soglia è tarata sui quantili misurati del Jacobiano (circa l'1% della superficie a forza 6) e la schiuma usa una trama a merletto come la scia, altrimenti a un texel per metro sembrava a macchie lisce.
- La prima normalizzazione dello spettro dava onde alte il doppio del dovuto (la varianza contava due volte h0); corretta e verificata calcolando l'altezza significativa.
- `uOff` cresce senza limite con il tempo: dopo ore la precisione di `vFlow / L` in float32 cala (già vero anche prima con il rumore). Si può risolvere passando uno scarto per cascata ridotto modulo L sulla CPU.
- Con N = 256 la cascata lunga ha 0,9 m per texel: da molto vicino le creste maggiori sono un po' morbide, il dettaglio lo danno le altre due cascate.

## Note per l'integrazione

- **Cielo (B)**: il mare legge ancora `skyColor()` della chunk `SKY` per il riflesso. Se B espone una cubemap o una nuova funzione, basta sostituire la riga `vec3 refl = skyColor(r);` nel fragment shader del mare.
- **Terra (C)**: le isole non toccano l'acqua FFT; la foschia resta la chunk `SKY`. Se servisse la battigia che segue le onde, `WATER_GLSL` e `ocean.waves` danno l'altezza dell'acqua in qualunque shader.
- **materials.js** è cambiato (vedi sopra): in caso di conflitti tenere la versione con `WATER_GLSL`.
- Il collegamento in `main.js` e `scena.js` è solo `createOcean(renderer)`.
- `post.js` misura il tempo GPU fra `beginFrame` ed `endFrame`; la FFT gira prima (in `ocean.update`) e non entra nella misura della qualità adattiva. Se serve, si può spostare `beginFrame` prima di `ocean.update` o legare `?fft` al livello di qualità.
