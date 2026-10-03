import * as THREE from "three";
import { createFFT } from "./fft/simulation.js";

// Mare e cielo del capitolo Navigazione.
// Il mare è un oceano FFT (fft/simulation.js): tre cascate di onde calcolate sulla GPU da uno
// spettro JONSWAP guidato dal vento delle condizioni. Il vertex shader sposta la griglia con le
// mappe di spostamento, il fragment shader legge pendenze, Jacobiano e schiuma dalle stesse mappe.
// L'acqua scorre verso poppa (-X) per dare l'idea che la barca avanzi. Il cielo è una cupola che
// segue la camera: lo stesso colore d'orizzonte chiude la nebbia del mare, così non resta una riga
// sull'orizzonte.

// Sole, colori, vento e foschia arrivano dalle condizioni (conditions.js) con setConditions.

// Lato della FFT: 256 di base, ?fft=128 per i portatili lenti (un quarto del lavoro sulla GPU)
const FFT_SIZE = (() => {
  const v = parseInt(new URLSearchParams(location.search).get("fft"), 10);
  return [64, 128, 256, 512].includes(v) ? v : 256;
})();

// Direzione del vento nel piano x-z: come le onde di Gerstner di prima, quasi lungo la prua
const WIND_DIR = Math.atan2(0.25, 1);
// fetch per costa: nell'arcipelago le isole spezzano il mare, in mare aperto l'onda si allunga
const FETCH = { arcipelago: 25000, costa: 60000, aperto: 120000 };

// Spostamento dell'acqua nel punto p del piano (x, z del mondo), dalle tre cascate FFT.
// Lo usano il vertex shader del mare, il campionamento per il galleggiamento (simulation.js) e la
// fascia bagnata dello scafo (materials.js): tutti vedono la stessa acqua.
// spacing è il passo della griglia in quel punto: le cascate si leggono al livello di mipmap
// adatto, così i vertici radi in lontananza non campionano onde più corte di loro.
export const WATER_GLSL = /* glsl */ `
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform vec3 uCascade;
uniform vec2 uOff;
uniform float uHeading;
// le onde si spengono in lontananza e attorno alla barca restano più basse
float waterFade(vec2 p) {
  float hc = cos(uHeading), hs = sin(uHeading);
  vec2 lp = vec2(p.x * hc + p.y * hs, -p.x * hs + p.y * hc);
  float fade = 1.0 - smoothstep(300.0, 1400.0, length(p));
  return fade * mix(0.55, 1.0, smoothstep(6.0, 22.0, length(lp * vec2(0.55, 1.0))));
}
float waterLod(float spacing, float L) {
  return max(0.0, log2(spacing * ${FFT_SIZE.toFixed(1)} / L));
}
vec3 waterOffset(vec2 p, float spacing) {
  vec2 q = p + uOff;
  vec3 d = textureLod(uDisp0, q / uCascade.x, waterLod(spacing, uCascade.x)).xyz;
  d += textureLod(uDisp1, q / uCascade.y, waterLod(spacing, uCascade.y)).xyz;
  d += textureLod(uDisp2, q / uCascade.z, waterLod(spacing, uCascade.z)).xyz;
  return d * waterFade(p);
}
// altezza dell'acqua nel punto del mondo: le onde spostano anche in orizzontale, quindi si cerca
// il punto del piano che finisce lì (due passi bastano per la fascia bagnata)
float waterHeight(vec2 x) {
  vec2 p = x;
  for (int k = 0; k < 2; k++) p = x - waterOffset(p, 0.0).xz;
  return waterOffset(p, 0.0).y;
}
`;

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return s;
}
`;

export const SKY = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
vec3 skyColor(vec3 r) {
  float h = r.y;
  vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, max(h, 0.0)));
  float sd = max(dot(r, uSunDir), 0.0);
  c += uSunCol * (pow(sd, 6.0) * 0.18 + pow(sd, 64.0) * 0.35);
  return c;
}
// Foschia a due colori, come la nebbia volumetrica di Black Flag: verso il sole prende il bagliore
// del cielo, dalla parte opposta è più fredda e scura. Il cielo usa la stessa tinta all'orizzonte,
// così mare e cupola si chiudono senza riga.
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogHeight;
vec3 hazeTone(vec3 dirH) {
  vec3 sunward = skyColor(dirH);
  vec3 opposite = mix(uHorizon, uZenith, 0.18) * 0.93;
  float ph = dot(dirH, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5;
  return mix(opposite, sunward, 0.45 + 0.55 * ph);
}
vec3 hazeColor(vec3 world) {
  vec2 d = world.xz - cameraPosition.xz;
  return hazeTone(normalize(vec3(d.x, 0.0, d.y)));
}
// più densa vicino all'acqua: le cime delle montagne escono dalla foschia
float hazeAmount(vec3 world) {
  float h = exp(-max(world.y, 0.0) / uFogHeight);
  return smoothstep(uFogNear, uFogFar, length(world.xz - cameraPosition.xz)) * mix(0.55, 1.0, h);
}
`;


