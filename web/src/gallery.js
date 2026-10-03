// Galleria d'archivio dietro all'ingresso (overlay #mode): foto che salgono lente su tutta la
// larghezza; verso il centro si velano, così il testo della card resta leggibile.
//
// Salendo ogni foto si sviluppa come una stampa in camera oscura: in basso è slavata, seppia e
// granulosa; a metà prende densità e contrasto in bianco e nero; in alto affiora il colore e la
// grana sparisce. Intanto passa da velata a piena. Lo stesso sfondo resta per tutti e due i passi
// dell'ingresso.
//
// Profondità di campo: le foto stanno su tre piani, come in una ripresa con un obiettivo vero.
// Lontano: piccole, lente, appena morbide. Al centro: il piano a fuoco, con la messa a fuoco che
// arriva mentre la foto si sviluppa. Vicino: poche foto grandi, veloci e sfocate, davanti alle altre.
//
// La disposizione sembra casuale: larghezza, proporzioni, allineamento e distanza di ogni foto
// sono estratti a sorte. Il sorteggio cambia a ogni visita ma resta lo stesso per tutta la
// permanenza (anche ridimensionando la finestra), e ogni colonna ripete la sua sequenza identica,
// così il ciclo non mostra salti.

const PHOTOS = Array.from({ length: 20 }, (_, i) => `/img/archivio/${String(i + 1).padStart(2, "0")}.jpg`);
/** Proporzioni possibili (altezza / larghezza): orizzontali, quadrate, verticali. */
const RATIOS = [0.6, 0.68, 0.75, 1, 1.25];
/** Opacità delle foto in basso: salendo arrivano piene. */
const MIN_OPACITY = 0.35;
/** Opacità delle foto al centro dello schermo, dietro la card: verso i bordi arrivano piene. */
const CENTER_OPACITY = 0.3;

/**
 * I tre piani, dal fondo al primo piano.
 * columnWidth: larghezza indicativa di una colonna (da qui il numero di colonne);
 * width: larghezza delle foto rispetto alla colonna [min, max]; gap: distanza fra foto [min, max];
 * speed: px/s verso l'alto (negativa per scendere); blur: sfocatura fissa in px;
 * focusPull: sfocatura in più che sparisce mentre la foto si sviluppa; opacity: attenuazione del piano.
 */
