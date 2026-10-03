import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import Lenis from "lenis";
import { KEYS, HOTSPOTS, CHAPTERS } from "./story.js";
import { createOcean } from "./ocean.js";
import { createLandscape } from "./landscape.js";
import { makeConditions, seedFromUrl } from "./conditions.js";
import { createPost } from "./post.js";
import { createMaterials } from "./materials.js";
import { createSeaFx, BOAT_LAYER } from "./seafx.js";
import { createRigging } from "./rigging.js";
import { drawMap, drawPolar } from "./charts.js";

// ---------- Renderer, camera, luci ----------
// Antialias, tone mapping e uscita sRGB sono nel post-processing (post.js)
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" });
renderer.toneMapping = THREE.NoToneMapping;
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();
// near a 0,5 m: con 0,1 il rivestimento interno, a pochi cm dallo scafo, sfarfallava (z-fighting)
const camera = new THREE.PerspectiveCamera(22, 1, 0.5, 5000);
const post = createPost(renderer, scene, camera);

// ---------- Sfondo ----------
// Gradiente e reticolo della tavola disegnati in WebGL e non in CSS, così sfocatura,
// vignettatura e grana lavorano anche sullo sfondo. Colori in sRGB, come nel CSS di prima.
const backdrop = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Vector3() },
      uBot: { value: new THREE.Vector3() },
      uGrid: { value: 1 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: 1 },
      uExposure: { value: 1 },
    },
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.99999, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uBot; uniform float uGrid; uniform vec2 uRes; uniform float uDpr; uniform float uExposure;
      varying vec2 vUv;
      float grid(vec2 px, float step) {
        vec2 f = abs(fract(px / step + 0.5) - 0.5) * step;
        return 1.0 - smoothstep(0.35, 0.85, min(f.x, f.y));
      }
      void main() {
        vec3 c = mix(uBot, uTop, vUv.y) / 255.0;
        vec2 px = gl_FragCoord.xy / uDpr - uRes * 0.5;
        float g = grid(px, 120.0) * 0.16 + grid(px, 24.0) * 0.06;
        c = mix(c, vec3(190.0, 220.0, 255.0) / 255.0, g * uGrid);
        gl_FragColor = vec4(pow(c, vec3(2.2)) / uExposure, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  })
);
backdrop.frustumCulled = false;
backdrop.renderOrder = -100;
scene.add(backdrop);

// ---------- Luci ----------
// Due ambienti: lo studio (luce morbida da softbox, ombra a terra, controluce freddo) e il mare
// (sole basso e caldo, cielo come mappa d'ambiente). Si passa dall'uno all'altro con s.ocean.
const pmrem = new THREE.PMREMGenerator(renderer);
const studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = studioEnv;

const SUN_STUDIO = new THREE.Vector3(-30, 52, 38);
const SUN_SEA = new THREE.Vector3();
const sun = new THREE.DirectionalLight(0xfff4e2, 2.4);
sun.position.copy(SUN_STUDIO);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.radius = 9;
sun.shadow.blurSamples = 16;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 160 });
scene.add(sun, sun.target);
sun.layers.enable(BOAT_LAYER); // le luci servono anche al riflesso della barca nel mare

// controluce freddo che disegna il profilo di scafo e vele sullo sfondo chiaro
const rim = new THREE.DirectionalLight(0xcfe0ff, 1.1);
rim.position.set(25, 18, -45);
scene.add(rim);
rim.layers.enable(BOAT_LAYER);

const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x6b5a48, 0.45);
scene.add(hemi);
hemi.layers.enable(BOAT_LAYER);

const STUDIO = { sun: new THREE.Color(0xfff4e2), hemiSky: new THREE.Color(0xdfe9f5), hemiGround: new THREE.Color(0x6b5a48) };
const SEA = { sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), intensity: 3.4, hemiI: 0.7 };

