# Report E: dettaglio fine del mare e schiuma con texture vera

Aggiornato al 4 ottobre 2026. Branch `worktree-agent-a788d945cf8161ee1`, portato su `ambiente/integrazione` (9dc60af) prima di iniziare. Obiettivo: avvicinare il mare a quello di Three.js Water Pro su due punti, senza guardarne il codice.

## Cosa ho fatto

### 1. Increspature di dettaglio sotto i 10 m

- Nuovo `web/src/fft/detail.js`: all'avvio calcola sulla CPU una texture di pendenze 256 × 256 ripetibile, con una FFT in JavaScript (pochi millisecondi, una volta sola, nessun download). Spettro a legge di potenza con la stessa energia di pendenza per ottava (spettro di saturazione), allungato lungo il vento (coseno quadro più un fondo in tutte le direzioni), banda da 3 a 56 cicli per lato. Le pendenze si calcolano nel dominio delle frequenze (i·k·h), quindi la texture è esattamente periodica. La parte reale e l'immaginaria della FFT complessa sono due campi indipendenti: canali `rg` e `ba`, due trame diverse con una sola lettura.
- Nel fragment shader di `ocean.js` (`detailSlope`) la texture si legge a due scale, lati di **6,1 m** (onde da 2 m a 11 cm) e **1,37 m** (da 45 a 2,5 cm), rapporto non intero. Ogni scala si legge due volte con direzioni (da -0,41 a +0,55 rad attorno al vento) e velocità diverse (da 0,34 a 1,3 m/s, vicine alle velocità di fase di quelle onde): le increspature cambiano forma invece di scivolare rigide.
- **Segue l'acqua**: le coordinate sono `vFlow` (che contiene `uOff`), nel riferimento del vento del mondo come la FFT, quindi nelle virate del gioco (`uHeading`) il dettaglio resta coerente con le onde grandi. Non si smorza attorno allo scafo (le onde FFT sì): proprio lì serviva.
- **Cresce con il vento**: pendenza quadratica media per scala da Cox e Munk (varianza lineare con il vento), circa 0,09 a 6 nodi e 0,15 a 25 nodi (`uDetail` in `setConditions`).
- **Niente scintillio in lontananza**: ogni scala si spegne quando l'impronta del pixel supera un decimo del suo lato. L'impronta è analitica (distanza per angolo del pixel, allungata di taglio). Con `fwidth(vFlow)` usciva costante per triangolo e la griglia radiale disegnava anelli concentrici dove la sfumatura cambiava gradino: corretto. La pendenza delle increspature spente non sparisce, passa nella ruvidità del riflesso del sole (α² = α0² + 2σ², l'idea della mipmap di Toksvig): in lontananza la scia del sole si allarga invece di diventare uno specchio.

**Perché texture e non una quarta cascata FFT.** La FFT costa per numero di passi (report A: 1,4 ms per 25 disegni). Una quarta cascata nella stessa texture impilata avrebbe aggiunto un terzo del lavoro a tutti i 16 passi della FFT più un passo di derivate (stima: mezzo millisecondo per fotogramma), per onde di decimetri che a schermo si vedono soprattutto scorrere, non evolvere. La texture costa quattro letture RGBA8 per pixel del mare e nessun passo GPU per fotogramma.

### 2. Schiuma con una texture vera

- **Fonte**: [ambientCG Foam001](https://ambientcg.com/view?id=Foam001), licenza **CC0** (pubblico dominio), etichette Foam, Ocean, Sea. Ho usato la mappa Opacity del pacchetto 1K-JPG.
- **Preparazione** (`web/public/textures/sea/foam.jpg`, 512 × 512, scala di grigi, **108 KB**): ridotta da 1024 px e **equalizzata**, così il valore di ogni texel è il suo quantile. Verificata la ripetizione 2 × 2: nessuna cucitura.
- **Uso nello shader**: le maschere restano quelle di prima (schiuma del Jacobiano delle tre cascate, strisce lungo il vento, buffer della scia di `seafx.js`) e dicono dove c'è schiuma e quanto è fresca. La foto fa da soglia: con la maschera piena copre quasi tutto, mentre la maschera si spegne restano solo i filamenti più chiari, quindi la schiuma **si sfalda a merletto** invecchiando, con bordi morbidi e densità che segue la foto (un velo di bolle, non un foglio bianco).
- **Contro la ripetizione**: due letture a 6,7 m e 2,3 m, ruotate e sfalsate, la seconda che deriva piano nel tempo (bolle che si muovono); una terza a 53 m varia la quantità di schiuma da un'onda all'altra.
- **Strisce di vento**: la stessa foto stirata lungo il vento (70 × 3,2 m), letta con `textureLod` al livello 4. Stirata a piena risoluzione dava graffi paralleli.
- **In lontananza** la trama è più fine del pixel: si passa alla copertura media, niente scintillio.
- Tolte dal fragment shader tutte le fbm procedurali della schiuma (sette fbm a quattro ottave) e la chunk `NOISE`, non più usata.

## File toccati

- `web/src/ocean.js`: fragment shader del mare (dettaglio e schiuma), uniformi nuove `uDetailTex`, `uDetail`, `uWind`, `uFoamPat`, `uDetail` in `setConditions`, caricamento della texture. Vertex shader, `WATER_GLSL`, chunk `SKY`, cielo e tutte le interfacce di `createOcean` (`float()`, `setCourse()`, `linkSeaFx()`, `linkSky()` e le altre) sono invariati. `linkSky` funziona come prima: sostituisce ancora `void main() {` e `vec3 refl = skyColor(r);`.
- `web/src/fft/detail.js` (nuovo).
- `web/public/textures/sea/foam.jpg` (nuovo).
- **Non** toccati `post.js`, `sky.js`, `main.js`, `bordo/scena.js`, `seafx.js`, `materials.js`.

## Costo misurato

Nessun passaggio a schermo intero nuovo, nessun passo GPU per fotogramma. Misura A/B nella stessa scena e nella stessa pagina, alternando a runtime il fragment shader vecchio (da `git show HEAD`) e il nuovo, 5 giri da 180 fotogrammi ciascuno, mediana. Landing, `?seed=2` (tramonto, forza 6), dpr 2, finestra 1440 × 900, browser condiviso con altri agenti:

| Vista | Vecchio | Nuovo | Differenza |
|---|---|---|---|
| Passo 13 (inquadratura della pagina) | 65,8 fps (15,2 ms) | 70,7 fps (14,1 ms) | **circa 1,1 ms in meno** |
| Mare a tutto schermo, camera bassa | 67,1 fps (14,9 ms) | 78,6 fps (12,7 ms) | **circa 2,2 ms in meno** |

Il nuovo shader è **più leggero** del vecchio: le nove letture di texture (quattro del dettaglio, cinque della schiuma) costano meno delle sette fbm procedurali che sostituiscono. In tutti i giri il nuovo è stato più veloce (vecchio 64-67 fps, nuovo 70-80). Una tantum: FFT della texture di dettaglio sulla CPU all'avvio (pochi ms) e 108 KB da scaricare.

## Verifica a schermo

Nessun errore di shader in console, né nella landing né in `/bordo/?passo=13` (in console solo il 404 della favicon, preesistente). Provati: `?seed=8` (mattino, forza 5, arcipelago), `?seed=2` (tramonto, forza 6, costa alta), `?seed=89` (pioggia, forza 5), `?seed=13` (pomeriggio, 10 nodi, forza 3), `/bordo/?passo=13&seed=2`.

Screenshot in `renders/ambiente/` (non nel commit):
- Prima: `E-prima-mattino-passo13.png`, `E-prima-mattino-vicino.png` (camera bassa: acqua liscia a macchie), `E-prima-forza3-vicino.jpeg`.
- Dopo: `E-dopo-mattino-vicino-v1.png`, `E-dopo-forza3-vicino.jpeg`, `E-dopo-tramonto-scia-v3.jpeg` (scia a merletto vista dall'alto), `E-dopo-tramonto-creste-v4.jpeg` (creste a forza 6 e orizzonte), `E-dopo-pioggia-passo13.jpeg`, `E-dopo-bordo-passo13.jpeg`.
- Intermedi della taratura: `E-dopo-tramonto-scia-v1.png` e `-v2.png` (strisce a graffi e schiuma a carta ritagliata, poi corrette), `E-dopo-tramonto-passo13-v1.png`.

## Punti aperti

- La texture di dettaglio scorre e si incrocia, ma non evolve con la dispersione vera: da molto vicino e a lungo si può riconoscere lo scorrimento. Se un giorno ci fosse margine, una quarta cascata FFT piccola (solo normali) la sostituirebbe senza cambiare il resto dello shader.
- Le increspature non sentono l'ombra del vento dietro la barca né la pioggia (in pioggia la superficie reale si fa più ruvida e opaca): basterebbe modulare `uDetail` con `cond.rain`.
- La taratura della schiuma (soglie, scale, quantità sulle creste) è fatta a occhio su forza 5 e 6; a forza 7 e oltre non ho un seme di riferimento: i preset arrivano a 27 nodi solo con la pioggia.
- L'impronta del pixel usa `uResolution`, che arriva da `seafx.js`: se un giorno il mare fosse disegnato senza `linkSeaFx`, il dettaglio resterebbe spento (valore di partenza 1 × 1).
- Nel worktree il `git reset --hard` richiesto è stato negato dai permessi; ho usato `git merge --ff-only ambiente/integrazione`, equivalente perché il branch era un antenato pulito.
