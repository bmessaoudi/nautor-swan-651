// Copia statica dell'indice che la pagina manda all'agente (web/src/bordo/bridge.js, readIndex).
// Nelle simulations di LiveKit non c'è la pagina: l'agente legge questo file.
// Rigenera dopo ogni modifica a passi, dettagli o immagini, dalla cartella web/:
//   pnpm run indice-agente
// I moduli passano da Vite perché importano JSON e asset come fa la pagina
import { writeFileSync } from "node:fs";
import { createServer } from "vite";

const vite = await createServer({ root: process.cwd(), logLevel: "error", server: { middlewareMode: true } });
const load = (p) => vite.ssrLoadModule(p);
const { CHAPTERS, HOTSPOTS } = await load("/src/story.js");
const { PASSI } = await load("/src/bordo/passi.js");
const { IMMAGINI } = await load("/src/bordo/immagini.js");
const { GRAFICI } = await load("/src/bordo/media.js");
const { CHAPTER_NAMES, chapterOf } = await load("/src/bordo/bridge.js");
await vite.close();

const PRESETS = ["alba", "mattino", "mezzogiorno", "pomeriggio", "tramonto", "foschia", "pioggia"];

const indice = {
  passi: PASSI.map((p, i) => ({ passo: i, capitolo: chapterOf(CHAPTERS, i), ...p })),
  capitoli: CHAPTER_NAMES.map((nome, i) => ({ nome, passo: CHAPTERS[i] })),
  hotspots: HOTSPOTS.map((h, i) => ({ id: i, passo: h.steps[0], titolo: h.title, testo: h.text })),
  immagini: [...GRAFICI, ...IMMAGINI].map(({ id, titolo, descrizione }) => ({ id, titolo, descrizione })),
  atmosfere: PRESETS,
};
writeFileSync(new URL("../../agent/simulazione/indice.json", import.meta.url), JSON.stringify(indice, null, 2) + "\n");
console.log(`indice.json: ${indice.passi.length} passi, ${indice.hotspots.length} dettagli, ${indice.immagini.length} immagini`);
