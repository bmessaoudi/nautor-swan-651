# D. Fauna animata: report

> **4 ottobre 2026:** i delfini sono stati tolti dal progetto (codice, modello e script). Le parti di questo report che li riguardano restano solo come storia.

Branch `worktree-agent-a9708e6d11f5db48c`, nato da `feature/ambiente-realistico` (36a8d18). 4 ottobre 2026.

## Cosa ho fatto

- Nuovo modulo `web/src/fauna.js` con `createFauna(shared)`, che restituisce `group`, `build(cond)` e `update(t, dt, opacity, camera, heading)`.
- **Gabbiani** con scheletro e due animazioni (`Flap`, battito a 2,5 Hz, e `Glide`, planata con piccole correzioni di assetto). Un `AnimationMixer` per uccello, e le due azioni sono mescolate col peso: si passa dal battito alla planata in modo continuo, senza scatti. Le fasi sono sfalsate (tempo iniziale e velocità di riproduzione diversi per ognuno).
  - Gruppo vicino di 3-8 gabbiani attorno all'albero, a quote fra 5 e 24 m, su cerchi di raggio 13-32 m che "respirano". Sbandata da virata coordinata (tan = v²/rg) a 7-10 m/s, beccheggio dalla salita, raffiche di rollio col vento. Battendo salgono, planando scendono piano. La quota resta in una fascia.
  - Il primo del gruppo è "curioso": il suo cerchio sta a metà strada fra l'albero e la camera, poco sopra la camera, e resta comunque ad almeno 11 m dall'albero, quindi fuori dalle vele. Così almeno un gabbiano si vede bene da vicino nelle inquadrature del capitolo.
  - Da 2 a 6 gabbiani lontani (70-220 m), che planano di più e si sciolgono nella foschia.
- **Delfini** (tursiopi), da 2 a 4: saltano in sequenza davanti alla prua ogni 7-16 s, a volte due volte di fila. L'arco è balistico, il corpo segue la tangente e l'animazione `Swim` rallenta fuori dall'acqua. Gli spruzzi all'uscita e al rientro sono `Points` con un piccolo serbatoio. Il gruppo ruota con `heading` (navigazione libera di `sailing.js`), quindi resta davanti alla prua.
- **Condizioni**:
  - con la pioggia, 1-3 gabbiani vicini e nessuno lontano;
  - col vento, planate più lunghe, meno discesa e più raffiche;
  - delfini solo con forza 5 o meno, senza pioggia e nell'80% dei semi, con salti più bassi quando il mare cresce.
  Fauna usa un suo generatore dal seme (`makeRng(seed * 7919 + 17)`), così non sposta le estrazioni di `c.rng` usate dal paesaggio.
- **Luce e dissolvenza**: `MeshStandardMaterial` con colori per vertice, quindi sole, emisfero e `scene.environment` come lo scafo. Con `onBeforeCompile` arrivano la foschia e la prospettiva aerea della chunk `SKY`, con la stessa formula di `landscape.js`, più un filo di luce riflessa dal mare (`uHorizon * 0.14`) perché in controluce le pance non vengano nere. L'opacità segue `shared.uOpacity` (il parametro `opacity` di `update`), e sotto 0,005 il gruppo è nascosto. I gabbiani vicini proiettano ombra.
- **Caricamento asincrono**: `GLTFLoader` con `MeshoptDecoder` (`three/addons/libs/meshopt_decoder.module.js`, nessun file esterno). Finché i modelli non arrivano, la scena va avanti senza fauna.
- **Collegamento** in `main.js` e `bordo/scena.js`, con poche righe in ognuno: creazione, `fauna.build(cond)` in `applyConditions`, `fauna.update(...)` dopo `landscape.update`. I gabbiani di `landscape.js` restano nel codice ma vengono spenti dopo `landscape.build` (`userData.wings` → `visible = false`). Il file `landscape.js` non è toccato: l'integrazione può rimuovere `makeGull` e il suo moto.

## Fonti e licenze dei modelli

**I modelli non vengono da Sketchfab né da Poly Haven.** Li ho generati da script in Blender (`scripts/blender/fauna.py`), come lo scafo, senza generazione AI. Nessuna licenza esterna.

Perché:
- Blender non era aperto. L'ho avviato io e l'add-on MCP è partito da solo, ma **Sketchfab non ha la chiave API** (preferenze e scena vuote) e Poly Haven è disattivato. Poly Haven, comunque, non ha animali.
- Senza chiave, Sketchfab non permette lo scarico, e Firecrawl non scarica file binari.
- Le alternative scaricabili non andavano bene:
  - i gabbiani di Poly Pizza (Google Poly, CC-BY) sono low-poly sfaccettati e senza scheletro;
  - il gabbiano CC0 di Lucas Gogol è su Google Drive e chiede l'accesso;
  - Quaternius (CC0) ha uno stile cartoon.

Come sono fatti:
- **Gabbiano reale**: 0,60 m di lunghezza e 1,40 m di apertura (in scena è scalato 1,1-1,3, cioè 1,55-1,8 m). Corpo a sezioni ellittiche e ali a guscio con profilo curvo e "piega a gabbiano". Colori per vertice: dorso grigio perla, bordo d'uscita bianco, punte nere con specchio bianco, becco giallo con la macchia rossa, occhi. 7 ossa: Root, Wing1/2 L/R, Tail, Head.
- **Tursiope**: 2,5 m, con pinne dorsale, pettorali e caudale. Dorso ardesia, fianchi chiari, ventre bianco. 5 ossa lungo la spina e ondulazione verticale.

