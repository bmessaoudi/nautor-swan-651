// Regia della pagina: un fotogramma chiave per ogni passo di scroll (100vh ciascuno).
// Coordinate del modello: X verso prua, Y in alto (0 = galleggiamento), Z verso dritta.
// shift sposta l'inquadratura in orizzontale (frazione della larghezza) per lasciare spazio al testo.
// Fotografia: bokeh è la forza della sfocatura (0 = spenta), range i metri attorno al punto a fuoco
// in cui l'immagine resta nitida, focus il punto a fuoco in coordinate della barca (solo per quel
// passo, altrimenti è tgt), tilt l'effetto modellino, grade il grading di colore del capitolo.

export const CHAPTERS = [1, 4, 9, 13]; // primo passo di ogni capitolo

export const KEYS = [
  // 0. Apertura: la tavola di profilo
  {
    cam: [0, 9, 122], tgt: [0, 6.5, 0], fov: 23, shift: 0,
    lines: 1, solid: 0, cut: 100, luff: 0, ocean: 0, heel: 0, motion: 0, theme: 0, sails: 1, bg: "blueprint",
    bokeh: 0, range: 20, tilt: 0, grade: "blueprint",
  },
  // 1. Da che idea nasce
  { cam: [0, 12, 100], tgt: [0, 11, 0], shift: 0.2 },
  // 2. Per chi: pianta di coperta vista dall'alto
  { cam: [0, 95, 4], tgt: [0, 1.5, 0], fov: 17, shift: -0.12 },
  // 3. L'armo: dal basso verso la testa d'albero
  { cam: [24, 2, 32], tgt: [0, 13, 0], fov: 38, shift: 0.16 },
  // 4. Esterni: la linea diventa scafo, da prua a poppa
  { cam: [36, 10, 42], tgt: [0, 10, 0], fov: 32, shift: -0.14, solid: 1, lines: 0.6, bg: "studio", theme: 1, bokeh: 1, range: 22, grade: "studio" },
  // 5. Lo scafo: tre quarti di poppa, basso
  { cam: [-24, 0.6, 20], tgt: [-1.5, 0.4, 0], fov: 36, shift: -0.12, lines: 0, luff: 1, bokeh: 3, range: 9 },
  // 6. Il piano di coperta
  { cam: [-1, 72, 15], tgt: [0, 1.4, 0], fov: 24, shift: 0.19, sails: 0, bokeh: 0, tilt: 1 },
  // 7. Le vele si gonfiano
  { cam: [30, 3, 24], tgt: [0, 12.5, 0], fov: 42, shift: 0.14, luff: 0, sails: 1, tilt: 0, bokeh: 2.5, range: 12, focus: [0, 11, 0] },
  // 8. Caratteristiche marine: profilo con la carena
  { cam: [1, 0.5, 54], tgt: [0, 2.5, 0], fov: 30, shift: -0.13, bokeh: 1.5, range: 18 },
  // 9. Interni: la coperta si toglie
  { cam: [-8, 26, 18], tgt: [0, 0, 0], fov: 34, shift: 0.2, cut: 0.95, bokeh: 2, range: 10, grade: "interior" },
  // 10. Disposizione, vista in pianta
  { cam: [0, 37, 3], tgt: [0, 0, 0.2], fov: 30, shift: -0.15, bokeh: 0, tilt: 1 },
  // 11. Ospiti: casa delle bambole da poppa
  { cam: [-15, 10, 12], tgt: [-0.5, 0, 0], fov: 34, shift: 0.14, tilt: 0, bokeh: 3, range: 6 },
  // 12. Materiali: dentro la dinette
  { cam: [-6.5, 7, 7.5], tgt: [0.2, -0.2, 0], fov: 40, shift: -0.15, bokeh: 4, range: 3, focus: [0.3, 0.2, -1.1] },
  // 13. Navigazione: in mare aperto
  {
    cam: [-34, 7, 30], tgt: [0, 7, 0], fov: 34, shift: 0.12,
    cut: 100, ocean: 1, heel: 16, motion: 1, bg: "sky", bokeh: 2.5, range: 24, grade: "sea",
  },
  // 14. Velocità: affiancati sottovento
  { cam: [16, 2.2, 44], tgt: [0, 9, 0], fov: 38, shift: -0.17, bokeh: 3, range: 18 },
  // 15. Rotte: vista larga dall'alto
  { cam: [-70, 30, 40], tgt: [0, 6, 0], fov: 30, shift: 0.24, bokeh: 1.5, range: 40 },
  // 16. Blue water: da prua sopravvento
  { cam: [34, 5, -20], tgt: [0, 8, 0], fov: 36, shift: -0.16, bokeh: 3, range: 15 },
  // 17. Chiusura: ci si allontana
  { cam: [-90, 22, 90], tgt: [0, 15, 0], fov: 26, shift: 0, heel: 12, bokeh: 1, range: 60 },
];

