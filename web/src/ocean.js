import * as THREE from "three";

// Mare e cielo del capitolo Navigazione.
// Il mare è un piano con onde di Gerstner nel vertex shader; il dettaglio fine (increspature,
// schiuma, onda di prua e scia) è nel fragment shader. L'acqua scorre verso poppa (-X) per
// dare l'idea che la barca avanzi. Il cielo è una cupola che segue la camera: lo stesso
// colore d'orizzonte chiude la nebbia del mare, così non resta una riga sull'orizzonte.

// Sole, colori, vento e foschia arrivano dalle condizioni (conditions.js) con setConditions.

const WAVES = [
  // direzione xy, ripidità, lunghezza d'onda (m)
  [1.0, 0.25, 0.11, 38],
  [0.7, -0.6, 0.09, 19],
  [0.9, 0.9, 0.07, 10],
  [-0.3, 1.0, 0.05, 6],
];
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
uniform float uFlow;
uniform vec2 uOff;
uniform float uHeading;
uniform float uWaveScale;
uniform vec4 uWaves[4];
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vFlow;
varying float vPeak;

vec3 gerstner(vec4 w, vec2 p, inout vec3 tang, inout vec3 bin) {
  float k = 6.2831853 / w.w;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(w.xy);
  float f = k * (dot(d, p) - c * uTime);
  float a = w.z / k;
  float s = sin(f), co = cos(f);
  tang += vec3(-d.x * d.x * w.z * s, d.x * w.z * co, -d.x * d.y * w.z * s);
  bin  += vec3(-d.x * d.y * w.z * s, d.y * w.z * co, -d.y * d.y * w.z * s);
  return vec3(d.x * a * co, a * s, d.y * a * co);
}

