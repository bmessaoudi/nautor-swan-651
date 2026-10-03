import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { SKY } from "./ocean.js";
import { makeRng } from "./conditions.js";

// Terra realistica del capitolo Navigazione: isole e coste da mappe di altezza vere.
// - Arcipelago: scogli e isole davanti a Pietarsaari (Copernicus DEM GLO-30). Rocce basse e
//   arrotondate dal ghiaccio, pinete fitte dove il modello di superficie vedeva le chiome.
// - Costa alta: falesie del golfo di Orosei e isole di Tavolara e Molara (terrain tiles Terrarium).
// Gli asset li prepara scripts/terrain/build_terrain.py: un atlante PNG per zona con l'altezza a
// 16 bit (R, G) e la densità del bosco (B), più quattro texture CC0 di Poly Haven.
// Il comportamento è quello del paesaggio di landscape.js: posizioni dal seme con Poisson disk, mai
// sopra la barca, scorrimento lungo -X alla velocità della barca e ricomparsa oltre la foschia.

const BASE = `${import.meta.env.BASE_URL}terrain/`;
// prospettiva aerea: un po' più lunga di quella di landscape.js (750 m), perché le isole vere sono
// basse e scure e si perderebbero nella foschia già a mezzo chilometro
const DEFINES = { AERIAL_DIST: "1100.0" };
// Esagerazione verticale dell'arcipelago (roccia, chiome). Gli scogli davanti a Pietarsaari sono alti
// pochi metri: dalla barca, già a 500 m, sparirebbero sotto la foschia
const ARCHIPELAGO_GAIN = [1.6, 1.7];

