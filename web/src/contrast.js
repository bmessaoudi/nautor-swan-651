// Leggibilità adattiva: i testi che stanno direttamente sulla scena 3D, senza una card dietro,
// leggono la luminosità dei pixel che hanno alle spalle nel fotogramma appena disegnato e scelgono
// il tono: chiaro su fondo scuro, scuro su fondo chiaro. Vale per ogni passo, scenario di mare e
// vista, anche quelli che arriveranno, perché guarda l'immagine e non i parametri della scena.
//
// Gli elementi interessati hanno l'attributo data-tone; il CSS ([data-tone="on-dark" | "on-light"])
// ridefinisce i colori del testo e aggiunge un alone morbido del colore opposto.

/** Millisecondi fra due letture: a tempo e non a fotogrammi, così anche dove la scena gira lenta il tono si aggiorna presto. */
const EVERY_MS = 200;
/** Punti letti per elemento, in colonne e righe. */
const COLS = 5;
const ROWS = 3;
// Soglie sulla luminanza relativa dello sfondo (0 nero, 1 bianco). Il punto in cui il testo bianco e
// quello scuro di on-light (#16212b) hanno lo stesso contrasto è circa 0,21; l'isteresi evita che il
// tono sfarfalli quando lo sfondo sta proprio lì intorno.
const LIGHT_ABOVE = 0.25;
const DARK_BELOW = 0.17;

const lin = (c) => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function createAdaptiveTone(renderer) {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  let last = -Infinity;

  // luminanza media dello sfondo dietro l'elemento, letta dal canvas
  function backgroundLuminance(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight) return null;
    const dpr = renderer.getPixelRatio();
    const H = gl.drawingBufferHeight;
    let sum = 0;
    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        const x = r.left + ((i + 0.5) / COLS) * r.width;
        const y = Math.min(innerHeight - 1, Math.max(0, r.top + ((j + 0.5) / ROWS) * r.height));
        gl.readPixels(Math.floor(x * dpr), Math.floor(H - 1 - y * dpr), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        sum += 0.2126 * lin(px[0]) + 0.7152 * lin(px[1]) + 0.0722 * lin(px[2]);
      }
    }
    return sum / (COLS * ROWS);
  }

  return {
    /**
     * Da chiamare subito dopo aver disegnato il fotogramma (prima che il browser lo componga),
     * solo nei fotogrammi in cui si è disegnato davvero.
     */
    update() {
      const now = performance.now();
      if (now - last < EVERY_MS) return;
      last = now;
      for (const el of document.querySelectorAll("[data-tone]")) {
        const L = backgroundLuminance(el);
        if (L === null) continue;
        const current = el.dataset.tone;
        let next = current;
        if (L > LIGHT_ABOVE) next = "on-light";
        else if (L < DARK_BELOW) next = "on-dark";
        else if (!current) next = L > (LIGHT_ABOVE + DARK_BELOW) / 2 ? "on-light" : "on-dark";
        if (next !== current) el.dataset.tone = next;
      }
    },
  };
}
