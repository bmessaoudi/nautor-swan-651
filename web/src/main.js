import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import Lenis from "lenis";
import { KEYS, HOTSPOTS, CHAPTERS } from "./story.js";
import { createOcean } from "./ocean.js";
import { createSky, SKY_PHYS } from "./sky.js";
import { createLandscape } from "./landscape.js";
import { createTerrain } from "./terrain.js";
import { createFauna } from "./fauna.js";
import { makeConditions, seedFromUrl } from "./conditions.js";
import { createPost } from "./post.js";
import { createAdaptiveTone } from "./contrast.js";
import { createMaterials } from "./materials.js";
import { createSeaFx, BOAT_LAYER } from "./seafx.js";
import { createRigging } from "./rigging.js";
import { createSailing } from "./sailing.js";
import { drawMap, drawPolar } from "./charts.js";
import { createGallery } from "./gallery.js";
import { createFilm, createTimeline } from "./film.js";

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
// mare e cielo prima del post-processing: le nuvole di sky.js sono passate del composer
const ocean = createOcean(renderer);
const sky = createSky(renderer, camera, ocean.shared, { quality: new URLSearchParams(location.search).get("cielo") || "bassa" });
const post = createPost(renderer, scene, camera, { sky });
// testi senza card sulla scena: scelgono chiaro o scuro in base a cosa hanno dietro (contrast.js)
const tone = createAdaptiveTone(renderer);

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
let sailing = null; // navigazione libera (sailing.js): rotta del mondo e gioco nella vista Navigazione
const interiorMeshes = []; // nascosti quando lo scafo è chiuso: dentro non si vedono e costano

// cielo fisico di sky.js al posto della cupola di ocean.js (ocean.sky resta, non si aggiunge)
scene.add(ocean.mesh, sky.mesh);
const seaFx = createSeaFx(renderer, scene, camera);
ocean.linkSeaFx(seaFx.uniforms);
ocean.linkSky(sky.uniforms, SKY_PHYS);
// per controllare accumulo, qualità e buffer del mare dalla console
if (import.meta.env.DEV) Object.assign(window, { __sky: sky, __post: post, __seaFx: seaFx, __renderer: renderer, __scene: scene, __ocean: ocean });
const mats = createMaterials(ocean.shared, ocean.waves);
const landscape = createLandscape(ocean.shared);
scene.add(landscape.group, landscape.rain);
// isole e coste da mappe di altezza vere
const terrain = createTerrain(ocean.shared);
scene.add(terrain.group);
// gabbiani con scheletro
const fauna = createFauna(ocean.shared);
scene.add(fauna.group);

// ---------- Condizioni del mare ----------
// Ora del giorno, vento e costa dal seme: ?seed=N rivede la stessa scena
let cond = null;
let seaEnv = null;
const condEl = document.getElementById("cond");
function applyConditions(seed) {
  cond = makeConditions(seed);
  ocean.setConditions(cond);
  sky.setConditions(cond); // dopo il mare: ricava dal cielo fisico i colori di orizzonte e foschia
  landscape.build(cond);
  terrain.build(cond);
  fauna.build(cond);
  refreshSeaEnv();
  SUN_SEA.copy(cond.sunDir).multiplyScalar(70);
  SEA.sun.copy(cond.light);
  SEA.intensity = cond.intensity;
  SEA.hemiSky.copy(cond.ambSky);
  SEA.hemiGround.copy(cond.ambGround);
  SEA.hemiI = cond.ambI;
  // al visitatore servono solo ora e vento: seme e tipo di costa restano interni (il seme è nell'URL)
  condEl.querySelector("span").textContent = `${cond.label}, ${cond.knots} nodi (forza ${cond.force})`;
  const url = new URL(location.href);
  url.searchParams.set("seed", seed);
  history.replaceState(null, "", url);
}
function refreshSeaEnv() {
  if (seaEnv) seaEnv.dispose();
  seaEnv = sky.envMap(pmrem);
}
applyConditions(seedFromUrl());
// le tabelle dell'atmosfera si calcolano in qualche fotogramma: poi si rifà la mappa d'ambiente
sky.ready.then(refreshSeaEnv);
condEl.querySelector("button").addEventListener("click", () => applyConditions(1 + Math.floor(Math.random() * 99999)));