const terrainVert = /* glsl */ `
attribute float aForest;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vNLocal;
varying float vForest;
varying vec3 vAxX;
varying vec3 vAxZ;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vAxX = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
  vAxZ = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  vWorld = w.xyz;
  // coordinate della texture legate all'isola (in metri), non al mondo: l'isola scorre e la
  // texture deve scorrere con lei
  vLocal = position * length(modelMatrix[0].xyz);
  vN = normalize(mat3(modelMatrix) * normal);
  vNLocal = normal;
  vForest = aForest;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const terrainFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform float uWrap;
uniform float uMed;
uniform float uWet;
uniform float uWave;
uniform sampler2D tRock;
uniform sampler2D tRockN;
uniform sampler2D tLichen;
uniform sampler2D tLichenN;
uniform sampler2D tSoil;
uniform sampler2D tSoilN;
uniform sampler2D tShore;
uniform sampler2D tShoreN;
varying vec3 vWorld;
varying vec3 vLocal;
varying vec3 vN;
varying vec3 vNLocal;
varying float vForest;
varying vec3 vAxX;
varying vec3 vAxZ;
${SKY}
float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y);
}
float tFbm(vec2 p) { return tNoise(p) * 0.55 + tNoise(p * 2.1 + 3.7) * 0.3 + tNoise(p * 4.3 + 9.1) * 0.15; }
// proiezione triplanare: le falesie non stirano la texture
vec3 triW(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
vec3 triCol(sampler2D t, vec3 p, vec3 w, float s) {
  return texture2D(t, p.zy * s).rgb * w.x + texture2D(t, p.xz * s).rgb * w.y + texture2D(t, p.xy * s).rgb * w.z;
}
// normali triplanari con la fusione "UDN": basta per una roccia vista da centinaia di metri
vec3 triNor(sampler2D t, vec3 p, vec3 w, float s) {
  vec2 a = texture2D(t, p.zy * s).xy * 2.0 - 1.0;
  vec2 b = texture2D(t, p.xz * s).xy * 2.0 - 1.0;
  vec2 c = texture2D(t, p.xy * s).xy * 2.0 - 1.0;
  return vec3(0.0, a.y, a.x) * w.x + vec3(b.x, 0.0, b.y) * w.y + vec3(c.x, c.y, 0.0) * w.z;
}
vec3 topNor(sampler2D t, vec3 p, float s) {
  vec2 b = texture2D(t, p.xz * s).xy * 2.0 - 1.0;
  return vec3(b.x, 0.0, b.y);
}
void main() {
  vec3 nG = normalize(vNLocal);
  vec3 w = triW(nG);
  float slope = 1.0 - nG.y; // 0 piano, 1 parete
  float h = vWorld.y;
  float macro = tFbm(vLocal.xz * 0.012);
  float fine = tNoise(vLocal.xz * 0.09);

  // pesi degli strati: parete di roccia, roccia con licheni, suolo e sottobosco, battigia bagnata
  // al sud la macchia si arrampica anche su versanti ripidi: la roccia nuda resta alle pareti
  float rock = smoothstep(mix(0.22, 0.36, uMed), mix(0.42, 0.62, uMed), slope + (macro - 0.5) * 0.3);
  float veg = clamp(vForest * 1.6, 0.0, 1.0);
  // macchia mediterranea: a chiazze, non sulle creste spoglie né sulla battigia
  veg = max(veg, uMed * smoothstep(0.5, 0.25, slope) * smoothstep(0.3, 0.55, macro + fine * 0.3) * smoothstep(4.0, 15.0, h));
  float dist = length(vWorld.xz - cameraPosition.xz);
  float far = smoothstep(300.0, 1200.0, dist);
  float wetTop = 0.5 + uWave * 1.1;
  float shore = 1.0 - smoothstep(wetTop, wetTop + 1.8 + fine * 1.5, h);
  // chiome della pineta (solo al nord, dal DEM): coprono tutto, anche i fianchi ripidi del bosco
  float canopy = smoothstep(0.12, 0.45, vForest);
  float wRock = rock * (1.0 - canopy);
  float wSoil = (1.0 - rock) * veg * (1.0 - canopy);
  float wLichen = (1.0 - rock) * (1.0 - veg) * (1.0 - canopy);
  wRock *= 1.0 - shore; wSoil *= 1.0 - shore; wLichen *= 1.0 - shore; canopy *= 1.0 - shore;

  // due scale per roccia e licheni: da lontano domina quella larga, così le pareti alte non
  // mostrano la griglia della ripetizione
  vec3 cRock = mix(triCol(tRock, vLocal, w, 1.0 / 38.0), triCol(tRock, vLocal.zyx + 71.0, w, 1.0 / 170.0), 0.35 + far * 0.5);
  vec3 cLichen = mix(triCol(tLichen, vLocal, w, 1.0 / 17.0), triCol(tLichen, vLocal.zyx + 13.0, w, 1.0 / 90.0), 0.35 + far * 0.5);
  vec3 cSoil = texture2D(tSoil, vLocal.xz / 45.0).rgb;
  vec3 cShore = texture2D(tShore, vLocal.xz / 14.0).rgb;
  // tinte di zona: granito rosato e grigio in Finlandia, calcare chiaro e caldo in Sardegna;
  // sottobosco di aghi scuro al nord, macchia verde oliva al sud
  float grey = dot(cRock, vec3(0.33));
  cRock = mix(mix(cRock, vec3(grey) * vec3(1.08, 0.97, 0.93), 0.55), vec3(grey) * vec3(1.18, 1.1, 0.98) * 1.25, uMed);
  // al nord i licheni sono macchie grigio verdi sul granito, non un prato
  cLichen = mix(mix(cRock * 0.95, vec3(dot(cLichen, vec3(0.33))) * vec3(0.95, 1.0, 0.8), 0.4), cLichen * vec3(1.05, 1.0, 0.85), uMed);
  // battigia: granito scuro bagnato al nord, sabbia e ciottoli al sud
  cShore = mix(cRock * vec3(0.62, 0.6, 0.58), cShore, uMed);
  cSoil = mix(cSoil * vec3(0.55, 0.62, 0.45), cSoil * vec3(0.62, 0.68, 0.42), uMed);
  // aghi di pino e abete: verde scuro a ciuffi, con i buchi d'ombra fra una chioma e l'altra
  float clump = tNoise(vLocal.xz * 0.22) * 0.6 + tNoise(vLocal.xz * 0.61 + 5.0) * 0.4;
  vec3 cCanopy = vec3(0.026, 0.044, 0.026) * (0.5 + clump * 0.9);
  vec3 alb = cRock * wRock + cLichen * wLichen + cSoil * wSoil + cShore * shore + cCanopy * canopy;
  alb *= 0.82 + macro * 0.36;

  // battigia: fascia scura bagnata a pelo d'acqua, più alta con onde forti. Con la pioggia è tutto bagnato
  float wetBand = 1.0 - smoothstep(wetTop - 0.4, wetTop + 0.6 + fine * 0.5, h);
  float wet = max(wetBand, uWet * 0.7);
  alb *= 1.0 - wet * 0.5;
  // un filo di alghe scure appena sopra l'acqua, come sugli scogli del Baltico
  alb = mix(alb, vec3(0.05, 0.06, 0.04), wetBand * (1.0 - uMed) * 0.4 * smoothstep(-0.3, 0.3, h));

  vec3 dn = triNor(tRockN, vLocal, w, 1.0 / 38.0) * (wRock + wLichen) + topNor(tSoilN, vLocal, 1.0 / 45.0) * wSoil
          + topNor(tShoreN, vLocal, 1.0 / 14.0) * shore;
  // la perturbazione è negli assi dell'isola: la si riporta nel mondo con i suoi assi X e Z
  vec3 n = normalize(vN + (vAxX * dn.x + vec3(0.0, dn.y, 0.0) + vAxZ * dn.z) * 0.6);
  if (!gl_FrontFacing) n = -n;

  // le chiome lasciano passare un po' di luce: illuminazione avvolgente invece del Lambert secco
  float dif = mix(max(dot(n, uSunDir), 0.0), clamp((dot(n, uSunDir) + 0.3) / 1.3, 0.0, 1.0), canopy);
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  // dentro la pineta il cielo arriva poco: le ombre fra le chiome restano scure
  amb *= 1.0 - canopy * 0.4;
  vec3 col = alb * (uSunCol * dif * 1.6 + amb * 0.75);
  // riflesso del sole sulla roccia bagnata
  vec3 v = normalize(cameraPosition - vWorld);
  float spec = pow(max(dot(n, normalize(uSunDir + v)), 0.0), 60.0) * wet;
  col += uSunCol * spec * 0.6;

  // prospettiva aerea come il resto del paesaggio, più la dissolvenza verso il punto in cui le
  // isole ricompaiono: lì devono essere già del colore della foschia
  float aerial = max(hazeAmount(vWorld), (1.0 - exp(-dist / AERIAL_DIST)) * 0.8);
  aerial = max(aerial, smoothstep(uWrap - 250.0, uWrap, dist));
  col = mix(col, hazeColor(vWorld), aerial);
  gl_FragColor = vec4(col, uOpacity);
}
`;

