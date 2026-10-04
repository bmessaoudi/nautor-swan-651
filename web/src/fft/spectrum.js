import * as THREE from "three";
import { makeRng } from "../conditions.js";

// Spettro iniziale del mare (Tessendorf 2001), calcolato sulla CPU una volta per condizione.
// JONSWAP limitato dal fetch: con lo stesso vento un braccio di mare chiuso (il golfo di Botnia,
// l'arcipelago) ha onde più corte e più basse dell'oceano aperto. Poi la GPU lo fa evolvere nel
// tempo e lo riporta nello spazio con la FFT (simulation.js).

const G = 9.81;
// Le frequenze si arrotondano a multipli di 2π/T: il mare si ripete ogni T secondi e il tempo
// passato allo shader resta piccolo (sin(ω t) in float32 perde precisione dopo qualche minuto)
export const LOOP = 240;
const W0 = (2 * Math.PI) / LOOP;
export const dispersion = (k) => Math.floor(Math.sqrt(G * k) / W0) * W0;

// JONSWAP in funzione di ω (Hasselmann 1973), vento U in m/s e fetch F in metri
// Con un fetch lungo il mare non cresce oltre lo stato pienamente sviluppato di Pierson-Moskowitz:
// α e il picco si fermano ai suoi valori
function jonswap(w, U, F) {
  const a = Math.max(0.0081, 0.076 * Math.pow((U * U) / (F * G), 0.22));
  const wp = Math.max((0.855 * G) / U, 22 * Math.pow((G * G) / (U * F), 1 / 3));
  const s = w <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((w - wp) ** 2) / (2 * s * s * wp * wp));
  return ((a * G * G) / w ** 5) * Math.exp(-1.25 * (wp / w) ** 4) * Math.pow(3.3, r);
}

// Distribuzione per direzione: coseno quadro attorno al vento, più una piccola parte in tutte le
// direzioni (mare incrociato), così le creste non sembrano pettinate
function spread(theta, wind) {
  let d = theta - wind;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  const main = Math.abs(d) < Math.PI / 2 ? (2 / Math.PI) * Math.cos(d) ** 2 : 0;
  return main * 0.88 + 0.12 / (2 * Math.PI);
}

// Gaussiana di Box-Muller dal generatore con seme di conditions.js
function gauss(rng) {
  const u = Math.max(1e-7, rng());
  const v = rng();
  const m = Math.sqrt(-2 * Math.log(u));
  return [m * Math.cos(2 * Math.PI * v), m * Math.sin(2 * Math.PI * v)];
}

/**
 * Riempie la texture h0 (N × N per ogni cascata, impilate in verticale) con
 * (h0(k), conj(h0(-k))): così lo shader del tempo non deve cercare -k.
 * cascades: [{ L, kMin, kMax }], wind: { speed (m/s), dir (radianti), fetch (m) }.
 */
export function buildSpectrum(data, N, cascades, wind, seed) {
  const rng = makeRng(seed * 7919 + 13);
  const h = new Float32Array(N * N * 2);
  cascades.forEach((c, ci) => {
    const dk = (2 * Math.PI) / c.L;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 2;
        // ordine della FFT: gli indici oltre N/2 sono le frequenze negative
        const kx = (x < N / 2 ? x : x - N) * dk;
        const kz = (y < N / 2 ? y : y - N) * dk;
        const k = Math.hypot(kx, kz);
        const [gr, gi] = gauss(rng);
        if (k < c.kMin || k >= c.kMax || k === 0) {
          h[i] = h[i + 1] = 0;
          continue;
        }
        const w = Math.sqrt(G * k);
        // S(k) = S(ω) dω/dk, diviso per k passando in coordinate polari
        const S = jonswap(w, wind.speed, wind.fetch) * (G / (2 * w)) * spread(Math.atan2(kz, kx), wind.dir) / k;
        // le onde più corte di qualche centimetro si smorzano (capillari)
        const damp = Math.exp(-k * k * 0.0004);
        // E|h0|² = S dk² / 2: h(k) somma h0(k) e conj(h0(-k)), così la varianza totale è ∫S
        const amp = Math.sqrt((S * dk * dk) / 4) * damp;
        h[i] = gr * amp;
        h[i + 1] = gi * amp;
      }
    }
    // (h0(k), conj(h0(-k))) per ogni texel
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 2;
        const j = (((N - y) % N) * N + ((N - x) % N)) * 2;
        const o = ((ci * N + y) * N + x) * 4;
        data[o] = h[i];
        data[o + 1] = h[i + 1];
        data[o + 2] = h[j];
        data[o + 3] = -h[j + 1];
      }
    }
  });
}

export function makeSpectrumTexture(N, count) {
  const tex = new THREE.DataTexture(new Float32Array(N * N * count * 4), N, N * count, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}
