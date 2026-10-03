// Grafici della colonna di destra disegnati in SVG, nello stile di polare e mappa (charts.js).
// Usano solo dati già verificati: passi.js, reference/swan651-data.json e agent/knowledge/scafi.md.
import { PROFILO, PIANTA } from "./contorni.js";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent?.appendChild(n);
  return n;
};
const testo = (parent, x, y, s, attrs = {}) => {
  const t = el("text", { x, y, ...attrs }, parent);
  t.textContent = s;
  return t;
};
// gli elementi con classe "entra" compaiono uno dopo l'altro quando il pannello si apre
const entra = (n, i) => {
  n.classList.add("entra");
  n.style.transitionDelay = `${0.25 + i * 0.08}s`;
  return n;
};
// quota con le due stanghette: orizzontale se y1 === y2, verticale se x1 === x2
function quota(g, x1, y1, x2, y2, label, { lato = -5, anchor = "middle" } = {}) {
  el("line", { class: "quota", x1, y1, x2, y2 }, g);
  const v = x1 === x2;
  for (const [x, y] of [[x1, y1], [x2, y2]]) {
    el("line", { class: "quota", x1: v ? x - 3 : x, y1: v ? y : y - 3, x2: v ? x + 3 : x, y2: v ? y : y + 3 }, g);
  }
  if (v) return testo(g, x1 + lato, (y1 + y2) / 2 + 3, label, { "text-anchor": anchor, class: "quota-lab" });
  return testo(g, (x1 + x2) / 2, y1 + lato, label, { "text-anchor": anchor, class: "quota-lab" });
}

// sagoma di profilo: sopra da poppa a prua, poi il fondo a ritroso
function pathProfilo(sx, sy) {
  const sopra = PROFILO.map(([x, a]) => `${sx(x)},${sy(a)}`);
  const sotto = PROFILO.slice().reverse().map(([x, , b]) => `${sx(x)},${sy(b)}`);
  return `M${sopra.join("L")}L${sotto.join("L")}Z`;
}
function pathPianta(sx, cy, k) {
  const sx_ = PIANTA.map(([x, l]) => `${sx(x)},${cy - l * k}`);
  const dx = PIANTA.slice().reverse().map(([x, , r]) => `${sx(x)},${cy + r * k}`);
  return `M${sx_.join("L")}L${dx.join("L")}Z`;
}
// dove il fondo taglia il galleggiamento: estremi della linea d'acqua
function galleggiamento() {
  const sotto = PROFILO.filter(([, , b]) => b < 0);
  return [sotto[0][0], sotto.at(-1)[0]];
}

// ---------- Scheda della barca ----------
// I dati generali d'apertura, gli stessi delle schede di passi.js
const SCHEDA = [
  ["Progetto", "Germán Frers"],
  ["Cantiere", "Nautor's Swan"],
  ["Costruita", "1982-1991"],
  ["Esemplari", "19"],
  ["Lunghezza", "19,98 m"],
  ["Baglio", "5,31 m"],
  ["Dislocamento", "36,0 t"],
  ["Zavorra", "14,4 t"],
  ["Armo", "Sloop"],
  ["Vele di bolina", "~194 m²"],
];
export function drawScheda(svg) {
  // sagoma di profilo in alto, poi i dati su due colonne
  const k = 15;
  const sx = (m) => 50 + m * k;
  const wl = 42;
  const sy = (m) => wl - m * k;
  const g = el("g", {}, svg);
  el("path", { class: "scafo-sagoma", d: pathProfilo(sx, sy) }, g);
  el("line", { class: "acqua", x1: 20, y1: wl, x2: 380, y2: wl }, g);
  SCHEDA.forEach(([etichetta, valore], i) => {
    const x = i % 2 ? 214 : 14;
    const y = 132 + Math.floor(i / 2) * 42;
    const r = entra(el("g", {}, svg), i);
    el("line", { class: "asse", x1: x, y1: y - 26, x2: x + 172, y2: y - 26 }, r);
    testo(r, x, y - 12, etichetta.toUpperCase());
    testo(r, x, y + 8, valore, { class: "medio" });
  });
}