// pavimento dello studio che raccoglie solo l'ombra
const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.ShadowMaterial({ opacity: 0.22 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -3.26;
floor.receiveShadow = true;
scene.add(floor);

// ---------- Piani di taglio ----------
// solid: lo scafo compare da prua (x >= sweep); line: la tavola resta a poppa (x <= sweep)
// draw: ingresso della tavola al caricamento; cut: sezione orizzontale per gli interni
const planeSolid = new THREE.Plane(new THREE.Vector3(1, 0, 0), -12);
const planeLine = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 12);
const planeDraw = new THREE.Plane(new THREE.Vector3(1, 0, 0), -12);
const planeCut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
const SOLID_PLANES = [planeSolid, planeCut];
const LINE_PLANES = [planeLine, planeDraw, planeCut];

const lineMat = new THREE.LineBasicMaterial({
  color: 0xd4e6ff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
  clippingPlanes: LINE_PLANES,
});
const lineMatInterior = lineMat.clone();
lineMatInterior.color.set(0x8fb6e6);
lineMatInterior.clippingPlanes = LINE_PLANES;

// ---------- Barca ----------
const boat = new THREE.Group();
scene.add(boat);
const sails = [];
const headliner = []; // il cielino sotto il pozzetto coprirebbe la pianta nella vista sezionata
let rigging = null; // cime, bandiera (rigging.js), creati quando il modello è caricato
const interiorMeshes = []; // nascosti quando lo scafo è chiuso: dentro non si vedono e costano

const ocean = createOcean();
scene.add(ocean.mesh, ocean.sky);
const seaFx = createSeaFx(renderer, scene, camera);
ocean.linkSeaFx(seaFx.uniforms);
// per controllare accumulo, qualità e buffer del mare dalla console
if (import.meta.env.DEV) Object.assign(window, { __post: post, __seaFx: seaFx, __renderer: renderer, __scene: scene });
const mats = createMaterials(ocean.shared, ocean.waves);
const landscape = createLandscape(ocean.shared);
scene.add(landscape.group, landscape.clouds, landscape.rain);

// ---------- Condizioni del mare ----------
// Ora del giorno, vento e costa dal seme: ?seed=N rivede la stessa scena
let cond = null;
let seaEnv = null;
const condEl = document.getElementById("cond");
function applyConditions(seed) {
  cond = makeConditions(seed);
  ocean.setConditions(cond);
  landscape.build(cond);
  if (seaEnv) seaEnv.dispose();
  seaEnv = ocean.envMap(pmrem);
  SUN_SEA.copy(cond.sunDir).multiplyScalar(70);
  SEA.sun.copy(cond.light);
  SEA.intensity = cond.intensity;
  SEA.hemiSky.copy(cond.ambSky);
  SEA.hemiGround.copy(cond.ambGround);
  SEA.hemiI = cond.ambI;
  condEl.querySelector("span").textContent = `${cond.label}, ${cond.knots} nodi (forza ${cond.force}), ${cond.coastLabel} / seme ${seed}`;
  const url = new URL(location.href);
  url.searchParams.set("seed", seed);
  history.replaceState(null, "", url);
}
applyConditions(seedFromUrl());
condEl.querySelector("button").addEventListener("click", () => applyConditions(1 + Math.floor(Math.random() * 99999)));

const loaderEl = document.getElementById("loader");
const bar = loaderEl.querySelector(".loader-bar i");
const pct = loaderEl.querySelector(".loader-pct");

new GLTFLoader().load(
  "/models/swan651.glb",
  (gltf) => {
    const root = gltf.scene;
    // ogni materiale si rifinisce una volta sola (materials.js), poi si condivide fra le mesh
    const done = new Map();
    const fix = (orig) => {
      if (done.has(orig)) return done.get(orig);
      const m = mats.upgrade(orig);
      done.set(orig, m);
      m.clippingPlanes = SOLID_PLANES;
      m.clipShadows = true;
      // Nel taglio si vede l'interno dei gusci: servono entrambe le facce
      m.side = THREE.DoubleSide;
      // Antivegetativa di chiglia e timone allineata al rosso della carena
      if (/Antifoul/.test(m.name)) m.color.set(0x5a1414);
      if (m.name === "Upholstery_Leather_Red") {
        m.color.set(0x6a1010);
        m.roughness = 0.62;
      }
      return m;
    };
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
      // gli interni non si vedono mai nel riflesso né nell'impronta sull'acqua
      if (o.name.startsWith("Interior")) interiorMeshes.push(o);
      else o.layers.enable(BOAT_LAYER);
      // con più materiali GLTFLoader crea un gruppo: le mesh figlie hanno il nome con un suffisso
      if (o.name.startsWith("Interior_Headliner")) headliner.push(o);
      o.castShadow = true;
      o.receiveShadow = !o.morphTargetInfluences;
      if (o.morphTargetInfluences) {
        sails.push(o);
        o.material.transparent = true;
      }

      const interior = o.name.startsWith("Interior");
      // Lo scafo mostra tutto il reticolo, come un piano di costruzione
      const angle = o.name === "Hull" ? 3 : interior ? 40 : o.name === "Rigging" || o.name === "Lifelines" ? 60 : 28;
      const edges = new THREE.EdgesGeometry(o.geometry, angle);
      const lines = new THREE.LineSegments(edges, interior ? lineMatInterior : lineMat);
      lines.renderOrder = 10;
      o.add(lines);
    });
    boat.add(root);
    rigging = createRigging({ boat, clipping: SOLID_PLANES, layer: BOAT_LAYER });
    for (const sl of sails) rigging.tagSail(sl);
    loaderEl.classList.add("done");
    introStart = performance.now();
    // ?step=N apre la pagina direttamente su un passo (utile per rivedere una scena)
    const go = new URLSearchParams(location.search).get("step");
    if (go) lenis.scrollTo(+go * innerHeight, { immediate: true });
  },
  (e) => {
    if (!e.total) return;
    const p = Math.round((e.loaded / e.total) * 100);
    bar.style.width = p + "%";
    pct.textContent = p + "%";
  },
  (err) => {
    pct.textContent = "Errore nel caricamento del modello";
    console.error(err);
  }
);