Se si vuole un modello d'autore, si inserisce la chiave Sketchfab nel pannello MCP di Blender. Candidati visti:
- "Seagull" di Dayvable, CC-BY, 4,4k triangoli con rig: https://sketchfab.com/3d-models/seagull-dc42ffc81c86480e9e7f7752fa134174
- "Flying Seagull" di The lighthouse keeper, con 3 clip animate: https://sketchfab.com/3d-models/flying-seagull-07dde3ea7d9048588d3c4edfd37ac20d

`fauna.js` cerca le clip per nome (`Flap`, `Glide`, `Swim`): con un altro modello basta rinominarle nell'esportazione.

## File toccati

- `web/src/fauna.js` (nuovo)
- `web/public/models/fauna/gull.glb`, `dolphin.glb` (nuovi)
- `scripts/blender/fauna.py` (nuovo, rigenera i due GLB)
- `web/src/main.js`, `web/src/bordo/scena.js` (collegamento)
- `renders/ambiente/D-*.png`

Per rigenerare i modelli: in Blender via MCP `exec(open(".../scripts/blender/fauna.py").read())` con `FAUNA_REPO` nell'ambiente, oppure `Blender -b --factory-startup --python scripts/blender/fauna.py`. Lo script lavora in una scena pulita e non salva file `.blend`.

## Pesi

| File | Triangoli | Byte |
|---|---|---|
| `gull.glb` | 4.780 facce (circa 9.500 triangoli) | 140 KB |
| `dolphin.glb` | 1.022 facce (circa 2.000 triangoli) | 36 KB |

In tutto **176 KB**, contro un limite di circa 5 MB. Compressione `EXT_meshopt_compression` direttamente dall'esportatore glTF di Blender 5.2. Nessuna texture e nessun UV.

## Fps

Il browser era condiviso con altri tre agenti, ognuno col suo server e la sua scena WebGL attiva, quindi le misure assolute sono rumorose. Ho misurato con un contatore di `requestAnimationFrame` su 3-4 s, alternando nella stessa pagina la fauna nuova con i vecchi gabbiani di codice:

- `/bordo/?passo=13&seed=4821`: prima delle modifiche 48 fps; con la fauna 62-90; senza fauna, alternato, 46-62.
- landing passo 14, seme 4821: fauna nuova 68 / 74 / 49 fps, vecchi gabbiani 65 / 75 / 40 fps.

Non c'è una differenza misurabile. Il costo è di circa 11 mesh con scheletro da circa 9.500 triangoli più l'ombra dei vicini, e i delfini si aggiornano solo durante il salto.

## Screenshot (`renders/ambiente/`)

- `D-prima-bordo-seed4821.png`, `D-prima-landing-passo14-seed4821.png`: con i gabbiani di codice
- `D-dopo-landing-passo14-seed4821.png`: mattino, gabbiano curioso in alto a destra e altri due
- `D-dopo-bordo-seed2-tramonto.png`: gabbiano davanti alla randa, luce calda
- `D-dopo-bordo-seed30-foschia.png`: foschia
- `D-dopo-bordo-seed89-pioggia.png`: pioggia, due soli gabbiani
- `D-dopo-bordo-delfini-seed4821.png`: delfini che saltano davanti alla prua
- `D-dopo-bordo-gabbiano-vicino.png`, `D-dopo-bordo-delfino-vicino.png`: **controlli da vicino**, con un gabbiano e un delfino spostati a mano davanti alla camera dalla console. Non sono inquadrature reali.

La console non mostra errori. Anche la build di produzione (`vite build`) passa.

## Problemi e limiti

- I delfini partono e arrivano a `y = -0,9` sul piano medio dell'acqua, non sull'altezza dell'onda in quel punto (`ocean.js` non la espone). Con mare calmo o medio non si nota. Con il mare FFT (lavoro A) conviene passare a `fauna` una funzione di quota dell'acqua.
- Nelle inquadrature lontane (passo 15, vista dall'alto) i gabbiani restano puntini: è la scala reale.
- In `/bordo/` la camera gira di continuo, quindi i delfini (a 12-20 m dalla prua) non sono sempre in vista.
- Blender resta aperto con la scena dello script, non salvata: l'ho avviato io.

## Note per l'integrazione

- In fase di sviluppo, `window.__fauna` espone gabbiani, delfini e stato del gruppo, per le verifiche dalla console.
- Firma: `fauna.update(t, dt, opacity, camera, heading)`. Nella landing `heading = nav ? nav.heading : 0`. In `/bordo/` la rotta è dritta e `heading` si omette.
- La foschia usa i nomi della chunk `SKY` (`uZenith`, `uHorizon`, `uSunDir`, `uSunCol`, `uFogNear`, `uFogFar`, `uFogHeight`) presi da `ocean.shared`. Se il cielo di B cambia l'interfaccia, va aggiornato solo `faunaMaterial()` in `fauna.js`.
- Per togliere i gabbiani vecchi: rimuovere `makeGull`, l'array `gulls` e il loro ciclo in `landscape.js`, poi le tre righe di `traverse` in `main.js` e `scena.js`. Attenzione: togliere il ciclo dei gabbiani da `build()` cambia le estrazioni di `c.rng` per nuvole e pioggia, cioè l'aspetto di un seme. Se serve la stessa scena, lasciare le chiamate a `rng` come segnaposto.
