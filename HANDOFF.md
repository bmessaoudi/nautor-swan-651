# Handoff: museo 3D Swan 651

Aggiornato al 3 ottobre 2026. Leggi questo file prima di toccare qualcosa.

## Obiettivo

Demo **a uso interno** di un museo web interattivo dedicato **solo allo Swan 651** (Nautor's Swan, Germán Frers, 1982-1991, 19 esemplari). Riferimento principale: **Lunz am Meer** (scafo 651-007, AUT 2895).

- Non servono consensi, licenze o autorizzazioni: lo ha detto l'utente, non riproporre il tema.
- Il punto critico era il modello 3D, che ora esiste. Il design del sito non è ancora stato discusso.
- Niente generazione AI (fal, Meshy e simili): l'utente ha scelto il metodo a script.

## Stato attuale

Il modello completo esiste ed è generato **interamente da script Python** eseguiti in Blender via MCP.

| File | Contenuto |
|---|---|
| `models/swan651.glb` | Formato per il web: esterni e interni, circa 42.500 triangoli, 1,7 MB |
| `models/swan651.fbx` | Copia per il collega esperto 3D (3ds Max, Maya, C4D, Unity). La mappa di ruvidità dello scafo non passa nell'FBX |
| `models/swan651.blend` | Scena Blender |
| `models/textures/` | Texture generate: vernice dello scafo (colore e ruvidità), teak di coperta, pagliolo teak e holly |
| `renders/v7_*.png` | Ultimi render: `v7_full`, `v7_saloon`, `v7_cutaway` (più `v6_stern` per lo specchio di poppa) |

Ogni oggetto ha un nome chiaro, così sul web si può smontare: Hull, Deck, Coachroof, Cockpit, Keel, Skeg, Rudder, Mast, Boom, Rigging, Mainsail, Headsail, Winches, Wheel, Lifelines, DeckHardware, Toerail, Portlights, e la collezione `Swan651_Interior` (Interior_Sole, Lining, Bulkheads, Furniture, Headliner, MastPost).

Le due vele hanno uno shape key `Luffing` (vela sgonfia), esportato come morph target per animarlo sul web.

## Come rigenerare il modello

Blender 5.2.2 LTS con l'add-on **MCP for Blender** (ahujasid), già registrato in Claude Code come server `blender`. In Blender va avviato il server: tasto N nella vista 3D, scheda MCP, "Start MCP Server".

Gli script vanno eseguiti **in quest'ordine e nello stesso namespace**, perché ognuno riusa le funzioni del precedente:

```python
ns = {}
base = "/Users/bilalmessaoudi/Desktop/coding/nautor-swan/scripts/blender/"
for f in ("swan651_hull.py", "swan651_rig.py", "swan651_interior.py"):
    exec(open(base + f).read(), ns)
```

Tutto in un colpo, anche senza aprire Blender, con `scripts/blender/build_and_export.py`: esegue i tre script, esporta GLB e FBX dalle collezioni `Swan651` e `Swan651_Interior` e salva il .blend.

```
/Applications/Blender.app/Contents/MacOS/Blender -b models/swan651.blend --python scripts/blender/build_and_export.py
cp models/swan651.glb web/public/models/
```

| Script | Cosa fa |
|---|---|
| `scripts/blender/swan651_hull.py` | Scafo parametrico, coperta, tuga, pozzetto, oblò, falchetta, cartello di poppa, chiglia, skeg, timone, tavole di riferimento nascoste (`Ref_Profile`, `Ref_Plan`), controllo idrostatico |
| `scripts/blender/swan651_rig.py` | Albero, boma, sartiame, vele, verricelli, ruota, candelieri e draglie, pulpiti, osteriggi |
| `scripts/blender/swan651_interior.py` | Interni dalla pianta: pagliolo, rivestimento, paratie con porte, arredi adattati allo scafo, cielino, montante d'albero |
| `scripts/measure_drawing.py`, `extract_outlines.py` | Misure e contorni ricavati dalla tavola, salvati in `reference/drawing_outlines_px.json` |
| `scripts/make_transom_sign.py`, `make_wood_textures.py` | Generano le texture con PIL |

## Decisioni geometriche (non rimetterle in discussione senza motivo)

1. **La tavola** `reference/swan651-002-profile-layout.jpeg` è di **Adrienne II (651-002), versione allungata a circa 21 m**.
   - Si scala su `DRAWING_LOA = 21.0`: con questa scala tornano baglio 5,31, pescaggio 3,23, slancio di prua 1,63 e galleggiamento circa 16,8.
   - Poi si tolgono 1,02 m di poppa (`STERN_CUT`), per arrivare alla lunghezza standard di 19,98 m.
2. **Poppa regolare come Lunz, non allungata** (richiesta esplicita dell'utente).
   - Il 651 standard ha lo **specchio di poppa rovescio**: lo spigolo basso è l'estremo poppiero, a 0,60 m sull'acqua (`Z_KNUCKLE`), e la coperta finisce 0,89 m più a prua (`TRANSOM_DECK_X`).
   - Fonti: il piano velico del cantiere e la foto di profilo di Second Wind.
3. **Le sezioni dello scafo sono stimate** (non esistono linee d'acqua).
   - Sono superellissi con esponenti `N_BOW, N_MID, N_AFT = 1.45, 2.1, 2.5`, tarati sul dislocamento IRC.
   - Dislocamento risultante circa 36,4 t, contro 36,58 t misurate IRC.
4. **Armo dal certificato IRC** di Lunz (`reference/irc-certificate-lunz-am-meer-AUT2895.pdf`, dati in `reference/swan651-data.json`).
   - J 8,05, P 24,00, E 7,04, HLU 26,56, HLP 7,81, 3 coppie di crocette.
   - Il valore I (circa 25,3 m) è stimato.
   - Albero a 11,7 m dallo specchio.
5. **Pozzetto e coperta dalla pianta di coperta del cantiere** (`reference/photos_web/drawings/`).
   - Il pozzetto va da 1,15 a 8,1 m, con una piattaforma di timoneria a poppa (fino a 4,4 m) sopra la cabina armatoriale.
   - La tuga è larga circa il 52% della coperta, con 3 coppie di verricelli.
   - Timone e skeg sono spostati di 0,3 m verso prua rispetto alla tavola (`RUDDER_SHIFT`).
6. **Topologia** (il collega 3D ha chiesto attenzione ai triangoli).
   - Le superfici curve sono **solo quadrilateri**.
   - Le fasce di colore dello scafo stanno in una **texture UV**, non in tagli della mesh: u è la distanza dalla linea di coperta, v è la quota.
   - La coperta ha la griglia allineata ai bordi di pozzetto e tuga.
   - Le facce piane con più di 4 lati vengono triangolate con BEAUTY (`triangulate_ngons`).
   - Il modello non ha nessuna faccia con più di 4 lati.
7. **Colori di Lunz am Meer.**
   - Scafo bianco, carena rossa, filetto rosso sopra il galleggiamento e sotto la coperta.
   - Fianchi della tuga bianchi con fascia rossa bassa.
   - Falchetta in alluminio, coperta in teak.
   - Nessun cartello sullo specchio (tolto il 3 ottobre 2026): il museo resta generico sul 651, senza nominare Lunz am Meer né nei testi né nel modello. `make_transom_sign.py` e la texture `lunz_transom_sign.png` non sono più usati.
   - Vele in laminato grigio.
8. **Interni.**
   - Disposizione dalla pianta di Adrienne II (spostata di `STERN_CUT`).
   - Materiali dalle foto degli scafi standard: teak miele satinato, pagliolo teak e holly, cielino bianco con listelli.
   - **Pelle rossa** sui divani (scelta dell'utente).

## Riferimenti

- `RICERCA.md`: ricerca iniziale su brand, pipeline 3D, librerie web (three.js, R3F, GSAP, anime.js) e siti di ispirazione.
- `reference/photos/`: 132 foto dei vari 651, dalla libreria dell'utente.
- `reference/photos_web/`: 233 immagini dal web. Le cartelle `interior/`, `deck/`, `exterior/` e `drawings/` hanno ciascuna un manifest JSON con la fonte di ogni file.
  - Interni degli scafi standard: Show Me, Aurora, 651-001.
  - Disegni: piano velico, pianta di coperta, piante interni.
  - Nessuna foto di uno Swan 651 a terra è disponibile online (esistono solo su Facebook e Instagram).
- Libreria dell'utente: `~/Desktop/coding/nautor-swan-library`. È un sito Next.js "WikiSwan" con 20 scafi 651 documentati (storie, timeline, palmarès). Utile per i contenuti del museo.

## Bozza web (3 ottobre 2026)

Cartella `web/`: Vite 8, three.js r186, Lenis, d3-geo e d3-shape. Avvio con `pnpm run dev` dentro `web/` (porta 5173). `?step=N` apre direttamente un passo.

- Pagina unica a scroll: 18 passi da 100vh, ognuno con un fotogramma chiave in `web/src/story.js` (camera, taglio, vele, mare, sfondo). `main.js` interpola fra i fotogrammi con la camera che orbita in coordinate sferiche.
- Capitoli: 01 Blueprint (passi 1-3), 02 Esterni (4-8), 03 Interni (9-12), 04 Navigazione (13-17).
- Blueprint: linee `EdgesGeometry` su fondo blu con griglia. Lo scafo ha soglia 3° e mostra il reticolo come un piano di costruzione. Al passo 4 un piano di taglio sostituisce le linee con il solido, da prua a poppa.
- Interni: piano di taglio orizzontale (`cut`) a 0,95 m. Punti caldi calcolati dalle coordinate della pianta: X = (px - 444) * SP - 11,005, Z = (py - 2292) * SP.
- Vele: il morph `Luffing` sbatte quando `luff > 0`; dissolvenza (`sails`) nella vista della coperta.
- Mare: shader Gerstner in `web/src/ocean.js`, sbandata 16° e moto ondoso.
- Luci: nello studio sole con ombre VSM, pavimento che raccoglie l'ombra e controluce freddo; in mare sole caldo (`SUN_DIR` in `ocean.js`), cupola del cielo e mappa d'ambiente generata dal cielo.
- Mare: onde di Gerstner, increspature a rumore, riflesso del cielo con Fresnel, luce nelle creste, schiuma, onda di prua e scia.
- Testi verificati il 3 ottobre 2026: 4 cabine ospiti, 3 bagni e 2 di equipaggio (Second Wind, Show Me); autonomia ~700 mn a 7-8 kn (Fraser, Second Wind); polare dal certificato ORC di Lunz am Meer (bolina ricavata dal VMG a 42°); Ocean Globe Race 2023 e Whitbread 1985-86 di Spirit of Helsinki. I verricelli elettrici sono di Lunz, in origine erano manuali.

## Fotografia, post-processing e paesaggio (3 ottobre 2026)

- **Post-processing** in `web/src/post.js` con `postprocessing` 6.39.5 (pmndrs) e `n8ao` 2.0.1, su WebGL. Il passaggio a WebGPU e `RenderPipeline` richiederebbe di riscrivere in TSL il mare e le linee della tavola.
- Ordine dei passaggi: scena, occlusione N8AO, profondità di campo, tilt-shift, bloom e look, accumulo, aberrazione cromatica, SMAA con vignettatura e grana.
- **Tone mapping Khronos PBR Neutral** dentro il look, al posto di ACES, che spingeva i rossi verso l'arancio. Il renderer ha `NoToneMapping` e niente antialias: se ne occupa il composer.
- **Grading per capitolo** (`GRADES` in `post.js`: blueprint, studio, interior, sea). È parametrico (slope, offset, power, saturazione, ombre e luci), non una LUT, così si interpola fra i passi. Ogni preset ha la sua esposizione, e lo sfondo la compensa per mantenere i colori grafici.
- **Fotogrammi chiave** (`story.js`), campi nuovi:
  - `bokeh`: forza della sfocatura;
  - `range`: metri di nitidezza attorno al fuoco;
  - `focus`: punto a fuoco in coordinate della barca, valido solo per quel passo;
  - `tilt`: effetto modellino, nei passi 6 e 10;
  - `grade`: grading del capitolo.
- **Accumulo a camera ferma**: dopo 12 fotogrammi immobili la camera oscilla di una frazione di pixel (Halton) e i fotogrammi si mediano. Dopo 48 la pagina smette di disegnare. Non si attiva in mare né con le vele che sbattono.
- **Qualità adattiva**: sopra 19 ms per fotogramma il pixel ratio scende (2, 1,5, 1,25, 1). Su 1440×900 a 2x si stabilizza a 1,5x e 59 fps.
- **Sfondo nel canvas**: gradiente e reticolo della tavola sono uno shader (`backdrop` in `main.js`). Gli elementi `#bg` e `#grid` non esistono più.
- **Condizioni con seme** (`web/src/conditions.js`, `?seed=N`): 6 preset di ora del giorno (alba, mattino, mezzogiorno, pomeriggio, tramonto, foschia), vento 6-24 nodi e costa (arcipelago, costa alta, mare aperto).
  - Il vento scala onde, sbandata, moto, velocità dell'acqua e schiuma.
  - Il pulsante "Cambia" in alto a destra, visibile solo in Navigazione, estrae un nuovo seme e aggiorna l'URL.
- **Paesaggio** (`web/src/landscape.js`): scogli di granito con pinete, promontori, vele lontane, gabbiani e nuvole a billboard.
  - Disposizione con Poisson disk.
  - Isole e barche scorrono con l'acqua e ricompaiono oltre la foschia piena.
  - Foschia condivisa con il mare (`hazeColor` e `hazeAmount` nel chunk `SKY` di `ocean.js`).
- In sviluppo `window.__post` espone il post-processing (accumulo, qualità).

## Ispirazione dai videogiochi (3 ottobre 2026)

Fonti: talk tecnico di Sea of Thieves (SIGGRAPH 2018), slide di Black Flag (GDC 2014, Wronski), FXGuide sull'oceano di AC3, analisi di Crimson Desert.

- **Riflesso planare della barca** (`web/src/seafx.js`): camera specchiata, solo il layer `BOAT_LAYER` (scafo, alberatura, cime, bandiera; non gli interni), a un terzo della risoluzione. Il mare lo legge in coordinate di schermo, deformato dalle onde.
- **Schiuma alla Sea of Thieves**: ogni fotogramma si disegna dall'alto l'impronta dello scafo tagliato a 0,12 m sull'acqua. Il bordo diventa schiuma in un buffer che si sfoca e scorre verso poppa con l'acqua (dominio `FOAM_BOX`, 72 x 36 m). Ne escono onda di prua e scia. Nel mare il buffer fa da soglia su una trama a merletto.
- **Mare** (`ocean.js`):
  - griglia polare (fitta vicino alla barca);
  - maschera delle creste dallo jacobiano di Gerstner, per il turchese in controluce;
  - sole come disco (Karis), più largo quando è basso;
  - schiuma a tre scale con rampa (come AC3);
  - schiuma sulle creste e strisce lungo il vento secondo la scala Beaufort (`beaufort()` in `conditions.js`).
- **Materiali** (`web/src/materials.js`): texture in triplanare nello spazio della barca, perché scafo, coperta e alberatura non hanno UV.
  - Teak, pelle e maglina di cotone sono texture CC0 di Poly Haven in `web/public/textures/`, normalizzate sulla loro media (convertita in lineare), così i colori di Lunz am Meer restano quelli scelti.
  - Il resto è procedurale: buccia d'arancia del gelcoat, fibre a ventaglio e cuciture delle vele, antivegetativa a chiazze, alluminio spazzolato.
  - Le facce interne dello scafo hanno il colore del rivestimento.
- **Bagnato solo dove arriva l'acqua** (idea di Crimson Desert): fascia sopra il galleggiamento che segue le onde, con colature e spruzzi a prua, e coperta umida a prua. Con la pioggia è bagnato tutto.
- **Vita a bordo** (`web/src/rigging.js`): scotte di fiocco e randa con la catenaria vera (come le cime di Sea of Thieves), bandiera austriaca di poppa in shader, balumina delle vele che vibra con il vento (attributo `aLeech`).
- **Atmosfera**:
  - foschia a due colori (verso il sole e opposta, come in Black Flag), più densa vicino all'acqua (`uFogHeight`);
  - prospettiva aerea sulle coste;
  - nuvole a volume con normali disturbate e bordo d'argento;
  - nuovo preset "pioggia", con gocce attorno alla camera.
- **Prestazioni**:
  - la qualità adattiva misura il tempo GPU con `EXT_disjoint_timer_query_webgl2` (soglia 15 ms), perché il browser in risparmio energetico limita la pagina a 30 fps anche con la GPU scarica;
  - gli interni sono nascosti quando lo scafo è chiuso;
  - l'occlusione è spenta in mare e a metà risoluzione mentre la camera si muove.
- **Semi di esempio** (dopo l'aggiunta della pioggia): `2` tramonto con costa alta e forza 6, `30` foschia con arcipelago, `89` pioggia con forza 5, `4821` mattino con arcipelago.
- **Non fatto**: il bake dell'occlusione in Blender, perché Blender non era aperto. Per ora la copre N8AO.

## Problemi aperti

- Firecrawl: piano aggiornato dall'utente il 3 ottobre 2026, di nuovo funzionante.
- **Interni, prima rifinitura fatta** (3 ottobre 2026): cuscini e materassi arrotondati, schienali a moduli, porte con angoli ad arco, librerie con libri, fuochi, lavelli, rubinetto e ante in cucina, strumenti al carteggio, cornici degli oblò (`Interior_Trim`). Restano semplici bagni, cabine prodiere e trapuntatura dei cuscini.
- **Avviso innocuo dell'export glTF** ("more than one tex image" sul materiale Hull_Paint): il risultato è corretto.
- La chiglia segue la tavola, cioè la pinna con scarpa in piombo del "651 Mod". Il piano velico standard mostra una pinna trapezoidale senza bulbo. Si è scelto Lunz.

## Prossimi passi proposti

L'utente deve scegliere quale fare per primo:

1. **Rifinire gli interni** con i dettagli delle foto (elenco sopra).
2. **Prima scena web**: Next.js con React Three Fiber e GSAP, oppure anime.js v4. Idee concordate nella ricerca:
   - la tavola tecnica che diventa barca allo scorrimento;
   - la coperta che si toglie con un piano di taglio per mostrare gli interni;
   - l'esploso dei componenti con schede al passaggio del mouse;
   - le vele che si gonfiano grazie al morph `Luffing`.
3. Ottimizzazione del GLB per il web: `gltf-transform optimize --compress meshopt --texture-compress ktx2`.

## Preferenze dell'utente

- Risposte in italiano, **mai il carattere em dash** (vedi `~/.claude/CLAUDE.md`).
- pnpm 11 come gestore pacchetti.
- Firecrawl per qualunque accesso web. curl è ammesso solo per scaricare file binari trovati tramite Firecrawl.
- Mostrare i progressi con render o screenshot di Blender. L'utente guarda il modello anche direttamente in Blender: lasciare la vista in modalità Rendered con la barca inquadrata.
