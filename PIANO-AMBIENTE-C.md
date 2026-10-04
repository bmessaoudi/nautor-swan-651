# C. Terra realistica: report

Agente C, 4 ottobre 2026. Branch `worktree-agent-a617ea4b0fda87598`, nato da `feature/ambiente-realistico` (36a8d18).

## In breve

Isole e costa alta procedurali sostituite da terreni costruiti su mappe di altezza vere, con texture PBR CC0 mescolate per pendenza e quota, fascia bagnata a pelo d'acqua, chiome della pineta dal modello di superficie e pini in istanza. Nuovo modulo `web/src/terrain.js`, asset in `web/public/terrain/` (1,9 MB), script ripetibile in `scripts/terrain/`. Collegato in `main.js` e `bordo/scena.js`; isole e costa di `landscape.js` spente con un'opzione, il codice resta. Nessun errore in console, costo GPU circa 1,5-2 ms a fotogramma.

## Fonti dei dati

| Zona | Dato | Dove |
|---|---|---|
| Arcipelago | Copernicus DEM GLO-30, tile `N63 E022` (modello di superficie, 30 m) | `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N63_00_E022_00_DEM/...tif` (AWS Open Data) |
| Costa alta | AWS Terrain Tiles, formato Terrarium, z13 (circa 14 m per pixel, dato SRTM) | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` |
| Texture | Poly Haven, CC0: `aerial_rocks_02` (roccia), `aerial_grass_rock` (licheni), `rocky_terrain_02` (suolo e macchia), `coast_sand_01` (battigia) | `dl.polyhaven.org`, 1k |

Le fonti e i formati li ho verificati con Firecrawl (registro AWS Open Data, blog Mapzen per la decodifica Terrarium, API di Poly Haven per i nomi delle texture). I binari li scarica lo script con curl.

## Zone scelte

- **Arcipelago**: mare davanti a Pietarsaari, rettangolo lon 22,30-22,85, lat 63,60-63,85. Le Terrarium qui sono inutilizzabili (metà del rettangolo viene da una fonte che non distingue il mare, più righe spurie), per questo ho usato Copernicus. Ne escono 28 isole intere, da 110 m a 1,6 km.
- **Costa alta**: Sardegna orientale. Isole e scogli attorno a **Tavolara e Molara** (Tavolara 525 m nel dato) e cinque tratti di **falesia del golfo di Orosei** (Cala Gonone, Cala Luna, Goloritzè: 470-620 m). La prima scelta era la costa di Capo Figari e Capo Ceraso, ma è troppo bassa (60-140 m) per una "costa alta"; Orosei ha le pareti giuste. I tratti li sceglie lo script in automatico: finestre di 4,2 km a cavallo della riva con il mare tutto da una parte e i rilievi più alti dietro.

## Cosa ho fatto

### Script `scripts/terrain/build_terrain.py` (Python con uv)

`uv run scripts/terrain/build_terrain.py` dalla radice: scarica (con cache in `scripts/terrain/.cache/`, ignorata da git), ritaglia, ricampiona e scrive tutto in `web/public/terrain/`. `tiles.py` ha la parte Terrarium (coordinate di tile, mosaico, decodifica).

- **Isole**: componenti di terra che non toccano il bordo, ognuna in un quadrato con margine di mare; le vicine tornano mare. Varietà: metà le più grandi, il resto preso a intervalli fra le piccole.
- **Arcipelago, suolo e chiome**: il DSM Copernicus include gli alberi. Sopra 3,5 m la quota viene compressa (roccia), il resto diventa altezza delle chiome. Il campo terra e mare viene sfumato prima del ricampionamento a 6 m, così le rive non seguono i gradini dei pixel da 30 m.
- **Tratti di costa**: finestra ruotata in modo che il mare stia sulla riga 0, cioè verso la barca. Lo script prova i due versi di rotazione e tiene quello giusto. Fianchi e retro scendono in mare con una rampa, così il pezzo sta in piedi da solo.
- **Atlante**: un PNG per zona (`arcipelago.png`, `costa.png`), ritagli impacchettati a scaffali. R e G contengono l'altezza a 16 bit, `(h + 30) * 100`; B contiene l'altezza delle chiome in decimetri. `terrain.json` dice dove sta ogni ritaglio, metri per pixel, quota massima, dimensione e fonti.
- **Texture**: diffuse a 1024 px, normal map (formato GL) a 512 px, in JPEG.

### Modulo `web/src/terrain.js`

`createTerrain(shared, opts)` restituisce `{ group, ready, build(cond), update(t, opacity) }`, con la stessa forma di `landscape`.

- **Caricamento asincrono**: `ready` carica JSON, atlanti (con `createImageBitmap` senza conversione di colore, perché i canali sono numeri) e texture. Se `build()` arriva prima, viene rieseguito a caricamento finito.
- **Geometria**: griglia della mappa di altezza, senza i triangoli tutti sott'acqua. Dove c'è bosco la superficie sale fino alle chiome, con un rumore a gruppi di 7 m: da lontano una pineta è una massa scura e bitorzoluta, non un prato con alberi sopra. La geometria si costruisce una volta per ritaglio e si riusa.
- **LOD semplice**: `THREE.LOD` con piena e mezza risoluzione, cambio a 900 m (`opts.lodDistance`).
- **Shader**: proiezione triplanare per roccia e licheni, a due scale; da lontano domina quella larga, così le pareti alte non mostrano la ripetizione. Strati: roccia (pendenza), licheni, suolo o macchia (bosco o, al sud, versanti non troppo ripidi a chiazze), chiome, battigia. La **fascia bagnata** si alza con `waveScale`; al nord ha anche un filo di alghe scure. Riflesso del sole sul bagnato. Tinte di zona con `uMed`: granito rosato e licheni grigio verdi al nord, calcare chiaro e macchia verde oliva al sud, ciottoli e sabbia sulla battigia mediterranea. Normal map con fusione UDN.
- **Luce coerente con le condizioni**: `uSunDir` e `uSunCol` dalla `shared` di `ocean.js`, ambiente cielo e terra da `cond.ambSky`, `cond.ambGround` e `cond.ambI` (come `landscape.js`). Con la pioggia (`cond.rain`) è tutto più scuro e lucido.
- **Foschia**: chunk `SKY` (`hazeAmount`, `hazeColor`) più la stessa prospettiva aerea di `landscape.js`, ma con distanza 1100 m invece di 750. In più una dissolvenza verso il colore della foschia fra `fog[1]` e il punto di ricomparsa, perché le cime alte escono dalla foschia: senza, una montagna ricomparirebbe di colpo.
- **Dissolvenza**: `shared.uOpacity`, materiali trasparenti come quelli di `landscape.js`; il gruppo si nasconde sotto 0,005.
- **Pini in istanza** (`InstancedMesh`, un colore per istanza): pino silvestre (tronco nudo e chioma a palchi piatti) e abete rosso al nord; pino domestico (a ombrello) e pino d'Aleppo al sud. Al nord vanno soprattutto sul margine del bosco, qualcuno spunta dalla massa delle chiome e qualcuno sta da solo sulla roccia; al sud su versanti dolci. Mai sopra la pendenza limite. Gli scogli bassi del sud restano nudi. `opts.trees` è la manopola di densità.
- **Disposizione dal seme**: generatore proprio (`makeRng` con un seme derivato da `cond.seed`), così la terra non cambia se altri moduli pescano numeri in più. Poisson disk come in `landscape.js`.
  - Arcipelago: 20-30 isole, più fitte vicino alla rotta, grandi poche e lontane, scala 0,8-1,25.
  - Costa alta: tre tratti di falesia affiancati, riva a 850-1150 m, scala 0,42-0,58 (uniforme, le proporzioni restano vere). Spesso Tavolara o Molara dall'altra parte della rotta, più 2-5 scogli.
  - Mare aperto: niente terra.
- **Nessuna isola sopra la barca**: il raggio di ogni pezzo (distanza massima della terra emersa dal centro, scalata) tiene il bordo ad almeno 160 m dalla rotta qualunque sia la rotazione. Per la costa conta la prima riga con terra.
- **Scorrimento**: lungo -X a `cond.flow`, come `landscape.js`. Ogni pezzo ricompare quando è tutto oltre il punto di giro, che si allarga del suo raggio.

### Collegamento

- `main.js` e `bordo/scena.js`: `createLandscape(ocean.shared, { islands: false })`, `createTerrain(ocean.shared)` aggiunto alla scena, `terrain.build(cond)` accanto a `landscape.build(cond)`, `terrain.update(t, s.ocean)` accanto a `landscape.update`.
- `landscape.js`: solo l'opzione `opts.islands === false`, che salta il blocco isole e costa. Il codice delle isole resta. Vele lontane, gabbiani, nuvole e pioggia restano accesi.

## File toccati

- nuovi: `web/src/terrain.js`, `scripts/terrain/build_terrain.py`, `scripts/terrain/tiles.py`, `web/public/terrain/*` (2 atlanti, 8 texture, `terrain.json`), `renders/ambiente/C-*.png`, questo report
- modificati: `web/src/main.js`, `web/src/bordo/scena.js` (4 righe ciascuno), `web/src/landscape.js` (opzione `islands`), `.gitignore` (cache dello script)

## Scelte e motivi

- **Copernicus per la Finlandia, Terrarium per la Sardegna**: dove le Terrarium sono buone (SRTM) sono comode; a 63 gradi nord no. Il DSM di Copernicus vede anche le chiome, e questo è diventato un pregio: è la maschera del bosco.
- **Esagerazione verticale dell'arcipelago** (`ARCHIPELAGO_GAIN = [1.6, 1.7]` in `terrain.js`): gli scogli veri davanti a Pietarsaari sono alti 3-9 m. A 500 m dalla barca, con la foschia dei preset, sparivano. Con suolo × 1,6 e chiome × 1,7 le isole arrivano a 15-25 m, con il profilo vero. La costa sarda non è esagerata, solo scalata in modo uniforme.
- **Costa sempre verso -Z**: le inquadrature dei passi 13, 14, 15 e 17 guardano verso -Z. Con il lato a caso, metà dei semi "costa alta" non mostravano la costa (succedeva con il seme 2). L'isola alta, se c'è, va dalla parte opposta per il passo 16.
- **Chiome come superficie e pochi alberi veri**: migliaia di pini singoli per fare un bosco costavano troppo e da 500 m sembravano lecca lecca in fila. La massa delle chiome nel terreno più circa 150-400 pini per isola sul margine dà la silhouette giusta.
- **Atlante PNG invece di file binari**: compressione gratuita, una richiesta per zona, si apre con qualunque visualizzatore.
- **Niente texture compresse KTX2**: con 1,9 MB in tutto il guadagno non valeva la dipendenza dal transcoder Basis.

## Problemi e limiti

- **Browser condiviso**: le schede degli altri agenti consumano GPU e i fps assoluti oscillano molto. Ho misurato con A/B nella stessa scheda (terra accesa, spenta, accesa) usando `__post.gpuMs`, il tempo GPU misurato da `post.js`.
- **Il seme non dà più le stesse vele e gli stessi gabbiani**: spegnendo le isole, `landscape.js` pesca meno numeri dal generatore delle condizioni, quindi vele lontane, gabbiani e nuvole di un seme sono diversi da prima. Ora, tempo e vento restano uguali.
- **Il gioco di navigazione non sposta la terra lungo la rotta**: come prima, la terra scorre solo lungo -X a `cond.flow`. Se in futuro si vuole la terra coerente con le virate, basta leggere `shared.uOff` invece di `flow * t`.
- I pini sulle creste della costa alta, molto lontani, si vedono ancora come puntini a ombrello.
- Le rampe ai fianchi dei tratti di costa, viste di sbieco, sembrano un promontorio che scende un po' troppo regolare.
- Le isole finlandesi del dato sono a 6 m per pixel ricampionati da 30 m: le rive sono morbide, mancano le scogliere di dettaglio vicino all'acqua (le copre la normal map).

## Pesi

`web/public/terrain/`: 1,9 MB in tutto. `arcipelago.png` 190 kB, `costa.png` 260 kB, le 4 diffuse da 190 a 310 kB, le 4 normal da 70 a 110 kB, `terrain.json` 8 kB. Ben sotto i 15 MB.

## Fps

MacBook con ProMotion, Chrome condiviso con altri 2-4 agenti, finestra 1440 x 900 a dpr 2, qualità adattiva a 1,5.

| Scena | Terra accesa | Terra spenta |
|---|---|---|
| Arcipelago, seme 8, passo 13 (25 isole, 4.754 pini) | 57-58 fps, GPU 12,6-13,3 ms | 59 fps, GPU 11,3 ms |
| Costa alta, seme 9, passo 13 (7 pezzi, 503 pini) | 63-67 fps, GPU 12,7-13,2 ms | 65 fps, GPU 11,1 ms |

Prima del lavoro, con il browser meno carico, la scena del seme 8 girava a 120 fps (limite dello schermo). Il costo della terra è circa 1,5-2 ms di GPU: si resta sopra i 50 fps.

## Screenshot (`renders/ambiente/`)

- prima: `C-prima-arcipelago-mattino-s8.png` (landing, passo 13), `C-prima-costa-tramonto-s2.png` (landing, passo 13), `C-prima-bordo-arcipelago-tramonto-s16.png`
- dopo: `C-dopo-arcipelago-mattino-s8.png`, `C-dopo-arcipelago-tramonto-s16-passo17.png`, `C-dopo-arcipelago-pioggia-s89.png`, `C-dopo-costa-tramonto-s2.png`, `C-dopo-costa-mattino-s9-passo17.png`, `C-dopo-bordo-arcipelago-mattino-s8.png`, `C-dopo-bordo-costa-tramonto-s2.png`

Semi utili: arcipelago 8 (mattino), 16 (tramonto), 89 (pioggia), 30 (foschia); costa alta 9 (mattino), 2 (tramonto), 4 (pioggia); mare aperto 60 (mattino), 17 (tramonto).

## Note per l'integrazione

- **Cielo (B)**: la terra usa solo la chunk `SKY` (`hazeAmount`, `hazeColor`) e `uSunDir` e `uSunCol` della `shared` di `ocean.js`. Se il cielo nuovo espone una foschia diversa, basta sostituire la chunk in `terrainFrag` e `pineFrag` (le ultime righe di ciascuno). La prospettiva aerea in più sta in `DEFINES.AERIAL_DIST`.
- **Mare (A)**: la fascia bagnata segue `cond.waveScale` (`uWave`). Se con la FFT l'altezza delle onde cambia scala, va ritarata la riga `wetTop` in `terrainFrag`.
- **Conflitti attesi su `landscape.js`**: B e D aggiungono probabilmente opzioni simili in `createLandscape(shared, opts)`. Va tenuto un solo oggetto `opts` con tutte le chiavi (`islands`, nuvole, gabbiani).
- **Rimozione**: quando l'integrazione toglie le isole procedurali da `landscape.js`, vanno via `makeIsland`, `makeHeadland`, il blocco isole e costa in `build()` e l'opzione `islands`.
- Per rigenerare gli asset serve solo `uv`; la prima esecuzione scarica circa 16 MB (Copernicus) più una sessantina di tile e le texture.
