import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import Lenis from "lenis";
import { KEYS, HOTSPOTS, CHAPTERS } from "./story.js";
import { createOcean } from "./ocean.js";
import { drawMap, drawPolar } from "./charts.js";

// ---------- Renderer, camera, luci ----------
const canvas = document.getElementById("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 5000);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.9;

const sun = new THREE.DirectionalLight(0xfff4e2, 2.2);
sun.position.set(-30, 50, 40);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x6b5a48, 0.5));

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

const ocean = createOcean();
scene.add(ocean.mesh);

const loaderEl = document.getElementById("loader");
const bar = loaderEl.querySelector(".loader-bar i");
const pct = loaderEl.querySelector(".loader-pct");

new GLTFLoader().load(
  "/models/swan651.glb",
  (gltf) => {
    const root = gltf.scene;
    const seen = new Set();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (seen.has(m)) continue;
        seen.add(m);
        m.clippingPlanes = SOLID_PLANES;
        // Nel taglio si vede l'interno dei gusci: servono entrambe le facce
        m.side = THREE.DoubleSide;
        // Antivegetativa di chiglia e timone allineata al rosso della carena
        if (/Antifoul/.test(m.name)) m.color.set(0x5a1414);
        if (m.name === "Upholstery_Leather_Red") m.color.set(0x6e1212);
      }
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
const FRAMES = [];
KEYS.forEach((k, i) => {
  FRAMES.push({ ...(FRAMES[i - 1] || {}), ...k });
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
  for (const key of ["fov", "shift", "lines", "solid", "cut", "luff", "ocean", "heel", "motion", "theme", "sails"]) {
    s[key] = lerp(A[key], B[key], t);
  }
  s.tgt = lerp3(A.tgt, B.tgt, t);
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

// ---------- DOM: passi, capitoli, sfondo ----------
const bgEl = document.getElementById("bg");
const gridEl = document.getElementById("grid");
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

const rgb = (c) => `rgb(${c.map((x) => Math.round(x)).join(",")})`;

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
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
}
addEventListener("resize", resize);
resize();

// ---------- Ciclo ----------
let introStart = 0;
const clock = new THREE.Timer();
let lastStep = -1;

function frame(time) {
  lenis.raf(time);
  clock.update(time);
  const t = clock.getElapsed();
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
  const m = s.motion;
  boat.rotation.x = THREE.MathUtils.degToRad(s.heel + m * 1.8 * Math.sin(t * 0.47));
  boat.rotation.z = THREE.MathUtils.degToRad(m * 1.4 * Math.sin(t * 0.61 + 1.2));
  boat.position.y = m * 0.14 * Math.sin(t * 0.83);
  ocean.update(t, s.ocean, camera);

  // Camera
  mouse.sx += (mouse.x - mouse.sx) * 0.04;
  mouse.sy += (mouse.y - mouse.sy) * 0.04;
  sph.set(s.radius, THREE.MathUtils.clamp(s.phi + mouse.sy * 0.04, 0.02, Math.PI - 0.02), s.theta - mouse.sx * 0.06);
  v.setFromSpherical(sph);
  camera.position.set(s.tgt[0] + v.x, s.tgt[1] + v.y, s.tgt[2] + v.z);
  camera.lookAt(s.tgt[0], s.tgt[1], s.tgt[2]);
  camera.fov = s.fov;
  camera.setViewOffset(W, H, -s.shift * W, 0, W, H);
  camera.updateProjectionMatrix();

  // Sfondo e tema dei testi
  bgEl.style.background = `linear-gradient(180deg, ${rgb(s.bgTop)} 0%, ${rgb(s.bgBot)} 100%)`;
  gridEl.style.opacity = (s.grid * 0.9).toFixed(3);
  document.body.classList.toggle("light", s.theme > 0.5);
  ocean.setHorizon(s.bgBot);

  renderer.render(scene, camera);
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