// Il modello si carica mentre si legge l'ingresso (overlay #mode).
const loaderEl = document.getElementById("loader");

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
    sailing = createSailing({ boat, root, sails, rigging, ocean, clipping: SOLID_PLANES, layer: BOAT_LAYER });
    for (const sl of sails) rigging.tagSail(sl);
    loaderEl.classList.add("done");
    modelReady = true;
    // l'apertura della scena parte quando si è scelto il tipo di visita
    if (modeChosen) introStart = performance.now();
    // ?step=N apre la pagina direttamente su un passo (utile per rivedere una scena)
    const go = new URLSearchParams(location.search).get("step");
    if (go) lenis.scrollTo(+go * innerHeight, { immediate: true });
  },
  undefined,
  (err) => {
    loaderEl.querySelector(".loader-error").textContent = "Errore nel caricamento del modello";
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
  blueprint: [[0, 54, 96], [0, 34, 61]],
  studio: [[246, 246, 246], [222, 226, 230]],
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

// ---------- Ingresso ----------
// Due passi sullo stesso overlay, prima di poter scorrere: la presentazione con "Entra", poi la
// scelta fra visita tradizionale (questa pagina) e audio (un'altra pagina).
// Con ?step=N, il link diretto a una scena, l'ingresso si salta.
const AUDIO_HREF = "/bordo/";
const modeEl = document.getElementById("mode");
let modeChosen = new URLSearchParams(location.search).has("step");
let modelReady = false;
if (modeChosen) {
  modeEl.remove();
} else {
  lenis.stop();
  document.documentElement.classList.add("choosing");
  // effetti d'archivio dell'ingresso: galleria, pellicola, linea del tempo
  const introFx = [
    createGallery(modeEl.querySelector(".mode-gallery")),
    createFilm(modeEl.querySelector(".film-dust")),
    createTimeline(modeEl.querySelector(".mode-timeline")),
  ];
  const [introStep, choiceStep] = modeEl.querySelectorAll(".mode-step");
  const enter = modeEl.querySelector('[data-mode="enter"]');
  const showChoice = () => {
    introStep.hidden = true;
    choiceStep.hidden = false;
    modeEl.setAttribute("aria-labelledby", "mode-title");
    choiceStep.querySelector("button").focus({ preventScroll: true });
  };
  enter.addEventListener("click", showChoice);
  // Con ?scelta (il link "indietro" di /bordo/) si torna direttamente alla scelta della visita
  if (new URLSearchParams(location.search).has("scelta")) {
    history.replaceState(null, "", location.pathname);
    showChoice();
  } else {
    enter.focus({ preventScroll: true });
  }
  modeEl.querySelector('[data-mode="classic"]').addEventListener("click", () => {
    modeChosen = true;
    modeEl.classList.add("done");
    document.documentElement.classList.remove("choosing");
    lenis.start();
    // gli effetti si fermano quando l'overlay ha finito di sfumare
    setTimeout(() => introFx.forEach((fx) => fx.stop()), 700);
    // se il modello non è ancora pronto, la copertura navy resta finché non arriva
    if (modelReady) introStart = performance.now();
  });
  // Verso l'audio l'overlay sfuma e si richiude la copertura navy, poi si cambia pagina: solo a
  // copertura piena (1.1s in style.css), perché /bordo/ parte dallo stesso navy e sfuma da lì
  modeEl.querySelector('[data-mode="audio"]').addEventListener("click", () => {
    modeEl.classList.add("done");
    loaderEl.classList.remove("done");
    setTimeout(() => location.assign(AUDIO_HREF), 1150);
  });
}
// Dalla visita tradizionale si torna alla scelta: si richiude la copertura navy, poi la pagina
// riparte con ?scelta (come il link indietro di /bordo/)
document.getElementById("back-btn").addEventListener("click", (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  const href = e.currentTarget.href;
  lenis.stop();
  loaderEl.classList.remove("done");
  setTimeout(() => location.assign(href), 1150);
});
// Tornando con il pulsante indietro del browser la pagina arriva dalla cache così come era stata
// lasciata, cioè coperta dal navy: si ricarica da capo
addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});
document.querySelectorAll("[data-go]").forEach((a) =>
  a.addEventListener("click", () => lenis.scrollTo(+a.dataset.go * innerHeight, { duration: 2.2 }))
);

