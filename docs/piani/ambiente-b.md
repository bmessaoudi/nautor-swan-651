# B. Cielo e nuvole volumetriche: report

Agente B, 4 ottobre 2026. Branch `worktree-agent-ae926855a9079966b` (da `feature/ambiente-realistico`), porta dev 5182.

## Esito dello spike

**Fattibile, si usano le librerie takram.** Nessun ripiego sul raymarching scritto da noi.

- Versioni fissate in `web/package.json`: `@takram/three-atmosphere` **0.19.1**, `@takram/three-clouds` **0.7.6**, `@takram/three-geospatial` **0.9.1** (le ultime stabili GLSL/WebGL; la riscrittura WebGPU/TSL non è in questi pacchetti). Le peer dipendenze React/R3F sono facoltative: si usano le classi three.js pure.
- **three r186 e postprocessing 6.39.5**: nessun errore di compilazione né in console, in landing e in `/bordo/`.
- **N8AO**: convive. Le nuvole stanno dopo l'occlusione nel composer; in mare N8AO è comunque spento (`ao.enabled` richiede `s.ocean < 0.5`).
- **Profondità di campo**: le nuvole vengono prima della DoF, quindi si sfocano come il resto dello sfondo. Nessun conflitto sul depth buffer (stesso depth texture del RenderPass).
- **Accumulo**: in mare l'accumulo non parte mai (la scena è sempre "dinamica"), e nello studio il passaggio delle nuvole è spento. Il jitter di `post.jitter()` quindi non incontra mai l'upscaling temporale delle nuvole.
- Due cose non andavano "di serie" e sono state aggirate:
  1. `PrecomputedTexturesGenerator` avanza con `requestIdleCallback`: con la scena che disegna di continuo ci metteva **~19 s**. Si caricano invece le tabelle precalcolate EXR della libreria (`web/public/sky/atmosphere/`, 3,9 MB, senza la tabella dello scattering di ordine superiore).
  2. Le texture di default delle nuvole e il rumore blu STBN vengono scaricati da GitHub: sono copiati in `web/public/sky/` (STBN scaricato una volta da media.githubusercontent.com con lo stesso commit fissato nel pacchetto). Totale `public/sky`: 7,7 MB.

## Cosa ho fatto

- Nuovo modulo `web/src/sky.js` con `createSky(renderer, camera, shared, { quality })`.
  - **Globo**: scena locale appoggiata su Pietarsaari (63,70 N, 22,62 E, livello del mare), frame nord/su/est (`Ellipsoid.WGS84.getNorthUpEastFrame`). X della scena = nord, Y = su, Z = est.
  - **Sole**: da `cond.sunDir` (ruotato in ECEF), non da una data: ogni preset resta com'è.
  - **Cielo nella scena**: `SkyMaterial` su un quad a schermo intero (`sky.mesh`, al posto di `ocean.sky`), con tre aggiunte al fragment: disco del sole delle condizioni (`uSunCol`, `uSunDisk`), fascia di foschia sull'orizzonte con `hazeTone()` della chunk `SKY` (come il cielo di prima) e alfa = `shared.uOpacity` per la dissolvenza. Un ginocchio morbido sulla luminanza tiene il cielo basso sotto ~1,2.
  - **Nuvole**: `CloudsEffect` + `AerialPerspectiveEffect` (solo composizione) in **un unico EffectPass** inserito in `post.js` dopo N8AO. Copertura da `cond.clouds` (sparse fino a 0,7, poi coltre fino a 0,82), strati più bassi e densi con la pioggia, cirri più radi col coperto, foschia volumetrica più densa con foschia e pioggia, deriva col vento (`cond.knots`).
  - **Esposizione**: la libreria lavora in luminanza relativa (cielo azzurro ~0,05). Un solo guadagno per condizione scala cielo, nuvole e composizione insieme (sono gli stessi `Vector3` di `AtmosphereParameters.DEFAULT`): l'orizzonte fisico medio prende la luminanza di `cond.horizon`, su cui sono tarate luci ed esposizione. Più un bilanciamento del bianco "luce diurna" (le nuvole lontane venivano rosa lilla).
  - **Cielo coperto** (foschia, pioggia): la luce diffusa dell'aria e il sole sopra la coltre vengono portati verso la tinta di `cond.horizon` a luminanza invariata. Senza, la coltre era azzurra o malva.
  - **Colori della chunk SKY**: dopo ogni `setConditions` il cielo viene reso in una cubemap 64 px, letta in 16 direzioni; `shared.uHorizon` e `shared.uZenith` prendono i colori del cielo fisico (verso quelli delle condizioni quando è coperto). Mare, isole e foschia esistenti si chiudono così sull'orizzonte vero senza toccare `ocean.js`.
  - **Mappa d'ambiente**: `sky.envMap(pmrem)` sostituisce `ocean.envMap(pmrem)`: cielo fisico + velo grigio delle nuvole in proporzione alla copertura + mare scuro sotto l'orizzonte.
  - **Qualità**: `?cielo=alta|media|bassa|spenta` (predefinita `media`), più un gradino automatico: la qualità adattiva di `post.js` prima scende di un livello nelle nuvole (mai fino a "spenta") e solo dopo abbassa la risoluzione.