// Pini in istanza: colore per vertice (chioma, tronco) per un colore per istanza
const pineVert = /* glsl */ `
varying vec3 vCol;
varying vec3 vN;
varying vec3 vWorld;
varying float vUp;
void main() {
  mat4 m = modelMatrix * instanceMatrix;
  vec4 w = m * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(m) * normal);
  vCol = color * instanceColor;
  vUp = position.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const pineFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform float uWrap;
uniform float uWet;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vWorld;
varying float vUp;
${SKY}
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  // chioma: luce avvolgente (gli aghi lasciano passare un po' di sole) e base più scura
  float dif = clamp((dot(n, uSunDir) + 0.35) / 1.35, 0.0, 1.0);
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  float occ = mix(0.45, 1.0, clamp(vUp, 0.0, 1.0));
  vec3 col = vCol * (uSunCol * dif * 1.3 + amb * 0.7) * occ * (1.0 - uWet * 0.25);
  float dist = length(vWorld.xz - cameraPosition.xz);
  float aerial = max(hazeAmount(vWorld), (1.0 - exp(-dist / AERIAL_DIST)) * 0.8);
  aerial = max(aerial, smoothstep(uWrap - 250.0, uWrap, dist));
  col = mix(col, hazeColor(vWorld), aerial);
  gl_FragColor = vec4(col, uOpacity);
}
`;