// ---------- Fotogrammi chiave ----------
// Ogni passo eredita i valori del precedente e sovrascrive solo ciò che cambia
// Il punto a fuoco no: vale solo per il suo passo, altrimenti si mette a fuoco il bersaglio
const FRAMES = [];
KEYS.forEach((k, i) => {
  const f = { ...(FRAMES[i - 1] || {}), ...k };
  f.focus = k.focus || f.tgt;
  FRAMES.push(f);
});
const N = FRAMES.length;

const BG = {
  blueprint: [[14, 40, 70], [8, 24, 42]],
  studio: [[236, 233, 226], [205, 200, 190]],
  sky: [[104, 150, 196], [222, 231, 234]],
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Interpolazione sferica attorno al punto guardato: la camera gira attorno alla barca
const sph = new THREE.Spherical();
const sphB = new THREE.Spherical();
const v = new THREE.Vector3();
function toSph(cam, tgt, out) {
  v.set(cam[0] - tgt[0], cam[1] - tgt[1], cam[2] - tgt[2]);
  return out.setFromVector3(v);
}

function sample(p) {
  const i = Math.min(N - 1, Math.max(0, Math.floor(p)));
  const j = Math.min(N - 1, i + 1);
  const t = smooth(0.08, 0.92, p - i);
  const A = FRAMES[i];
  const B = FRAMES[j];
  const s = {};
  for (const key of ["fov", "shift", "lines", "solid", "cut", "luff", "ocean", "heel", "motion", "theme", "sails", "bokeh", "range", "tilt"]) {
    s[key] = lerp(A[key], B[key], t);
  }
  s.tgt = lerp3(A.tgt, B.tgt, t);
  s.focus = lerp3(A.focus, B.focus, t);
  s.gradeA = A.grade;
  s.gradeB = B.grade;
  s.gradeT = t;
  toSph(A.cam, A.tgt, sph);
  toSph(B.cam, B.tgt, sphB);
  let dTheta = sphB.theta - sph.theta;
  if (dTheta > Math.PI) dTheta -= Math.PI * 2;
  if (dTheta < -Math.PI) dTheta += Math.PI * 2;
  s.radius = lerp(sph.radius, sphB.radius, t);
  s.phi = lerp(sph.phi, sphB.phi, t);
  s.theta = sph.theta + dTheta * t;
  // Sfondo: mescolanza fra i tre ambienti
  const bgA = BG[A.bg];
  const bgB = BG[B.bg];
  s.bgTop = lerp3(bgA[0], bgB[0], t);
  s.bgBot = lerp3(bgA[1], bgB[1], t);
  s.grid = lerp(A.bg === "blueprint" ? 1 : 0, B.bg === "blueprint" ? 1 : 0, t);
  return s;
}

// ---------- Punti caldi ----------
const hsLayer = document.getElementById("hotspots");
const hsEls = HOTSPOTS.map((h) => {
  const el = document.createElement("div");
  el.className = "hs off";
  el.innerHTML = `<span class="dot"></span><span class="lab">${h.title}</span><span class="txt">${h.text}</span>`;
  hsLayer.appendChild(el);
  return { ...h, el, pos: new THREE.Vector3(...h.at) };
});

const proj = new THREE.Vector3();
function updateHotspots(p, w, h) {
  for (const hs of hsEls) {
    let o = 0;
    for (const st of hs.steps) o = Math.max(o, 1 - smooth(0.12, 0.34, Math.abs(p - st)));
    if (o < 0.01) {
      hs.el.classList.add("off");
      hs.el.style.opacity = 0;
      continue;
    }
    proj.copy(hs.pos).applyMatrix4(boat.matrixWorld).project(camera);
    if (proj.z > 1) o = 0;
    const x = (proj.x * 0.5 + 0.5) * w;
    const y = (-proj.y * 0.5 + 0.5) * h;
    hs.el.classList.toggle("off", o < 0.5);
    hs.el.style.opacity = o.toFixed(3);
    hs.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}

// ---------- DOM: passi, capitoli ----------
const steps = [...document.querySelectorAll(".step")];
const navLinks = [...document.querySelectorAll("#chapters a")];
const progressEl = document.querySelector("#chapters .progress i");
const readout = {
  x: document.querySelector('[data-r="x"]'),
  fov: document.querySelector('[data-r="fov"]'),
  step: document.querySelector('[data-r="step"]'),
};

history.scrollRestoration = "manual";
const lenis = new Lenis({ lerp: 0.085, wheelMultiplier: 0.9 });
document.querySelectorAll("[data-go]").forEach((a) =>
  a.addEventListener("click", () => lenis.scrollTo(+a.dataset.go * innerHeight, { duration: 2.2 }))
);

drawMap(document.getElementById("map"));
drawPolar(document.getElementById("polar"));

// ---------- Mouse ----------
const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener("pointermove", (e) => {
  mouse.x = (e.clientX / innerWidth) * 2 - 1;
  mouse.y = (e.clientY / innerHeight) * 2 - 1;
});

// ---------- Resize ----------
let W = 0;
let H = 0;
function resize() {
  W = innerWidth;
  H = innerHeight;
  post.setSize(W, H);
  camera.aspect = W / H;
}
addEventListener("resize", resize);
resize();

// ---------- Ciclo ----------
let introStart = 0;
const clock = new THREE.Timer();
let lastStep = -1;
let lastP = -1;
let lastTime = 0;
let stillFrames = 0;
const focusW = new THREE.Vector3();

function frame(time) {
  lenis.raf(time);
  clock.update(time);
  const t = clock.getElapsed();
  const dt = clock.getDelta();
  const p = Math.min(N - 1, Math.max(0, window.scrollY / H));
  const s = sample(p);

  // Ingresso della tavola: le linee si disegnano da prua a poppa
  const intro = introStart ? smooth(0, 1, (performance.now() - introStart) / 2600) : 0;
  planeDraw.constant = -lerp(12, -12, intro);

  // Tavola e scafo
  const sweepX = lerp(12, -12, s.solid);
  planeSolid.constant = -sweepX;
  planeLine.constant = sweepX;
  planeCut.constant = s.cut;
  for (const h of headliner) h.visible = s.cut > 1.5;
  const showInterior = s.cut < 50 || s.lines > 0.01;
  for (const o of interiorMeshes) if (!o.name.startsWith("Interior_Headliner")) o.visible = showInterior;
  if (!showInterior) for (const h of headliner) h.visible = false;
  lineMat.opacity = 0.85 * s.lines;
  lineMatInterior.opacity = 0.32 * s.lines;
  lineMat.visible = lineMatInterior.visible = s.lines > 0.01;

  // Vele: sgonfie e che sbattono quando luff > 0
  const flutter = s.luff * (0.78 + 0.22 * Math.sin(t * 7.0) * Math.sin(t * 2.3));
  for (const m of sails) {
    m.morphTargetInfluences[0] = flutter;
    m.material.opacity = s.sails;
    m.material.depthWrite = s.sails > 0.98;
    m.visible = s.sails > 0.01 || s.lines > 0.01;
  }

  // Barca in mare: sbandata, beccheggio, rollio
  // il vento delle condizioni scala sbandata e moto ondoso (i fotogrammi sono tarati su 16°)
  const m = s.motion * lerp(1, cond.motion, s.ocean);
  boat.rotation.x = THREE.MathUtils.degToRad(s.heel * lerp(1, cond.heel / 16, s.ocean) + m * 1.8 * Math.sin(t * 0.47));
  boat.rotation.z = THREE.MathUtils.degToRad(m * 1.4 * Math.sin(t * 0.61 + 1.2));
  boat.position.y = m * 0.14 * Math.sin(t * 0.83);
  boat.updateMatrixWorld();
  // vento sulle vele e sulla bandiera: brezza leggera nello studio, quello delle condizioni in mare
  const wind = lerp(0.18, Math.min(1, cond.knots / 20), s.ocean);
  mats.update(boat, s.ocean, wind * s.sails, cond.rain ? s.ocean : 0);
  if (rigging) rigging.update(t, wind);
  ocean.update(t, s.ocean, m, camera);
  landscape.update(t, s.ocean, camera);

  // Luci: dallo studio al mare
  const sea = s.ocean;
  sun.position.lerpVectors(SUN_STUDIO, SUN_SEA, sea);
  sun.color.lerpColors(STUDIO.sun, SEA.sun, sea);
  sun.intensity = lerp(2.4, SEA.intensity, sea);
  rim.intensity = lerp(1.1, 0.25, sea);
  hemi.color.lerpColors(STUDIO.hemiSky, SEA.hemiSky, sea);
  hemi.groundColor.lerpColors(STUDIO.hemiGround, SEA.hemiGround, sea);
  hemi.intensity = lerp(0.45, SEA.hemiI, sea);
  scene.environment = sea > 0.5 ? seaEnv : studioEnv;
  scene.environmentIntensity = sea > 0.5 ? lerp(0.6, 1.0, (sea - 0.5) * 2) : lerp(0.9, 0.6, sea * 2);
  floor.material.opacity = 0.22 * s.solid * (1 - sea) * (s.cut > 50 ? 1 : 0.3);
  floor.visible = floor.material.opacity > 0.005;

  // Camera ferma? Allora si accumulano i fotogrammi (vedi post.js). Il mare, le vele che
  // sbattono e l'ingresso della tavola si muovono sempre: lì niente accumulo.
  const dynamic = !introStart || intro < 1 || s.ocean > 0.001 || s.luff > 0.001 || s.motion > 0.001;
  const settled = Math.abs(p - lastP) < 1e-5 && Math.abs(mouse.x - mouse.sx) < 0.004 && Math.abs(mouse.y - mouse.sy) < 0.004;
  stillFrames = !dynamic && settled ? stillFrames + 1 : 0;
  lastP = p;
  const still = stillFrames > 12;

  // Camera
  if (still) {
    mouse.sx = mouse.x;
    mouse.sy = mouse.y;
  } else {
    mouse.sx += (mouse.x - mouse.sx) * 0.04;
    mouse.sy += (mouse.y - mouse.sy) * 0.04;
  }
  sph.set(s.radius, THREE.MathUtils.clamp(s.phi + mouse.sy * 0.04, 0.02, Math.PI - 0.02), s.theta - mouse.sx * 0.06);
  v.setFromSpherical(sph);
  camera.position.set(s.tgt[0] + v.x, s.tgt[1] + v.y, s.tgt[2] + v.z);
  camera.lookAt(s.tgt[0], s.tgt[1], s.tgt[2]);
  camera.fov = s.fov;
  if (still) post.jitter(-s.shift * W);
  else camera.setViewOffset(W, H, -s.shift * W, 0, W, H);
  camera.updateProjectionMatrix();

  // Sfondo e tema dei testi
  const bu = backdrop.material.uniforms;
  bu.uTop.value.set(...s.bgTop);
  bu.uBot.value.set(...s.bgBot);
  bu.uGrid.value = s.grid * 0.9;
  bu.uRes.value.set(W, H);
  bu.uDpr.value = renderer.getPixelRatio();
  bu.uExposure.value = post.exposure;
  document.body.classList.toggle("light", s.theme > 0.5);
  condEl.classList.toggle("on", s.ocean > 0.5);

  // Post-processing: fuoco sul punto del passo, esposizione delle condizioni in mare
  focusW.set(...s.focus).applyMatrix4(boat.matrixWorld);
  s.exposure = lerp(1, cond.exposure, s.ocean);
  post.apply(s, focusW);
  // dopo ~48 fotogrammi accumulati l'immagine è pulita: si smette di disegnare finché non cambia nulla
  if (!(still && post.accum.count >= 48)) {
    post.beginFrame();
    seaFx.render(dt, cond.flow, s.ocean);
    post.render(dt, still);
    post.endFrame();
  }
  if (!still && lastTime) post.measure(time - lastTime);
  lastTime = time;
  updateHotspots(p, W, H);

  // Testi e indice
  const cur = Math.round(p);
  if (cur !== lastStep) {
    lastStep = cur;
    steps.forEach((el, i) => el.classList.toggle("in", i === cur));
    const ch = CHAPTERS.findLastIndex((c) => cur >= c);
    navLinks.forEach((a, i) => a.classList.toggle("on", i === ch));
  }
  progressEl.style.height = ((p / (N - 1)) * 100).toFixed(2) + "%";
  readout.x.textContent = `X ${sweepX.toFixed(2)}`;
  readout.fov.textContent = `FOV ${s.fov.toFixed(0)}`;
  readout.step.textContent = `${String(cur).padStart(2, "0")} / ${N - 1}`;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