const oceanVert = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec2 vFlow;
varying float vFade;
${WATER_GLSL}

void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  // passo della griglia radiale in quel punto (anelli in progressione geometrica, vedi radialGrid)
  float spacing = 0.03 * length(p.xz) + 0.02;
  vec3 off = waterOffset(p.xz, spacing);
  // le mappe di pendenze e schiuma sono legate all'acqua, non al punto spostato: il fragment
  // shader le legge nel punto di partenza. uOff è lo spostamento dell'acqua rispetto alla barca
  // (setCourse): con la rotta dritta vale (tempo × velocità, 0)
  vFlow = p.xz + uOff;
  vFade = waterFade(p.xz);
  p += off;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const oceanFrag = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uFoam;
uniform float uCrestFoam;
uniform float uStreaks;
uniform float uSunRadius;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uSss;
uniform sampler2D uRefl;
uniform float uReflOn;
uniform vec2 uResolution;
uniform sampler2D uFoamTex;
uniform vec4 uFoamBox;
uniform float uHeading;
uniform sampler2D uDeriv0;
uniform sampler2D uDeriv1;
uniform sampler2D uDeriv2;
uniform vec3 uCascade;
varying vec3 vWorld;
varying vec2 vFlow;
varying float vFade;
${NOISE}
${SKY}

// Sole come disco e non come punto (Karis 2013, usato da Sea of Thieves per il sole basso):
// si prende il punto del disco più vicino al raggio riflesso.
float areaSpec(vec3 n, vec3 v, vec3 l, float radius, float rough) {
  vec3 r = reflect(-v, n);
  vec3 toRay = dot(l, r) * r - l;
  vec3 lp = normalize(l + toRay * clamp(radius / max(length(toRay), 1e-4), 0.0, 1.0));
  vec3 h = normalize(lp + v);
  float a = rough * rough;
  float a2 = a * a;
  float nh = max(dot(n, h), 0.0);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * d * d);
  // normalizzazione dell'area: allargare il disco non deve aggiungere energia
  float norm = a / clamp(a + radius * 0.5, 1e-4, 1.0);
  return D * norm * norm * max(dot(n, lp), 0.0);
}