drawMap(document.getElementById("map"));
drawPolar(document.getElementById("polar"));

// ---------- Esplorazione libera ----------
// Dalla CTA in alto a sinistra: niente animazioni di scroll, il modello si gira col mouse (o col
// dito) e si passa fra esterni e interni. La scena prende lo stato fisso di un passo della storia,
// la camera la guida OrbitControls. Uscendo si torna esattamente dov'eri nello scroll.
const EXPLORE_VIEWS = {
  // step: il passo della storia da cui prendere luci, sfondo, mare e materiali; cut: altezza del taglio
  // (0.95 toglie la coperta e mostra gli interni); sails: vele visibili (da sopra coprirebbero gli interni);
  // maxPolar: quanto la camera può scendere (in mare resta sopra l'acqua)
  esterni: { step: 8, cut: 100, sails: 1, cam: [-30, 12, 36], tgt: [0, 7, 0], minDistance: 12, maxDistance: 110, maxPolar: 0.92 },
  interni: { step: 10, cut: 0.95, sails: 0, cam: [-9, 15, 11], tgt: [0, 0, 0], minDistance: 3, maxDistance: 40, maxPolar: 0.92 },
  navigazione: { step: 13, cut: 100, sails: 1, cam: [-34, 7, 30], tgt: [0, 7, 0], minDistance: 14, maxDistance: 90, maxPolar: 0.47 },
};
const exploreBtn = document.getElementById("explore-btn");
const exploreBar = document.getElementById("explore-bar");
// collegati al canvas solo in esplorazione: da collegati bloccano lo scroll col dito (touch-action)
const controls = new OrbitControls(camera);
controls.enabled = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
let lastControlsChange = 0;
controls.addEventListener("change", () => (lastControlsChange = performance.now()));
/** Durata del volo della camera fra due viste, in ms: coperta e vele cambiano nello stesso tempo. */
const FLY_MS = 1200;
const explore = { on: false, view: "esterni", cut: 100, fly: null, leaving: null };
const flyProgress = () => (explore.fly ? smooth(0, 1, (performance.now() - explore.fly.t0) / FLY_MS) : 1);
let lastS = null;

function flyTo(name) {
  const view = EXPLORE_VIEWS[name];
  explore.view = name;
  exploreBar.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === name)));
  controls.minDistance = view.minDistance;
  controls.maxDistance = view.maxDistance;
  controls.maxPolarAngle = Math.PI * view.maxPolar;
  document.documentElement.classList.toggle("explore-sea", name === "navigazione");
  explore.fly = {
    t0: performance.now(),
    from: camera.position.clone(),
    fromTgt: controls.target.clone(),
    to: new THREE.Vector3(...view.cam),
    toTgt: new THREE.Vector3(...view.tgt),
    cutFrom: explore.cut,
    // lo stato della scena da cui si parte: durante il volo si sfuma verso quello della nuova vista
    fromState: lastS,
  };
}

function setExplore(on) {
  // durante il volo di ritorno non si interrompe
  if (explore.leaving || on === explore.on) return;
  const html = document.documentElement;
  // "Esplora in" si nasconde su telefono, dove accanto c'è anche "Scegli la visita"
  exploreBtn.innerHTML = on ? "Torna alla visita" : '<span class="explore-long">Esplora in&nbsp;</span>3D';
  exploreBtn.setAttribute("aria-label", on ? "Torna alla visita guidata" : "Esplora liberamente il modello 3D");
  if (on) {
    explore.on = true;
    html.classList.add("exploring");
    controls.connect(renderer.domElement);
    lenis.stop();
    // si parte dall'inquadratura attuale e si vola sugli esterni
    if (lastS) {
      controls.target.set(...lastS.tgt);
      explore.cut = lastS.cut;
    }
    flyTo("esterni");
  } else {
    // Uscita: lo stesso volo dell'ingresso, al contrario. Dalla vista libera si torna all'inquadratura
    // del passo della storia in cui eri, mentre la scena sfuma nella sua luce; alla fine (vedi
    // finishLeaving) ricompaiono i testi e lo scroll riparte.
    controls.enabled = false;
    controls.disconnect();
    explore.fly = null;
    explore.on = false;
    explore.leaving = {
      t0: performance.now(),
      from: camera.position.clone(),
      fromTgt: controls.target.clone(),
      fromState: lastS,
      cutFrom: explore.cut,
      to: new THREE.Vector3(),
      toTgt: new THREE.Vector3(),
      k: 0,
    };
    html.classList.add("explore-leaving");
    html.classList.remove("explore-sea");
  }
}

