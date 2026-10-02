# Museo interattivo Nautor's Swan: ricerca preliminare

Data: 2 ottobre 2026. Fonti raccolte via Firecrawl, versioni delle librerie verificate su npm e GitHub nel giorno della ricerca. Dove un dato è incerto lo dico.

---

## 1. Verdetto: abbiamo gli strumenti?

Sì, con tre buchi da chiudere: **Blender non è installato**, **mancano i dati tecnici per lo scafo** (linee d'acqua o CAD) e **va chiarito il diritto d'uso** di marchio, disegni e foto.

### Sulla tua macchina

| Strumento | Stato | Nota |
|---|---|---|
| MacBook Pro M1 Max, 32 GB, Metal 4 | ok | Sufficiente per Blender, bake e sviluppo WebGL |
| Node 22.13, pnpm 11.1, git, brew | ok | |
| uv / uvx | ok (`~/.local/bin`) | Serve per Blender MCP |
| Python 3.10.1 | ok | Minimo richiesto da Blender MCP |
| Firecrawl MCP | ok | |
| **Blender** | **manca** | Installare **5.2 LTS** (uscita 14/07/2026, patch 5.2.2) |
| **Blender MCP** | **manca** | Vedi sezione 5 |
| gltf-transform CLI | manca | `pnpm add -g @gltf-transform/cli` (v4.5.1) |
| GPU CUDA | non disponibile | Esclude i generatori AI locali (TRELLIS.2); si usano servizi cloud se servono |

### Da ottenere dal cliente o da terzi

1. **CAD Rhino/3D** dei modelli recenti (dagli anni 2000 in poi è probabile che esistano).
2. **Piani di forma / linee d'acqua** dei modelli storici: per S&S stanno al Mystic Seaport, per Frers e Holland nessun archivio pubblico.
3. **Autorizzazione** su marchio, disegni ufficiali, foto (le foto della libreria hanno crediti di fotografi terzi).
4. Password del **tour 360°** già esistente sul sito.

---

## 2. Il brand: cosa esiste online

### Fonti principali

- Timeline ufficiale: https://www.nautorswan.com/company/heritage/
- Timeline con foto storiche numerate (ottime per il museo): https://nautorswanservice.com/legacy/
- Wikipedia (tabella modelli con anni, designer, esemplari): https://en.wikipedia.org/wiki/Nautor_Swan
- Sailboatdata, 85 modelli con specifiche e disegno profilo/piano velico: https://sailboatdata.com/builder/nautor-swan-sailboats/
- Speciale Yachting World 1986 "20 Years of Nautor's Swan", PDF integrale 62 pagine: https://www.classicswan.org/upload/articles_swan/2020_10_15_14_25_48-20.years.swan.pdf
- Libro ufficiale "Nautor's Swan: Through 50 Years of Yachting Evolution" (Skira, 2016, ISBN 9788857231815)
- Comunicato 60° anniversario: https://www.nautorswan.com/news/2026/01/nautor-swan-sailing-forward-since-1966/

### Cronologia essenziale

| Anno | Evento |
|---|---|
| 1966 | Pekka Koskenkylä fonda Oy Nautor Ab a Pietarsaari/Jakobstad, in una ex conceria |
| 1967 | Swan 36 "Tarantella" (S&S), varato il 17 luglio. 90 esemplari |
| 1968 | Swan 36 Casse Tete II vince 6 regate su 6 alla Cowes Week |
| 1969 | Incendio dello stabilimento (anno leggermente incerto); Schauman (poi UPM) entra al 51% |
| 1972 | Swan 48 Noryema vince la Bermuda Race, prima barca di serie a riuscirci |
| 1973-74 | **Swan 65 Sayula II vince la prima Whitbread** |
| 1975 | Swan 38, il più venduto (116 esemplari) |
| 1978 | Arriva Ron Holland (Swan 39) |
| 1980-81 | Arriva Germán Frers (Swan 51). Frers firma da allora quasi tutti gli Swan |
| 1980 o 1984 | Prima Swan Cup a Porto Cervo (1980 secondo Yacht Style, 1984 "prima Rolex" secondo Nautor: da verificare) |
| 1982 | **Swan 651** (Frers), 19 esemplari fino al 1991 |
| 1985-86 | Swan 651 Fazer Finland 3° alla Whitbread |
| 1986 | Garuda (Swan 100/102, Holland + Bannenberg), primo maxi custom |
| 1998 | Leonardo Ferragamo proprietario |
| 2001 | Swan 45, primo one design |
| 2005 | ClubSwan 42 con il NYYC |
| 2012 | Swan 90S Freya è lo scafo n. 2000 |
| 2016 | 50° anniversario, ClubSwan 50 (Kouyoumdjian) |
| 2021 | Swan Shadow (motore), ClubSwan 125 Skorpios |
| 2024 | Ingresso nel Gruppo Sanlorenzo; Swan 88 primo ibrido |
| 2025 | Swan 128 "Raijin", lo Swan più grande mai costruito |
| 2026 | 60° anniversario: refit e nuovo varo di Tarantella, Rolex Swan Cup con flotta record |

Totale costruito: "oltre 2.350" barche da 36 a 131 piedi.

### Modelli

Elenco completo per designer (S&S, Holland, Frers, Kouyoumdjian, linea motore) con anni ed esemplari nella tabella Wikipedia e su sailboatdata. Gamma attuale sul sito: Swan 51, 55, 58, 65, 73; Maxi 80, 88, 98, 108, 128; Alloy 44; ClubSwan 28, 36, 43, 50; Shadow, OverShadow, Arrow.

### Il sito nautorswan.com oggi

- WordPress 6.8, tema Qode Bridge, WPBakery, Slider Revolution. Brochure come flipbook FlipBuilder.
- **Nessun 3D**: niente three.js, model-viewer, glTF. Il "virtual showroom" è fatto di immagini statiche e video YouTube. Il "360° tour" è protetto da password.
- **Materiale tecnico scaricabile senza form** per i modelli attuali: brochure PDF, sail plan, deck arrangement, interior general arrangement in JPG ad alta risoluzione. Esempio Swan 55: https://www.nautorswan.com/w1/wp-content/uploads/2025/11/Brochure-Swan_55-11-2025_V2b-web.pdf
- Brochure 2000-2020 archiviate su NauticExpo.
- Nemmeno Wally, Baltic, Sanlorenzo, Ferretti, Riva o Oceanco hanno 3D realtime sul sito: **è uno spazio libero nel segmento vela di lusso**.

### Disegni tecnici e archivi

- **Sparkman & Stephens**: disegni originali al Mystic Seaport (https://research.mysticseaport.org/coll/spcoll041/), ordinati per numero di progetto (Swan 65 = 2110). Copie acquistabili per riferimento; **la ripubblicazione va negoziata**.
- **S&S Swan Association** (https://www.classicswan.org/): circa 30.000 file, ma riservati ai soci proprietari.
- Registri di classe: Swan 38 (116 scafi), Swan 46 Association, Swan Classic by Frers (presieduta da Lodovica Genghini, già nella tua libreria).
- **Linee d'acqua pubbliche: nessuna trovata.** Per i modelli storici si ricostruisce da profilo, pianta, foto e misure, oppure si ottengono i dati dal cantiere.

### Modelli 3D Swan già esistenti

Nessuno utilizzabile: uno Swan 55 su CGTrader (2017, qualità medio-bassa), uno Swan 100RS su TurboSquid (2006), alcuni lavori su Sketchfab non scaricabili. **Vanno fatti da zero.**

### Musei fisici

Non esiste un museo Nautor. Il heritage oggi vive solo negli eventi (Swan Cup, 50° e 60° anniversario). Un museo digitale non ha concorrenti nemmeno interni al brand.

---

## 3. La tua libreria (`nautor-swan-library`)

Sito Next.js 16 "WikiSwan" che documenta i **singoli scafi dello Swan 651**.

- `src/content/models/swan-651.json`: scheda modello completa con specifiche e note sulle discrepanze tra fonti.
- 20 scafi documentati (1 attivo in `src/content/boats`, 19 in `_removed/`): numero di scafo, anno, colori, timeline, palmarès, persone, fonti, gallerie, certificati ORC/IRC.
- Storie forti: **Spirit of Helsinki** (651-011, ex Fazer Finland, Whitbread 1985-86 e Ocean Globe Race 2023-24), **Futuro** (651-001, il primo scafo), **Lunz am Meer** (651-007, verificato, ancora in regata).
- **`_removed/images/boats/adrienne-planimetria.jpeg`**: tavola ufficiale Nautor "Profile Layout" dello scafo 651-002, 4960 px, con profilo completo (bulbo, timone su skeg, elica, oblò) e pianta interni. È il riferimento più prezioso per il primo modello 3D.

**Cosa manca per il 651**: sezioni trasversali o foto da prua/poppa per la forma dello scafo, piano velico (le misure I, J, P, E sono nei certificati ORC già linkati).

**Conseguenza**: lo Swan 651 è il candidato naturale per il primo modello. Ha i dati migliori, una tavola tecnica in scala e 20 storie di scafi, che diventano varianti dello stesso modello base (colori, albero in carbonio, verricelli modificati).

---

## 4. Modelli 3D: come farli

### Le strade possibili, confrontate

| Approccio | Tempo | Qualità | Quando usarlo |
|---|---|---|---|
| **Parametrico in Blender** (script bpy pilotato da Claude via MCP) + libreria di accessori | ~6 settimane di setup, poi 1-3 giorni a modello | Alta e coerente, proporzioni corrette, dettagli "tipici" | **Strategia principale** per decine di modelli |
| **CAD del cantiere** (Rhino → glTF) | 2-4 giorni a modello | Massima fedeltà | Modelli recenti, se Nautor fornisce i file |
| Modellazione manuale da piani | 4-7 giorni (medio), 2-3 settimane (hero) | Alta | 2-3 modelli "hero" del museo |
| Generazione AI (Meshy, Tripo, Rodin) | minuti + ore di pulizia | **Inaccettabile per scafo e armo**: sartiame e vele si fondono o spariscono | Solo oggetti secondari: equipaggio, cuscini, parabordi, oggetti d'epoca |
| Fotogrammetria / Gaussian splat | 1 giorno cattura (drone) + 1-3 elaborazione | Molto realistica, ma senza sartiame né animazioni | 1-2 "reperti speciali" in secca (es. Tarantella dopo il refit) |
| Marketplace | / | Nulla di utile | No |

**Attenzione licenze AI**: la licenza di **Hunyuan3D non vale in UE**, quindi è esclusa. Meshy e Tripo a pagamento cedono la proprietà degli asset; TRELLIS.2 è MIT ma richiede GPU CUDA.

### Approccio raccomandato (ibrido)

1. **Scafo e coperta parametrici**: uno script bpy legge un JSON per modello (LOA, LWL, baglio, pescaggio, bordo libero, insellatura, poppa) e genera sezioni, loft e suddivisione. Verifica automatica del dislocamento calcolando il volume immerso. Le tavole (profilo, pianta) vanno messe come immagini di riferimento in scala per correggere a mano.
2. **Appendici da libreria**: chiglie e timoni da profili NACA, bulbi parametrici.
3. **Libreria accessori riutilizzabili**: winch, candelieri, pulpiti, timoneria, oblò, passauomo, rotaie. Tre livelli di dettaglio e materiali condivisi, raggruppati per epoca (S&S anni '60-'70, Frers anni '80, moderni).
4. **Armo procedurale**: albero e boma come estrusioni di profili, sartiame generato dalle coordinate I, J, P, E del piano velico.
5. **Vele**: mesh dal triangolo velico con curvatura parametrica, più shape key "sgonfia/gonfia" (o simulazione cloth cotta in shape key).
6. **Interni**: ricostruiti dalle piante (come quella di Adrienne II) solo per i modelli hero.
7. **Parti con nomi coerenti** (scafo, coperta, tuga, chiglia, bulbo, timone, albero, boma, vele, interni) per poterle smontare ed etichettare sul web.

### Pipeline di produzione

1. Raccolta dati per modello (1-2 settimane): schede, tavole, foto, CAD se disponibili.
2. Generatore scafo e coperta, calibrato su 2-3 modelli con CAD o tavole (3-4 settimane, una volta sola).
3. Libreria accessori e armo (2-3 settimane, una volta sola).
4. Produzione: genera, rifinisci, UV, bake di AO e luce, export GLB (1-3 giorni a modello).
5. Ottimizzazione: `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress ktx2`. Meshopt anche per morph target (vele animate), KTX2 ETC1S per i colori, UASTC per normal e ORM.
6. Controllo: draw call e triangoli misurati su un telefono di fascia media; GLB hero sotto i 5-8 MB.

### Budget indicativi (stime, non dati di fonte)

- Modello hero: 150-300k triangoli desktop, 50-100k mobile.
- LOD per il confronto tra modelli affiancati: 5-15k triangoli.
- Mobile: meno di 100-150 draw call, texture al massimo 2K, DPR limitato a 1.5.

### Mare e animazioni

- Due modalità: **studio** (sfondo neutro, per i dettagli) e **in navigazione** (onde Gerstner o FFT; three.js `Water`, oppure Three.js Water Pro a pagamento con galleggiamento e scie).
- Sbandamento e beccheggio in JS, senza bake.
- Confronto dimensioni: tutti i modelli in metri reali sulla stessa origine, con una sagoma umana di riferimento.

---

## 5. Blender MCP

Due server, complementari.

### MCP for Blender (ahujasid), per costruire

- Repo: https://github.com/ahujasid/mcp-for-blender (ex blender-mcp, MIT, molto usato).
- Installazione:
  ```
  claude mcp add blender uvx mcp-for-blender
  uvx mcp-for-blender install-addon
  ```
  Poi in Blender: Preferences > Add-ons > abilita "MCP for Blender"; nella viewport tasto N > scheda MCP > "Start MCP Server" (porta 9876).
- Funzioni: lettura scena, esecuzione di codice Python bpy, export GLB, asset Poly Haven (CC0), Sketchfab, generatori AI.
- Limiti: esegue codice arbitrario senza autenticazione (salvare spesso); le operazioni complesse vanno spezzate in passi piccoli. Telemetria disattivabile con `DISABLE_TELEMETRY=true`.

### MCP ufficiale Blender Lab, per documentazione e controllo

- https://www.blender.org/lab/mcp-server/ (nato con il connettore Claude, aprile 2026). Richiede **Blender 5.1+**.
- Ricerca nella documentazione API e nel manuale, riepilogo dei file .blend, render della viewport. Non crea asset. È sperimentale.

**In pratica**: Claude Code scrive e lancia gli script del generatore dentro Blender, controlla il risultato con screenshot, esporta GLB. Gli script restano in git, quindi ogni modello è riproducibile.

---

## 6. Stack web consigliato

| Livello | Scelta | Versione | Perché |
|---|---|---|---|
| Framework | **Next.js** App Router | 16.3 | SEO e i18n per i contenuti storici; la tua libreria è già Next 16 |
| CMS | Sanity (o i JSON della libreria) | | Contenuti museali separati dal codice |
| 3D | **three.js** + **React Three Fiber** + drei | r186 / 9.8 / 10.7 | Ecosistema più ricco e stabile. WebGLRenderer oggi, WebGPU quando R3F v10 esce dall'alpha |
| Postprocessing | @react-three/postprocessing | 3.1 | Bloom, profondità di campo, tone mapping |
| Scroll e regia | **GSAP** ScrollTrigger + **Lenis** | 3.15 / 1.3 | Standard di tutti i siti premiati analizzati |
| Alternativa MIT | **anime.js v4** | 4.5 | `onScroll` con `sync` + adapter ufficiale three.js (da v4.5). Valida se la licenza GSAP crea problemi al cliente |
| UI | Motion | 13.5 | Già nella tua libreria; ok per interfaccia, non per la camera |
| AR | model-viewer + USDZ dedicato | 4.3 | iOS non supporta WebXR AR: serve Quick Look con USDZ |
| Splat (opzionale) | Spark (World Labs) | | Gaussian splat dentro three.js, misti alle mesh |
| Debug | leva, stats-gl, Triplex | | r3f-perf è fermo da 2 anni |

Note:
- **GSAP** è gratuito anche per uso commerciale, ma con licenza proprietaria Webflow (non open source). **anime.js** è MIT.
- **Theatre.js** sconsigliato: fermo alla 0.7.2, la 1.0 è in un repo privato.
- **Architettura**: un unico `<Canvas>` persistente nel layout, le pagine proiettano le scene con `<View>` di drei. Il contesto WebGL non si ricrea a ogni cambio di pagina.
- **Qualità adattiva**: `PerformanceMonitor` di drei, `frameloop="demand"` nelle sale statiche, fallback a poster o video per i dispositivi deboli.
- **AR**: due scale, da tavolo (1:50) e 1:1. Uno Swan da 20 m a grandezza reale in salotto non si legge.

---

## 7. Ispirazione: siti che smontano, sezionano e costruiscono un oggetto allo scroll

Tecnologia verificata sul DOM della pagina dove indicato.

| Sito | Cosa fa | Tecnologia | Idea per la barca |
|---|---|---|---|
| **iyO One** https://www.iyo.ai/iyo-one | Exploded view allo scroll, pezzo in hover con etichetta | three.js r178 + GSAP. [Case study](https://www.awwwards.com/iyo-case-study-selling-the-worlds-first-audio-computer.html) con pipeline CAD → glTF | Chiglia scende, albero sale, coperta si solleva; hover: "Bulbo in piombo, 14,4 t" |
| **Blackbird SR-71** https://sr-seventy.one/ | Da wireframe a solido con fusione nello shader | three.js r172, Sanity, GSAP. [Tutorial Codrops](https://tympanus.net/codrops/2025/08/12/building-a-blended-material-shader-in-webgl-with-solid-js/) | **Il piano di costruzione Frers che diventa scafo** |
| **Hanwha Ocean** https://www.hanwhaocean.com/en/whatwedo/3dsubm/ | Cantiere navale: scroll sistema per sistema | three.js r161 | Un capitolo per chiglia, timone, armo, interni, con scafo semitrasparente |
| **Cartier Watches & Wonders** https://www.cartier.com/watchesandwonders | Sei "alcove", una per orologio, come sale di un museo | three.js r183 + GSAP + Lenis | Un'alcova per modello iconico: Swan 36, 65, 651, 100, ClubSwan 50 |
| **Shopify Editions Spring '26** https://www.shopify.com/editions/spring2026 | Canvas unico, scene diverse per capitolo | three.js r183, R3F. [Case study](https://tympanus.net/codrops/2026/06/26/engineering-the-web-experience-behind-shopifys-spring-26-edition-everywhere/) | Architettura di riferimento: un'epoca per capitolo |
| **Neoconda** https://neoconda.com/ | Exploded view + griglia da tavola tecnica + video scrubbato | three.js r160 + video | Griglia millimetrata sotto la barca; video per le sequenze pesanti |
| **anime.js** https://animejs.com/ | Oggetto 3D in homepage legato allo scroll | three.js r172 + anime.js `onScroll` | Prova che anime.js basta per legare smontaggio e shader allo scroll |
| **Oryzo (Lusion)** https://oryzo.ai/ | Un'unica scena per tutta la pagina, solo regia di camera | three.js r178 modificato | Schede tecniche Swan raccontate con la sola camera |
| **Smithsonian Apollo 11** https://3d.si.edu/object/3d/command-module-apollo-11%3Ad8c63e8a-4ebc-11ea-b77f-2e728ce88125 | Tour annotato esterno e interno | Voyager (open source) | Il formato da museo vero: annotazioni con fonte |
| **Apple AirPods Pro** https://www.apple.com/airpods-pro/ | Sequenza "design" allo scroll | **Video scrubbato, non 3D** | Per le scene fotorealistiche (vele che si issano) il video renderizzato costa meno |
| **M-Sport Raptor** https://www.msport-raptor.com/ | Veicolo che ruota allo scroll | **Sequenza di immagini su canvas 2D** | Fallback mobile per i giri attorno allo scafo |
| **Codrops, scatola che si piega** [tutorial](https://tympanus.net/codrops/2022/12/13/how-to-code-an-on-scroll-folding-3d-cardboard-box-animation-with-three-js-and-gsap/) | Assemblaggio con pivot gerarchici | three.js + GSAP | Costruzione: paratie che si alzano, coperta che si chiude |
| **Codrops, camera path da Blender** [tutorial](https://tympanus.net/codrops/2026/07/07/building-a-scroll-driven-3d-gallery-using-a-blender-camera-path-with-three-js-and-gsap/) | Curva della camera disegnata in Blender | three.js + GSAP | Giro di prua, passaggio sotto la chiglia, ingresso nel tambuccio |
| **Codrops, ZERO** [case study](https://tympanus.net/codrops/2026/07/17/zero-the-engineering-behind-a-defiant-interactive-narrative/) | Scroll con "gate" dove ci si ferma a esplorare | | Pause nel racconto con esplorazione libera della barca |
| **Needle, Bike Scrollytelling** https://engine.needle.tools/samples/bike-scrollytelling-responsive-3d/ | Inquadra il pezzo giusto su desktop e mobile | Needle (three.js) | Tenere inquadrato il bulbo su ogni schermo |

Riferimenti nautici luxury: BLUE e SeaCat di Rossinavi (three.js, GSAP, Blender), Asaro, Seasats (SOTD settembre 2026).

### Tecniche e codice da cui partire

- **Exploded view**: direzione dal centro del bounding box moltiplicata per un fattore di progresso. https://blog.anaili.fr/articles/exploded
- **Blueprint a solido**: render del wireframe e del solido su due target, poi fusione (tutorial SR-71); fronte "dissolve" che corre da prua a poppa: https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/
- **Tavola tecnica generata dal modello**: three-edge-projection proietta gli spigoli in linee 2D esportabili in SVG. https://github.com/gkjohnson/three-edge-projection
- **Contorni stile disegno**: https://blog.maximeheckel.com/posts/moebius-style-post-processing/
- **Sezioni e cutaway**: `clippingPlanes` con riempimento stencil (esempio three.js `webgl_clipping_stencil`).
- **Prototipo rapido**: model-viewer con annotazioni e orbita legata allo scroll in puro attributo, per validare la regia prima del codice.

### Le 5 idee più forti per Swan

1. **Dal piano di costruzione al mare.** Si apre con la tavola in linee su fondo carta; lo scroll riempie lo scafo da prua a poppa fino al gelcoat e all'acqua. Ripetibile per epoca: S&S, Frers, moderni.
2. **Togli la coperta.** Un piano di taglio scende dalla testa d'albero: si apre la coperta, appaiono gli interni (la pianta di Adrienne II diventa 3D) con punti cliccabili.
3. **Exploded view dei grandi componenti** con scheda in hover: materiale, peso, anno. Al contrario diventa "costruzione in cantiere a Pietarsaari".
4. **Sale come alcove con canvas unico**: hangar di Pietarsaari, regata, ormeggio. La camera passa da una sala all'altra lungo un percorso disegnato in Blender.
5. **Tour annotato da museo vero** per ogni barca iconica, con foto d'archivio e fonte. Video renderizzato come fallback mobile e per le scene hero fotorealistiche.

---

## 8. Rischi e punti aperti

- **Diritti**: marchio Nautor's Swan, tavole ufficiali (la planimetria di Adrienne II ha il logo Nautor), disegni S&S del Mystic Seaport, foto con crediti di terzi nella libreria. Serve l'accordo con Nautor prima di pubblicare.
- **Licenze software**: Hunyuan3D esclusa in UE; GSAP gratuito ma proprietario (alternativa anime.js MIT); Needle Engine con licenza commerciale sopra una soglia.
- **Dati in conflitto** da risolvere prima di scriverli nel museo: prima Swan Cup (1980 o 1984), arrivo di Frers (1980 o 1981), numero di Swan S&S (775 o circa 1.000) e Frers (700+ o 900+), anno dell'incendio.
- **Scope**: museo di tutta la storia Swan con il 651 come caso approfondito, oppure registro degli scafi stile WikiSwan? Cambia architettura e numero di modelli da produrre.

---

## 9. Prossimi passi proposti

1. Installare Blender 5.2 LTS e MCP for Blender; verificare la connessione da Claude Code.
2. **Prova sul 651**: mettere in scala la tavola di Adrienne II in Blender, scrivere la prima versione del generatore di scafo, confrontare con le foto. Obiettivo: capire in pochi giorni se la qualità del parametrico basta.
3. In parallelo, chiedere a Nautor i CAD dei modelli recenti e le tavole storiche.
4. Prototipo web di una sola scena: blueprint che diventa scafo, poi smontaggio, con R3F + GSAP (o anime.js).
5. Poi il design.