// ---------- Registro degli scafi ----------
const SCAFI = {
  1: "Futuro", 2: "Adrienne II", 4: "Ichiban", 5: "Show Me", 6: "Rosbeg", 7: "Lunz am Meer",
  8: "Deneb", 9: "Whisper of V", 10: "Tihama", 11: "Spirit of Helsinki", 14: "White Knight of NY",
  16: "Geronimo", 17: "Aurora",
};
function aCapo(nome) {
  if (nome.length <= 13) return [nome];
  const spazi = [...nome.matchAll(/ /g)].map((m) => m.index);
  const meta = nome.length / 2;
  const i = spazi.reduce((a, b) => (Math.abs(b - meta) < Math.abs(a - meta) ? b : a));
  return [nome.slice(0, i), nome.slice(i + 1)];
}
export function drawRegistro(svg) {
  const col = 5;
  const w = 80;
  const h = 56;
  for (let n = 1; n <= 19; n++) {
    const i = n - 1;
    const x = (i % col) * w + 8;
    const y = Math.floor(i / col) * h + 14;
    const nome = SCAFI[n];
    const g = entra(el("g", { class: `scafo${nome ? " noto" : ""}${n === 7 ? " qui" : ""}` }, svg), i * 0.5);
    el("circle", { cx: x + 4, cy: y, r: 3.2 }, g);
    testo(g, x + 12, y + 3, `651-${String(n).padStart(3, "0")}`, { class: "num-scafo" });
    aCapo(nome || "non identificato").forEach((riga, k) => testo(g, x, y + 18 + k * 11, riga, { class: "nome-scafo" }));
  }
  return `<span class="lnoto">13 identificati</span><span class="lignoto">6 senza nome</span>`;
}

// ---------- Dimensioni: profilo e pianta ----------
export function drawDimensioni(svg) {
  const k = 17.5;
  const sx = (m) => 22 + m * k;
  const wl = 62;
  const sy = (m) => wl - m * k;
  const g = el("g", {}, svg);
  el("path", { class: "scafo-sagoma", d: pathProfilo(sx, sy) }, g);
  const [a, b] = galleggiamento();
  el("line", { class: "acqua", x1: 8, y1: wl, x2: 392, y2: wl }, g);
  quota(g, sx(0), 20, sx(19.98), 20, "LUNGHEZZA 19,98 M");
  const chiglia = sy(Math.min(...PROFILO.map((p) => p[2])));
  quota(g, sx(a), chiglia + 10, sx(b), chiglia + 10, "GALLEGGIAMENTO 16,80 M", { lato: 12 });
  const cy = 210;
  el("path", { class: "scafo-sagoma", d: pathPianta(sx, cy, k) }, g);
  const largo = PIANTA.reduce((m, p) => (p[1] + p[2] > m[1] + m[2] ? p : m));
  quota(g, sx(largo[0]), cy - largo[1] * k, sx(largo[0]), cy + largo[2] * k, "BAGLIO 5,31 M", { lato: -8, anchor: "end" });
}

// ---------- Carena: pinna, bulbo e timone ----------
export function drawCarena(svg) {
  const k = 18;
  const sx = (m) => 20 + m * k;
  const wl = 70;
  const sy = (m) => wl - m * k;
  const g = el("g", {}, svg);
  el("clipPath", { id: "sotto-acqua" }, g).appendChild(el("rect", { x: 0, y: wl, width: 400, height: 200 }));
  const d = pathProfilo(sx, sy);
  el("path", { class: "scafo-sagoma", d }, g);
  el("path", { class: "opera-viva", d, "clip-path": "url(#sotto-acqua)" }, g);
  el("line", { class: "acqua", x1: 6, y1: wl, x2: 394, y2: wl }, g);
  testo(g, 392, wl - 5, "GALLEGGIAMENTO", { "text-anchor": "end" });
  // il punto più profondo della pinna e quello del timone (nella parte poppiera)
  const minimo = Math.min(...PROFILO.map((p) => p[2]));
  const bulbo = PROFILO.filter((p) => p[2] < minimo + 0.05);
  const fondo = [(bulbo[0][0] + bulbo.at(-1)[0]) / 2, 0, minimo];
  const timone = PROFILO.filter(([x]) => x < 4).reduce((m, p) => (p[2] < m[2] ? p : m));
  quota(g, sx(bulbo.at(-1)[0]) + 14, wl, sx(bulbo.at(-1)[0]) + 14, sy(fondo[2]), "PESCAGGIO 3,23 M", { lato: 6, anchor: "start" });
  const richiamo = (x, y, lx, ly, s, i) => {
    const r = entra(el("g", {}, g), i);
    el("line", { class: "richiamo", x1: x, y1: y, x2: lx, y2: ly }, r);
    el("circle", { class: "punto", cx: x, cy: y, r: 2.4 }, r);
    testo(r, lx, ly + (ly > y ? 10 : -4), s, { "text-anchor": "middle" });
  };
  richiamo(sx(fondo[0]), sy(fondo[2]) - 3, sx(fondo[0]), sy(fondo[2]) + 22, "PINNA CON BULBO IN PIOMBO", 0);
  richiamo(sx(timone[0]), sy(timone[2]) - 3, sx(timone[0]) + 22, sy(timone[2]) + 28, "TIMONE SU SKEG", 1);
}