// ---------- Alberi ----------

function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.deleteAttribute("uv");
  return g;
}

// Tutti gli alberi sono alti 1 e poggiano a y = 0: la scala dell'istanza dà l'altezza in metri
const TREES = {
  // abete rosso: cono a palchi sovrapposti
  abete() {
    const parts = [colored(new THREE.CylinderGeometry(0.018, 0.028, 0.3, 5).translate(0, 0.15, 0), 0x4a3426)];
    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const r = 0.2 * (1 - i / tiers) + 0.05;
      const h = 0.38 - i * 0.04;
      const y = 0.12 + i * 0.2;
      parts.push(colored(new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y + h / 2, 0), i % 2 ? 0x1d3320 : 0x203a24));
    }
    return mergeGeometries(parts);
  },
  // pino silvestre: tronco alto e nudo, chioma a cuscini irregolari in cima
  silvestre() {
    const parts = [colored(new THREE.CylinderGeometry(0.02, 0.03, 0.66, 5).translate(0, 0.33, 0), 0x5a3a28)];
    // palchi piatti e sfalsati: la chioma è larga, irregolare e scende fino a metà fusto
    const blobs = [[0, 0.88, 0, 0.19], [0.15, 0.78, 0.06, 0.16], [-0.13, 0.8, -0.08, 0.17], [0.05, 0.66, -0.14, 0.14], [-0.08, 0.6, 0.12, 0.12]];
    for (const [x, y, z, r] of blobs) {
      parts.push(colored(new THREE.IcosahedronGeometry(r, 0).scale(1.15, 0.5, 1.15).translate(x, y, z), 0x1f3523));
    }
    return mergeGeometries(parts);
  },
  // pino domestico: l'ombrello delle coste mediterranee
  domestico() {
    const parts = [colored(new THREE.CylinderGeometry(0.02, 0.035, 0.76, 5).translate(0, 0.38, 0), 0x6b4a36)];
    parts.push(colored(new THREE.SphereGeometry(0.36, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.42, 1).translate(0, 0.78, 0), 0x2f4a26));
    parts.push(colored(new THREE.CircleGeometry(0.33, 9).rotateX(Math.PI / 2).translate(0, 0.79, 0), 0x22351d));
    return mergeGeometries(parts);
  },
  // pino d'Aleppo e lecci della macchia: chioma più rada e irregolare
  aleppo() {
    const parts = [colored(new THREE.CylinderGeometry(0.02, 0.03, 0.5, 5).translate(0, 0.25, 0), 0x5e4634)];
    const blobs = [[0, 0.62, 0, 0.24], [0.15, 0.52, 0.06, 0.16], [-0.13, 0.56, -0.08, 0.17], [0.03, 0.8, 0.04, 0.15]];
    for (const [x, y, z, r] of blobs) {
      parts.push(colored(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.7, 1).translate(x, y, z), 0x3a5530));
    }
    return mergeGeometries(parts);
  },
};

// ---------- Mappe di altezza ----------

async function loadAtlas(url) {
  const blob = await (await fetch(url)).blob();
  // niente conversioni di colore: i canali sono numeri, non colori
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const cv = document.createElement("canvas");
  cv.width = bmp.width;
  cv.height = bmp.height;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, width: bmp.width };
}

