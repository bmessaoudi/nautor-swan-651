import * as THREE from "three";
import {
  EffectComposer, RenderPass, EffectPass, Pass, Effect, CopyMaterial,
  DepthOfFieldEffect, TiltShiftEffect, BloomEffect, ChromaticAberrationEffect,
  VignetteEffect, NoiseEffect, SMAAEffect, BlendFunction, KernelSize,
} from "postprocessing";
import { N8AOPostPass } from "n8ao";

// Post-processing con pmndrs/postprocessing (WebGL). Ordine dei passaggi:
//   scena > occlusione (N8AO) > nuvole e prospettiva aerea (sky.js) > profondità di campo > tilt-shift > bloom e look
//   > accumulo a camera ferma > aberrazione cromatica > SMAA, vignettatura, grana
// Il look fa il tone mapping Khronos PBR Neutral (rispetta i rossi di Lunz am Meer, ACES li
// spingeva verso l'arancio) e poi il grading del capitolo. Grana e aberrazione vengono dopo
// l'accumulo, altrimenti la media dei fotogrammi le cancellerebbe.

// ---------- Look: esposizione, tone mapping Neutral, grading ----------
const lookFrag = /* glsl */ `
uniform float lookExposure;
uniform vec3 lookSlope;
uniform vec3 lookOffset;
uniform vec3 lookPower;
uniform float lookSaturation;
uniform vec3 lookShadows;
uniform vec3 lookHighlights;

// Khronos PBR Neutral: identità sotto 0,76, poi compressione morbida verso il bianco
vec3 pbrNeutral(vec3 color) {
  const float startCompression = 0.8 - 0.04;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= off;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = pbrNeutral(max(inputColor.rgb * lookExposure, 0.0));
  // grading in uno spazio vicino a quello del monitor, come in un programma di color
  c = pow(c, vec3(1.0 / 2.2));
  c = pow(max(c * lookSlope + lookOffset, 0.0), lookPower);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, lookSaturation);
  c += lookShadows * (1.0 - l) * (1.0 - l) + lookHighlights * l * l;
  outputColor = vec4(pow(max(c, 0.0), vec3(2.2)), inputColor.a);
}
`;