// ---------- Armo: piano velico quotato ----------
// Misure dal certificato IRC di Lunz am Meer; I non è nel certificato ed è stimata.
export function drawArmo(svg) {
  const k = 8.6;
  const x0 = 34;
  const sx = (m) => x0 + m * k;
  const wl = 262;
  const sy = (m) => wl - m * k;
  const g = el("g", {}, svg);
  el("path", { class: "scafo-sagoma", d: pathProfilo(sx, sy) }, g);
  el("line", { class: "acqua", x1: 4, y1: wl, x2: 256, y2: wl }, g);
  const coperta = 1.3;
  const prua = 19.3;
  const albero = prua - 8.05;
  const boma = coperta + 1.9;
  const testa = boma + 24;
  const I = coperta + 25.31;
  // fiocco e randa, poi albero e crocette
  el("path", { class: "vela fiocco", d: `M${sx(prua)},${sy(coperta + 0.4)}L${sx(albero + 0.15)},${sy(I)}L${sx(albero - 0.6)},${sy(coperta + 0.9)}Z` }, g);
  el("path", { class: "vela randa", d: `M${sx(albero)},${sy(boma)}L${sx(albero)},${sy(testa)}L${sx(albero - 7.04)},${sy(boma)}Z` }, g);
  el("line", { class: "albero", x1: sx(albero), y1: sy(coperta), x2: sx(albero), y2: sy(testa + 0.4) }, g);
  el("line", { class: "albero", x1: sx(albero), y1: sy(boma), x2: sx(albero - 7.04), y2: sy(boma) }, g);
  for (const f of [0.3, 0.52, 0.74]) {
    const y = sy(coperta + (testa - coperta) * f);
    el("line", { class: "crocetta", x1: sx(albero) - 9, y1: y, x2: sx(albero) + 9, y2: y }, g);
  }
  el("line", { class: "strallo", x1: sx(prua), y1: sy(coperta + 0.3), x2: sx(albero), y2: sy(I) }, g);
  el("line", { class: "strallo", x1: sx(albero), y1: sy(testa + 0.4), x2: sx(0.4), y2: sy(coperta + 0.2) }, g);
  entra(quota(g, sx(albero) + 22, sy(boma), sx(albero) + 22, sy(testa), "P 24,00", { lato: 4, anchor: "start" }), 0);
  entra(quota(g, sx(albero - 7.04), sy(boma) + 9, sx(albero), sy(boma) + 9, "E 7,04", { lato: 11 }), 1);
  // l'etichetta di J sta oltre la prua, fuori dal fiocco
  const j = entra(quota(g, sx(albero), sy(coperta) - 8, sx(prua), sy(coperta) - 8, "J 8,05"), 2);
  j.setAttribute("x", sx(prua) + 5);
  j.setAttribute("y", sy(coperta) - 5);
  j.setAttribute("text-anchor", "start");
  entra(quota(g, 8, sy(coperta), 8, sy(I), "I ~25,3", { lato: 4, anchor: "start" }), 3);
  return `<span class="lranda">Randa</span><span class="lfiocco">Fiocco</span>`;
}