// Un ritaglio: altezze e bosco in metri su una griglia n x n, più le misure che servono a disporlo.
// gain = esagerazione verticale [suolo, chiome]
function readChip(atlas, meta, enc, gain = [1, 1]) {
  const { n } = meta;
  const h = new Float32Array(n * n);
  const f = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = ((meta.y + r) * atlas.width + meta.x + c) * 4;
      const y = (atlas.data[i] * 256 + atlas.data[i + 1]) / enc.scale - enc.offset;
      h[r * n + c] = y > 0 ? y * gain[0] : y;
      f[r * n + c] = (atlas.data[i + 2] / 10) * gain[1]; // altezza delle chiome in metri
    }
  }
  meta = { ...meta, hmax: meta.hmax * gain[0] };
  const size = (n - 1) * meta.mpp;
  // raggio della terra emersa dal centro, e prima riga con terra (il lato verso il mare è la riga 0)
  let radius = 0;
  let front = n;
  for (let r = 0; r < n; r++) {
    let landInRow = 0;
    for (let c = 0; c < n; c++) {
      if (h[r * n + c] > 0) {
        landInRow++;
        radius = Math.max(radius, Math.hypot(c / (n - 1) - 0.5, r / (n - 1) - 0.5) * size);
      }
    }
    if (front === n && landInRow > n * 0.02) front = r;
  }
  return { ...meta, h, f, size, radius, front: (front / (n - 1) - 0.5) * size, geo: [] };
}

// rumore a valori per le chiome: gruppi di alberi di qualche metro, non una coperta liscia
function crownNoise(x, z) {
  const hash = (i, j) => {
    const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const i = Math.floor(x), j = Math.floor(z);
  let fx = x - i, fz = z - j;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  return (hash(i, j) * (1 - fx) + hash(i + 1, j) * fx) * (1 - fz) + (hash(i, j + 1) * (1 - fx) + hash(i + 1, j + 1) * fx) * fz;
}

// Griglia della mappa di altezza, saltando i triangoli tutti sott'acqua. step 2 = mezza risoluzione (LOD).
// Dove il DEM vedeva il bosco la superficie sale fino alle chiome: da lontano una pineta è una massa
// scura e bitorzoluta, gli alberi in istanza servono solo a sfrangiarne il profilo
function chipGeometry(chip, step) {
  const { n, h, f, size } = chip;
  const m = Math.floor((n - 1) / step) + 1;
  const pos = new Float32Array(m * m * 3);
  const forest = new Float32Array(m * m);
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      const sr = Math.min(n - 1, r * step);
      const sc = Math.min(n - 1, c * step);
      const k = r * m + c;
      const x = (sc / (n - 1) - 0.5) * size;
      const z = (sr / (n - 1) - 0.5) * size;
      const ground = h[sr * n + sc];
      const crown = ground > 0.3 ? f[sr * n + sc] : 0;
      pos[k * 3] = x;
      pos[k * 3 + 1] = ground + crown * (0.55 + 0.6 * crownNoise(x / 7, z / 7));
      pos[k * 3 + 2] = z;
      forest[k] = Math.min(1, crown / 7);
    }
  }
  const idx = [];
  const deep = -2.5;
  for (let r = 0; r < m - 1; r++) {
    for (let c = 0; c < m - 1; c++) {
      const a = r * m + c, b = a + 1, d = a + m, e = d + 1;
      const ya = pos[a * 3 + 1], yb = pos[b * 3 + 1], yd = pos[d * 3 + 1], ye = pos[e * 3 + 1];
      if (Math.max(ya, yb, yd, ye) < deep) continue;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aForest", new THREE.BufferAttribute(forest, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// altezza e pendenza nel punto (u, v) del ritaglio, interpolate
function sampleChip(chip, u, v) {
  const { n, h, f } = chip;
  const x = u * (n - 1), y = v * (n - 1);
  const c = Math.min(n - 2, Math.floor(x)), r = Math.min(n - 2, Math.floor(y));
  const fx = x - c, fy = y - r;
  const at = (rr, cc) => h[rr * n + cc];
  const z = (at(r, c) * (1 - fx) + at(r, c + 1) * fx) * (1 - fy) + (at(r + 1, c) * (1 - fx) + at(r + 1, c + 1) * fx) * fy;
  const dx = (at(r, c + 1) - at(r, c)) / chip.mpp;
  const dy = (at(r + 1, c) - at(r, c)) / chip.mpp;
  return { y: z, slope: Math.hypot(dx, dy), forest: f[r * n + c] };
}

// Poisson disk per lancio di freccette, come in landscape.js
function poisson(count, sampleFn, tries = 40) {
  const out = [];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < tries; k++) {
      const p = sampleFn();
      if (!p) continue;
      if (out.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > (p.r + q.r) * 0.7)) {
        out.push(p);
        break;
      }
    }
  }
  return out;
}