function finishLeaving() {
  explore.leaving = null;
  document.documentElement.classList.remove("exploring", "explore-leaving");
  lenis.start();
}

// Stato della scena durante il volo di ritorno: da quello dell'esplorazione a quello del passo.
// Calcola anche l'inquadratura d'arrivo, la stessa della camera della storia (parallasse compresa).
function leavingState(p) {
  const L = explore.leaving;
  const target = sample(p);
  L.k = smooth(0, 1, (performance.now() - L.t0) / FLY_MS);
  sph.set(target.radius, THREE.MathUtils.clamp(target.phi + mouse.sy * 0.04, 0.02, Math.PI - 0.02), target.theta - mouse.sx * 0.06);
  v.setFromSpherical(sph);
  L.toTgt.set(...target.tgt);
  L.to.copy(L.toTgt).add(v);
  if (!L.fromState) return target;
  const s = blendStates(L.fromState, target, L.k);
  s.cut = Math.exp(lerp(Math.log(L.cutFrom), Math.log(target.cut), L.k));
  return s;
}
const leavingLook = new THREE.Vector3();
exploreBtn.addEventListener("click", () => setExplore(!explore.on));
exploreBar.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => flyTo(b.dataset.view)));
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && explore.on) setExplore(false);
});

// Due stati della scena mescolati: numeri e vettori interpolati, il grading passa dall'uno all'altro.
function blendStates(A, B, k) {
  const s = {};
  for (const key in B) {
    const a = A[key];
    const b = B[key];
    if (typeof b === "number" && typeof a === "number") s[key] = lerp(a, b, k);
    else if (Array.isArray(b) && Array.isArray(a)) s[key] = b.map((x, i) => lerp(a[i], x, k));
    else s[key] = b;
  }
  s.gradeA = A.gradeT > 0.5 ? A.gradeB : A.gradeA;
  s.gradeB = B.gradeA;
  s.gradeT = k;
  return s;
}

// Stato della scena in esplorazione: quello del passo scelto, senza sfocature né animazioni di
// scroll (il mare e la barca in navigazione invece si muovono). Durante il volo fra due viste tutta
// la scena sfuma dall'una all'altra: luce, sfondo, mare, vele. Il taglio della coperta va in scala
// logaritmica, perché da 100 a 0.95 la parte che si vede è tutta in fondo.
function exploreState() {
  const view = EXPLORE_VIEWS[explore.view];
  const target = Object.assign(sample(view.step), {
    cut: view.cut, sails: view.sails, bokeh: 0, tilt: 0, luff: 0, shift: 0, lines: 0, solid: 1, fov: 35,
  });
  const f = explore.fly;
  if (!f || !f.fromState) {
    explore.cut = view.cut;
    return target;
  }
  const k = flyProgress();
  const s = blendStates(f.fromState, target, k);
  explore.cut = s.cut = Math.exp(lerp(Math.log(f.cutFrom), Math.log(view.cut), k));
  return s;
}