// ---------- Vele: superfici a confronto ----------
const VELE = [
  ["Randa", 86.1],
  ["Fiocco", 107.9],
  ["Genoa 150%", 161.8],
  ["Spinnaker", 388],
];
export function drawVele(svg) {
  const max = 400;
  const x0 = 92;
  const w = 268;
  VELE.forEach(([nome, m2], i) => {
    const y = 22 + i * 44;
    testo(svg, x0 - 10, y + 13, nome.toUpperCase(), { "text-anchor": "end" });
    el("rect", { class: "binario", x: x0, y, width: w, height: 18 }, svg);
    const b = el("rect", { class: `barra${nome === "Spinnaker" ? " forte" : ""}`, x: x0, y, width: (m2 / max) * w, height: 18 }, svg);
    b.style.transitionDelay = `${0.3 + i * 0.12}s`;
    entra(testo(svg, x0 + (m2 / max) * w + 6, y + 13, `${String(m2).replace(".", ",")} m²`, { class: "valore" }), i + 3);
  });
  for (const v of [0, 100, 200, 300, 400]) testo(svg, x0 + (v / max) * w, 198, v, { "text-anchor": "middle" });
}

// ---------- Pesi: zavorra sul dislocamento ----------
export function drawPesi(svg) {
  const cx = 110;
  const cy = 110;
  const r = 78;
  el("circle", { class: "anello", cx, cy, r }, svg);
  const quota_ = 14.4 / 36;
  const a = -Math.PI / 2 + quota_ * Math.PI * 2;
  const x = cx + r * Math.cos(a);
  const y = cy + r * Math.sin(a);
  el("path", { class: "traccia zavorra", d: `M${cx},${cy - r}A${r},${r} 0 0 1 ${x},${y}`, pathLength: 1 }, svg);
  testo(svg, cx, cy + 12, "40%", { class: "grande", "text-anchor": "middle" });
  testo(svg, cx, cy + 30, "DEL PESO È ZAVORRA", { "text-anchor": "middle" });
  const riga = (yy, v, s, cls, i) => {
    const g = entra(el("g", {}, svg), i);
    el("rect", { class: `chip ${cls}`, x: 222, y: yy - 9, width: 10, height: 10 }, g);
    testo(g, 242, yy, v, { class: "medio" });
    testo(g, 242, yy + 15, s);
  };
  riga(72, "14,4 t", "ZAVORRA IN PIOMBO", "zavorra", 0);
  riga(130, "36,0 t", "DISLOCAMENTO", "totale", 1);
  testo(svg, 222, 182, "PESCAGGIO 3,23 M");
}

// ---------- Palmarès di Lunz am Meer ----------
const PALMARES = [
  ["2012", "13ª", "Rolex Swan Cup"],
  ["2016", "7ª", "Swan Cup, Mini Maxi"],
  ["2018", "1ª", "Swan Cup, Classics by Frers"],
  ["2018", "4ª", "Middle Sea Race, IRC"],
  ["2019", "1ª", "Tre Golfi, classe Maxi"],
  ["2019", "2ª", "Maxi Yacht Rolex Cup"],
  ["2022", "5ª", "Rolex Swan Cup"],
  ["2026", "1ª", "Swan Cup, Classics by Frers"],
];
export function drawPalmares(svg) {
  const x = 64;
  const passo = 31;
  el("line", { class: "asse", x1: x, y1: 12, x2: x, y2: 12 + passo * (PALMARES.length - 1) + 8 }, svg);
  PALMARES.forEach(([anno, pos, gara], i) => {
    const y = 18 + i * passo;
    const g = entra(el("g", { class: pos === "1ª" ? "vittoria" : "" }, svg), i);
    if (anno !== PALMARES[i - 1]?.[0]) testo(g, x - 14, y + 3, anno, { "text-anchor": "end" });
    el("circle", { class: "punto", cx: x, cy: y, r: pos === "1ª" ? 4 : 2.6 }, g);
    testo(g, x + 16, y + 6, pos, { class: "posizione" });
    testo(g, x + 54, y + 3, gara.toUpperCase());
  });
}
