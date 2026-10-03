# Piano: ambiente realistico in mare

Aggiornato al 4 ottobre 2026. Branch di lavoro: `feature/ambiente-realistico` (nato da `dev`, poi PR verso `dev`).

## Obiettivo

Portare il capitolo Navigazione (landing, passi 13-17, e la pagina `/bordo/`) dallo stile attuale a un ambiente realistico, con il riferimento visivo di Three.js Water Pro e Sky Pro (threejswaterpro.com, threejsskypro.com). **Non si compra niente e non si copia codice da quei prodotti**: si usano solo risorse gratuite e open source.

Vincoli fissi:

- **Si resta su `WebGLRenderer`**, three.js r186, `postprocessing` 6.39.5 di pmndrs e `n8ao`. Niente WebGPU, niente TSL.
- Demo **a uso interno**, su desktop. Non servono crediti né file di attribuzione. Serve comunque una manopola di qualità per non scendere sotto ~50 fps su un portatile recente.
- Gestore pacchetti: **pnpm** (in `web/`).
- Stile del codice: come quello che c'è. Commenti in italiano, brevi, che spiegano il perché. Mai il trattino lungo (em dash) in commenti, commit o testi.
- Le condizioni (`web/src/conditions.js`: preset alba, mattino, mezzogiorno, pomeriggio, tramonto, foschia, pioggia; costa arcipelago, costa alta, mare aperto; vento in nodi) restano la fonte di verità: ogni nuovo modulo le legge.
- Le due pagine usano gli stessi moduli: `web/src/main.js` (landing) e `web/src/bordo/scena.js` (`/bordo/`). Ogni modifica va collegata in **entrambe**.

## Come si vede la scena in mare

- `cd web && pnpm install && pnpm exec vite --port <porta> --strictPort`
- Landing: `http://localhost:<porta>/` e scorrere fino al capitolo 04 Navigazione (passi 13-17). Il seme fissa le condizioni: `?seed=N`.
- `/bordo/`: `http://localhost:<porta>/bordo/?passo=13` apre direttamente un passo (solo in sviluppo). Anche qui vale `?seed=N`.
- Per le verifiche visive c'è Chrome DevTools via MCP (`mcp__chrome-devtools__*`). **Il browser è condiviso con altri agenti**: apri una tua scheda con `new_page`, e chiama `select_page` sulla tua scheda prima di ogni azione o screenshot.

## Interfacce da non rompere

`createOcean()` in `web/src/ocean.js` restituisce: `mesh`, `sky`, `shared` (uniformi condivise con paesaggio e materiali), `waves`, `linkSeaFx(u)`, `envMap(pmrem)`, `setConditions(c)`, `setCourse(heading, pos)`, `float(t, dt)`, `update(t, opacity, foam, cam)`.

- `float()` dà sollevamento, beccheggio e rollio della barca e **deve corrispondere all'acqua disegnata**: la barca non può galleggiare su onde diverse da quelle che si vedono.
- `setCourse()` arriva dal gioco di navigazione (`sailing.js`): la barca resta all'origine e ruota, l'acqua scorre lungo la prua (`uHeading`, `uOff`). Senza questa chiamata il mare resta fermo.
- `seafx.js` fornisce riflesso planare dello scafo e buffer della schiuma di scia (`uRefl`, `uFoamTex`, `uFoamBox`): vanno mantenuti.
- `shared.uOpacity` fa la dissolvenza fra lo studio (capitoli 1-3) e il mare: tutto il nuovo ambiente deve seguirla.
- La chunk GLSL `SKY` (in `ocean.js`: `skyColor`, `hazeTone`, `hazeColor`, `hazeAmount`) è usata anche da `landscape.js` per la foschia.

## Lavori in parallelo

Ogni lavoro è affidato a un agente diverso, in un suo worktree, partendo da zero. Ognuno lavora sui propri file, collega il risultato in `main.js` e `bordo/scena.js` con modifiche piccole, verifica a schermo, e fa commit sul proprio branch. L'integrazione finale la fa l'orchestratore.

| Lavoro | File propri | Porta dev |
|---|---|---|
| A. Mare FFT | `web/src/ocean.js` (parte acqua e galleggiamento), nuovi `web/src/fft/*` | 5181 |
| B. Cielo e nuvole volumetriche | nuovo `web/src/sky.js`, `web/src/post.js` | 5182 |
| C. Terra realistica | nuovo `web/src/terrain.js`, `web/public/terrain/*` | 5183 |
| D. Fauna animata | nuovo `web/src/fauna.js`, `web/public/models/fauna/*` | 5184 |

### A. Mare FFT

- Sostituire le 4 onde di Gerstner con uno spettro **FFT (Phillips o JONSWAP)** calcolato sulla GPU in WebGL2 con render target ping-pong (niente compute shader). Riferimento: `github.com/jbouny/fft-ocean` e la demo WebGL di David Li (2013).
- Almeno due cascate (onda lunga e dettaglio) per evitare la ripetizione della texture. Spostamento orizzontale (choppy), normali e **Jacobiano per la schiuma** dalle mappe FFT.
- Vento e altezza d'onda dalle condizioni (`knots`, `waveScale`, `crestFoam`, `streaks`).
- Mantenere: griglia radiale fino all'orizzonte, riflesso del sole come disco (`areaSpec`), subsurface sulle creste, schiuma di scia di `seafx.js`, foschia, attenuazione delle onde attorno allo scafo.
- **Galleggiamento**: `float()` deve leggere la stessa acqua. Strade possibili: lettura asincrona (PBO o `readRenderTargetPixels` su una piccola regione) dell'altezza sotto lo scafo, oppure FFT a bassa risoluzione ripetuta sulla CPU con lo stesso spettro e lo stesso seme. Scegliere e motivare.
- Non toccare la parte cielo di `ocean.js` (`skyVert`, `skyFrag`, `envMap`, chunk `SKY`): è del lavoro B.