void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  // spostamento dell'acqua rispetto alla barca, accumulato sulla CPU (setCourse): con la rotta
  // dritta vale (tempo × velocità, 0), come prima; in navigazione libera l'acqua scorre lungo la prua
  vec2 q = p.xz + uOff;
  // coordinate nel riferimento della barca (che in navigazione libera ruota su se stessa)
  float hc = cos(uHeading), hs = sin(uHeading);
  vec2 lp = vec2(p.x * hc + p.z * hs, -p.x * hs + p.z * hc);
  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 bin = vec3(0.0, 0.0, 1.0);
  vec3 off = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    w.z *= uWaveScale;
    off += gerstner(w, q, tang, bin);
  }
  // le onde si spengono in lontananza (e attorno alla barca restano più basse)
  float fade = 1.0 - smoothstep(300.0, 1400.0, length(p.xz));
  fade *= mix(0.55, 1.0, smoothstep(6.0, 22.0, length(lp * vec2(0.55, 1.0))));
  p += off * fade;
  vWorld = p;
  vFlow = q;
  vNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normalize(cross(bin, tang)), fade));
  // maschera delle creste (Sea of Thieves): dove le onde comprimono la superficie,
  // lo jacobiano orizzontale scende sotto 1. Lì la luce attraversa meno acqua.
  float jac = tang.x * bin.z - tang.z * bin.x;
  vPeak = clamp((1.0 - jac) * 1.6, 0.0, 1.0) * fade;
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
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vFlow;
varying float vPeak;
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

  // increspature: normale perturbata da rumore che scorre con l'acqua
  vec2 q = vFlow * 0.2 + vec2(0.0, uTime * 0.05);
  float e = 0.12;
  float h0 = fbm(q);
  float hx = fbm(q + vec2(e, 0.0));
  float hz = fbm(q + vec2(0.0, e));
  vec3 rip = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.16 * (1.0 - far);
  vec3 n = normalize(vNormal + rip);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), far * 0.7));

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
  float sssAmt = clamp(vPeak * (0.35 + back * 0.9) + crest * back * 0.45 + pow(1.0 - ndv, 3.0) * vPeak * 0.3, 0.0, 1.0);
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
  // creste: compaiono con il vento, dove la superficie si comprime
  float crestFoam = smoothstep(0.38, 0.85, vPeak + coarse * 0.4 - 0.1) * uCrestFoam;
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
  float lace = fbm(vFlow * 2.4 + uTime * 0.2) * 0.65 + noise(vFlow * 7.0) * 0.35;
  float hullFoam = smoothstep(lace * 0.85, lace * 0.85 + 0.18, hull * 1.25);

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
// Le stesse onde di Gerstner del vertex shader, rifatte sulla CPU: l'altezza dell'acqua in alcuni
// punti sotto lo scafo dà sollevamento, beccheggio e rollio. Lo scafo (19,98 × 5,31 m, centrato
// nell'origine, prua verso +X) si campiona su una griglia 5 × 3 dentro la linea di galleggiamento:
// le onde più corte della barca si compensano fra i punti, come su uno scafo vero.
const HULL_X = [-7, -3.5, 0, 3.5, 7];
const HULL_Z = [-2.1, 0, 2.1];
const smoothstep = (a, b, x) => {
  const u = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

// spostamento dell'onda nel punto p del piano (x, z), come gerstner() nello shader
function waveOffset(px, pz, t, sh, waves, out) {
  let ox = 0, oy = 0, oz = 0;
  const qx = px + sh.uOff.value.x, qz = pz + sh.uOff.value.y;
  for (const w of waves) {
    const k = (2 * Math.PI) / w.w;
    const c = Math.sqrt(9.8 / k);
    const len = Math.hypot(w.x, w.y);
    const dx = w.x / len, dz = w.y / len;
    const f = k * (dx * qx + dz * qz - c * t);
    const a = (w.z * sh.uWaveScale.value) / k;
    const co = Math.cos(f);
    ox += dx * a * co;
    oy += a * Math.sin(f);
    oz += dz * a * co;
  }
  // stessa attenuazione dello shader: in lontananza e attorno allo scafo
  const hc = Math.cos(sh.uHeading.value), hs = Math.sin(sh.uHeading.value);
  const lx = px * hc + pz * hs, lz = -px * hs + pz * hc;
  let fade = 1 - smoothstep(300, 1400, Math.hypot(px, pz));
  fade *= 0.55 + 0.45 * smoothstep(6, 22, Math.hypot(lx * 0.55, lz));
  out.x = ox * fade; out.y = oy * fade; out.z = oz * fade;
  return out;
}

// altezza dell'acqua nel punto del mondo (x, z): le onde spostano anche in orizzontale, quindi si
// cerca il punto del piano che finisce lì (tre passi bastano, le onde sono poco ripide)
const tmpOff = { x: 0, y: 0, z: 0 };
function waterHeight(x, z, t, sh, waves) {
  let px = x, pz = z;
  for (let i = 0; i < 3; i++) {
    waveOffset(px, pz, t, sh, waves, tmpOff);
    px = x - tmpOff.x;
    pz = z - tmpOff.z;
  }
  return waveOffset(px, pz, t, sh, waves, tmpOff).y;
}

function floatOn(t, sh, waves, out) {
  // assi della barca nel mondo: prua (cos h, sin h), dritta (-sin h, cos h), come lp nello shader
  const hc = Math.cos(sh.uHeading.value), hs = Math.sin(sh.uHeading.value);
  let sum = 0, sx = 0, sz = 0, sxx = 0, szz = 0, n = 0;
  for (const bx of HULL_X) {
    for (const bz of HULL_Z) {
      const h = waterHeight(bx * hc - bz * hs, bx * hs + bz * hc, t, sh, waves);
      sum += h; sx += bx * h; sz += bz * h; sxx += bx * bx; szz += bz * bz; n++;
    }
  }
  // piano ai minimi quadrati sulla griglia simmetrica: la media è il sollevamento, le pendenze
  // lungo la prua e lungo il baglio danno beccheggio e rollio
  // (rollio col segno della sbandata, rotation.x: positivo è la dritta che scende)
  out.heave = sum / n;
  out.pitch = Math.atan(sx / sxx);
  out.roll = -Math.atan(sz / szz);
  return out;
}

export function createOcean() {
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


  const geo = radialGrid(1.5, 1600, 190, 288);
  const mat = new THREE.ShaderMaterial({
    vertexShader: oceanVert,
    fragmentShader: oceanFrag,
    transparent: true,
    uniforms: {
      ...shared,
      uWaves: { value: WAVES.map((w) => new THREE.Vector4(...w)) },
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
  const floatRaw = { heave: 0, pitch: 0, roll: 0 };
  const floatState = { heave: 0, pitch: 0, roll: 0 };
  let floatReady = false;

  return {
    mesh,
    sky,
    shared,
    waves: mat.uniforms.uWaves,
    // collega le uniformi di seafx.js (stessi oggetti, si aggiornano da sole)
    linkSeaFx(u) {
      Object.assign(mat.uniforms, u);
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
    },
    // Rotta della barca: heading in radianti (verso dritta positivo), pos lo spostamento percorso
    // sul piano del mondo (x, z). La barca ruota su se stessa al centro della scena; onde, sole e
    // paesaggio restano fermi e l'acqua scorre alla velocità della barca lungo la sua prua.
    setCourse(heading, pos) {
      shared.uHeading.value = heading;
      shared.uOff.value.set(pos.x, pos.y);
    },
    // Galleggiamento: come sta la barca sull'acqua disegnata dallo shader, al tempo t (dopo
    // setCourse, che sposta l'acqua). Restituisce sollevamento (m), beccheggio e rollio (radianti,
    // prua che sale e dritta che scende positivi), con un filo d'inerzia: 30 tonnellate non
    // seguono ogni increspatura. dt è il passo del fotogramma.
    float(t, dt) {
      floatOn(t, shared, mat.uniforms.uWaves.value, floatRaw);
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
    },
  };
}