- Collegamento in `main.js` e `bordo/scena.js`: `createOcean()` spostato prima di `createPost()` (il post riceve `{ sky }`), `sky.mesh` al posto di `ocean.sky`, `sky.setConditions(cond)` dopo `ocean.setConditions(cond)`, `sky.update(t, dt, s.ocean)` dopo `ocean.update`, mappa d'ambiente da `sky.envMap` (rifatta quando arrivano le tabelle, `sky.ready`). **Nuvole a billboard spente** (`landscape.clouds` non si aggiunge più alla scena, il codice resta).
- `ocean.js` **non è stato toccato** (né l'acqua né il cielo).

## File toccati

- `web/src/sky.js` (nuovo)
- `web/src/post.js` (opzione `{ sky }`, passaggi dopo N8AO, gradino delle nuvole nella qualità adattiva)
- `web/src/main.js`, `web/src/bordo/scena.js` (collegamento)
- `web/package.json`, `web/pnpm-lock.yaml`
- `web/public/sky/` (texture delle nuvole, STBN, tabelle EXR dell'atmosfera)
- `renders/ambiente/B-*.png`

## Interfaccia per l'integrazione

```js
import { createSky, SKY_PHYS, SKY_QUALITY } from "./sky.js";
const sky = createSky(renderer, camera, ocean.shared, { quality: "media" });
const post = createPost(renderer, scene, camera, { sky });
scene.add(sky.mesh);
```

| Membro | Uso |
|---|---|
| `sky.mesh` | cielo fisico in scena (sostituisce `ocean.sky`) |
| `sky.passes` | `[EffectPass(nuvole + composizione)]`, li inserisce `createPost` |
| `sky.setConditions(cond)` | dopo `ocean.setConditions`: sole, nuvole, guadagno, `shared.uHorizon/uZenith` |
| `sky.update(t, dt, opacity)` | ogni fotogramma, con `s.ocean`: dissolvenza, accensione, matrici per i riflessi |
| `sky.envMap(pmrem)` | texture PMREM per `scene.environment` (come `ocean.envMap`) |
| `sky.ready` | Promise: tabelle caricate (rifare `envMap` dopo) |
| `sky.uniforms` | `uSkyEnv`, `uSkyClouds`, `uSkyViewProj`, `uSkyCloudsOn` (oggetti vivi) |
| `sky.sunLight` | colore della luce del sole al livello del mare, stesse unità del cielo (non ancora usato dalle luci) |
| `sky.gain` | guadagno applicato (diagnostica) |
| `sky.setQuality(q)`, `sky.quality`, `sky.degrade()` | manopola di qualità |
| `sky.clouds`, `sky.aerial` | effetti takram, per ritocchi |

### Riflessi del mare (per A)

Chunk GLSL `SKY_PHYS` (GLSL1 come gli shader di `ocean.js`):

- `vec3 skyEnv(vec3 dir)`: cielo dalla cubemap (64 px, con velo delle nuvole e mare sotto l'orizzonte).
- `vec4 skyClouds(vec3 dir)`: nuvole e foschia volumetriche **del fotogramma precedente**, lette sullo schermo nella direzione `dir` (all'infinito), premoltiplicate (rgb, alfa). Fuori schermo sfuma a 0 sui bordi.
- `vec3 skyReflect(vec3 dir)`: le due cose insieme. Da usare al posto di `skyColor(r)` nel riflesso dell'acqua.

Collegamento: `Object.assign(mat.uniforms, sky.uniforms)` e `${SKY_PHYS}` nel fragment (dopo `${SKY}`). Verificato con un piano specchio di prova: compila e riflette le nuvole nel punto giusto. Limite: è un riflesso in spazio schermo, quindi le nuvole fuori inquadratura (tipicamente quelle sopra la camera) si riflettono solo dalla cubemap, che le ha come velo uniforme.

### Foschia (per A e C)

Nessun cambio di interfaccia: la chunk `SKY` di `ocean.js` (`skyColor`, `hazeTone`, `hazeColor`, `hazeAmount`) resta valida e ora i suoi colori (`uHorizon`, `uZenith`) arrivano dal cielo fisico. Distanze (`uFogNear/Far/Height`) restano quelle delle condizioni. La foschia volumetrica delle nuvole (`clouds.haze`) si somma solo oltre la scena (è limitata dalla profondità).

### Mappa d'ambiente

`seaEnv = sky.envMap(pmrem)` in `applyConditions` e di nuovo su `sky.ready`. `sky.uniforms.uSkyEnv` è la stessa cubemap non filtrata, utile per riflessi nitidi.

## Scelte e motivi

- **Cielo come mesh in scena, non `sky: true` della prospettiva aerea**: il mare sfuma in trasparenza tra 1050 e 1500 m; dietro serve un cielo vero nel color buffer, e la mesh segue `uOpacity` con l'alfa.
- **Prospettiva aerea senza trasmittanza né luce diffusa**: entro 1,5 km di mare non si vedono (c'è già la foschia di `ocean.js`) e costano letture di tabelle 3D su ogni pixel. Resta solo come compositore delle nuvole.
- **Illuminazione della barca invariata** (luci della scena, non post-process lighting della libreria): materiali PBR, riflesso planare e schiuma di `seafx.js` continuano a funzionare.
- **Tabelle EXR invece del generatore**: vedi spike (19 s di attesa).
- **Niente strato di nebbia bassa** (canale `a` delle nuvole) per la foschia: con la camera dentro il volume il raymarching a risoluzione ridotta lasciava una grana fitta su barca e mare.
- **Disco del sole nostro**: quello fisico, una volta scalato dal guadagno, supera la mezza precisione del composer.

## Cosa non ha funzionato o resta aperto

- **Ombre delle nuvole sul mare**: la libreria le dà solo con l'illuminazione in post-processing (`sunLight/skyLight` della prospettiva aerea), che non usiamo. Le mappe d'ombra ci sono (`clouds.atmosphereShadow`: array di cascate, matrici, intervalli): l'integrazione potrebbe campionarle nello shader del mare. Non fatto.
- **Upscaling temporale**: un po' di sfarfallio a puntini sulle nuvole lontane a filo d'orizzonte in qualità "media" e "bassa", e un leggero alone sui profili delle montagne di `costa alta` quando le nuvole passano dietro.
- **Pioggia**: coltre grigia uniforme, poca struttura. Ombre della base più marcate richiederebbero di ritoccare densità e profilo degli strati.
- **Leggero lilla nelle ombre delle nuvole a mezzogiorno**: è luce del cielo azzurra più il grading caldo delle luci (`GRADES.sea` in `post.js`). Si può abbassare `sky.clouds.skyLightScale` o il grading.
- **Luci**: sole e ambiente della barca vengono ancora da `cond.light` e `cond.ambSky`. `sky.sunLight` è pronto se si vuole legarle al cielo.
- **Raggi di luce** (qualità "alta") senza la tabella dello scattering di ordine superiore: un filo più chiari del corretto. Aggiungere `higher_order_scattering.exr` (3,5 MB) se si tiene "alta".

## Prestazioni

Misure in Chrome su questo Mac, 1440 × 900 CSS a **devicePixelRatio 2** (2880 × 1800), tramonto (seed 2, passo 13), con la qualità adattiva bloccata. **Il browser era condiviso con 3-4 schede WebGL di altri agenti che disegnavano di continuo**: i ms della GPU (timer query) sono gonfiati dalla contesa e vanno letti come confronto relativo, gli fps sono quelli della scheda in primo piano.

| Cielo | ms GPU (mediana) | fps |
|---|---|---|
| prima (cupola di `ocean.js`, scheda in secondo piano) | 15-18 | n.d. (scheda limitata dal browser) |
| `spenta` (solo cielo fisico, circa come prima) | 17,5-18 | 50-58 |
| `bassa` | 28 | ~57 |
| `media` (predefinita) | 29-32 | 53-62 |
| `alta` | 47-50 | 45-47 |

Il costo delle nuvole è dominato da parti che non dipendono dalla risoluzione (mappe d'ombra BSM a 3 cascate da 512, risoluzione delle nuvole che conta poco grazie all'upscaling temporale): ridurre le cascate a 1 × 256 toglieva ~6 ms. "Media" resta sopra i 50 fps anche così; a 1,5x di densità di pixel (dove la qualità adattiva scende da sola) le nuvole costavano 3-5 ms. "Alta" è da usare solo su macchine potenti.

## Screenshot

`renders/ambiente/`, 1200 px di lato lungo:

- prima: `B-prima-mezzogiorno.png` (passo 14), `B-prima-tramonto.png`, `B-prima-pioggia.png`
- dopo, landing passo 13: `B-dopo-alba.png` (seed 7), `B-dopo-mezzogiorno.png` (18), `B-dopo-tramonto.png` (2), `B-dopo-foschia.png` (30), `B-dopo-pioggia.png` (89)
- `B-dopo-bordo-tramonto-alta.png`: `/bordo/?passo=13&seed=2&cielo=alta`
- `B-dopo-transizione.png`: landing a metà fra passo 12 e 13 (dissolvenza dallo studio al mare)

## Da sapere per l'integrazione

1. In `main.js` e `scena.js` `createOcean()` ora sta **prima** di `createPost()`: se A cambia `createOcean`, attenzione all'ordine.
2. Se A sostituisce lo shader del mare, per i riflessi del cielo basta `skyReflect(r)` al posto di `skyColor(r)` e le uniformi di `sky.uniforms`. La chunk `SKY` deve restare (la usa anche il cielo di `sky.js`, per la fascia di foschia).
3. Se C aggiunge geometria alta (montagne vere), le nuvole la rispettano già via profondità.
4. `ocean.sky` e `ocean.envMap` restano in `ocean.js` ma non sono più usati: si possono togliere insieme alle nuvole a billboard.
5. Pesi: +7,7 MB in `public/sky` (3,9 MB di tabelle atmosfera, 2,1 MB forma delle nuvole, 1 MB STBN, il resto immagini).
