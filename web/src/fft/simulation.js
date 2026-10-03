import * as THREE from "three";
import { buildSpectrum, makeSpectrumTexture, LOOP } from "./spectrum.js";

// Mare FFT sulla GPU in WebGL2, con render target in ping-pong e senza compute shader
// (l'idea della demo di David Li del 2013 e di jbouny/fft-ocean, riscritta per tre cascate).
//
// Ogni fotogramma:
// 1. spettro al tempo t, per tutte le cascate in una texture N × 3N (una sopra l'altra);
// 2. FFT inversa a radice 2 (Stockham): log2(N) passi orizzontali e log2(N) verticali, che lavorano
//    su tutte le cascate insieme. Due segnali reali per numero complesso: (h + i·Dx) e Dz;
// 3. per ogni cascata una mappa di spostamento (Dx, h, Dz) e una di pendenze, Jacobiano e schiuma,
//    tutte e due con mipmap: lontano dalla barca si legge un livello più morbido, niente sfarfallio.
// La schiuma resta nella mappa e si spegne piano (ping-pong): dietro un frangente resta la scia.

// Tre cascate di lato non multiplo fra loro, così le ripetizioni non si allineano. Ognuna tiene
// solo la sua banda di numeri d'onda: le onde lunghe nella prima, le increspature nell'ultima.
export const CASCADES = [
  { L: 233, kMin: 0, kMax: ((2 * Math.PI) / 41) * 6 },
  { L: 41, kMin: ((2 * Math.PI) / 41) * 6, kMax: ((2 * Math.PI) / 9.7) * 6 },
  { L: 9.7, kMin: ((2 * Math.PI) / 9.7) * 6, kMax: Infinity },
];

const quadVert = /* glsl */ `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Spettro al tempo t (Tessendorf): h = h0 e^{iωt} + conj(h0(-k)) e^{-iωt}.
// Spostamento orizzontale D = i k/|k| h: con questo segno le creste si stringono come in Gerstner.
const spectrumFrag = /* glsl */ `
uniform sampler2D uH0;
uniform float uN;
uniform float uTime;
uniform vec3 uL;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int n = int(uN);
  int c = px.y / n;
  ivec2 local = ivec2(px.x, px.y - c * n);
  float L = c == 0 ? uL.x : (c == 1 ? uL.y : uL.z);
  vec2 m = vec2(local);
  m = mix(m, m - uN, step(uN * 0.5, m));
  vec2 k = m * 6.2831853 / L;
  float kl = length(k);
  vec4 h0 = texelFetch(uH0, px, 0);
  // stessa dispersione della CPU: ω arrotondato a multipli di 2π/LOOP
  float w0 = 6.2831853 / ${LOOP.toFixed(1)};
  float w = floor(sqrt(9.81 * kl) / w0) * w0;
  vec2 e = vec2(cos(w * uTime), sin(w * uTime));
  vec2 h = cmul(h0.xy, e) + cmul(h0.zw, vec2(e.x, -e.y));
  vec2 kn = kl > 1e-6 ? k / kl : vec2(0.0);
  vec2 dx = cmul(vec2(0.0, kn.x), h);
  vec2 dz = cmul(vec2(0.0, kn.y), h);
  // h + i·Dx: dopo la FFT la parte reale è l'altezza, l'immaginaria lo spostamento lungo x
  gl_FragColor = vec4(h + cmul(vec2(0.0, 1.0), dx), dz);
}
`;

// Un passo della FFT inversa (Stockham, ordine naturale in ingresso e in uscita). Lavora su due
// numeri complessi per texel. In verticale ogni cascata è un blocco di N righe.
const fftFrag = /* glsl */ `
uniform sampler2D uInput;
uniform float uN;
uniform float uSub;
uniform int uVertical;
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int n = int(uN);
  int sub = int(uSub);
  int idx = uVertical == 1 ? px.y % n : px.x;
  int even = (idx / sub) * (sub / 2) + idx % (sub / 2);
  int odd = even + n / 2;
  ivec2 pe = uVertical == 1 ? ivec2(px.x, px.y - idx + even) : ivec2(even, px.y);
  ivec2 po = uVertical == 1 ? ivec2(px.x, px.y - idx + odd) : ivec2(odd, px.y);
  vec4 a = texelFetch(uInput, pe, 0);
  vec4 b = texelFetch(uInput, po, 0);
  float ang = 6.2831853 * float(idx) / uSub;
  vec2 tw = vec2(cos(ang), sin(ang));
  gl_FragColor = vec4(a.xy + cmul(tw, b.xy), a.zw + cmul(tw, b.zw));
}
`;

// Mappa di spostamento della cascata: (Dx, h, Dz) in metri, già con la ripidità (choppy)
const dispFrag = /* glsl */ `
uniform sampler2D uFft;
uniform float uN;
uniform float uCascade;
uniform float uChoppy;
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec4 f = texelFetch(uFft, ivec2(px.x, px.y + int(uCascade * uN)), 0);
  gl_FragColor = vec4(f.y * uChoppy, f.x, f.z * uChoppy, 1.0);
}
`;

// Pendenze, Jacobiano e schiuma per differenze finite sulla stessa uscita della FFT.
// Il Jacobiano dello spostamento orizzontale scende sotto 1 dove la superficie si comprime
// (le creste) e sotto 0 dove si ripiega su se stessa (l'onda frange): lì nasce la schiuma.
const derivFrag = /* glsl */ `
uniform sampler2D uFft;
uniform sampler2D uPrev;
uniform float uN;
uniform float uCascade;
uniform float uChoppy;
uniform float uTexel;
uniform float uDecay;
uniform float uFoamBias;
uniform float uFoamGain;
vec3 at(ivec2 p) {
  int n = int(uN);
  p = (p + n) % n;
  vec4 f = texelFetch(uFft, ivec2(p.x, p.y + int(uCascade * uN)), 0);
  return vec3(f.y * uChoppy, f.x, f.z * uChoppy);
}
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  vec3 l = at(px - ivec2(1, 0)), r = at(px + ivec2(1, 0));
  vec3 d = at(px - ivec2(0, 1)), u = at(px + ivec2(0, 1));
  vec3 ddx = (r - l) / (2.0 * uTexel);
  vec3 ddz = (u - d) / (2.0 * uTexel);
  float jxx = 1.0 + ddx.x;
  float jzz = 1.0 + ddz.z;
  float jxz = ddz.x;
  float J = jxx * jzz - jxz * jxz;
  // pendenza della superficie spostata: la x di arrivo cambia di jxx per ogni metro di partenza
  vec2 slope = vec2(ddx.y / max(jxx, 0.25), ddz.y / max(jzz, 0.25));
  float fresh = clamp((uFoamBias - J) * uFoamGain, 0.0, 1.0);
  float prev = texelFetch(uPrev, px, 0).a;
  gl_FragColor = vec4(slope, J, max(prev * uDecay, fresh));
}
`;

// Altezza dell'acqua in alcuni punti del mondo, per il galleggiamento: stessa funzione del vertex
// shader del mare (WATER_GLSL), con la ricerca del punto di partenza che finisce lì
function sampleFrag(water) {
  return /* glsl */ `
