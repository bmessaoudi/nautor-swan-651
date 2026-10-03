import * as THREE from "three";
import { SKY } from "./ocean.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Paesaggio del capitolo Navigazione, generato dal seme delle condizioni.
// - Isole: scogli di granito arrotondati, alcuni con pinete, come l'arcipelago davanti a Pietarsaari.
// - Costa alta: promontori lontani e velati, più mediterranei.
// - Vele lontane, gabbiani attorno all'albero, nuvole a billboard.
// La barca è ferma all'origine e l'acqua scorre verso -X: anche isole e barche scorrono, e
// ricompaiono dall'altra parte oltre la foschia, dove sono già del colore del cielo.
// Le posizioni usano un campionamento Poisson disk, così gli oggetti non si ammucchiano.

const sceneryVert = /* glsl */ `
varying vec3 vCol;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vCol = color;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const sceneryFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vWorld;
${SKY}
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  float dif = max(dot(n, uSunDir), 0.0);
  // le pance di gabbiani e scafi prendono la luce riflessa dal mare, non il buio
  vec3 amb = mix(uAmbGround, uAmbSky, abs(n.y) * 0.5 + 0.5);
  vec3 col = vCol * (uSunCol * dif * 1.6 + amb * 0.75);
  // prospettiva aerea: anche con aria limpida le montagne lontane sbiadiscono verso il cielo
  float dist = length(vWorld.xz - cameraPosition.xz);
  float aerial = max(hazeAmount(vWorld), (1.0 - exp(-dist / 750.0)) * 0.82);
  col = mix(col, hazeColor(vWorld), aerial);
  gl_FragColor = vec4(col, uOpacity);
}
`;

