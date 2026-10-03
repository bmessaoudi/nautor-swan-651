# Handoff: Swan 651, branch dell'agente vocale

Aggiornato al 3 ottobre 2026. Leggi questo file prima di toccare qualcosa.

## Dove siamo

Demo **a uso interno** di un museo web dedicato **solo allo Swan 651** (Nautor's Swan, Germán Frers, 1982-1991, 19 esemplari). Riferimento principale: **Lunz am Meer**, scafo 651-007, AUT 2895. Non servono consensi né licenze: lo ha detto l'utente, non riproporre il tema.

Il team è diviso in due e lavora su due branch:

| Branch | Chi | Esperienza |
|---|---|---|
| `feature/computer-di-bordo` | l'utente (dev) | Agente vocale che fa da guida: l'utente ascolta e guarda il sito che si muove, con pochissimo testo a schermo |
| `dev` | la designer | Landing page con design prestabilito, da leggere ed esplorare in autonomia |

Più avanti i due branch verranno uniti in `main`, che conterrà entrambe le esperienze.

- Questo branch è nato da `main` al commit `0d9bb57` ed è pubblicato su `origin`.
- Al 3 ottobre `dev` non esisteva ancora sul remoto. Non crearlo e non toccarlo: è lo spazio della designer.
- **Regola per il merge:** il codice dell'agente vive in file e cartelle propri. Sui file condivisi (`web/src/main.js`, `web/index.html`, `web/src/style.css`) solo modifiche piccole e circoscritte.

## Obiettivo del branch: il "computer di bordo"

Un agente vocale che fa visitare il sito al posto dell'utente. Se l'utente chiede gli interni, la camera ci va. Se chiede la storia del brand o qualcosa che non ha una scena, risponde a voce e dice che non c'è niente da mostrare. Il nome richiama il computer di bordo di una barca a vela. **Si accende dal pulsante di accensione della plancia**, che è anche il gesto con cui il browser concede microfono e audio.

### Vincoli dell'utente

- Tutto definito **in codice nel repo**. Nessuna dashboard esterna: ElevenLabs Agents è escluso per questo.
- **Esclusi i modelli speech-to-speech realtime**: OpenAI Realtime, Gemini Live e simili.
- Priorità alla **qualità dell'esperienza e della voce**: tono, espressività, italiano naturale.

### Stack scelto (verificato sui sorgenti dei plugin il 3 ottobre 2026)

| Pezzo | Scelta | Note |
|---|---|---|
| Trasporto | LiveKit server locale | `brew install livekit`, poi `livekit-server --dev`; credenziali `devkey` / `secret`, porta 7880. Si passa a LiveKit Cloud cambiando solo le variabili d'ambiente |
| Worker | **Python** con LiveKit Agents, cartella `agent/` | Python e non Node, vedi sotto |
| Cervello | Claude Opus 5.5 (`claude-opus-5-5`), effort basso | Prompt e conoscenza in file nel repo, prompt caching attivo |
| Orecchie | Deepgram Flux Multilingual (`flux-general-multi`) | Classe `deepgram.STTv2`, suggerimento di lingua `it` |
| Turni | Endpointing di Flux (`turn_detection="stt"`) oppure TurnDetector audio di LiveKit | Il TurnDetector supporta l'italiano. In locale gira la versione `v1-mini` sulla CPU, gratis. Provare entrambi |
| Voce | ElevenLabs **Eleven v4 Turbo** (`eleven_v4_turbo`) | Uscito il 28 settembre 2026, 90+ lingue, audio tag per il tono, circa 100 ms di inferenza. Ripiego: `eleven_flash_v2_5` |
| Ponte col sito | RPC di LiveKit dall'agente al browser | Pattern documentato "forwarding tools to the frontend" |

**Perché Python:** Eleven v4 Turbo passa solo dal WebSocket "Text to Dialogue". Il plugin ElevenLabs Python lo implementa già (`is_dialogue_model`). Quello Node usa solo il WebSocket classico e si ferma a `eleven_v3`. Anche le opzioni di Deepgram Flux a sessione aperta sono solo in Python.

**Limiti noti del plugin Anthropic** (sia Python sia Node):

- Non espone `output_config.effort`. Su Opus 5.5 il default è `medium`: serve una sottoclasse o `extra_kwargs` per passare `low`.
- Il default di `max_tokens` in Python è 1024, troppo stretto con il thinking sempre attivo di Opus 5.5. Alzarlo.
- Non rimanda i blocchi di thinking fra un turno e l'altro. È ammesso dall'API: si perde solo un po' di continuità di ragionamento.
- Su Opus 5.5 `tool_choice` `any` o `tool` restituisce un errore 400. Lasciare `auto`, che è il default del plugin.
- Su Opus 5.5 aggiungere i fallback lato server in caso di rifiuto (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`).

### Chiavi API necessarie

Anthropic, Deepgram, ElevenLabs. Vanno in `agent/.env`, mai committate.

## Stato al 3 ottobre 2026 (notte)

Il computer di bordo ha una **pagina tutta sua, `/bordo/`**, riprogettata per la voce. La landing (`/`, `index.html`, `main.js`, `style.css`) è identica a `main`: è lo spazio della designer. **Manca ancora la prova con le chiavi vere** e i suoni non sono stati generati.

### Scelte dell'utente per la pagina a voce (3 ottobre)

- Pagina separata `/bordo/`: in `main` conviveranno la landing da leggere e il museo guidato a voce.
- **Regia solo dell'agente**: niente scroll. A sinistra un indice di argomenti da chiedere (vedi il secondo giro).
- **Niente testo a schermo**: solo parole chiave (un titolo e fino a tre dati) scelte dall'agente, più foto e grafici quando servono.
- Sottotitoli spenti, attivabili dal tasto CC.
- Foto da `reference/` (sia dell'utente sia dal web) e grafici della landing.
- Suoni d'ambiente per sezione con ElevenLabs Sound Effects, sempre sotto la voce. Suno scartato: niente API ufficiale né sintesi vocale.

### Secondo giro (richieste dell'utente, 3 ottobre notte)

- **Consumo.** Misurato con Chrome: landing e `/bordo/` a camera ferma disegnano zero fotogrammi WebGL; LiveKit e il worker Python lavorano solo sulla CPU. La differenza trovata: animazioni CSS continue sopra pannelli con `backdrop-filter` raddoppiavano il lavoro del processo GPU anche da fermi. La nuova plancia non ha sfocature; la sfera è un canvas piccolo che si ferma quando la plancia è spenta; gli strumenti si aggiornano 4 volte al secondo. La scena in mare resta la parte pesante, in entrambe le pagine.
- **LiveKit Cloud.** Basta mettere url e chiavi del progetto (`lk cloud auth`, poi `lk app env -w` in `agent/`, che scrive `.env.local`; gli script lo leggono). Su Cloud l'agente usa da solo le interruzioni `adaptive` e, con `BORDO_TURNI=audio`, il TurnDetector `v1` in cloud.
- **Ingresso al buio con la plancia.** Ricerca sulle foto vere (`reference/photos_web/deck/unnamed-1984_cockpit_8.jpg` è il riferimento migliore): mensola con cappello di teak sulla paratia del pozzetto di poppa, casse quadrate nere con quadranti antracite e lancette bianche (ripetitori B&G Hercules degli anni Ottanta). `plancia.js` la disegna in SVG: vento apparente con sagoma dello scafo e settori rosso e verde, nodi di vento, rotta (la rosa segue la camera), "visita" come un indicatore VDO dei serbatoi; levette d'alluminio con spia (Bordo rossa, Sottotitoli ambra, Suoni verde). Si entra con tutto spento e la plancia al centro; la levetta Bordo accende gli strumenti con l'autotest delle lancette, poi appare la barca e la plancia scende al suo posto.
- **Sfera della voce** (`orb.js`): shader WebGL di acqua e schiuma dentro lo strumento centrale. Si gonfia con la voce dell'agente quando parla e con il microfono quando ascolta (`livello.js`), gira quando elabora.
- **Indice al posto della navigazione** (`indice.js`): argomenti raggruppati (Il progetto, Fuori, Dentro, In mare, Storie). Si illumina quello in scena; il clic manda all'agente "[Argomento scelto dall'indice: ...]". Spariti i puntini dei capitoli e le domande suggerite.
- **Inquadrature.** Composizione fissa: indice a sinistra, parole chiave e foto a destra, barca centrata nello spazio fra i due e sopra la plancia (il centro ottico della camera si sposta lì). Ritocchi di campo visivo in `REGIA` dentro `scena.js` per i passi 0, 1, 3, 4, 7, 11, 12, 14, 16. In sviluppo `?passo=N` apre direttamente una scena. **Centraggio automatico** (`misuraSagoma` in `scena.js`): a ogni fotogramma si proietta un campione di circa 3000 vertici esterni e il centro ottico va sul centro della sagoma, anche durante la panoramica. Se la barca è più alta dello schermo la chiglia si appoggia sopra la plancia e si taglia l'albero. Negli interni resta il punto di `story.js`.
- **Luci di cabina**: faretti rivolti in basso invece di luci puntiformi. Le chiazze rosate sui fianchi bianchi degli interni ci sono anche nella landing, quindi non dipendono dalle luci: è un difetto dei rivestimenti interni da guardare a parte.
- **Carattere**: prompt con personalità ironica e carismatica (battute brevi dopo il fatto vero, mai inventare aneddoti) e audio tag di Eleven v4 (`[chuckles]`, `[sarcastic]`, `[whispers]`, `[dry amusement]`...), al massimo uno o due per risposta. Saluto nuovo. Con Flash i tag vengono tolti dal testo (`togli_tag`); i sottotitoli li nascondono sempre.
- **Voce**: `agent/cerca_voce.py` (cerca nella Voice Library italiana e scarica le anteprime, prova una battuta con i tag su `eleven_v4`, aggiunge la voce all'account, oppure Voice Design da descrizione). Candidati: Vittorio (`nH7uLS5UdEnvKEOAXtlQ`, "friendly, smiling") e Max (`tULHfJ4iE8Pmlm5lOtto`, "expressive"), da verificare: la Library pubblica non è leggibile senza login. ElevenLabs avverte che le voci progettate rendono meno su v4 di quelle della Library.

### Pagina `/bordo/` (`web/bordo/index.html`, `web/src/bordo/`)

- `scena.js`: copia della scena della landing guidata dalla regia invece che dallo scroll. Ogni spostamento va dallo stato attuale a quello d'arrivo senza attraversare i passi intermedi (da 1,8 a 3,6 secondi). Negli interni si accendono cinque luci di cabina calde, con un breve sfarfallio. **Da unificare con `main.js` in un modulo comune al merge.**
- `pagina.js` e `pagina.css`: ingresso con il pulsante di accensione (sblocca audio e microfono), unico modo di entrare: l'ingresso senza voce è stato tolto; parole chiave sul lato libero dell'inquadratura; pannello per foto e grafici; plancia in basso al centro (vedi il secondo giro).
- `passi.js`: i testi delle 18 schede della landing, ora conoscenza dell'agente e non testo a schermo. Ogni passo ha un campo `pannello`: la foto o il grafico che riempie la colonna di destra all'arrivo della camera, così la colonna non resta mai vuota. Una foto aperta dall'agente prende il suo posto fino allo spostamento successivo; se l'agente non dà parole chiave resta il titolo del passo. Sul telefono (sotto 901 px) il pannello fisso non compare, per non coprire la barca.
- `disegni.js` e `contorni.js`: otto grafici SVG nuovi (scheda tecnica generale, pannello d'apertura; registro dei 19 scafi, misure, carena, piano velico quotato, superfici delle vele, zavorra, palmarès di Lunz am Meer). I contorni dello scafo in metri sono ricavati da `reference/drawing_outlines_px.json`. In `scena.js` la camera allarga il campo (fino a 1,6 volte) quando la barca intera non entra fra indice e colonna di destra.
- `immagini.js` e `public/img/bordo/`: 42 foto (aggiunte la pianta degli interni e il barografo di Show Me) scelte da `reference/` (circa 10 MB, massimo 400 KB l'una), con titolo, didascalia e una descrizione per l'agente. `media.js`: polare, mappa delle rotte e gli otto grafici di `disegni.js`.
- `suoni.json` e `suoni.js`: 9 ambienti in loop e 9 effetti. Il volume degli ambienti segue lo stato della scena a ogni fotogramma: la tavola, il cantiere, sottocoperta con le voci basse, le vele che sbattono quando sbattono anche nel 3D, il mare e il vento in base ai nodi, i gabbiani vicino alla costa, la pioggia con il preset pioggia. Gli effetti sono legati ai momenti: interruttore e porta quando si accendono le luci, verricello in coperta, vela che si gonfia, onda all'arrivo in mare. Tutto scende al 32% mentre l'agente parla. Senza file audio la pagina funziona lo stesso.
- `bordo.js` (collegamento LiveKit, trascrizioni, invio di testo) e `bridge.js` (RPC). L'indice per l'agente parte come **stream di testo**: supera i 15 KB massimi di una risposta RPC.
- `web/vite.config.js`: due ingressi nella build (landing e `/bordo/`).

### Agente (`agent/`)

- Tool: `vai_al_passo(passo, titolo, dati)`, `mostra_dettaglio(id, dati)`, `mostra_parole(titolo, dati)`, `mostra_immagine(id)`, `nascondi_immagine`, `cambia_mare`, `spegni`. Le parole chiave viaggiano nella stessa chiamata dello spostamento, così compaiono insieme alla scena senza un secondo giro del modello.
- Sottoclasse `ClaudeLLM`: `output_config.effort` (default `low`), `fallbacks: "default"` con la beta `server-side-fallback-2026-07-01`, `max_tokens` 8000, caching.
- Lo stato dello schermo (passo, capitolo, mare, foto aperta) entra in testa a ogni messaggio dell'utente come `[A schermo: ...]`, sia a voce sia dal testo (suggerimenti e puntini).
- Interruzioni con il VAD Silero locale (`mode: "vad"`): quelle "adaptive" chiamano un servizio di LiveKit Cloud che col server locale risponde 401.
- `genera_suoni.py`: genera gli mp3 da `suoni.json` con l'API Sound Effects (`eleven_text_to_sound_v2`, `loop: true` per gli ambienti). Salta quelli già presenti.
- `prompt.md`: riscritto per lo schermo senza testo (parole chiave, foto, note tra parentesi quadre).

### Verificato senza chiavi

- Richiesta a Claude ricostruita a secco, schemi stretti dei tool compreso `dati` come lista di oggetti.
- Con LiveKit locale: dispatch, indice via stream, avvio della sessione. Con le chiavi finte la sessione cade su Deepgram (401) e la plancia mostra "Non raggiungibile".
- Con un finto agente Python nella stanza: dettaglio indicato con parole e dati, salto dalla tavola alla carena, foto della Whitbread, polare, dinette con le luci. Screenshot controllati.
- Navigazione senza voce dai puntini. Build di produzione.

### Avvio

```
cp agent/.env.example agent/.env           # poi le tre chiavi
cd agent && uv run genera_suoni.py         # una volta: crea web/public/audio/bordo/
livekit-server --dev                       # terminale 1
cd agent && uv run token_server.py         # terminale 2
cd agent && uv run agent.py dev            # terminale 3
cd web && pnpm run dev                     # terminale 4, poi http://localhost:5173/bordo/
```

Opzioni in `.env`: `ELEVEN_VOICE_ID`, `ELEVEN_MODEL`, `BORDO_EFFORT`, `BORDO_TURNI` (`stt` per Flux, `audio` per il TurnDetector `v1-mini`).

### Da verificare con le chiavi

- Il plugin Anthropic scarta i blocchi di thinking fra un turno e l'altro: controllare che l'API lo accetti nel giro dei tool.
- La frase di presa in carico prima di un tool deve arrivare come testo: su Opus 5.5 le note più lunghe di una frase fra un tool e l'altro diventano thinking, quindi mute.
- Latenza alla prima parola con effort `low`; confronto `BORDO_TURNI=stt` e `audio`.
- Qualità di voce e suoni, volumi relativi (`LIVELLI` e `DUCK` in `suoni.js`).
- Che l'agente scelga parole chiave brevi e foto pertinenti.

## Prossimi passi

1. Chiavi in `agent/.env` e credenziali LiveKit Cloud in `.env.local`, poi prima prova completa a voce.
2. Scelta della voce con `cerca_voce.py` e prova degli audio tag in streaming su v4 Turbo (la documentazione lo lascia intendere ma non lo dice).
3. Generazione dei suoni (`genera_suoni.py`) e taratura dei volumi.
4. Rifinire il prompt sulle conversazioni vere: dose di ironia, lunghezza, uso di foto e parole chiave.
5. Chiazze rosate sui rivestimenti interni (anche nella landing).
6. Prima del merge in `main`: estrarre la scena comune da `main.js` e `scena.js`.
7. Contraddizioni nelle fonti: Swan Cup 1980 o 1984, dislocamento 34,2 o 36 t, verricelli di Lunz elettrici o idraulici, un doppione fra Kingfisher, Emocean e Indigo VI; foto con attribuzione debole (Whisper of V e Geronimo, Rosbeg forse ancora Gaetana, Show Me, Deneb).

## La demo web esistente

Cartella `web/`: Vite 8, three.js r186, Lenis, `postprocessing` 6.39.5 e `n8ao` 2.0.1. Avvio con `pnpm run dev` dentro `web/`, porta 5173.

- **Pagina unica a scroll**: 18 passi da 100vh, ognuno con un fotogramma chiave in `web/src/story.js` (camera, taglio, vele, mare, grading, sfocatura). `main.js` interpola fra i fotogrammi.
- **Capitoli**: 01 Blueprint (passi 1-3), 02 Esterni (4-8), 03 Interni (9-12), 04 Navigazione (13-17).
- **Navigazione da codice**, ciò che il ponte userà: `lenis.scrollTo(passo * innerHeight)` in `main.js`; i link del menu capitoli hanno `data-go` con il passo d'arrivo.
- **Hotspot**: array in `story.js` con passi, posizione, titolo e testo. Sono il contenuto naturale per l'agente.
- **Parametri URL**: `?step=N` apre un passo, `?seed=N` fissa ora del giorno, vento e costa (esempi: `2` tramonto, `30` foschia, `89` pioggia, `4821` mattino).
- **File principali**:
  - `story.js`: fotogrammi chiave e hotspot.
  - `ocean.js`: mare Gerstner, cielo, foschia.
  - `post.js`: post-processing e grading per capitolo.
  - `conditions.js`: condizioni dal seme.
  - `landscape.js`: isole, vele lontane, gabbiani, nuvole.
  - `seafx.js`: riflesso della barca e schiuma della scia.
  - `materials.js`: materiali triplanari, texture CC0 di Poly Haven.
  - `rigging.js`: scotte a catenaria, bandiera, balumina che vibra.
- **Prestazioni**: qualità adattiva sul tempo GPU, accumulo a camera ferma, interni nascosti con lo scafo chiuso.
- **Testi verificati**: 4 cabine ospiti, 3 bagni e 2 di equipaggio; autonomia circa 700 miglia a 7-8 nodi; polare dal certificato ORC di Lunz am Meer; Whitbread 1985-86 e Ocean Globe Race 2023 di Spirit of Helsinki. I verricelli elettrici sono di Lunz, in origine erano manuali.

## Il modello 3D

Generato **interamente da script Python** in Blender. Niente generazione AI: scelta dell'utente.

| File | Contenuto |
|---|---|
| `models/swan651.glb` | Esterni e interni, circa 42.500 triangoli, 1,7 MB. Copia in `web/public/models/` |
| `models/swan651.fbx` | Per il collega 3D. La mappa di ruvidità dello scafo non passa nell'FBX |
| `models/swan651.blend` | Scena Blender |
| `scripts/blender/` | `swan651_hull.py`, `swan651_rig.py`, `swan651_interior.py`, da eseguire in quest'ordine nello stesso namespace |

Rigenerazione completa senza aprire Blender:

```
/Applications/Blender.app/Contents/MacOS/Blender -b models/swan651.blend --python scripts/blender/build_and_export.py
cp models/swan651.glb web/public/models/
```

- Oggetti con nomi chiari (Hull, Deck, Mast, Mainsail, collezione `Swan651_Interior` e così via), quindi smontabili sul web.
- Le vele hanno lo shape key `Luffing`, esportato come morph target.
- **Decisioni geometriche da non rimettere in discussione:** tavola di Adrienne II scalata a 21 m e accorciata di 1,02 m di poppa; specchio di poppa rovescio come Lunz; sezioni a superellisse tarate sul dislocamento IRC (circa 36,4 t contro 36,58); armo dal certificato IRC di Lunz; colori di Lunz am Meer con pelle rossa sui divani; superfici curve solo a quadrilateri.
- Blender 5.2.2 LTS con l'add-on MCP for Blender, registrato in Claude Code come server `blender`.

## Problemi aperti

- **Interni**: restano semplici bagni, cabine prodiere e trapuntatura dei cuscini.
- La chiglia segue la pinna con scarpa in piombo del "651 Mod" (scelta Lunz), non la pinna trapezoidale del piano velico standard.
- Avviso innocuo dell'export glTF ("more than one tex image" su Hull_Paint).
- Bake dell'occlusione in Blender non fatto: per ora la copre N8AO.

## Riferimenti

- `RICERCA.md`: ricerca iniziale su brand, pipeline 3D e librerie web.
- `reference/`: tavole, certificati IRC e ORC, 132 foto dell'utente e 233 dal web con manifest delle fonti.
- `~/Desktop/coding/nautor-swan-library`: sito Next.js "WikiSwan" con 20 scafi 651 documentati. Fonte dei contenuti per l'agente.

## Preferenze dell'utente

- Risposte in italiano, **mai il carattere em dash** (vedi `~/.claude/CLAUDE.md`).
- pnpm 11 come gestore pacchetti.
- Firecrawl per qualunque accesso web. curl solo per scaricare file binari trovati con Firecrawl.
- Mostrare i progressi con screenshot o render. In Blender lasciare la vista in modalità Rendered con la barca inquadrata.