// ---------- Terra ----------

// opts.trees: moltiplicatore della densità dei pini (manopola di qualità)
export function createTerrain(shared, opts = {}) {
  const treeK = opts.trees ?? 1;
  const group = new THREE.Group();
  group.name = "Terrain";
  const amb = { uAmbSky: { value: new THREE.Color() }, uAmbGround: { value: new THREE.Color() } };
  const common = { uWrap: { value: 2000 }, uWet: { value: 0 } };
  const terrainMat = new THREE.ShaderMaterial({
    vertexShader: terrainVert,
    defines: DEFINES,
    fragmentShader: terrainFrag,
    uniforms: {
      ...shared,
      ...amb,
      ...common,
      uMed: { value: 0 },
      uWave: { value: 1 },
      tRock: { value: null }, tRockN: { value: null },
      tLichen: { value: null }, tLichenN: { value: null },
      tSoil: { value: null }, tSoilN: { value: null },
      tShore: { value: null }, tShoreN: { value: null },
    },
    transparent: true,
  });
  const pineMat = new THREE.ShaderMaterial({
    vertexShader: pineVert,
    defines: DEFINES,
    fragmentShader: pineFrag,
    uniforms: { ...shared, ...amb, ...common },
    vertexColors: true,
    transparent: true,
  });
  const trees = Object.fromEntries(Object.entries(TREES).map(([k, f]) => [k, f()]));

  let data = null; // { arcipelago: [chip], costa: [chip] }
  let pending = null;
  let movers = [];
  let wrap = 2000;
  let flow = 4.6;

  const ready = (async () => {
    const meta = await (await fetch(`${BASE}terrain.json`)).json();
    const tl = new THREE.TextureLoader();
    const tex = (name, srgb) =>
      new Promise((res, rej) =>
        tl.load(`${BASE}${name}.jpg`, (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = 8;
          if (srgb) t.colorSpace = THREE.SRGBColorSpace;
          res(t);
        }, undefined, rej)
      );
    const u = terrainMat.uniforms;
    const [atA, atC] = await Promise.all([loadAtlas(BASE + meta.arcipelago.atlas), loadAtlas(BASE + meta.costa.atlas)]);
    [u.tRock.value, u.tRockN.value, u.tLichen.value, u.tLichenN.value, u.tSoil.value, u.tSoilN.value, u.tShore.value, u.tShoreN.value] =
      await Promise.all([
        tex("roccia_diff", true), tex("roccia_nor", false),
        tex("lichene_diff", true), tex("lichene_nor", false),
        tex("suolo_diff", true), tex("suolo_nor", false),
        tex("riva_diff", true), tex("riva_nor", false),
      ]);
    data = {
      arcipelago: meta.arcipelago.chips.map((m) => readChip(atA, m, meta.encoding, ARCHIPELAGO_GAIN)),
      costa: meta.costa.chips.map((m) => readChip(atC, m, meta.encoding)),
    };
    if (pending) build(pending);
  })().catch((e) => console.error("terrain: asset non caricati", e));

  // geometria del ritaglio in due livelli di dettaglio, costruita una volta sola
  function lodFor(chip) {
    if (!chip.geo.length) chip.geo = [chipGeometry(chip, 1), chipGeometry(chip, 2)];
    const lod = new THREE.LOD();
    lod.addLevel(new THREE.Mesh(chip.geo[0], terrainMat), 0);
    lod.addLevel(new THREE.Mesh(chip.geo[1], terrainMat), opts.lodDistance ?? 900);
    return lod;
  }

  // Pini: punti a caso sul ritaglio, accettati dove la pendenza lo permette e il bosco c'è
  function plantTrees(rng, chip, scale, med) {
    const out = new THREE.Group();
    const kinds = med ? ["domestico", "aleppo"] : ["silvestre", "abete"];
    // gli scogli bassi del sud restano nudi
    if (med && chip.hmax < 20) return out;
    const want = Math.round(treeK * (med ? 90 + chip.radius * 0.05 : Math.min(700, 30 + chip.radius * chip.radius * 0.002 * (0.3 + chip.forest * 4))));
    const lists = [[], []];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let placed = 0;
    for (let k = 0; k < want * 12 && placed < want; k++) {
      const uu = rng(), vv = rng();
      const at = sampleChip(chip, uu, vv);
      if (at.y < 1.2 || at.slope > (med ? 0.55 : 0.45)) continue;
      // al nord le chiome sono già nella superficie: gli alberi servono sul margine del bosco, qualcuno
      // che spunta dalla massa e qualche pino solitario sulla roccia. Al sud versanti dolci, a macchie
      const cf = at.forest;
      const chance = med ? (at.y < chip.hmax * 0.7 ? 0.35 : 0.08) * (1 - at.slope) : cf > 1 && cf < 6 ? 0.9 : cf >= 6 ? 0.5 : 0.03;
      if (rng() > chance) continue;
      const kind = rng() < (med ? 0.55 : 0.6) ? 0 : 1;
      const height = med ? rng.range(8, 15) : Math.min(26, Math.max(cf + rng.range(1.5, 5), rng.range(8, 16)));
      const wide = med ? rng.range(0.9, 1.35) : rng.range(0.8, 1.2);
      p.set((uu - 0.5) * chip.size * scale, at.y * scale - 0.4, (vv - 0.5) * chip.size * scale);
      q.setFromAxisAngle(up, rng() * Math.PI * 2);
      s.set(height * wide, height, height * wide);
      m.compose(p, q, s);
      // ogni albero un po' più chiaro o più scuro, appena più giallo o più blu
      const l = rng.range(0.78, 1.15);
      lists[kind].push([m.clone(), new THREE.Color(l, l * rng.range(0.96, 1.04), l * rng.range(0.88, 1.0))]);
      placed++;
    }
    lists.forEach((list, i) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(trees[kinds[i]], pineMat, list.length);
      list.forEach(([mm, cc], j) => {
        im.setMatrixAt(j, mm);
        im.setColorAt(j, cc);
      });
      im.computeBoundingSphere();
      out.add(im);
    });
    return out;
  }

  function clear() {
    for (const m of movers) {
      m.obj.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
      });
    }
    group.clear();
    movers = [];
  }

  function build(c) {
    pending = c;
    if (!data) return;
    clear();
    // generatore proprio, legato al seme: la terra non cambia se altri moduli pescano numeri in più
    const rng = makeRng((c.seed * 2654435761) ^ 0x7e11a);
    flow = c.flow;
    amb.uAmbSky.value.copy(c.ambSky).multiplyScalar(c.ambI);
    amb.uAmbGround.value.copy(c.ambGround).multiplyScalar(c.ambI);
    // oltre questa distanza la foschia è piena: lì la terra può ricomparire senza salti
    wrap = c.fog[1] + 250;
    common.uWrap.value = wrap;
    common.uWet.value = c.rain ? 1 : 0;
    terrainMat.uniforms.uWave.value = c.waveScale;
    terrainMat.uniforms.uMed.value = c.coast === "costa" ? 1 : 0;

    const med = c.coast === "costa";
    const add = (chip, x, z, scale, rotY) => {
      const obj = new THREE.Group();
      const lod = lodFor(chip);
      lod.scale.setScalar(scale);
      obj.add(lod, plantTrees(rng, chip, scale, med));
      obj.rotation.y = rotY;
      obj.position.set(x, 0, z);
      group.add(obj);
      // ogni pezzo ricompare quando è tutto oltre la foschia: il suo raggio allarga il giro
      movers.push({ obj, x0: x, r: chip.size * scale * 0.72 });
    };

    if (c.coast === "arcipelago") {
      const chips = data.arcipelago;
      const zMax = Math.min(950, c.fog[1] * 0.7);
      const isl = poisson(rng.int(20, 30), () => {
        // le grandi poche e lontane, le piccole dappertutto
        const big = rng() < 0.25;
        const pool = chips.filter((ch) => (big ? ch.radius > 350 : ch.radius <= 450));
        const chip = rng.pick(pool);
        const scale = rng.range(0.8, 1.25);
        const r = chip.radius * scale;
        // nessuna isola sopra la barca, anche ruotata: il bordo resta a 160 m dalla rotta
        const zMin = r + 160;
        // più fitte vicino alla rotta: da una barca l'arcipelago si vede soprattutto nei primi 500 m
        const z = zMin + Math.max(50, zMax + r * 0.5 - zMin) * rng() ** 1.7;
        return { x: rng.range(-wrap, wrap), z: (rng() < 0.5 ? -1 : 1) * z, r, chip, scale };
      });
      for (const p of isl) add(p.chip, p.x, p.z, p.scale, rng() * Math.PI * 2);
    } else if (med) {
      const coasts = data.costa.filter((ch) => ch.kind === "costa");
      const isles = data.costa.filter((ch) => ch.kind === "isola");
      // le inquadrature dei passi 13, 14, 15 e 17 guardano verso -Z: la costa sta da quella parte,
      // l'isola alta va da una parte o dall'altra (il passo 16 guarda verso +Z)
      const side = -1;
      // falesie: tre tratti affiancati, con la riva a 0,85-1,15 km
      const parts = 3;
      const used = [];
      for (let i = 0; i < parts; i++) {
        let chip = rng.pick(coasts);
        if (used.includes(chip) && coasts.length > used.length) chip = coasts.find((ch) => !used.includes(ch));
        used.push(chip);
        const scale = rng.range(0.42, 0.58);
        const shore = rng.range(850, 1150);
        // il lato del mare è -Z locale: dalla parte opposta la si gira di mezzo giro
        const z = side * (shore - chip.front * scale);
        const x = -wrap + ((i + rng.range(0.25, 0.75)) / parts) * wrap * 2;
        add(chip, x, z, scale, side > 0 ? 0 : Math.PI);
      }
      // spesso un'isola alta dall'altra parte della rotta (Tavolara, Molara), e qualche scoglio.
      // Il raggio dell'isola tiene il bordo lontano dalla barca qualunque sia la rotazione
      const tall = isles.filter((ch) => ch.hmax > 100);
      if (tall.length && rng() < 0.7) {
        const chip = rng.pick(tall);
        const scale = rng.range(0.4, 0.55);
        const r = chip.radius * scale;
        add(chip, rng.range(-wrap, wrap), -side * (r + rng.range(250, 600)), scale, rng() * Math.PI * 2);
      }
      const rocks = isles.filter((ch) => ch.hmax <= 100 && ch.radius < 500);
      for (let i = 0; i < rng.int(2, 5) && rocks.length; i++) {
        const chip = rng.pick(rocks);
        const scale = rng.range(0.5, 0.9);
        const r = chip.radius * scale;
        add(chip, rng.range(-wrap, wrap), side * rng.range(Math.max(400, r + 160), 800), scale, rng() * Math.PI * 2);
      }
    }
  }

  return {
    group,
    ready,
    build,
    update(t, opacity) {
      const vis = opacity > 0.005 && movers.length > 0;
      group.visible = vis;
      if (!vis) return;
      terrainMat.uniforms.uOpacity.value = opacity;
      for (const m of movers) {
        const w = wrap + m.r;
        const span = w * 2;
        let x = m.x0 - flow * t;
        x = ((((x + w) % span) + span) % span) - w;
        m.obj.position.x = x;
      }
    },
  };
}