void main() {
  float d = length(vWorld.xz - cameraPosition.xz);
  float far = smoothstep(25.0, 260.0, d);

  // pendenze, Jacobiano e schiuma delle tre cascate (con mipmap: in lontananza si mediano da sole)
  vec4 c0 = texture2D(uDeriv0, vFlow / uCascade.x);
  vec4 c1 = texture2D(uDeriv1, vFlow / uCascade.y);
  vec4 c2 = texture2D(uDeriv2, vFlow / uCascade.z);
  vec2 slope = (c0.xy + c1.xy + c2.xy) * vFade;
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  // in lontananza un filo più piatta: il riflesso del cielo non deve sfarfallare
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), far * 0.35));
  // maschera delle creste (Sea of Thieves): dove le onde comprimono la superficie il Jacobiano
  // scende sotto 1. Lì la luce attraversa meno acqua. Le cascate si sommano come scarti da 1
  float jac = 1.0 + (c0.z + c1.z + c2.z - 3.0) * vFade;
  float peak = clamp((1.0 - jac) * 1.4, 0.0, 1.0);

  vec3 vdir = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, vdir), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-vdir, n);
  r.y = abs(r.y);
  vec3 refl = skyColor(r);
  // riflesso planare della barca, deformato dalle onde
  vec2 suv = gl_FragCoord.xy / uResolution + n.xz * 0.075 * (1.0 - far);
  vec4 boatRefl = texture2D(uRefl, suv);
  refl = mix(refl, boatRefl.rgb, boatRefl.a * uReflOn);

  // corpo dell'acqua: dal colore profondo a quello della luce che attraversa le creste.
  // Conta l'angolo di vista, la direzione del sole (onde in controluce) e la maschera delle creste.
  vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  float back = pow(clamp(dot(-vdir, sunH) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  float crest = clamp(vWorld.y * 0.45 + 0.4, 0.0, 1.0);
  float sssAmt = clamp(peak * (0.35 + back * 0.9) + crest * back * 0.45 + pow(1.0 - ndv, 3.0) * peak * 0.3, 0.0, 1.0);
  vec3 body = mix(uDeep, uMid, crest * 0.6);
  body = mix(body, uSss * (0.6 + uSunCol * 0.6), sssAmt * (1.0 - far * 0.8));

  vec3 col = mix(body, refl, fres * (1.0 - boatRefl.a * uReflOn * 0.15));

  // sole: disco più largo quando è basso, riflesso più ruvido in lontananza
  float spec = areaSpec(n, vdir, uSunDir, uSunRadius, mix(0.06, 0.2, far));
  col += uSunCol * spec * 0.22 * (1.0 - boatRefl.a * uReflOn);

  // schiuma (come AC3): tre trame a scale diverse, una rampa sceglie quanto mostrarne
  float coarse = fbm(vFlow * 0.18);
  float medium = fbm(vFlow * 0.9 + 3.1);
  float sparse = smoothstep(0.55, 0.8, noise(vFlow * 3.3));
  // creste: la schiuma della FFT, dove l'onda si ripiega e nei secondi dopo (si spegne piano)
  float fftFoam = clamp(c0.a + c1.a * 0.8 + c2.a * 0.35, 0.0, 1.0) * vFade;
  // come per la scia: il valore della mappa fa da soglia su una trama, compatta dove la schiuma è
  // fresca e a merletto mentre si spegne (la mappa da sola, a un texel per metro, darebbe macchie lisce)
  float crestLace = fbm(vFlow * 1.1 + 7.3) * 0.6 + noise(vFlow * 4.2) * 0.4;
  float crestFoam = smoothstep(crestLace * 0.8, crestLace * 0.8 + 0.2, fftFoam * (0.7 + 0.6 * coarse)) * step(0.001, uCrestFoam);
  // strisce lungo il vento da forza 5 in su
  vec2 wd = normalize(vec2(1.0, 0.25));
  vec2 sq = vec2(dot(vFlow, wd) * 0.03, dot(vFlow, vec2(-wd.y, wd.x)) * 0.55);
  float streak = smoothstep(0.56, 0.74, fbm(sq)) * uStreaks * (1.0 - far * 0.6);

  // schiuma attorno allo scafo e scia, dal buffer (seafx.js)
  // il buffer della schiuma segue la barca: si legge nel suo riferimento (seafx.js ruota la camera)
  float fc = cos(uHeading), fs = sin(uHeading);
  vec2 bl = vec2(vWorld.x * fc + vWorld.z * fs, -vWorld.x * fs + vWorld.z * fc);
  vec2 fuv = vec2((bl.x - uFoamBox.x) / uFoamBox.z, (uFoamBox.y + uFoamBox.w - bl.y) / uFoamBox.w);
  float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
  float hull = texture2D(uFoamTex, clamp(fuv, 0.0, 1.0)).r * inside;
  float churn = fbm(vFlow * 1.3 + uTime * 0.35);
  // merletto: il buffer fa da soglia su una trama fine, compatta solo dove la schiuma è fresca
  // coordinate ruotate: il value noise allineato agli assi, tagliato da una soglia stretta,
  // faceva una scia a quadretti
  vec2 lq = mat2(0.8, -0.6, 0.6, 0.8) * vFlow;
  float lace = fbm(lq * 2.4 + uTime * 0.2) * 0.7 + fbm(mat2(0.6, 0.8, -0.8, 0.6) * vFlow * 5.5) * 0.3;
  float hullFoam = smoothstep(lace * 0.85 - 0.06, lace * 0.85 + 0.26, hull * 1.25);

  float amount = clamp(crestFoam + streak * 0.5 + hullFoam, 0.0, 1.0);
  float pattern = mix(sparse, mix(medium, 1.0, smoothstep(0.5, 1.0, amount)), smoothstep(0.1, 0.6, amount));
  float foam = clamp(amount * (0.35 + 0.65 * pattern) * (0.7 + 0.6 * churn), 0.0, 1.0);
  vec3 foamCol = vec3(0.9, 0.93, 0.95) * (0.55 + 0.45 * max(dot(n, uSunDir), 0.0)) + uSunCol * 0.08;
  col = mix(col, foamCol, clamp(foam * uFoam, 0.0, 0.92));

  // foschia verso l'orizzonte, dello stesso colore del cielo in basso
  col = mix(col, hazeColor(vWorld), hazeAmount(vWorld));
  gl_FragColor = vec4(col, uOpacity * (1.0 - smoothstep(1050.0, 1500.0, d)));
}
`;

// Griglia polare: fitta vicino alla barca, rada verso l'orizzonte (l'idea del LOD di Black Flag,
// senza patch: la barca è sempre al centro).
function radialGrid(rMin, rMax, rings, segs) {
  const pos = [];
  const idx = [];
  pos.push(0, 0, 0);
  for (let i = 0; i < rings; i++) {
    const r = rMin * Math.pow(rMax / rMin, i / (rings - 1));
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = 1 + i * segs + j;
      const b = 1 + i * segs + ((j + 1) % segs);
      const c = a + segs;
      const d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const skyFrag = /* glsl */ `
uniform float uOpacity;
uniform float uSunDisk;
varying vec3 vDir;
${SKY}
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir);
  // disco del sole
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunCol * smoothstep(0.9993, 0.9997, sd) * 6.0 * uSunDisk;
  // vicino e sotto l'orizzonte il cielo prende la tinta della foschia
  vec3 tone = hazeTone(normalize(vec3(dir.x, 0.0, dir.z)));
  col = mix(col, tone, 1.0 - smoothstep(-0.02, 0.1, dir.y));
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;