function updateExploreCamera() {
  if (explore.fly) {
    const k = flyProgress();
    camera.position.lerpVectors(explore.fly.from, explore.fly.to, k);
    controls.target.lerpVectors(explore.fly.fromTgt, explore.fly.toTgt, k);
    camera.lookAt(controls.target);
    controls.enabled = false;
    if (k >= 1) {
      explore.fly = null;
      controls.enabled = true;
    }
  } else {
    controls.update();
  }
}

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
  // in mare si disegna a ritmo ridotto (post.pace); lo scroll di Lenis va avanti comunque
  if (!post.pace(time, (lastS?.ocean ?? 0) > 0.5)) {
    requestAnimationFrame(frame);
    return;
  }
  clock.update(time);
  const t = clock.getElapsed();
  const dt = clock.getDelta();
  const p = Math.min(N - 1, Math.max(0, window.scrollY / H));
  const s = explore.on ? exploreState() : explore.leaving ? leavingState(p) : sample(p);
  lastS = s;

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

  // Navigazione libera: il gioco gira solo nella vista Navigazione dell'esplorazione (a volo finito);
  // altrimenti sailing tiene la rotta dritta e la velocità delle condizioni, come la pagina a scroll
  const nav = sailing ? sailing.update(dt, explore.on && explore.view === "navigazione" && !explore.fly, cond) : null;

  // Vele: sgonfie e che sbattono quando luff > 0
  const flutter = s.luff * (0.78 + 0.22 * Math.sin(t * 7.0) * Math.sin(t * 2.3));
  for (const m of sails) {
    m.morphTargetInfluences[0] = flutter;
    m.material.opacity = s.sails;
    m.material.depthWrite = s.sails > 0.98;
    m.visible = s.sails > 0.01 || s.lines > 0.01;
  }
  sailing?.applySails(t);

  // Barca in mare: la sbandata viene dal vento (i fotogrammi sono tarati su 16°), beccheggio,
  // rollio e sollevamento dalle onde che ha sotto (ocean.float, dopo la rotta di sailing.update)
  const m = s.motion * lerp(1, cond.motion, s.ocean);
  const heel = nav?.heel ?? s.heel * lerp(1, cond.heel / 16, s.ocean);
  const onda = ocean.float(t, dt);
  const mare = s.motion * s.ocean;
  boat.rotation.x = THREE.MathUtils.degToRad(heel) + mare * onda.roll;
  boat.rotation.z = mare * onda.pitch;
  boat.position.y = mare * onda.heave;
  boat.updateMatrixWorld();
  // vento sulle vele e sulla bandiera: brezza leggera nello studio, quello delle condizioni in mare
  const wind = lerp(0.18, Math.min(1, cond.knots / 20), s.ocean);
  mats.update(boat, s.ocean, wind * s.sails, cond.rain ? s.ocean : 0);
  if (rigging) rigging.update(t, wind);
  ocean.update(t, s.ocean, m, camera);
  sky.update(t, dt, s.ocean);
  landscape.update(t, s.ocean);
  terrain.update(t, s.ocean);
  fauna.update(t, dt, s.ocean, camera);

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
  const exploreMoving = explore.leaving || (explore.on && (explore.fly || performance.now() - lastControlsChange < 250));
  const settled = !exploreMoving && Math.abs(p - lastP) < 1e-5 && Math.abs(mouse.x - mouse.sx) < 0.004 && Math.abs(mouse.y - mouse.sy) < 0.004;
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
  if (explore.on) {
    updateExploreCamera();
  } else if (explore.leaving) {
    const L = explore.leaving;
    camera.position.lerpVectors(L.from, L.to, L.k);
    camera.lookAt(leavingLook.lerpVectors(L.fromTgt, L.toTgt, L.k));
    if (L.k >= 1) finishLeaving();
  } else {
    sph.set(s.radius, THREE.MathUtils.clamp(s.phi + mouse.sy * 0.04, 0.02, Math.PI - 0.02), s.theta - mouse.sx * 0.06);
    v.setFromSpherical(sph);
    camera.position.set(s.tgt[0] + v.x, s.tgt[1] + v.y, s.tgt[2] + v.z);
    camera.lookAt(s.tgt[0], s.tgt[1], s.tgt[2]);
  }
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
  // Nel capitolo Navigazione il logo diventa bianco sul cielo e sul mare; torna blu sulla schermata finale
  document.body.classList.toggle("logo-white", !explore.on && !explore.leaving && p > CHAPTERS[3] - 0.5 && p < N - 1.5);
  condEl.classList.toggle("on", s.ocean > 0.5);

  // Post-processing: fuoco sul punto del passo, esposizione delle condizioni in mare
  focusW.set(...s.focus).applyMatrix4(boat.matrixWorld);
  s.exposure = lerp(1, cond.exposure, s.ocean);
  post.apply(s, focusW);
  // dopo ~48 fotogrammi accumulati l'immagine è pulita: si smette di disegnare finché non cambia nulla
  if (!(still && post.accum.count >= 48)) {
    post.beginFrame();
    seaFx.render(dt, nav ? nav.speed : cond.flow, s.ocean, nav ? nav.heading : 0);
    post.render(dt, still);
    post.endFrame();
    tone.update();
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