// Nuvole come in Sea of Thieves: volumi opachi (sfere fuse) con luce che li attraversa,
// bordi sfrangiati da rumore e bordo d'argento in controluce. Niente ray marching.
const cloudVert = /* glsl */ `
attribute float aH;
varying vec3 vN;
varying vec3 vW;
varying float vH;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vH = aH;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const cloudFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uAmbSky;
uniform float uDark;
varying vec3 vN;
varying vec3 vW;
varying float vH;
${SKY}
float cHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cHash(i), cHash(i + vec3(1,0,0)), f.x), mix(cHash(i + vec3(0,1,0)), cHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(cHash(i + vec3(0,0,1)), cHash(i + vec3(1,0,1)), f.x), mix(cHash(i + vec3(0,1,1)), cHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  // normali disturbate dal rumore: la luce non disegna più le singole sfere
  vec3 q = vW * 0.028;
  vec3 n = normalize(normalize(vN) + (vec3(cNoise(q), cNoise(q + 7.1), cNoise(q + 13.7)) - 0.5) * 1.1);
  vec3 v = normalize(cameraPosition - vW);
  vec3 dir = -v;
  float ndvG = max(dot(normalize(vN), v), 0.0);
  // luce avvolgente (la nuvola non ha un lato in ombra netta) e base più scura
  float wrapL = clamp((dot(n, uSunDir) + 0.6) / 1.6, 0.0, 1.0);
  vec3 shade = mix(uAmbSky * 0.5, uHorizon * 0.75, 0.5) * (1.0 - uDark * 0.5);
  vec3 lit = uSunCol * 1.1 + uAmbSky * 0.35;
  vec3 col = mix(shade, lit, clamp(wrapL * 0.75 + vH * 0.35, 0.0, 1.0) * (1.0 - uDark * 0.55));
  col *= 1.0 - uDark * 0.25;
  // bordo d'argento: controluce sui contorni
  float ndv = max(dot(n, v), 0.0);
  float back = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  col += uSunCol * back * pow(1.0 - ndv, 2.0) * 1.8;
  // contorni sfrangiati
  float fluff = cNoise(vW * 0.018) * 0.6 + cNoise(vW * 0.06) * 0.4;
  float a = smoothstep(0.25, 0.95, ndvG + (fluff - 0.5) * 1.0);
  col = mix(col, skyColor(dir), (1.0 - smoothstep(0.0, 0.16, dir.y)) * 0.7);
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

// Pioggia: segmenti in un volume attorno alla camera, inclinati dal vento
const rainVert = /* glsl */ `
uniform float uTime;
uniform vec3 uBox;
uniform vec2 uSlant;
attribute float aEnd;
varying float vFade;
void main() {
  vec3 p = position;
  float fall = 9.0;
  p.y = mod(p.y - uTime * fall, uBox.y);
  p.xz += uSlant * p.y * 0.25;
  p.xz = mod(p.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5;
  // la scia della goccia: il secondo estremo sta più in alto, nel verso della caduta
  p.y += aEnd * 0.55;
  p.xz -= uSlant * aEnd * 0.14;
  vec3 w = cameraPosition + vec3(p.x, p.y - uBox.y * 0.35, p.z);
  vFade = 1.0 - smoothstep(10.0, uBox.x * 0.5, length(p.xz));
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

const rainFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uHorizon;
varying float vFade;
void main() {
  gl_FragColor = vec4(mix(vec3(0.8, 0.84, 0.88), uHorizon, 0.3), 0.32 * vFade * uOpacity);
}
`;

// ---------- Utilità ----------

// rumore 1D liscio con fasi casuali, per profili di coste e creste
function noise1D(rng, octaves = 4) {
  const comps = [];
  for (let i = 0; i < octaves; i++) comps.push([2 ** i * rng.range(0.8, 1.2), rng.range(0, Math.PI * 2), 0.55 ** i]);
  const norm = comps.reduce((s, c) => s + c[2], 0);
  return (x) => comps.reduce((s, [f, ph, a]) => s + Math.sin(x * f + ph) * a, 0) / norm;
}

// Poisson disk per lancio di freccette: abbastanza per qualche decina di oggetti
function poisson(rng, count, sampleFn, minDist, tries = 40) {
  const out = [];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < tries; k++) {
      const p = sampleFn();
      const r = minDist(p);
      if (out.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > r + minDist(q))) {
        out.push(p);
        break;
      }
    }
  }
  return out;
}

function flatGeometry(positions, colors) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

const lin = (hex) => new THREE.Color(hex);

// ---------- Isole ----------

// Scoglio: griglia radiale, cupola arrotondata dal ghiacciaio, eventuale pineta in cima
function makeIsland(rng, size, forest) {
  const R = 6;
  const S = 22;
  const rx = size * rng.range(0.8, 1.6);
  const rz = size * rng.range(0.5, 0.9);
  const H = Math.min(size * rng.range(0.09, 0.2), 32);
  const outline = noise1D(rng, 3);
  const bumps = noise1D(rng, 4);
  const rock = [lin(0x8b7d74), lin(0x9a8a7e), lin(0x7b6f68)];
  const pine = [lin(0x24331f), lin(0x2c3d25), lin(0x1e2a1b)];
  const shore = lin(0x5a5048);

  const ring = [];
  for (let i = 0; i <= R; i++) {
    const r = i / R;
    const row = [];
    for (let j = 0; j < S; j++) {
      const a = (j / S) * Math.PI * 2;
      const k = 1 + outline(a * 1.0) * 0.35;
      let h = H * Math.pow(Math.max(0, 1 - r * r), 0.55) * (1 + bumps(a * 2 + r * 3) * 0.25);
      let c = rock[(i + j) % 3];
      if (forest && r < 0.8) {
        h += H * rng.range(0.35, 0.9) * (1 - r * 0.6);
        c = pine[Math.floor(rng() * 3)];
      }
      if (i === R) {
        h = -3;
        c = shore;
      }
      row.push([Math.cos(a) * rx * r * k, h, Math.sin(a) * rz * r * k, c]);
    }
    ring.push(row);
  }
  const pos = [];
  const colr = [];
  const tri = (a, b, c) => {
    // il colore della faccia è quello del vertice più alto: le cime restano verdi
    const top = [a, b, c].reduce((m, v) => (v[1] > m[1] ? v : m));
    for (const v of [a, b, c]) {
      pos.push(v[0], v[1], v[2]);
      colr.push(top[3].r, top[3].g, top[3].b);
    }
  };
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < S; j++) {
      const j2 = (j + 1) % S;
      const a = ring[i][j], b = ring[i][j2], c = ring[i + 1][j], d = ring[i + 1][j2];
      if (i > 0) tri(a, c, b);
      tri(b, c, d);
    }
  }
  return flatGeometry(pos, colr);
}

// Promontorio: una cresta lunga e alta, con il versante che scende in acqua
function makeHeadland(rng, length, height) {
  const N = 48;
  const D = 6;
  const ridge = noise1D(rng, 5);
  const depth = rng.range(250, 420);
  const scrub = [lin(0x5e6a43), lin(0x6f7550), lin(0x7d7258)];
  const tint = noise1D(rng, 3);
  const grid = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = (u - 0.5) * length;
    const env = Math.sin(Math.PI * u) ** 0.6; // le estremità scendono al mare
    const peak = height * env * (0.6 + 0.4 * ridge(u * 9));
    const row = [];
    for (let k = 0; k <= D; k++) {
      const v = k / D; // 0 = riva, 1 = cresta
      const y = k === 0 ? -4 : peak * Math.pow(v, 0.8);
      row.push([x, y, -(1 - v) * depth]); // riva verso la barca, cresta dietro
    }
    grid.push(row);
  }
  const pos = [];
  const colr = [];
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < D; k++) {
      const a = grid[i][k], b = grid[i + 1][k], c = grid[i][k + 1], d = grid[i + 1][k + 1];
      for (const t of [[a, b, c], [b, d, c]]) {
        // macchia mediterranea a chiazze ampie, non a scacchi
        const n = tint(i * 0.35 + k * 0.9) * 0.5 + 0.5;
        const cc = scrub[0].clone().lerp(n < 0.5 ? scrub[1] : scrub[2], Math.abs(n - 0.5) * 2);
        for (const v of t) {
          pos.push(...v);
          colr.push(cc.r, cc.g, cc.b);
        }
      }
    }
  }
  return flatGeometry(pos, colr);
}

// ---------- Vele lontane ----------

function makeSailboat(rng) {
  const L = rng.range(11, 17);
  const B = L * 0.28;
  const hullCol = lin(rng.pick([0xf2f2ee, 0x1c2a44, 0xe9e4da, 0x8a1c1c]));
  const sailCol = lin(rng.pick([0xf4f1ea, 0xe8e6e0, 0xd9d4c8]));
  const mast = L * rng.range(1.25, 1.45);
  const pos = [];
  const colr = [];
  const push = (pts, c) => {
    for (const p of pts) {
      pos.push(...p);
      colr.push(c.r, c.g, c.b);
    }
  };
  // scafo: prisma a cuneo
  const bow = [L / 2, 1, 0], sternL = [-L / 2, 1, -B / 2], sternR = [-L / 2, 1, B / 2], keel = [-L * 0.1, -0.6, 0];
  push([bow, sternR, sternL], hullCol);
  push([bow, sternL, keel], hullCol);
  push([bow, keel, sternR], hullCol);
  push([sternL, sternR, keel], hullCol);
  // randa e fiocco, doppia faccia
  const mx = L * 0.1;
  const main = [[mx, 1.4, 0], [mx, mast, 0], [-L * 0.38, 1.6, 0]];
  const jib = [[mx + 0.3, mast * 0.88, 0], [L / 2 - 0.3, 1.3, 0], [mx + 0.3, 1.5, 0]];
  push(main, sailCol);
  push([main[0], main[2], main[1]], sailCol);
  push(jib, sailCol);
  push([jib[0], jib[2], jib[1]], sailCol);
  return flatGeometry(pos, colr);
}

// ---------- Gabbiani ----------

function makeGull(mat) {
  const g = new THREE.Group();
  const white = lin(0xf2f2f0);
  const grey = lin(0x9aa3ab);
  const wing = (side) => {
    const s = side;
    const pos = [0.12, 0, 0, -0.12, 0, 0, -0.02, 0.02, 0.45 * s, -0.02, 0.02, 0.45 * s, -0.12, 0, 0, -0.2, 0.05, 0.85 * s];
    const c = [white, white, white, grey, grey, grey].flatMap((x) => [x.r, x.g, x.b]);
    const m = new THREE.Mesh(flatGeometry(pos, c), mat);
    return m;
  };
  const body = new THREE.Mesh(
    flatGeometry(
      [0.32, 0, 0, -0.3, 0.02, 0.05, -0.3, 0.02, -0.05, 0.32, 0, 0, -0.3, 0.02, -0.05, -0.28, -0.06, 0, 0.32, 0, 0, -0.28, -0.06, 0, -0.3, 0.02, 0.05],
      new Array(27).fill(0).map((_, i) => [white.r, white.g, white.b][i % 3])
    ),
    mat
  );
  const l = wing(1);
  const r = wing(-1);
  g.add(body, l, r);
  g.userData.wings = [l, r];
  g.scale.setScalar(1.1);
  return g;
}

// ---------- Nuvole ----------

// Cumulo: sfere fuse lungo una campana, base piatta. aH = quota relativa (0 base, 1 cima)
function makeCloud(rng, w) {
  const parts = [];
  const n = 8 + Math.floor(rng() * 8);
  const base = 0;
  let top = 0;
  for (let i = 0; i < n; i++) {
    const u = rng.range(-0.5, 0.5);
    const bell = Math.cos(u * Math.PI);
    const r = w * rng.range(0.07, 0.15) * (0.55 + bell * 0.7);
    const g = new THREE.SphereGeometry(r, 14, 9);
    g.translate(u * w, r * rng.range(0.25, 0.7) + bell * w * 0.06, rng.range(-0.15, 0.15) * w);
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) < base) p.setY(i, base);
    top = Math.max(top, p.getY(i));
  }
  const h = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) h[i] = p.getY(i) / top;
  geo.setAttribute("aH", new THREE.BufferAttribute(h, 1));
  geo.computeVertexNormals();
  return geo;
}

// ---------- Paesaggio ----------

export function createLandscape(shared) {
  const group = new THREE.Group();
  const cloudGroup = new THREE.Group(); // segue la camera, come la cupola del cielo
  const rainGroup = new THREE.Group(); // segue la camera senza ruotare
  let rain = null;
  const amb = { uAmbSky: { value: new THREE.Color() }, uAmbGround: { value: new THREE.Color() } };
  const sceneryMat = new THREE.ShaderMaterial({
    vertexShader: sceneryVert,
    fragmentShader: sceneryFrag,
    uniforms: { ...shared, ...amb },
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
  });

  let movers = [];
  let gulls = [];
  let clouds = [];
  let wrap = 2000;
  let flow = 4.6;

  function clear() {
    for (const o of [...group.children, ...cloudGroup.children]) {
      o.traverse((m) => {
        if (m.geometry) m.geometry.dispose();
        if (m.material && m.material !== sceneryMat) m.material.dispose();
      });
    }
    group.clear();
    cloudGroup.clear();
    if (rain) {
      rain.geometry.dispose();
      rain.material.dispose();
      rainGroup.clear();
      rain = null;
    }
    movers = [];
    gulls = [];
    clouds = [];
  }

  function build(c) {
    clear();
    const rng = c.rng;
    flow = c.flow;
    amb.uAmbSky.value.copy(c.ambSky).multiplyScalar(c.ambI);
    amb.uAmbGround.value.copy(c.ambGround).multiplyScalar(c.ambI);
    // oltre questa distanza la foschia è piena: lì gli oggetti possono ricomparire senza salti
    wrap = c.fog[1] + 250;

    const addMover = (mesh, x, z, speed, bob = 0) => {
      mesh.position.set(x, 0, z);
      group.add(mesh);
      movers.push({ mesh, x0: x, speed, bob, phase: rng() * 10 });
    };

    // Isole e costa: solo in fasce laterali, così nessuna passa sopra la barca scorrendo
    if (c.coast === "arcipelago") {
      const isl = poisson(
        rng,
        rng.int(14, 24),
        () => {
          const size = rng() < 0.2 ? rng.range(120, 260) : rng.range(25, 110);
          return { x: rng.range(-wrap, wrap), z: (rng() < 0.5 ? -1 : 1) * rng.range(380, Math.min(1100, c.fog[1] * 0.85)), size };
        },
        (p) => p.size * 0.9
      );
      for (const p of isl) {
        const m = new THREE.Mesh(makeIsland(rng, p.size, rng() < 0.6), sceneryMat);
        m.rotation.y = rng.range(-0.5, 0.5);
        addMover(m, p.x, p.z, 1);
      }
    } else if (c.coast === "costa") {
      const side = rng() < 0.5 ? -1 : 1;
      const parts = rng.int(2, 4);
      for (let i = 0; i < parts; i++) {
        const len = rng.range(600, 1100);
        const m = new THREE.Mesh(makeHeadland(rng, len, rng.range(90, 240)), sceneryMat);
        // la cresta guarda il mare: il versante scende verso la barca
        if (side < 0) m.rotation.y = Math.PI;
        addMover(m, -wrap + ((i + rng.range(0.1, 0.6)) / parts) * wrap * 2, side * rng.range(1150, 1500), 1);
      }
      // qualche scoglio davanti alla costa
      for (let i = 0; i < rng.int(2, 6); i++) {
        const size = rng.range(20, 60);
        const m = new THREE.Mesh(makeIsland(rng, size, false), sceneryMat);
        addMover(m, rng.range(-wrap, wrap), side * rng.range(450, 850), 1);
      }
    }

    // Vele lontane: alcune con la nostra rotta, più lente; altre di bolina sul bordo opposto
    const boats = poisson(
      rng,
      rng.int(c.coast === "aperto" ? 1 : 2, c.coast === "aperto" ? 3 : 6),
      () => ({ x: rng.range(-wrap * 0.7, wrap * 0.7), z: (rng() < 0.5 ? -1 : 1) * rng.range(160, 800) }),
      () => 90
    );
    for (const p of boats) {
      const m = new THREE.Mesh(makeSailboat(rng), sceneryMat);
      const opposite = rng() < 0.35;
      m.rotation.order = "YXZ";
      m.rotation.y = opposite ? Math.PI + rng.range(-0.4, 0.4) : rng.range(-0.4, 0.4);
      m.rotation.x = (opposite ? -1 : 1) * THREE.MathUtils.degToRad(c.heel * rng.range(0.6, 1));
      addMover(m, p.x, p.z, opposite ? rng.range(1.6, 1.9) : rng.range(0.25, 0.6), 0.25);
    }

    // Gabbiani: girano attorno all'albero, ogni tanto planano
    for (let i = 0; i < rng.int(3, 8); i++) {
      const g = makeGull(sceneryMat);
      group.add(g);
      gulls.push({
        g,
        cx: rng.range(-8, 8),
        cz: rng.range(-6, 6),
        r: rng.range(9, 22),
        y: rng.range(16, 32),
        w: rng.range(0.12, 0.3) * (rng() < 0.5 ? -1 : 1),
        a: rng() * Math.PI * 2,
        flap: rng.range(5, 7),
        phase: rng() * 10,
      });
    }

    // Nuvole: volumi su un anello lontano
    const count = Math.round(c.clouds * (c.rain ? 16 : 46));
    const pts = poisson(
      rng,
      count,
      () => ({ x: rng() * Math.PI * 2, z: 0, el: 0.035 + rng.range(0, 0.22) ** 1.2 }),
      () => 0.05
    );
    const dark = c.preset === "foschia" || c.rain ? 1 : 0;
    const cloudMat = new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      uniforms: { ...shared, uAmbSky: amb.uAmbSky, uDark: { value: dark } },
      transparent: true,
      depthWrite: false,
    });
    for (const p of pts) {
      const w = rng.range(200, 560);
      const m = new THREE.Mesh(makeCloud(rng, w), cloudMat);
      const d = 2000;
      m.position.set(Math.cos(p.x) * d * Math.cos(p.el), Math.sin(p.el) * d, Math.sin(p.x) * d * Math.cos(p.el));
      m.lookAt(0, m.position.y, 0);
      m.renderOrder = -0.5;
      m.frustumCulled = false;
      cloudGroup.add(m);
      clouds.push(m);
    }

    // Pioggia
    if (c.rain) {
      const N = 14000;
      const box = new THREE.Vector3(140, 50, 140);
      const pos = new Float32Array(N * 6);
      const end = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) {
        const x = rng.range(-box.x / 2, box.x / 2);
        const y = rng.range(0, box.y);
        const z = rng.range(-box.z / 2, box.z / 2);
        pos.set([x, y, z, x, y, z], i * 6);
        end[i * 2 + 1] = 1;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aEnd", new THREE.BufferAttribute(end, 1));
      const slant = new THREE.Vector2(-1, 0.35).multiplyScalar(c.knots / 20);
      rain = new THREE.LineSegments(
        g,
        new THREE.ShaderMaterial({
          vertexShader: rainVert,
          fragmentShader: rainFrag,
          uniforms: { uTime: shared.uTime, uOpacity: shared.uOpacity, uHorizon: shared.uHorizon, uBox: { value: box }, uSlant: { value: slant } },
          transparent: true,
          depthWrite: false,
        })
      );
      rain.frustumCulled = false;
      rainGroup.add(rain);
    }
  }

  return {
    group,
    clouds: cloudGroup,
    rain: rainGroup,
    build,
    update(t, opacity, cam) {
      const vis = opacity > 0.005;
      group.visible = cloudGroup.visible = rainGroup.visible = vis;
      if (!vis) return;
      sceneryMat.uniforms.uOpacity.value = opacity;
      const span = wrap * 2;
      for (const m of movers) {
        let x = m.x0 - flow * m.speed * t;
        x = ((((x + wrap) % span) + span) % span) - wrap;
        m.mesh.position.x = x;
        m.mesh.position.y = m.bob * Math.sin(t * 0.9 + m.phase);
      }
      for (const q of gulls) {
        const a = q.a + q.w * t;
        q.g.position.set(q.cx + Math.cos(a) * q.r, q.y + Math.sin(t * 0.4 + q.phase) * 2, q.cz + Math.sin(a) * q.r);
        // muso nella direzione di volo, inclinato in virata
        q.g.rotation.set(0, -a - Math.sign(q.w) * Math.PI / 2, 0);
        q.g.rotateX(-Math.sign(q.w) * 0.35);
        // battiti d'ala alternati a planate
        const glide = Math.sin(t * 0.5 + q.phase) > 0.3 ? 0.15 : 1;
        const f = Math.sin(t * q.flap + q.phase) * 0.55 * glide + 0.1;
        q.g.userData.wings[0].rotation.x = -f;
        q.g.userData.wings[1].rotation.x = f;
      }
      cloudGroup.position.copy(cam.position);
      cloudGroup.rotation.y = t * 0.0015;
    },
  };
}