// ---------- Galleggiamento ----------
// L'altezza dell'acqua sotto lo scafo si legge dalla GPU, con la stessa funzione del vertex shader
// (waterOffset): la barca galleggia sull'acqua disegnata, cascata fine compresa. La lettura è
// asincrona (PBO e fence): il dato arriva uno o due fotogrammi dopo, meno del filo d'inerzia
// che float() aggiunge comunque. Lo scafo (19,98 × 5,31 m, centrato nell'origine, prua verso +X)
// si campiona su una griglia 5 × 3 dentro la linea di galleggiamento: le onde più corte della
// barca si compensano fra i punti, come su uno scafo vero.
const HULL_X = [-7, -3.5, 0, 3.5, 7];
const HULL_Z = [-2.1, 0, 2.1];
const HULL = HULL_X.flatMap((bx) => HULL_Z.map((bz) => [bx, bz]));

// piano ai minimi quadrati sulla griglia simmetrica: la media è il sollevamento, le pendenze
// lungo la prua e lungo il baglio danno beccheggio e rollio
// (rollio col segno della sbandata, rotation.x: positivo è la dritta che scende)
function fitPlane(heights, out) {
  let sum = 0, sx = 0, sz = 0, sxx = 0, szz = 0;
  HULL.forEach(([bx, bz], i) => {
    const h = heights[i];
    sum += h; sx += bx * h; sz += bz * h; sxx += bx * bx; szz += bz * bz;
  });
  out.heave = sum / HULL.length;
  out.pitch = Math.atan(sx / sxx);
  out.roll = -Math.atan(sz / szz);
  return out;
}

