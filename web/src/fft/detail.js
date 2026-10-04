import * as THREE from "three";
import { makeRng } from "../conditions.js";

// Increspature di dettaglio, sotto la cascata FFT più piccola (9,7 m).
// Una texture di pendenze ripetibile, calcolata una volta sulla CPU con una FFT 256 × 256 da uno
// spettro a legge di potenza allungato lungo il vento. Il mare la legge a due scale (qualche metro
// e qualche decimetro) facendola scorrere con il vento: costa quattro letture di texture per pixel
// e nessun passo GPU per fotogramma. Una quarta cascata FFT animata avrebbe aggiunto alla
// simulazione un terzo del lavoro (stimato in mezzo millisecondo) per onde che a queste scale si vedono
// soprattutto scorrere, non cambiare forma.
//
// Canali: (rg) pendenze x, z del primo campo, (ba) del secondo. I due campi sono la parte reale e
// l'immaginaria della stessa FFT complessa: indipendenti, quindi una lettura dà due trame diverse.

const N = 256;
// fattore di codifica: pendenza normalizzata (valore quadratico medio 1) divisa per ENC in [-1, 1]
export const DETAIL_ENC = 3.5;

// FFT a radice 2 sul posto, su righe o colonne di un campo N × N (re, im separati)
function fft1(re, im, off, stride) {
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      [re[a], re[b]] = [re[b], re[a]];
      [im[a], im[b]] = [im[b], im[a]];
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (2 * Math.PI) / len;
    for (let i = 0; i < N; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const a = off + (i + k) * stride, b = off + (i + k + len / 2) * stride;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}
function fft2(re, im) {
  for (let y = 0; y < N; y++) fft1(re, im, y * N, 1);
  for (let x = 0; x < N; x++) fft1(re, im, x, N);
}

export function createDetailTexture(seed = 1) {
  const rng = makeRng(seed * 4099 + 7);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-7, rng()))) * Math.cos(2 * Math.PI * rng());
  const sxr = new Float64Array(N * N), sxi = new Float64Array(N * N);
  const szr = new Float64Array(N * N), szi = new Float64Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const kx = x < N / 2 ? x : x - N;
      const kz = y < N / 2 ? y : y - N;
      const k = Math.hypot(kx, kz);
      // banda da 3 a 56 cicli per lato: niente onde più lunghe della texture né più corte di 4,5 texel
      if (k < 3 || k > 56) continue;
      // pendenze con la stessa energia per ottava (spettro di saturazione, Phillips 1985): |h| ∝ k⁻²
      // vento lungo +x: coseno quadro più un fondo in tutte le direzioni, creste più corte che lunghe
      const c = kx / k;
      const amp = k ** -2 * (0.35 + c * c) * Math.min(1, (k - 3) / 2) * Math.min(1, (56 - k) / 8);
      const hr = gauss() * amp, hi = gauss() * amp;
      const i = y * N + x;
      // pendenza = i k h
      sxr[i] = -kx * hi; sxi[i] = kx * hr;
      szr[i] = -kz * hi; szi[i] = kz * hr;
    }
  }
  fft2(sxr, sxi);
  fft2(szr, szi);
  // valore quadratico medio di ciascun campo, per normalizzarlo a 1
  const rms = (a, b) => {
    let s = 0;
    for (let i = 0; i < N * N; i++) s += a[i] * a[i] + b[i] * b[i];
    return Math.sqrt(s / (2 * N * N));
  };
  const r1 = rms(sxr, szr), r2 = rms(sxi, szi);
  const data = new Uint8Array(N * N * 4);
  const enc = (v) => Math.round(THREE.MathUtils.clamp(v / DETAIL_ENC * 0.5 + 0.5, 0, 1) * 255);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = enc(sxr[i] / r1);
    data[i * 4 + 1] = enc(szr[i] / r1);
    data[i * 4 + 2] = enc(sxi[i] / r2);
    data[i * 4 + 3] = enc(szi[i] / r2);
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
