import * as THREE from "three";

// Condizioni del capitolo Navigazione: ora del giorno, vento e costa.
// Tutto dipende da un seme (?seed=N nell'URL), così una scena riuscita si può rivedere.
// Il caso lavora dentro intervalli scelti a mano: ogni preset è già una scena credibile,
// il seme ne sposta il sole, i colori e il vento di poco.

// mulberry32: generatore piccolo e veloce, abbastanza buono per la grafica
export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => Math.floor(next.range(a, b + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.weighted = (entries) => {
    const tot = entries.reduce((s, e) => s + e[1], 0);
    let r = next() * tot;
    for (const [v, w] of entries) if ((r -= w) <= 0) return v;
    return entries[entries.length - 1][0];
  };
  return next;
}

// Colori in sRGB, come in un'app di grafica. elev e azim in gradi (azimut 0 = prua, verso dritta).
// Il sole resta sempre a poppa sulla dritta: la barca è in luce nelle viste di poppa.
const PRESETS = {
  alba: {
    label: "Alba", elev: 6, zenith: 0x3d5f8f, horizon: 0xf0c9a8, sun: 0xffc08a, light: 0xffc896, intensity: 2.3,
    deep: 0x0a1a2c, mid: 0x2a4a62, ambSky: 0xb7c3d6, ambGround: 0x2a3440, ambI: 0.75,
    exposure: 1.02, fog: [280, 1450], disk: 1, clouds: [0.35, 0.6],
  },
  mattino: {
    label: "Mattino", elev: 30, zenith: 0x2a64a8, horizon: 0xc4d6e3, sun: 0xfff2dc, light: 0xfff0dc, intensity: 3.4,
    deep: 0x03182b, mid: 0x0d4566, ambSky: 0x9cc6ec, ambGround: 0x0d3550, ambI: 0.7,
    exposure: 1, fog: [210, 1650], disk: 1, clouds: [0.15, 0.4],
  },
  mezzogiorno: {
    label: "Mezzogiorno", elev: 52, zenith: 0x1f5fae, horizon: 0xcfe0ea, sun: 0xffffff, light: 0xfffaf0, intensity: 3.7,
    deep: 0x021a30, mid: 0x0b5378, ambSky: 0xa6cdef, ambGround: 0x0b3a58, ambI: 0.7,
    exposure: 0.95, fog: [230, 1800], disk: 1, clouds: [0.1, 0.35],
  },
  pomeriggio: {
    label: "Pomeriggio", elev: 21, zenith: 0x2a64a8, horizon: 0xbfd2e0, sun: 0xfff0d8, light: 0xffe1b5, intensity: 3.4,
    deep: 0x03182b, mid: 0x0d4566, ambSky: 0x9cc6ec, ambGround: 0x0d3550, ambI: 0.7,
    exposure: 1, fog: [180, 1400], disk: 1, clouds: [0.2, 0.5],
  },
  tramonto: {
    label: "Tramonto", elev: 4, zenith: 0x2b3f6b, horizon: 0xe8b08c, sun: 0xff9a52, light: 0xffb27a, intensity: 2.4,
    deep: 0x0b1624, mid: 0x3a3a48, ambSky: 0x8f8fb0, ambGround: 0x2a1a20, ambI: 0.75,
    exposure: 1, fog: [320, 1500], disk: 1, clouds: [0.3, 0.6],
  },
  foschia: {
    label: "Foschia", elev: 30, zenith: 0x8d9fb0, horizon: 0xc9d0d4, sun: 0xe8ecef, light: 0xe8eef2, intensity: 1.6,
    deep: 0x0e2230, mid: 0x2f4f5e, ambSky: 0xc0cad3, ambGround: 0x2c3a44, ambI: 1.15,
    exposure: 1.05, fog: [90, 780], disk: 0.15, clouds: [0.75, 0.95], fogHeight: 70,
  },
  // pioggia: cielo coperto, vento fresco, tutto bagnato
  pioggia: {
    label: "Pioggia", elev: 25, zenith: 0x5f6b78, horizon: 0x9aa4ab, sun: 0xc9ced3, light: 0xc8d0d8, intensity: 1.15,
    deep: 0x0b1a24, mid: 0x26404c, ambSky: 0xa9b4be, ambGround: 0x26323a, ambI: 1.25,
    exposure: 1.12, fog: [70, 700], disk: 0, clouds: [0.95, 1], fogHeight: 90, rain: true,
  },
};

const COASTS = {
  arcipelago: "arcipelago",
  costa: "costa alta",
  aperto: "mare aperto",
};

const col = (hex) => new THREE.Color(hex);

// Scala Beaufort (come in Assassin's Creed): dalla forza dipendono schiuma e strisce sul mare
const BEAUFORT = [1, 4, 7, 11, 17, 22, 28, 34, 41]; // nodi minimi per le forze 1-9
export const beaufort = (kn) => BEAUFORT.filter((v) => kn >= v).length;
// schiuma sulle creste: assente fino a forza 3, piena a forza 7
const CREST_FOAM = [0, 0, 0, 0, 0.3, 0.55, 0.8, 1, 1, 1];
// strisce di schiuma allineate al vento da forza 5
const STREAKS = [0, 0, 0, 0, 0, 0.35, 0.7, 1, 1, 1]; // THREE.Color converte da sRGB a lineare

export function makeConditions(seed) {
  const rng = makeRng(seed);
  const key = rng.weighted([
    ["alba", 1], ["mattino", 1.2], ["mezzogiorno", 0.8], ["pomeriggio", 1.4], ["tramonto", 1.2], ["foschia", 0.8], ["pioggia", 0.6],
  ]);
  const P = PRESETS[key];

  // sole: azimut attorno a quello originale (poppa sulla dritta), altezza con poco scarto
  const azim = THREE.MathUtils.degToRad(131.5 + rng.range(-22, 22));
  const elev = THREE.MathUtils.degToRad(P.elev * rng.range(0.8, 1.2));
  const sunDir = new THREE.Vector3(Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim)).normalize();

  // piccole variazioni di tinta, così due albe non sono identiche
  const hue = rng.range(-0.012, 0.012);
  const tint = (hex) => col(hex).offsetHSL(hue, 0, 0);

  // vento: in foschia di solito è più debole
  const knots = Math.round(key === "foschia" ? rng.range(6, 14) : key === "pioggia" ? rng.range(16, 27) : rng.range(9, 24));
  const w = THREE.MathUtils.clamp((knots - 8) / 16, 0, 1);
  const force = beaufort(knots);

  const coast = rng.weighted([["arcipelago", 0.45], ["costa", 0.3], ["aperto", 0.25]]);

  return {
    seed,
    preset: key,
    label: P.label,
    coast,
    coastLabel: COASTS[coast],
    knots,
    force,
    crestFoam: CREST_FOAM[force],
    streaks: STREAKS[force],
    sunDir,
    zenith: tint(P.zenith),
    horizon: tint(P.horizon),
    sun: col(P.sun),
    light: col(P.light),
    intensity: P.intensity,
    deep: tint(P.deep),
    mid: tint(P.mid),
    ambSky: col(P.ambSky),
    ambGround: col(P.ambGround),
    ambI: P.ambI,
    exposure: P.exposure,
    fog: [P.fog[0] * rng.range(0.9, 1.1), P.fog[1] * rng.range(0.9, 1.15) * (coast === "costa" ? 1.2 : 1)],
    disk: P.disk,
    fogHeight: P.fogHeight || 260,
    rain: !!P.rain,
    clouds: rng.range(P.clouds[0], P.clouds[1]),
    // vento: onde più ripide, più sbandata, barca più veloce
    waveScale: 0.6 + w * 0.75,
    heel: 9 + w * 11,
    motion: 0.7 + w * 0.6,
    flow: (6.5 + w * 3.5) * 0.5144, // velocità della barca in m/s
    foam: 0.6 + w * 0.4,
    rng, // il paesaggio continua a pescare dallo stesso generatore
  };
}

export function seedFromUrl() {
  const s = parseInt(new URLSearchParams(location.search).get("seed"), 10);
  return Number.isFinite(s) && s > 0 ? s : 1 + Math.floor(Math.random() * 99999);
}
