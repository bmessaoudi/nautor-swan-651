// Effetti d'archivio dell'ingresso (overlay #mode), insieme alla galleria di gallery.js.
//
// createFilm: la pellicola in proiezione. Polvere, peli e graffi verticali disegnati su un canvas
// a 12 fotogrammi al secondo, come una copia proiettata; il tremolio di luce, la vignettatura e
// l'ondeggiamento del fotogramma sono in CSS (.film-flicker, .mode-gallery). Tutto molto lieve:
// deve restare atmosfera, non diventare un "vecchio film" posticcio.
//
// createTimeline: la linea del tempo su tutta la larghezza, con le tappe della storia di Nautor e
// dello Swan 651 fino a oggi; un marcatore la percorre e accende ogni tappa al suo arrivo.

const FPS = 12;
/** Granelli di polvere per fotogramma, al massimo. */
const MAX_DUST = 5;
/** Probabilità per fotogramma che compaia un graffio e che passi un pelo. */
const SCRATCH_CHANCE = 0.07;
const HAIR_CHANCE = 0.04;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createFilm(canvas) {
  if (reducedMotion()) return { stop() {} };
  const ctx = canvas.getContext("2d");
  let scratches = [];

  const resize = () => {
    // risoluzione piena non serve: sono segni piccoli e tremolanti
    canvas.width = Math.round(innerWidth);
    canvas.height = Math.round(innerHeight);
  };

  const draw = () => {
    const { width: W, height: H } = canvas;
    ctx.clearRect(0, 0, W, H);

    // polvere: granelli chiari e scuri, diversi a ogni fotogramma
    const dust = Math.floor(Math.random() * (MAX_DUST + 1));
    for (let i = 0; i < dust; i++) {
      const light = Math.random() < 0.6;
      ctx.fillStyle = light ? `rgba(255, 250, 235, ${0.25 + Math.random() * 0.35})` : `rgba(0, 0, 0, ${0.3 + Math.random() * 0.3})`;
      ctx.beginPath();
      ctx.arc(Math.random() * W, Math.random() * H, 0.6 + Math.random() * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // un pelo ogni tanto: una curva sottile che resta un solo fotogramma
    if (Math.random() < HAIR_CHANCE) {
      const x = Math.random() * W;
      const y = Math.random() * H;
      const len = 14 + Math.random() * 30;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + len * 0.3, y - len * 0.4, x + len * 0.7, y + len * 0.3, x + len, y - len * 0.1);
      ctx.stroke();
    }

    // graffi verticali: durano qualche fotogramma e scivolano appena di lato
    if (Math.random() < SCRATCH_CHANCE) {
      scratches.push({ x: Math.random() * W, life: 4 + Math.floor(Math.random() * 14), alpha: 0.08 + Math.random() * 0.14 });
    }
    scratches = scratches.filter((s) => s.life-- > 0);
    for (const s of scratches) {
      s.x += (Math.random() - 0.5) * 1.5;
      ctx.strokeStyle = `rgba(255, 250, 235, ${s.alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      // tratti interrotti, come un graffio vero sull'emulsione
      for (let y = 0; y < H; y += 40 + Math.random() * 120) {
        ctx.moveTo(s.x, y);
        ctx.lineTo(s.x, y + 30 + Math.random() * 160);
      }
      ctx.stroke();
    }
  };

  resize();
  window.addEventListener("resize", resize);
  const timer = setInterval(draw, 1000 / FPS);

  return {
    stop() {
      clearInterval(timer);
      window.removeEventListener("resize", resize);
    },
  };
}

/**
 * Le tappe della linea del tempo: anno, didascalia, quanto restarci (s) e quanto metterci ad arrivare (s).
 * 1982 e 1986 vengono dai dati verificati del progetto (HANDOFF.md); le altre sono tappe note
 * della storia di Nautor, da confermare con le fonti del cantiere.
 */
const MILESTONES = [
  { year: 1966, caption: "Nautor nasce a Pietarsaari", hold: 1.2, travel: 0 },
  { year: 1974, caption: "Uno Swan 65 vince la prima Whitbread", hold: 1.2, travel: 1.1 },
  { year: 1982, caption: "Nasce lo Swan 651 di Germán Frers", hold: 2.2, travel: 1.1 },
  { year: 1986, caption: "Uno Swan 651 è terzo alla Whitbread", hold: 1.2, travel: 1.1 },
  { year: 1998, caption: "Leonardo Ferragamo rileva Nautor", hold: 1.2, travel: 1.1 },
  { year: new Date().getFullYear(), caption: "Oggi", hold: 0, travel: 1.1 },
];

export function createTimeline(el) {
  // tutte le tappe su una riga: anno sopra la linea, punto sulla linea, didascalia sotto
  const track = document.createElement("div");
  track.className = "tl-track";
  const fill = document.createElement("i");
  fill.className = "tl-fill";
  const head = document.createElement("span");
  head.className = "tl-head";
  track.append(fill, head);
  const last = MILESTONES.length - 1;
  const steps = MILESTONES.map((m, i) => {
    const step = document.createElement("div");
    step.className = "tl-step";
    step.style.left = `${(i / last) * 100}%`;
    step.innerHTML = `<b class="tl-year">${m.year}</b><span class="tl-dot"></span><span class="mono tl-caption">${m.caption}</span>`;
    track.appendChild(step);
    return step;
  });
  // su schermi stretti si legge solo la didascalia della tappa accesa, in un'area unica sotto la riga
  const current = document.createElement("span");
  current.className = "tl-current";
  el.append(track, current);
  // ogni tappa sta al centro di una cella uguale della riga: il CSS ricava le misure da --tl-n
  el.style.setProperty("--tl-n", MILESTONES.length);

  // pos va da 0 (prima tappa) a last (ultima): il marcatore e il tratto pieno la seguono
  let shownPos = -1;
  const show = (pos) => {
    if (pos === shownPos) return;
    shownPos = pos;
    const pct = `${(pos / last) * 100}%`;
    fill.style.width = pct;
    head.style.left = pct;
    steps.forEach((step, i) => {
      const on = Math.abs(pos - i) < 0.001;
      step.classList.toggle("on", on);
      step.classList.toggle("past", pos - i >= 0.001);
    });
    // didascalia unica (schermi stretti): quella dell'ultima tappa raggiunta
    const reached = MILESTONES[Math.min(last, Math.floor(pos + 0.001))].caption;
    if (current.textContent !== reached) current.textContent = reached;
  };

  if (reducedMotion()) {
    show(last);
    return { stop() {} };
  }

  // la sequenza come elenco di tratti: sosta su una tappa, poi corsa verso la successiva
  const segments = [];
  let at = 0.6; // un attimo prima di partire, mentre l'ingresso compare
  MILESTONES.forEach((m, i) => {
    if (i > 0) {
      segments.push({ from: i - 1, to: i, start: at, end: at + m.travel });
      at += m.travel;
    }
    segments.push({ from: i, to: i, start: at, end: at + m.hold });
    at += m.hold;
  });

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const t0 = performance.now();
  let frame = 0;
  // il marcatore avanza a 30 fotogrammi al secondo, come il resto del sito
  let lastTick = -Infinity;
  const tick = (now) => {
    if (now - lastTick < 1000 / 30 - 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    lastTick = now;
    const t = (performance.now() - t0) / 1000;
    const seg = segments.find((s) => t < s.end) ?? segments[segments.length - 1];
    const k = seg.end > seg.start ? ease(Math.min(1, Math.max(0, (t - seg.start) / (seg.end - seg.start)))) : 1;
    show(seg.from + (seg.to - seg.from) * k);
    if (t < at) frame = requestAnimationFrame(tick);
    else show(last);
  };
  show(0);
  frame = requestAnimationFrame(tick);

  return {
    stop() {
      cancelAnimationFrame(frame);
    },
  };
}