### B. Cielo e nuvole volumetriche

- Usare `@takram/three-atmosphere` e `@takram/three-clouds` (MIT, `github.com/takram-design-engineering/three-geospatial`), nella versione stabile basata su `postprocessing` di pmndrs e WebGL. **Fissare la versione esatta**: l'autore sta riscrivendo tutto per WebGPU con un'API incompatibile.
- Sono librerie geospaziali (Terra come ellissoide): posizionare la scena locale su una latitudine e longitudine plausibili (per esempio il golfo di Botnia davanti a Pietarsaari, dove nasce lo Swan) e far corrispondere il sole a `cond.sunDir`.
- Prima di tutto uno **spike di fattibilità**: versioni compatibili con three r186 e postprocessing 6.39.5, convivenza con N8AO, profondità di campo e accumulo di `post.js`. Se non è fattibile in tempi ragionevoli, ripiegare su nuvole volumetriche in raymarching scritte da noi (un effetto `postprocessing` con rumore 3D precalcolato) e scriverlo nel report.
- Nuvole diverse per preset (`cond.clouds`, `foschia`, `pioggia`), ombre delle nuvole sul mare se la libreria le dà.
- Il cielo nuovo deve alimentare anche: la mappa d'ambiente per scafo e cromature (oggi `ocean.envMap`), il colore dei riflessi del mare e la foschia. Esporre un'interfaccia chiara in `sky.js` (per esempio `skyColor` e foschia come chunk GLSL, oppure una cubemap aggiornata) che A e C possano usare all'integrazione.
- Lasciare dov'è il codice delle nuvole a billboard di `landscape.js`: basta spegnerle dal collegamento in `main.js` e `scena.js`. La rimozione la fa l'integrazione.

### C. Terra realistica

- Isole e coste da **mappe di altezza reali**: Copernicus DEM GLO-30 oppure le terrain tiles di AWS Open Data (formato Terrarium, PNG). Zone: l'arcipelago davanti a Pietarsaari (Finlandia) per `arcipelago`, una costa alta mediterranea (per esempio Sardegna nord orientale o Costa Brava) per `costa alta`.
- Texture PBR CC0 da **Poly Haven** o **ambientCG**: granito arrotondato e chiaro, licheni, pineta scura, sabbia o roccia bagnata sulla battigia. Mescolarle per pendenza e quota in uno shader, con una fascia scura bagnata a pelo d'acqua.
- Alberi: istanze (`InstancedMesh`) di pini semplici ma credibili, solo dove la pendenza lo permette.
- Mantenere il comportamento attuale: posizioni con campionamento di Poisson dal seme, nessuna isola che passa sopra la barca, scorrimento con `flow` e ricomparsa oltre la foschia, foschia della chunk `SKY`, dissolvenza con `uOpacity`.
- Ottimizzare: mappe piccole (512 px o meno per isola), LOD semplice, texture compresse dove possibile. Pesi totali sotto ~15 MB.
- Le vele lontane di `landscape.js` restano. Lasciare dov'è il codice delle isole attuali: basta spegnerle nel collegamento. La rimozione la fa l'integrazione.
- Per scaricare file binari (tile, texture) va bene `curl` sugli URL diretti: Firecrawl non scarica binari. Per cercare le fonti usare Firecrawl.

### D. Fauna animata

- Sostituire i gabbiani di codice con **modelli GLTF animati** (volo battuto e planata), presi da Sketchfab (licenza CC0 o CC-BY, scaricabili) o da Poly Haven. Si può usare Blender via MCP (`mcp__blender__*`, con Sketchfab e Poly Haven integrati) per pulire, ridurre i poligoni, sistemare le animazioni ed esportare in GLB compresso. **Blender è un'istanza unica condivisa**: lo usa solo questo lavoro.
- Comportamento: stormo di 3-8 gabbiani attorno all'albero come oggi, più qualcuno lontano. Opzionale: **delfini** che saltano ogni tanto vicino alla prua, solo con mare calmo o medio.
- Animazioni con `AnimationMixer`, fasi sfalsate. Illuminazione coerente con la scena (materiali standard, luce del sole e mappa d'ambiente).
- Pesi: sotto ~5 MB in tutto. Caricamento asincrono che non blocca la pagina.
- Lasciare dov'è il codice dei gabbiani di `landscape.js`: basta spegnerli nel collegamento. La rimozione la fa l'integrazione.

## Integrazione (orchestratore, dopo A-D)

1. Unire i quattro branch in `feature/ambiente-realistico`.
2. Collegare il cielo di B a riflessi del mare (A), foschia della terra (C) e mappa d'ambiente.
3. Togliere da `landscape.js` nuvole a billboard, isole procedurali e gabbiani sostituiti.
4. Verifica a schermo di tutti i preset e delle tre coste, in entrambe le pagine, e misura degli fps.
5. Aggiornare `HANDOFF.md`.

## Report di ogni agente

Alla fine ogni agente scrive in `PIANO-AMBIENTE-<lettera>.md` (nel suo worktree, incluso nel commit): cosa ha fatto, file toccati, scelte e motivi, cosa non ha funzionato, fps misurati, screenshot salvati in `renders/ambiente/<lettera>-*.png`, e i punti che l'integrazione deve sapere.
