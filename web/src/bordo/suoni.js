// Paesaggio sonoro della pagina a voce. Gli ambienti sono loop sempre in esecuzione, con il
// volume calcolato a ogni fotogramma dallo stato della scena (mare, taglio della coperta, vele
// che sbattono, vento); gli effetti sono colpi singoli legati ai momenti della regia.
// Tutto scende di volume quando parla il computer di bordo: è sottofondo, mai protagonista.
import SUONI from "./suoni.json";
// passi in cui comincia un capitolo: lì gli ambienti prendono fiato
import { CHAPTERS as CAPITOLI } from "../story.js";

const BASE = "/audio/bordo/";
const MASTER = 0.55; // volume generale del paesaggio sonoro
const DUCK = 0.32; // quota che resta mentre la voce dell'agente suona
// ambienti che girano con la camera durante la panoramica: vengono da un punto del mondo
const PAN = { "amb-mare": 0.35, "amb-gabbiani": 0.8, "amb-vento-forte": 0.5 };

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
  let premuto = false;
  let lastPasso = -1;
  // livello della voce dell'agente (0..1), dato dalla pagina: il ducking segue la voce vera,
  // così nelle pause fra le frasi il mare risale
  let voce = () => 0;
  let inviluppo = 0;
  let ultimo = 0;
  let respiro = 0;
  let tic = 0;
  let rumore = null;

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
      let out = src.connect(g);
      // StereoPanner costa pochissimo: niente HRTF, solo bilanciamento
      const pan = PAN[a.id] != null ? ctx.createStereoPanner() : null;
      if (pan) out = out.connect(pan);
      out.connect(duck);
      // partenza sfalsata: due ambienti non ricominciano mai insieme
      src.start(0, Math.random() * buf.duration);
      loops.set(a.id, { g, pan, level: 0 });
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

  // Suoni d'interfaccia sintetizzati qui, senza file: un clic secco da strumento di bordo e il
  // ticchettio di un relè mentre il computer pensa
  function clic({ gain = 0.22, freq = 2400, delay = 0 } = {}) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.45, t + 0.04);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.08);
  }
  function setPensa(on) {
    clearTimeout(tic);
    tic = 0;
    if (!on) return;
    // il ticchettio parte solo se l'attesa si allunga: sotto un secondo e poco basta il clic
    const batti = () => {
      clic({ gain: 0.06, freq: 1500 + Math.random() * 300 });
      tic = setTimeout(batti, 420 + Math.random() * 160);
    };
    tic = setTimeout(batti, 1200);
  }
  // fruscio di passaggio fra un capitolo e l'altro: rumore filtrato che sale e scende
  function passaggio() {
    if (!ctx || muted) return;
    if (!rumore) {
      rumore = ctx.createBuffer(1, ctx.sampleRate * 1.6, ctx.sampleRate);
      const d = rumore.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = rumore;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.7);
    f.frequency.exponentialRampToValueAtTime(400, t + 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    src.connect(f).connect(g).connect(master);
    src.start(t);
    // gli ambienti scendono per mezzo secondo, come un respiro fra due scene
    respiro = 1;
  }

  // Volumi degli ambienti dallo stato della scena
  function frame({ s, knots, rain, coast, theta = 0 }) {
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
      // la sorgente sta ferma nel mondo: girando la camera, passa da un orecchio all'altro
      if (l.pan) l.pan.pan.setTargetAtTime(Math.sin(theta) * PAN[id], ctx.currentTime, 0.3);
    }
    // Ducking sulla voce vera: scende in 80 ms quando la voce suona e risale in 600 ms nelle
    // pause. Mentre chi visita parla (speaking senza voce dell'agente) resta giù
    const now = ctx.currentTime;
    const dt = Math.min(0.1, now - ultimo);
    ultimo = now;
    const v = speaking ? Math.max(clamp01(voce() * 2.5), premuto ? 1 : 0) : 0;
    inviluppo += (v - inviluppo) * (1 - Math.exp(-dt / (v > inviluppo ? 0.08 : 0.6)));
    respiro = Math.max(0, respiro - dt * 1.4);
    const quota = 1 - (1 - DUCK) * inviluppo;
    duck.gain.setTargetAtTime(quota * (1 - 0.6 * Math.sin(Math.PI * Math.min(1, respiro))), now, 0.03);
  }

  // Effetti legati ai momenti della regia
  function event(name, data) {
    if (!ctx) return;
    if (name === "passo") {
      const p = data;
      const prev = lastPasso;
      lastPasso = p;
      if (prev >= 0 && CAPITOLI.some((c) => (prev < c) !== (p < c))) passaggio();
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
    // chi visita tiene premuto: ambienti giù anche senza voce dell'agente
    setPremuto(v) {
      premuto = v;
      speaking = v || speaking;
    },
    setVoce(fn) {
      voce = fn;
    },
    clic,
    setPensa,
    get muted() {
      return muted;
    },
    setMuted(v) {
      muted = v;
      if (master) master.gain.setTargetAtTime(v ? 0 : MASTER, ctx.currentTime, 0.2);
    },
  };
}
