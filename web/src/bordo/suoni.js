// Paesaggio sonoro della pagina a voce. Gli ambienti sono loop sempre in esecuzione, con il
// volume calcolato a ogni fotogramma dallo stato della scena (mare, taglio della coperta, vele
// che sbattono, vento); gli effetti sono colpi singoli legati ai momenti della regia.
// Tutto scende di volume quando parla il computer di bordo: è sottofondo, mai protagonista.
import SUONI from "./suoni.json";

const BASE = "/audio/bordo/";
const MASTER = 0.55; // volume generale del paesaggio sonoro
const DUCK = 0.32; // quota che resta mentre parla l'agente

// volume massimo di ogni ambiente
const LIVELLI = {
  "amb-tavola": 0.35,
  "amb-cantiere": 0.3,
  "amb-sottocoperta": 0.55,
  "amb-voci": 0.16,
  "amb-vele": 0.5,
  "amb-mare": 0.7,
  "amb-vento-forte": 0.45,
  "amb-gabbiani": 0.28,
  "amb-pioggia": 0.4,
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function createSuoni() {
  let ctx = null;
  let master = null;
  let duck = null;
  const buffers = new Map();
  const loops = new Map();
  let muted = false;
  let speaking = false;
  let lastPasso = -1;

  // Il contesto audio nasce al primo gesto (il clic di accensione o di ingresso)
  async function start() {
    if (ctx) return ctx.resume();
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    duck = ctx.createGain();
    duck.connect(master);
    master.connect(ctx.destination);
    const all = [...SUONI.ambienti, ...SUONI.effetti];
    await Promise.all(all.map((s) => load(s.id)));
    for (const a of SUONI.ambienti) {
      const buf = buffers.get(a.id);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(duck);
      // partenza sfalsata: due ambienti non ricominciano mai insieme
      src.start(0, Math.random() * buf.duration);
      loops.set(a.id, { g, level: 0 });
    }
  }

  async function load(id) {
    try {
      const res = await fetch(`${BASE}${id}.mp3`);
      if (!res.ok) throw new Error(res.status);
      buffers.set(id, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch {
      // suono non ancora generato (agent/genera_suoni.py): la pagina funziona lo stesso
      console.info(`[suoni] manca ${id}`);
    }
  }

  function play(id, { gain = 0.7, delay = 0 } = {}) {
    const buf = ctx && buffers.get(id);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(duck);
    src.start(ctx.currentTime + delay);
  }

  // Volumi degli ambienti dallo stato della scena
  function frame({ s, knots, rain, coast }) {
    if (!ctx || loops.size === 0) return;
    const inside = s.cut < 20 ? 1 - s.cut / 20 : 0;
    const land = 1 - s.ocean;
    const want = {
      "amb-tavola": (1 - s.solid) * land,
      "amb-cantiere": s.solid * land * (1 - inside),
      "amb-sottocoperta": inside * land,
      "amb-voci": inside * land,
      "amb-vele": s.luff * s.sails * (1 - inside) * land,
      "amb-mare": s.ocean,
      "amb-vento-forte": s.ocean * clamp01((knots - 12) / 12),
      "amb-gabbiani": s.ocean * (coast === "aperto" ? 0 : 1) * (rain ? 0.3 : 1),
      "amb-pioggia": s.ocean * (rain ? 1 : 0),
    };
    for (const [id, l] of loops) {
      const target = clamp01(want[id] ?? 0) * (LIVELLI[id] ?? 0.4);
      l.level += (target - l.level) * 0.05;
      l.g.gain.setTargetAtTime(l.level, ctx.currentTime, 0.05);
    }
    // mentre parla l'agente gli ambienti si abbassano in fretta e risalgono piano
    duck.gain.setTargetAtTime(speaking ? DUCK : 1, ctx.currentTime, speaking ? 0.12 : 0.9);
  }

  // Effetti legati ai momenti della regia
  function event(name, data) {
    if (!ctx) return;
    if (name === "passo") {
      const p = data;
      const prev = lastPasso;
      lastPasso = p;
      if (p <= 3 && (prev > 3 || prev < 0)) play("fx-carta", { gain: 0.5, delay: 0.4 });
      if (p === 6) play("fx-verricello", { gain: 0.45, delay: 0.8 });
      if (p === 7) {
        play("fx-vela-gonfia", { gain: 0.6, delay: 0.2 });
        play("fx-sartiame", { gain: 0.35, delay: 1.2 });
      }
      if (p === 13 && prev < 13) play("fx-onda", { gain: 0.5, delay: 0.6 });
    }
    if (name === "luci-accese") {
      play("fx-interruttore", { gain: 0.7 });
      play("fx-porta", { gain: 0.5, delay: 0.5 });
    }
    if (name === "accensione") play("fx-accensione", { gain: 0.6 });
    if (name === "spegnimento") play("fx-spegnimento", { gain: 0.5 });
  }

  return {
    start,
    frame,
    event,
    setSpeaking(v) {
      speaking = v;
    },
    get muted() {
      return muted;
    },
    setMuted(v) {
      muted = v;
      if (master) master.gain.setTargetAtTime(v ? 0 : MASTER, ctx.currentTime, 0.2);
    },
  };
}