export const HOTSPOTS = [
  // Scafo
  { steps: [5], at: [9.4, 1.5, 0], title: "Slancio di prua", text: "1,63 m di slancio: la barca si allunga quando sbanda e guadagna galleggiamento." },
  { steps: [5], at: [-9.55, 1.0, 0.4], title: "Specchio rovescio", text: "Lo spigolo basso è l'estremo poppiero, a 0,60 m sull'acqua." },
  { steps: [5], at: [0.2, -2.6, 0.27], title: "Pinna e piombo", text: "Pinna con scarpa in piombo, pescaggio 3,23 m nella versione Mod." },
  { steps: [5], at: [-8.6, -1.4, 0.08], title: "Timone su skeg", text: "Lo skeg sostiene e protegge la pala: una scelta da oceano più che da regata." },
  // Coperta
  { steps: [6], at: [-5.2, 1.2, 0], title: "Pozzetto", text: "Pozzetto di manovra profondo e protetto, con i coffee grinder." },
  { steps: [6], at: [-7.5, 3.1, 0], title: "Timoneria", text: "Piattaforma rialzata a poppa, sopra la cabina armatoriale." },
  { steps: [6], at: [3.5, 1.9, 0], title: "Tuga", text: "Larga circa il 52% della coperta: passavanti ampi per lavorare a prua." },
  { steps: [6], at: [-0.5, 2.0, 1.75], title: "Verricelli", text: "Tre coppie sulla tuga e in pozzetto. In origine manuali, su diversi scafi oggi alcuni sono elettrici." },
  { steps: [6], at: [7, 1.75, -1.6], title: "Teak", text: "Coperta interamente in teak, doghe allineate alla falchetta." },
  // Vele
  { steps: [7], at: [-2, 11, 0.7], title: "Randa", text: "86,1 m², P 24,00 m, E 7,04 m." },
  { steps: [7], at: [5.2, 9, 0.9], title: "Fiocco", text: "107,9 m², inferitura 26,56 m." },
  { steps: [7], at: [1.7, 25.5, 0], title: "Albero", text: "Passante in chiglia, tre ordini di crocette, testa a 27,5 m sull'acqua." },
  // Caratteristiche marine
  { steps: [8], at: [0.1, -2.9, 0.27], title: "Zavorra 14,4 t", text: "Il 40% del dislocamento, concentrato in basso." },
  { steps: [8], at: [-3, 0.02, 2.65], title: "Galleggiamento", text: "16,80 m su 19,98 di lunghezza fuori tutto." },
  { steps: [8], at: [-8.1, -1.7, 0.08], title: "Skeg", text: "Davanti al timone, come sulle barche da giro del mondo." },
  // Interni
  { steps: [10, 11], at: [-6.3, 0.4, 0], title: "Armatore", text: "Cabina di poppa con due cuccette, bagno e doccia." },
  { steps: [10], at: [-2.7, 0.5, 0.1], title: "Sala macchine", text: "Sotto il pozzetto: Perkins 6.354 e, su molti scafi, un generatore aggiunto dopo." },
  { steps: [10], at: [-2.1, 0.5, -1.5], title: "Cucina", text: "A sinistra, banco a L con penisola, vicino alla scala." },
  { steps: [10], at: [-1.45, 0.5, 1.6], title: "Carteggio", text: "A dritta, con la cabina ospiti alle spalle." },
  { steps: [10], at: [0.4, 0.5, -0.9], title: "Dinette", text: "Tavolo a U e divani in pelle rossa attorno all'albero." },
  { steps: [11], at: [-3.5, 0.4, 2.0], title: "Ospiti a dritta", text: "Cabina con cuccetta, alle spalle del carteggio." },
  { steps: [10, 11], at: [3.2, 0.4, 0], title: "Cabine ospiti", text: "Due cabine e due bagni prodieri." },
  { steps: [10, 11], at: [6.3, 0.4, 0], title: "Cabina a V", text: "A prua, prima del gavone delle vele." },
  // Materiali
  { steps: [12], at: [0.3, 0.5, -1.55], title: "Pelle rossa", text: "Divani della dinette, scelta per questa ricostruzione." },
  { steps: [12], at: [1.59, 0.7, -0.6], title: "Teak miele", text: "Paratie e mobili in teak satinato." },
  { steps: [12], at: [-0.6, -0.28, -0.3], title: "Teak e holly", text: "Pagliolo a listelli, il classico dei Swan nordici." },
];