uniform vec2 uPts[16];
${water}
void main() {
  int i = int(gl_FragCoord.x);
  vec2 x = uPts[i];
  vec2 p = x;
  for (int k = 0; k < 4; k++) p = x - waterOffset(p, 0.0).xz;
  gl_FragColor = vec4(waterOffset(p, 0.0).y, 0.0, 0.0, 1.0);
}
`;
}

export function createFFT(renderer, { size = 256, water }) {
  const N = size;
  const C = CASCADES.length;
  const h0 = makeSpectrumTexture(N, C);

  const fopts = { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false };
  let ping = new THREE.WebGLRenderTarget(N, N * C, fopts);
  let pong = new THREE.WebGLRenderTarget(N, N * C, fopts);
  // mappe lette dal mare: mezza precisione con mipmap e ripetizione
  const mopts = {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
  };
  const disp = CASCADES.map(() => new THREE.WebGLRenderTarget(N, N, mopts));
  const deriv = CASCADES.map(() => [new THREE.WebGLRenderTarget(N, N, mopts), new THREE.WebGLRenderTarget(N, N, mopts)]);
  for (const rt of [...disp, ...deriv.flat()]) {
    rt.texture.anisotropy = 4;
  }
  const sampleRT = new THREE.WebGLRenderTarget(16, 1, { ...fopts });

  const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
  const specMat = mat(spectrumFrag, {
    uH0: { value: h0 }, uN: { value: N }, uTime: { value: 0 },
    uL: { value: new THREE.Vector3(...CASCADES.map((c) => c.L)) },
  });
  const fftMat = mat(fftFrag, { uInput: { value: null }, uN: { value: N }, uSub: { value: 2 }, uVertical: { value: 0 } });
  const dispMat = mat(dispFrag, { uFft: { value: null }, uN: { value: N }, uCascade: { value: 0 }, uChoppy: { value: 1 } });
  const derivMat = mat(derivFrag, {
    uFft: { value: null }, uPrev: { value: null }, uN: { value: N }, uCascade: { value: 0 }, uChoppy: { value: 1 },
    uTexel: { value: 1 }, uDecay: { value: 0.98 }, uFoamBias: { value: 0.5 }, uFoamGain: { value: 2 },
  });

  // uniformi lette dal mare (e da materials.js per la fascia bagnata dello scafo)
  const uniforms = {
    uDisp0: { value: disp[0].texture },
    uDisp1: { value: disp[1].texture },
    uDisp2: { value: disp[2].texture },
    uDeriv0: { value: deriv[0][0].texture },
    uDeriv1: { value: deriv[1][0].texture },
    uDeriv2: { value: deriv[2][0].texture },
    uCascade: { value: new THREE.Vector3(...CASCADES.map((c) => c.L)) },
  };
  const sampleMat = mat(sampleFrag(water.glsl), { ...water.uniforms, ...uniforms, uPts: { value: Array.from({ length: 16 }, () => new THREE.Vector2()) } });

  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), specMat);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const draw = (material, target) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  };

  let flip = 0;
  let lastT = null;
  const readBuf = new Float32Array(16 * 4);
  let reading = false;
  const heights = new Float32Array(16);
  let heightsReady = false;
  let heightsCount = 0;

  return {
    uniforms,
    size: N,
    // nuovo spettro: vento in m/s, direzione (radianti, nel piano x-z), fetch in metri
    setSpectrum(wind, seed) {
      buildSpectrum(h0.image.data, N, CASCADES, wind, seed);
      h0.needsUpdate = true;
    },
    // choppy: ripidità delle creste; foam: { bias, gain } della schiuma dal Jacobiano
    update(t, choppy, foam) {
      const prevTarget = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      const prevXr = renderer.xr.enabled;
      renderer.autoClear = false;
      renderer.xr.enabled = false;

      specMat.uniforms.uTime.value = ((t % LOOP) + LOOP) % LOOP;
      draw(specMat, ping);
      // FFT: prima le righe, poi le colonne
      for (const vertical of [0, 1]) {
        fftMat.uniforms.uVertical.value = vertical;
        for (let sub = 2; sub <= N; sub *= 2) {
          fftMat.uniforms.uInput.value = ping.texture;
          fftMat.uniforms.uSub.value = sub;
          draw(fftMat, pong);
          [ping, pong] = [pong, ping];
        }
      }
      // la schiuma si spegne in un paio di secondi (ne resta il 37% dopo due secondi)
      const dt = lastT === null ? 0 : Math.min(Math.max(t - lastT, 0), 0.1);
      lastT = t;
      const prev = flip;
      flip = 1 - flip;
      for (let c = 0; c < C; c++) {
        dispMat.uniforms.uFft.value = ping.texture;
        dispMat.uniforms.uCascade.value = c;
        dispMat.uniforms.uChoppy.value = choppy;
        draw(dispMat, disp[c]);
        const du = derivMat.uniforms;
        du.uFft.value = ping.texture;
        du.uPrev.value = deriv[c][prev].texture;
        du.uCascade.value = c;
        du.uChoppy.value = choppy;
        du.uTexel.value = CASCADES[c].L / N;
        du.uDecay.value = Math.exp(-dt / 2);
        // le increspature dell'ultima cascata non frangono: solo un velo di schiuma
        du.uFoamBias.value = foam.bias - (c === 2 ? 0.06 : 0);
        du.uFoamGain.value = foam.gain;
        draw(derivMat, deriv[c][flip]);
        uniforms[`uDeriv${c}`].value = deriv[c][flip].texture;
      }

      renderer.setRenderTarget(prevTarget);
      renderer.autoClear = prevAuto;
      renderer.xr.enabled = prevXr;
    },
    // altezza dell'acqua nei punti dati (x, z del mondo), letta in modo asincrono: il risultato
    // arriva uno o due fotogrammi dopo, senza fermare la GPU
    sample(points) {
      if (reading) return;
      const pts = sampleMat.uniforms.uPts.value;
      points.forEach((p, i) => pts[i].set(p[0], p[1]));
      const prevTarget = renderer.getRenderTarget();
      draw(sampleMat, sampleRT);
      renderer.setRenderTarget(prevTarget);
      reading = true;
      const n = points.length;
      renderer.readRenderTargetPixelsAsync(sampleRT, 0, 0, 16, 1, readBuf).then(
        () => {
          for (let i = 0; i < n; i++) heights[i] = readBuf[i * 4];
          heightsCount = n;
          heightsReady = true;
          reading = false;
        },
        () => { reading = false; }
      );
    },
    // per controllare le mappe dalla console
    debug: () => ({ fft: ping, disp, deriv, h0 }),
    get heights() {
      return heightsReady ? heights.subarray(0, heightsCount) : null;
    },
    dispose() {
      for (const rt of [ping, pong, sampleRT, ...disp, ...deriv.flat()]) rt.dispose();
      h0.dispose();
    },
  };
}