export function createOcean(renderer) {
  // Uniformi condivise fra mare, cielo e paesaggio
  const shared = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uZenith: { value: new THREE.Color(0x2a64a8) },
    uHorizon: { value: new THREE.Color(0xbfd2e0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(0xfff0d8) },
    uSunDisk: { value: 1 },
    uFogNear: { value: 180 },
    uFogFar: { value: 1300 },
    uFogHeight: { value: 250 },
    uFlow: { value: 4.6 },
    uOff: { value: new THREE.Vector2() },
    uHeading: { value: 0 },
    uWaveScale: { value: 1 },
  };

  const fft = createFFT(renderer, { size: FFT_SIZE, water: { glsl: WATER_GLSL, uniforms: { uOff: shared.uOff, uHeading: shared.uHeading } } });
  // uniformi dell'acqua per chi deve conoscerne l'altezza (materials.js, con WATER_GLSL)
  const water = { ...fft.uniforms, uOff: shared.uOff, uHeading: shared.uHeading };

  const geo = radialGrid(1.5, 1600, 190, 288);
  const mat = new THREE.ShaderMaterial({
    vertexShader: oceanVert,
    fragmentShader: oceanFrag,
    transparent: true,
    uniforms: {
      ...shared,
      ...water,
      uFoam: { value: 1 },
      uDeep: { value: new THREE.Color(0x03182b) },
      uMid: { value: new THREE.Color(0x0d4566) },
      uSss: { value: new THREE.Color(0x1f8f86) },
      uCrestFoam: { value: 0 },
      uStreaks: { value: 0 },
      uSunRadius: { value: 0.03 },
      // riflesso e schiuma dello scafo: le texture arrivano da seafx.js
      uRefl: { value: null },
      uReflOn: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFoamTex: { value: null },
      uFoamBox: { value: new THREE.Vector4(0, 0, 1, 1) },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  const skyMat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: shared,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;

  // il "mare" visto dal basso nella mappa d'ambiente: un disco scuro sotto l'orizzonte
  const envSea = new THREE.MeshBasicMaterial({ color: 0x0b3048 });
  let foamBase = 1;
  // ripidità delle creste e soglia della schiuma, dalle condizioni
  let choppy = 0.8;
  const foamParams = { bias: 0.75, gain: 6 };
  const floatRaw = { heave: 0, pitch: 0, roll: 0 };
  const floatState = { heave: 0, pitch: 0, roll: 0 };
  let floatReady = false;
  const hullPts = HULL.map(() => [0, 0]);

  return {
    mesh,
    sky,
    shared,
    // uniformi dell'acqua FFT (mappe di spostamento, lati delle cascate, rotta): con WATER_GLSL
    // danno waterHeight(xz) a chi deve sapere dov'è il pelo dell'acqua (materials.js)
    waves: water,
    fft,
    // collega le uniformi di seafx.js (stessi oggetti, si aggiornano da sole)
    linkSeaFx(u) {
      Object.assign(mat.uniforms, u);
    },
    // collega il cielo fisico di sky.js: il riflesso dell'acqua passa da skyColor (la cupola
    // dipinta) a skyReflect (cubemap del cielo più nuvole volumetriche lette sullo schermo).
    // La chunk arriva da fuori perché sky.js importa già SKY da qui (import circolare).
    linkSky(uniforms, chunk) {
      Object.assign(mat.uniforms, uniforms);
      mat.fragmentShader = mat.fragmentShader
        .replace("void main() {", `${chunk}\nvoid main() {`)
        .replace("vec3 refl = skyColor(r);", "vec3 refl = skyReflect(r);");
      mat.needsUpdate = true;
    },
    // Mappa d'ambiente del cielo per i riflessi su scafo e cromature
    envMap(pmrem) {
      const s = new THREE.Scene();
      const dome = new THREE.Mesh(sky.geometry, skyMat.clone());
      dome.material.uniforms = { ...shared, uOpacity: { value: 1 } };
      dome.scale.setScalar(0.01);
      s.add(dome);
      const sea = new THREE.Mesh(new THREE.CircleGeometry(30, 32), envSea);
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -2;
      s.add(sea);
      const tex = pmrem.fromScene(s, 0.02).texture;
      dome.material.dispose();
      sea.geometry.dispose();
      return tex;
    },
    setConditions(c) {
      shared.uSunDir.value.copy(c.sunDir);
      shared.uZenith.value.copy(c.zenith);
      shared.uHorizon.value.copy(c.horizon);
      shared.uSunCol.value.copy(c.sun);
      shared.uSunDisk.value = c.disk;
      shared.uFogNear.value = c.fog[0];
      shared.uFogFar.value = c.fog[1];
      shared.uFogHeight.value = c.fogHeight;
      shared.uFlow.value = c.flow;
      shared.uWaveScale.value = c.waveScale;
      mat.uniforms.uDeep.value.copy(c.deep);
      mat.uniforms.uMid.value.copy(c.mid);
      // turchese delle creste: il colore dell'acqua schiarito verso il verde acqua
      mat.uniforms.uSss.value.copy(c.mid).lerp(new THREE.Color(0x2aa898), 0.55).multiplyScalar(1.15);
      mat.uniforms.uCrestFoam.value = c.crestFoam;
      mat.uniforms.uStreaks.value = c.streaks;
      // il sole basso si allarga per l'atmosfera: scia di luce più ampia al tramonto
      mat.uniforms.uSunRadius.value = 0.025 + 0.11 * (1 - Math.min(1, c.sunDir.y / 0.5));
      envSea.color.copy(c.mid).multiplyScalar(0.6);
      foamBase = c.foam;
      // Spettro: il vento in nodi dà energia e lunghezza delle onde, la costa il fetch.
      // waveScale (0,6 con vento leggero, 1,35 con vento forte) dà la ripidità delle creste
      fft.setSpectrum({ speed: Math.max(2, c.knots * 0.5144), dir: WIND_DIR, fetch: FETCH[c.coast] ?? 60000 }, c.seed);
      choppy = 0.6 + 0.5 * c.waveScale;
      // schiuma dal Jacobiano: assente fino a forza 3, sulle creste che frangono con vento fresco
      foamParams.bias = c.crestFoam > 0 ? 0.62 + 0.16 * c.crestFoam : -1;
    },
    // Rotta della barca: heading in radianti (verso dritta positivo), pos lo spostamento percorso
    // sul piano del mondo (x, z). La barca ruota su se stessa al centro della scena; onde, sole e
    // paesaggio restano fermi e l'acqua scorre alla velocità della barca lungo la sua prua.
    setCourse(heading, pos) {
      shared.uHeading.value = heading;
      shared.uOff.value.set(pos.x, pos.y);
    },
    // Galleggiamento: come sta la barca sull'acqua disegnata dallo shader (letta dalla GPU, vedi
    // sopra). Restituisce sollevamento (m), beccheggio e rollio (radianti, prua che sale e dritta
    // che scende positivi), con un filo d'inerzia: 30 tonnellate non seguono ogni increspatura.
    // dt è il passo del fotogramma.
    float(t, dt) {
      const h = fft.heights;
      if (!h) return floatState;
      fitPlane(h, floatRaw);
      // il sollevamento segue l'acqua più da vicino (lo scafo non deve affondare né staccarsi),
      // beccheggio e rollio con più inerzia
      const step = Math.min(dt, 0.1);
      const kh = floatReady ? 1 - Math.exp(-step / 0.2) : 1;
      const ka = floatReady ? 1 - Math.exp(-step / 0.5) : 1;
      floatReady = true;
      floatState.heave += (floatRaw.heave - floatState.heave) * kh;
      floatState.pitch += (floatRaw.pitch * 0.85 - floatState.pitch) * ka;
      floatState.roll += (floatRaw.roll * 0.85 - floatState.roll) * ka;
      return floatState;
    },
    update(t, opacity, foam, cam) {
      shared.uTime.value = t;
      shared.uOpacity.value = opacity;
      mat.uniforms.uFoam.value = foam * foamBase;
      mesh.visible = sky.visible = opacity > 0.005;
      sky.position.copy(cam.position);
      // nello studio il mare non si vede: niente FFT
      if (!mesh.visible) return;
      fft.update(t, choppy, foamParams);
      // punti dello scafo nel mondo con la rotta di adesso: prua (cos h, sin h), dritta (-sin h, cos h)
      const hc = Math.cos(shared.uHeading.value), hs = Math.sin(shared.uHeading.value);
      HULL.forEach(([bx, bz], i) => {
        hullPts[i][0] = bx * hc - bz * hs;
        hullPts[i][1] = bx * hs + bz * hc;
      });
      fft.sample(hullPts);
    },
  };
}