const LAYERS = [
  { name: "far", columnWidth: 480, width: [0.32, 0.5], gap: [320, 620], speed: 11, blur: 1.2, focusPull: 0, opacity: 0.5 },
  { name: "mid", columnWidth: 340, width: [0.62, 1], gap: [70, 200], speed: 21, blur: 0, focusPull: 3, opacity: 1 },
  { name: "near", columnWidth: 720, width: [0.38, 0.6], gap: [1200, 2000], speed: 46, blur: 7, focusPull: 0, opacity: 0.6 },
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const between = (rand, [a, b]) => a + rand() * (b - a);

// Generatore pseudo-casuale con seme (mulberry32): stesso seme, stessa disposizione.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGallery(host) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const seed = (Math.random() * 2 ** 32) >>> 0;
  let columns = [];
  let frame = 0;
  let stopped = false;
  const start = performance.now();

  function buildLayer(layer, rand, order) {
    const vw = innerWidth;
    const vh = innerHeight;
    const el = document.createElement("div");
    el.className = `gal-layer gal-${layer.name}`;
    host.appendChild(el);

    const nCols = Math.max(layer.name === "near" ? 1 : 2, Math.round(vw / layer.columnWidth));
    // ogni piano parte da un punto diverso della lista, così i piani non mostrano le stesse foto
    const offset = Math.floor(rand() * order.length);
    const list = order.map((_, i) => order[(i + offset) % order.length]);
    const cols = [];
    for (let c = 0; c < nCols; c++) {
      const colEl = document.createElement("div");
      colEl.className = "gal-col";
      el.appendChild(colEl);
      cols.push({
        el: colEl,
        list: list.filter((_, i) => i % nCols === c),
        items: [],
        speed: layer.speed * between(rand, [0.85, 1.15]),
        // partenze sfalsate, così le colonne non iniziano tutte alla stessa altezza
        phase: rand() * 900,
        layer,
      });
    }

    // misura dopo l'inserimento: la larghezza delle colonne viene dal CSS
    const colW = cols[0].el.getBoundingClientRect().width || 200;
    for (const col of cols) {
      // quanto la colonna sta verso il centro (0 al centro, 1 ai bordi): al centro le foto si velano
      const r = col.el.getBoundingClientRect();
      const edge = Math.abs(r.left + r.width / 2 - vw / 2) / (vw / 2);
      col.fade = layer.opacity * (CENTER_OPACITY + (1 - CENTER_OPACITY) * smooth(0.12, 0.62, edge));

      // una sequenza estratta a sorte per colonna, poi ripetuta identica
      let y = 0;
      const layout = col.list.map((src) => {
        const w = Math.round(colW * between(rand, layer.width));
        const h = Math.round(w * RATIOS[Math.floor(rand() * RATIOS.length)]);
        // può sconfinare un poco nelle colonne vicine, così i bordi non si allineano
        const x = Math.round(rand() * (colW - w) + (rand() - 0.5) * 0.3 * colW);
        const slot = { src, x, y, w, h };
        y += h + between(rand, layer.gap);
        return slot;
      });
      col.loopH = y;
      const copies = Math.ceil((vh + col.loopH) / col.loopH) + 1;
      for (let k = 0; k < copies; k++) {
        for (const slot of layout) {
          const fig = document.createElement("figure");
          fig.className = "gal-item";
          const top = slot.y + k * col.loopH;
          Object.assign(fig.style, { left: slot.x + "px", top: top + "px", width: slot.w + "px", height: slot.h + "px" });
          const img = document.createElement("img");
          img.src = slot.src;
          img.alt = "";
          img.decoding = "async";
          const grain = document.createElement("i");
          grain.className = "gal-grain";
          fig.append(img, grain);
          col.el.appendChild(fig);
          col.items.push({ fig, img, grain, center: top + slot.h / 2, h: slot.h });
        }
      }
    }
    return cols;
  }

  function build() {
    host.replaceChildren();
    const rand = random(seed);
    // le foto mescolate una volta sola, poi ogni piano le prende da un punto diverso
    const order = PHOTOS.map((src) => ({ src, k: rand() }))
      .sort((a, b) => a.k - b.k)
      .map((p) => p.src);
    columns = LAYERS.flatMap((layer) => buildLayer(layer, rand, order));
    update();
  }

  function update() {
    const t = reducedMotion ? 0 : (performance.now() - start) / 1000;
    const vh = innerHeight;
    for (const col of columns) {
      const { blur, focusPull } = col.layer;
      const travel = t * col.speed + col.phase;
      const offset = ((travel % col.loopH) + col.loopH) % col.loopH;
      col.el.style.transform = `translate3d(0, ${(-offset).toFixed(1)}px, 0)`;
      for (const item of col.items) {
        const center = item.center - offset;
        if (center < -item.h || center > vh + item.h) continue;
        // 0 in basso, 1 in alto
        const p = 1 - clamp01(center / vh);
        const density = smooth(0, 0.45, p);
        const color = smooth(0.4, 0.85, p);
        // messa a fuoco: sul piano centrale arriva insieme allo sviluppo
        const focus = blur + focusPull * (1 - smooth(0.15, 0.55, p));
        item.img.style.filter =
          `grayscale(${(1 - color).toFixed(3)}) sepia(${(0.35 * (1 - color)).toFixed(3)}) ` +
          `contrast(${(0.55 + 0.5 * density).toFixed(3)}) brightness(${(1.35 - 0.35 * density).toFixed(3)})` +
          (focus > 0.05 ? ` blur(${focus.toFixed(2)}px)` : "");
        item.img.style.transform = `scale(${(1.1 - 0.1 * p).toFixed(4)})`;
        item.grain.style.opacity = (0.45 * (1 - color)).toFixed(3);
        item.fig.style.opacity = ((MIN_OPACITY + (1 - MIN_OPACITY) * smooth(0, 0.8, p)) * col.fade).toFixed(3);
      }
    }
  }

  function loop() {
    if (stopped) return;
    update();
    frame = requestAnimationFrame(loop);
  }

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 150);
  };

  build();
  window.addEventListener("resize", onResize);
  if (!reducedMotion) frame = requestAnimationFrame(loop);

  return {
    stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    },
  };
}