class LookEffect extends Effect {
  constructor() {
    super("LookEffect", lookFrag, {
      uniforms: new Map([
        ["lookExposure", new THREE.Uniform(1)],
        ["lookSlope", new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ["lookOffset", new THREE.Uniform(new THREE.Vector3())],
        ["lookPower", new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ["lookSaturation", new THREE.Uniform(1)],
        ["lookShadows", new THREE.Uniform(new THREE.Vector3())],
        ["lookHighlights", new THREE.Uniform(new THREE.Vector3())],
      ]),
    });
  }
}

// Grading per capitolo: si interpola fra due preset come gli altri valori dei fotogrammi chiave
export const GRADES = {
  // freddo, ombre blu, un filo desaturato: carta da disegno sotto la lampada
  blueprint: { slope: [0.96, 1, 1.06], offset: [0, 0.004, 0.016], power: [1.04, 1, 0.96], sat: 0.92, shadows: [0, 0.006, 0.02], highlights: [0, 0, 0], vignette: 0.5, exposure: 1 },
  // neutro, appena caldo nelle luci: lo studio fotografico
  studio: { slope: [1.01, 1, 0.985], offset: [0, 0, 0.004], power: [1, 1, 1], sat: 1.0, shadows: [0.002, 0.004, 0.01], highlights: [0.008, 0.004, 0], vignette: 0.22, exposure: 0.9 },
  // teak e pelle: appena più caldo, più contrasto nei mezzitoni
  interior: { slope: [1.015, 1, 0.975], offset: [0, 0, 0], power: [1.06, 1.08, 1.1], sat: 0.98, shadows: [0.002, 0.001, 0], highlights: [0.006, 0.003, 0], vignette: 0.42, exposure: 0.8 },
  // ombre verso il verde acqua, luci calde: il classico "orange and teal", ma leggero
  sea: { slope: [1.03, 1, 0.97], offset: [0, 0.003, 0.008], power: [1, 1, 1], sat: 1.07, shadows: [-0.004, 0.006, 0.012], highlights: [0.012, 0.006, -0.004], vignette: 0.32, exposure: 0.95 },
};

// ---------- Accumulo a camera ferma ----------
// Ogni fotogramma la camera si sposta di una frazione di pixel (sequenza di Halton) e il
// risultato si media con i precedenti: bordi lisci, occlusione senza rumore, sfocature pulite.
class AccumulatePass extends Pass {
  constructor() {
    super("AccumulatePass");
    this.count = 0;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rtA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.rtB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.blend = new THREE.ShaderMaterial({
      uniforms: { tNew: { value: null }, tOld: { value: null }, uWeight: { value: 1 } },
      vertexShader: "varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }",
      fragmentShader: `
        uniform sampler2D tNew; uniform sampler2D tOld; uniform float uWeight; varying vec2 vUv;
        void main() { gl_FragColor = mix(texture2D(tOld, vUv), texture2D(tNew, vUv), uWeight); }`,
      depthTest: false,
      depthWrite: false,
    });
    this.copy = new CopyMaterial();
    this.fullscreenMaterial = this.blend;
  }

  render(renderer, inputBuffer, outputBuffer) {
    this.fullscreenMaterial = this.blend;
    this.blend.uniforms.tNew.value = inputBuffer.texture;
    this.blend.uniforms.tOld.value = this.rtA.texture;
    this.blend.uniforms.uWeight.value = 1 / (this.count + 1);
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.scene, this.camera);
    [this.rtA, this.rtB] = [this.rtB, this.rtA];
    this.fullscreenMaterial = this.copy;
    this.copy.inputBuffer = this.rtA.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
    this.count++;
  }

  setSize(w, h) {
    this.rtA.setSize(w, h);
    this.rtB.setSize(w, h);
    this.count = 0;
  }
}

const halton = (i, b) => {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
};

// ---------- Pipeline ----------
// sky (facoltativo): il cielo di sky.js, con le passate di nuvole e prospettiva aerea
export function createPost(renderer, scene, camera, { sky = null } = {}) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));

  const ao = new N8AOPostPass(scene, camera, 1, 1);
  Object.assign(ao.configuration, {
    aoRadius: 1.6,
    distanceFalloff: 0.6,
    intensity: 2.2,
    aoSamples: 12,
    denoiseSamples: 6,
    denoiseRadius: 10,
    halfRes: true,
    gammaCorrection: false,
    transparencyAware: false,
  });
  composer.addPass(ao);

  // nuvole e atmosfera dopo l'occlusione (che scurisce solo la scena) e prima della profondità di
  // campo, così le nuvole si sfocano come il resto dello sfondo
  if (sky) for (const p of sky.passes) composer.addPass(p);

  // Dosaggio generale della sfocatura sopra i valori dei passi in story.js: meno bokeh,
  // zona a fuoco più ampia, tilt-shift più leggero. 1 = come scritto nei passi.
  const BLUR = { bokeh: 0.6, range: 1.5, tilt: 0.6 };

  const dof = new DepthOfFieldEffect(camera, { focusDistance: 30, focusRange: 12, bokehScale: 2, resolutionScale: 0.5 });
  const dofPass = new EffectPass(camera, dof);
  composer.addPass(dofPass);

  const tilt = new TiltShiftEffect({ offset: 0, rotation: 0, focusArea: 0.42, feather: 0.32, kernelSize: KernelSize.LARGE });
  const tiltPass = new EffectPass(camera, tilt);
  composer.addPass(tiltPass);

  // bloom solo sulle luci oltre il bianco: riflessi del sole su acqua e cromature
  const bloom = new BloomEffect({ luminanceThreshold: 1.15, luminanceSmoothing: 0.35, intensity: 0.55, mipmapBlur: true, radius: 0.7 });
  const look = new LookEffect();
  composer.addPass(new EffectPass(camera, bloom, look));

  const accum = new AccumulatePass();
  accum.enabled = false;
  composer.addPass(accum);

  const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0004), radialModulation: true, modulationOffset: 0.35 });
  composer.addPass(new EffectPass(camera, ca));

  const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.3 });
  const noise = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
  noise.blendMode.opacity.value = 0.28;
  const smaa = new SMAAEffect();
  composer.addPass(new EffectPass(camera, smaa, vignette, noise));

  const u = look.uniforms;
  const tmp = { a: new THREE.Vector3(), b: new THREE.Vector3() };
  const mixV = (key, A, B, t) => u.get(key).value.set(...A).lerp(tmp.b.set(...B), t);

  // ---------- Qualità adattiva ----------
  // Si misura il tempo della GPU con le timer query di WebGL2: il tempo fra un fotogramma e
  // l'altro non basta, perché il browser può limitare la pagina a 30 fps (risparmio energetico)
  // anche con la GPU scarica. Sopra ~15 ms di GPU per un po' si abbassa la risoluzione, mai sotto 1x.
  // Senza timer query si ripiega sul tempo fra fotogrammi (sopra ~19 ms).
  const gl = renderer.getContext();
  const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  let query = null;
  let gpuMs = -1;
  const maxDpr = Math.min(devicePixelRatio, 2);
  const LEVELS = [maxDpr, Math.min(maxDpr, 1.5), Math.min(maxDpr, 1.25), 1].filter((v, i, a) => a.indexOf(v) === i);
  let level = 0;
  let ema = 16;
  let slow = 0;
  let warm = 0;
  renderer.setPixelRatio(LEVELS[0]);

  let W = 1;
  let H = 1;
  const api = {
    composer,
    dof,
    ao,
    accum,
    setSize(w, h) {
      W = w;
      H = h;
      renderer.setSize(w, h, false);
      composer.setSize(w, h, false);
    },
    // Valori del fotogramma interpolato: fuoco, sfocatura, tilt-shift, grading, esposizione
    apply(s, focusPoint) {
      const dofOn = s.bokeh > 0.02;
      dofPass.enabled = dofOn;
      if (dofOn) {
        dof.cocMaterial.focusDistance = camera.position.distanceTo(focusPoint);
        dof.cocMaterial.focusRange = s.range * BLUR.range;
        dof.bokehScale = s.bokeh * BLUR.bokeh;
      }
      tiltPass.enabled = s.tilt > 0.02;
      tilt.blendMode.opacity.value = s.tilt * BLUR.tilt;

      const A = GRADES[s.gradeA];
      const B = GRADES[s.gradeB];
      const t = s.gradeT;
      mixV("lookSlope", A.slope, B.slope, t);
      mixV("lookOffset", A.offset, B.offset, t);
      mixV("lookPower", A.power, B.power, t);
      mixV("lookShadows", A.shadows, B.shadows, t);
      mixV("lookHighlights", A.highlights, B.highlights, t);
      u.get("lookSaturation").value = THREE.MathUtils.lerp(A.sat, B.sat, t);
      u.get("lookExposure").value = s.exposure * THREE.MathUtils.lerp(A.exposure, B.exposure, t);
      vignette.darkness = THREE.MathUtils.lerp(A.vignette, B.vignette, t);

      // occlusione: niente nella tavola, raggio più corto negli interni
      ao.configuration.intensity = (s.cut < 50 ? 4 : 2.2) * s.solid;
      ao.configuration.aoRadius = s.cut < 50 ? 0.7 : 1.6;
      // in mare aperto l'occlusione quasi non si vede e costa quanto il resto della scena
      ao.enabled = s.solid > 0.02 && s.ocean < 0.5;
    },
    // Sposta la camera di una frazione di pixel durante l'accumulo
    jitter(shiftPx) {
      const n = accum.count % 32;
      const dpr = renderer.getPixelRatio();
      const jx = (halton(n + 1, 2) - 0.5) / dpr;
      const jy = (halton(n + 1, 3) - 0.5) / dpr;
      camera.setViewOffset(W, H, shiftPx + jx, jy, W, H);
    },
    // apre e chiude la misura GPU attorno a tutto il lavoro del fotogramma (seafx compreso)
    beginFrame() {
      if (!timer || query) return;
      query = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      query.open = true;
    },
    endFrame() {
      if (query && query.open) {
        gl.endQuery(timer.TIME_ELAPSED_EXT);
        query.open = false;
      }
    },
    render(dt, still) {
      if (still !== accum.enabled) {
        accum.enabled = still;
        accum.count = 0;
        // occlusione a piena risoluzione solo a camera ferma, quando l'accumulo la ripulisce
        ao.configuration.halfRes = !still || level > 0;
      }
      composer.render(dt);
    },
    // ms del fotogramma precedente; si misura solo quando la scena si muove davvero
    measure(ms) {
      if (query && !query.open && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query);
        query = null;
      }
      if (warm++ < 120) return;
      const useGpu = timer && gpuMs >= 0;
      ema += (Math.min(useGpu ? gpuMs : ms, 100) - ema) * 0.05;
      slow = ema > (useGpu ? 15 : 19) ? slow + 1 : 0;
      // prima si alleggeriscono le nuvole (sono la parte più cara del mare), poi la risoluzione
      if (slow > 90 && sky && sky.degrade()) {
        slow = 0;
      } else if (slow > 90 && level < LEVELS.length - 1) {
        level++;
        slow = 0;
        renderer.setPixelRatio(LEVELS[level]);
        ao.configuration.halfRes = level > 0;
        composer.setSize(W, H, false);
      }
    },
    // lo sfondo compensa l'esposizione: il suo colore è una scelta grafica, non una luce
    get exposure() {
      return u.get("lookExposure").value;
    },
    get quality() {
      return LEVELS[level];
    },
    get gpuMs() {
      return gpuMs;
    },
  };
  return api;
}
