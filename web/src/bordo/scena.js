// Scena 3D della pagina guidata a voce. Nasce dalla scena della landing (src/main.js) con
// tre differenze: la camera la muove la regia (comandi dell'agente o puntini dei capitoli)
// e non lo scroll; i passi lontani si raggiungono con un salto diretto invece di attraversare
// tutti quelli in mezzo; negli interni si accendono le luci di cabina.
// Quando i due branch si uniranno in main, le parti comuni andranno in un modulo condiviso.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { KEYS, HOTSPOTS, CHAPTERS } from "../story.js";
import { createOcean } from "../ocean.js";
import { createLandscape } from "../landscape.js";
import { makeConditions, seedFromUrl } from "../conditions.js";
import { createPost } from "../post.js";
import { createAdaptiveTone } from "../contrast.js";
import { createMaterials } from "../materials.js";
import { createSeaFx, BOAT_LAYER } from "../seafx.js";
import { createRigging } from "../rigging.js";

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const NUM_KEYS = ["fov", "shift", "lines", "solid", "cut", "luff", "ocean", "heel", "motion", "theme", "sails", "bokeh", "range", "tilt", "radius", "phi", "grid"];

const BG = {
  blueprint: [[14, 40, 70], [8, 24, 42]],
  studio: [[236, 233, 226], [205, 200, 190]],
  sky: [[104, 150, 196], [222, 231, 234]],
};

// Ritocchi ai fotogrammi chiave di story.js per la pagina a voce (campo visivo più largo dove
// la barca usciva dall'area libera)
const REGIA = {
  // la tavola d'apertura è il primo colpo d'occhio: la barca occupa quasi tutta l'altezza libera
  0: { fov: 20 },
  1: { fov: 28 },
  3: { fov: 48 },
  4: { fov: 37 },
  7: { fov: 47 },
  11: { fov: 42 },
  12: { fov: 58 },
  14: { fov: 43 },
  16: { fov: 41 },
};

// Luci di cabina in coordinate della barca, sopra il piano di taglio: armatore, cucina,
// dinette, cabine ospiti, cabina a V
const CABIN_LIGHTS = [[-6.3, 1.5, 0], [-2.2, 1.5, -1.1], [0.4, 1.6, -0.6], [3.2, 1.5, 0], [6.0, 1.4, 0]];

// margini: funzione che restituisce i pixel occupati dall'interfaccia { sinistra, basso }.
// Il centro ottico della camera si sposta nell'area libera, così la barca non finisce sotto
// l'indice o la plancia.
export function createScena({ canvas, onEvent = () => {}, margini = () => ({ sinistra: 0, destra: 0, alto: 0, basso: 0 }) }) {
  // ---------- Renderer, camera, post ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 1, 0.5, 5000);
  const post = createPost(renderer, scene, camera);
  // parole chiave e indice scelgono chiaro o scuro in base a cosa hanno dietro (contrast.js, come nella landing)
  const tone = createAdaptiveTone(renderer);

  // ---------- Sfondo (come nella landing) ----------
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

  // ---------- Luci: studio e mare ----------
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
  sun.layers.enable(BOAT_LAYER);

  const rim = new THREE.DirectionalLight(0xcfe0ff, 1.1);
  rim.position.set(25, 18, -45);
  scene.add(rim);
  rim.layers.enable(BOAT_LAYER);

  const hemi = new THREE.HemisphereLight(0xdfe9f5, 0x6b5a48, 0.45);
  scene.add(hemi);
  hemi.layers.enable(BOAT_LAYER);

  const STUDIO = { sun: new THREE.Color(0xfff4e2), hemiSky: new THREE.Color(0xdfe9f5), hemiGround: new THREE.Color(0x6b5a48) };
  const SEA = { sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), intensity: 3.4, hemiI: 0.7 };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.ShadowMaterial({ opacity: 0.22 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.26;
  floor.receiveShadow = true;
  scene.add(floor);

  // ---------- Piani di taglio ----------
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
  const headliner = [];
  let rigging = null;
  const interiorMeshes = [];

  // luci di cabina: sempre nella scena (accenderle e spegnerle cambierebbe gli shader),
  // a intensità zero finché non si scende sottocoperta
  // faretti rivolti in basso, come plafoniere: pozze di luce su pagliolo, tavoli e divani,
  // senza sporcare di arancione i fianchi bianchi dello scafo
  const cabin = CABIN_LIGHTS.map((at) => {
    const l = new THREE.SpotLight(0xffd6a0, 0, 4.2, 1.05, 0.85, 1.6);
    l.position.set(...at);
    l.target.position.set(at[0], -0.4, at[2]);
    boat.add(l, l.target);
    return l;
  });
  let lightsOn = false;
  let lightsT = 0;

  const ocean = createOcean();
  scene.add(ocean.mesh, ocean.sky);
  const seaFx = createSeaFx(renderer, scene, camera);
  ocean.linkSeaFx(seaFx.uniforms);
  const mats = createMaterials(ocean.shared, ocean.waves);
  const landscape = createLandscape(ocean.shared);
  scene.add(landscape.group, landscape.clouds, landscape.rain);

  // ---------- Condizioni del mare ----------
  let cond = null;
  let seaEnv = null;
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
    onEvent("mare", cond);
  }
  applyConditions(seedFromUrl());

  // ---------- Fotogrammi chiave ----------
  // Quelli della landing, con qualche ritocco per questa pagina: qui la barca ha a disposizione
  // la colonna centrale fra indice e parole chiave, non mezza pagina accanto a una scheda
  const FRAMES = [];
  KEYS.forEach((k, i) => {
    const f = { ...(FRAMES[i - 1] || {}), ...k, ...(REGIA[i] || {}) };
    f.focus = k.focus || f.tgt;
    FRAMES.push(f);
  });
  const N = FRAMES.length;

  const sph = new THREE.Spherical();
  const v = new THREE.Vector3();

  // Stato completo di un fotogramma, in una forma che si può interpolare con un altro stato
  function stateOf(i) {
    const F = FRAMES[i];
    v.set(F.cam[0] - F.tgt[0], F.cam[1] - F.tgt[1], F.cam[2] - F.tgt[2]);
    sph.setFromVector3(v);
    const s = {};
    for (const key of NUM_KEYS) s[key] = F[key];
    s.radius = sph.radius;
    s.phi = sph.phi;
    s.theta = sph.theta;
    s.tgt = [...F.tgt];
    s.focus = [...F.focus];
    s.bgTop = [...BG[F.bg][0]];
    s.bgBot = [...BG[F.bg][1]];
    s.grid = F.bg === "blueprint" ? 1 : 0;
    s.gradeA = s.gradeB = F.grade;
    s.gradeT = 0;
    return s;
  }

  function mix(A, B, t) {
    const s = {};
    for (const key of NUM_KEYS) s[key] = lerp(A[key], B[key], t);
    // la camera gira attorno al punto guardato dalla parte più corta
    let d = B.theta - A.theta;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    s.theta = A.theta + d * t;
    s.tgt = lerp3(A.tgt, B.tgt, t);
    s.focus = lerp3(A.focus, B.focus, t);
    s.bgTop = lerp3(A.bgTop, B.bgTop, t);
    s.bgBot = lerp3(A.bgBot, B.bgBot, t);
    // il grading parte da quello dominante dello stato di partenza
    s.gradeA = A.gradeT < 0.5 ? A.gradeA : A.gradeB;
    s.gradeB = B.gradeB;
    s.gradeT = t;
    return s;
  }

  // ---------- Regia ----------
  // Un solo meccanismo per tutti gli spostamenti: dallo stato attuale a quello del passo
  // d'arrivo. La durata cresce con la distanza, ma un salto lungo non attraversa i passi intermedi.
  let step = 0;
  let cur = stateOf(0);
  let move = null;
  // un salto immediato cambia la scena senza movimento: si forza qualche fotogramma
  let kick = 0;
  // Panoramica: a scena ferma la camera gira piano attorno alla barca (un giro in circa
  // due minuti). Parte e si ferma con dolcezza; si ferma su un dettaglio indicato, perché
  // il punto non finisca dietro lo scafo.
  const GIRO = (Math.PI * 2) / 120;
  let giro = 0;
  let giroVel = 0;

  function goTo(target, { immediato = false } = {}) {
    const to = Math.min(N - 1, Math.max(0, Math.round(target)));
    const dist = Math.abs(to - step);
    if (immediato) {
      move = null;
      kick = 3;
      giro = giroVel = 0;
      cur = stateOf(to);
      step = to;
      onEvent("passo", step);
      return to;
    }
    if (dist === 0 && !move) return to;
    // lo spostamento parte da dove la panoramica ha portato la camera
    const from = { ...cur, theta: cur.theta + giro };
    giro = 0;
    move = { from, to: stateOf(to), toStep: to, t0: performance.now(), dur: 1800 + Math.min(dist, 4) * 450, announced: false };
    return to;
  }

  // ---------- Dettagli indicati ----------
  // Solo i punti del passo corrente; l'etichetta compare solo su quello indicato dall'agente
  const hsLayer = document.getElementById("hotspots");
  const hsEls = HOTSPOTS.map((h, i) => {
    const el = document.createElement("div");
    el.className = "hs";
    el.innerHTML = `<span class="dot"></span><span class="lab">${h.title}</span>`;
    hsLayer.appendChild(el);
    return { ...h, id: i, el, pos: new THREE.Vector3(...h.at), o: 0 };
  });
  let focused = null;
  function focus(id) {
    focused = id == null ? null : hsEls[id];
    for (const h of hsEls) h.el.classList.toggle("focus", h === focused);
  }

  const proj = new THREE.Vector3();
  function updateHotspots(dt, w, h) {
    for (const hs of hsEls) {
      const want = !move && hs.steps.includes(step) ? (hs === focused ? 1 : 0.55) : 0;
      hs.o += (want - hs.o) * Math.min(1, dt * 5);
      if (hs.o < 0.01) {
        hs.el.style.opacity = 0;
        continue;
      }
      proj.copy(hs.pos).applyMatrix4(boat.matrixWorld).project(camera);
      const o = proj.z > 1 ? 0 : hs.o;
      hs.el.style.opacity = o.toFixed(3);
      hs.el.style.transform = `translate(${((proj.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-proj.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    }
  }

  // ---------- Modello ----------
  const ready = new Promise((resolve, reject) => {
    new GLTFLoader().load(
      "/models/swan651.glb",
      (gltf) => {
        const root = gltf.scene;
        const done = new Map();
        const fix = (orig) => {
          if (done.has(orig)) return done.get(orig);
          const m = mats.upgrade(orig);
          done.set(orig, m);
          m.clippingPlanes = SOLID_PLANES;
          m.clipShadows = true;
          m.side = THREE.DoubleSide;
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
          if (o.name.startsWith("Interior")) interiorMeshes.push(o);
          else o.layers.enable(BOAT_LAYER);
          if (o.name.startsWith("Interior_Headliner")) headliner.push(o);
          o.castShadow = true;
          o.receiveShadow = !o.morphTargetInfluences;
          if (o.morphTargetInfluences) {
            sails.push(o);
            o.material.transparent = true;
          }
          const interior = o.name.startsWith("Interior");
          const angle = o.name === "Hull" ? 3 : interior ? 40 : o.name === "Rigging" || o.name === "Lifelines" ? 60 : 28;
          const lines = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, angle), interior ? lineMatInterior : lineMat);
          lines.renderOrder = 10;
          o.add(lines);
        });
        // prima di agganciarlo alla barca, che può essere già inclinata
        campionaSagoma(root);
        boat.add(root);
        rigging = createRigging({ boat, clipping: SOLID_PLANES, layer: BOAT_LAYER });
        for (const sl of sails) rigging.tagSail(sl);
        introStart = performance.now();
        resolve();
      },
      (e) => e.total && onEvent("caricamento", e.loaded / e.total),
      reject
    );
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

  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  addEventListener("pointermove", (e) => {
    mouse.x = (e.clientX / innerWidth) * 2 - 1;
    mouse.y = (e.clientY / innerHeight) * 2 - 1;
  });

  // ---------- Ciclo ----------
  let introStart = 0;
  const clock = new THREE.Timer();
  // ---------- Centraggio ----------
  // La camera guarda tgt, che non coincide con il centro di ciò che si vede: da tre quarti la
  // prua sembra più grande della poppa, l'albero sale molto sopra lo scafo e la panoramica
  // cambia la sagoma mentre gira. A ogni fotogramma si proietta un campione dei vertici
  // esterni e si sposta il centro ottico sul centro della sagoma. Le misure sono in mezze
  // altezze di schermo, così non dipendono dalle proporzioni della finestra.
  const CAMPIONE = 3000;
  let esterni = new Float32Array(0);
  let vele = new Float32Array(0);
  function campionaSagoma(root) {
    const a = [];
    const b = [];
    const p = new THREE.Vector3();
    let tot = 0;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o.isMesh && !o.name.startsWith("Interior")) tot += o.geometry.attributes.position.count;
    });
    const passo = Math.max(1, Math.floor(tot / CAMPIONE));
    root.traverse((o) => {
      if (!o.isMesh || o.name.startsWith("Interior")) return;
      const pos = o.geometry.attributes.position;
      const out = o.morphTargetInfluences ? b : a;
      // ogni mesh contribuisce almeno con qualche punto, anche le più piccole (bandiera, timone)
      for (let i = 0; i < pos.count; i += Math.min(passo, Math.ceil(pos.count / 8))) {
        p.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        out.push(p.x, p.y, p.z);
      }
    });
    esterni = new Float32Array(a);
    vele = new Float32Array(b);
  }

  const centro = { x: 0, y: 0, zoom: 1, pronto: false };
  const mBarca = new THREE.Matrix4();
  const q = new THREE.Vector3();
  function misuraSagoma(s, dt) {
    let tx = 0;
    let ty = 0;
    let tz = 1;
    // negli interni la coperta è tolta e conta il punto scelto in story.js, non la sagoma
    if (esterni.length && s.cut > 50) {
      mBarca.makeRotationX(THREE.MathUtils.degToRad(s.heel)).premultiply(camera.matrixWorldInverse);
      const k = 1 / Math.tan(THREE.MathUtils.degToRad(s.fov / 2));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const scorri = (arr) => {
        for (let i = 0; i < arr.length; i += 3) {
          q.set(arr[i], arr[i + 1], arr[i + 2]).applyMatrix4(mBarca);
          if (q.z > -0.5) continue;
          const x = (q.x / -q.z) * k;
          const y = (q.y / -q.z) * k;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      };
      scorri(esterni);
      if (s.sails > 0.5) scorri(vele);
      // in orizzontale si centra se la sagoma sta più o meno nello schermo; in verticale anche,
      // ma se sborda la chiglia si appoggia appena sopra la plancia e si taglia l'alto dell'albero
      if (x1 > x0) {
        if (x1 - x0 < 4.2) {
          tx = (x0 + x1) / 2;
          // se la barca intera non entra fra indice e colonna di destra, la camera allarga
          // il campo quanto basta; i dettagli ravvicinati (sagoma molto più larga) restano tali
          const mg = margini();
          const libero = (2 * (W - mg.sinistra - mg.destra)) / H;
          if (libero > 0) tz = Math.min(1.6, Math.max(1, ((x1 - x0) * 1.06) / libero));
        }
        if (y1 - y0 < 1.7) ty = (y0 + y1) / 2;
        else if (y1 - y0 < 6) ty = y0 + 0.8;
      }
    }
    // al primo fotogramma utile si parte già centrati, poi si segue con dolcezza
    const f = centro.pronto ? Math.min(1, dt * 4) : 1;
    centro.pronto = esterni.length > 0;
    centro.x += (tx - centro.x) * f;
    centro.y += (ty - centro.y) * f;
    centro.zoom += (tz - centro.zoom) * f;
  }

  let lastTime = 0;
  const rotta = new THREE.Vector2();
  let stillFrames = 0;
  const focusW = new THREE.Vector3();

  function frame(time) {
    clock.update(time);
    const t = clock.getElapsed();
    const dt = clock.getDelta();

    if (move) {
      const k = Math.min(1, (performance.now() - move.t0) / move.dur);
      cur = mix(move.from, move.to, easeInOut(k));
      // a metà strada il passo d'arrivo diventa quello corrente (suoni, puntini, stato)
      if (!move.announced && k > 0.5) {
        move.announced = true;
        step = move.toStep;
        onEvent("passo", step);
      }
      if (k >= 1) {
        cur = move.to;
        move = null;
        onEvent("arrivo", step);
      }
    }
    const s = cur;
    giroVel += ((move || focused ? 0 : GIRO) - giroVel) * Math.min(1, dt * (move ? 6 : 0.6));
    giro += giroVel * dt;

    const intro = introStart ? smooth(0, 1, (performance.now() - introStart) / 2600) : 0;
    planeDraw.constant = -lerp(12, -12, intro);

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

    // Luci di cabina: si accendono quando la coperta è tolta, con un breve sfarfallio
    const wantLights = s.cut < 3 && s.solid > 0.5;
    if (wantLights !== lightsOn) {
      lightsOn = wantLights;
      lightsT = performance.now();
      onEvent(wantLights ? "luci-accese" : "luci-spente");
    }
    const since = (performance.now() - lightsT) / 1000;
    const flicker = since < 0.35 ? (Math.sin(since * 90) > 0.2 ? 1 : 0.15) : 1;
    const level = lightsOn ? Math.min(1, since / 0.6) * flicker : Math.max(0, 1 - since / 0.5);
    for (const l of cabin) l.intensity = level * 5;

    const flutter = s.luff * (0.78 + 0.22 * Math.sin(t * 7.0) * Math.sin(t * 2.3));
    for (const m of sails) {
      m.morphTargetInfluences[0] = flutter;
      m.material.opacity = s.sails;
      m.material.depthWrite = s.sails > 0.98;
      m.visible = s.sails > 0.01 || s.lines > 0.01;
    }

    const m = s.motion * lerp(1, cond.motion, s.ocean);
    boat.rotation.x = THREE.MathUtils.degToRad(s.heel * lerp(1, cond.heel / 16, s.ocean) + m * 1.8 * Math.sin(t * 0.47));
    boat.rotation.z = THREE.MathUtils.degToRad(m * 1.4 * Math.sin(t * 0.61 + 1.2));
    boat.position.y = m * 0.14 * Math.sin(t * 0.83);
    boat.updateMatrixWorld();
    const wind = lerp(0.18, Math.min(1, cond.knots / 20), s.ocean);
    mats.update(boat, s.ocean, wind * s.sails, cond.rain ? s.ocean : 0);
    if (rigging) rigging.update(t, wind);
    // rotta dritta: l'acqua scorre lungo la prua alla velocità delle condizioni (ocean.js non lo
    // calcola più da solo, lo stesso che fa sailing.js nella landing fuori dal gioco)
    ocean.setCourse(0, rotta.set(t * cond.flow, 0));
    ocean.update(t, s.ocean, m, camera);
    landscape.update(t, s.ocean, camera);

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

    // accumulo a camera ferma, come nella landing; le luci che si accendono contano come movimento
    const dynamic = !introStart || intro < 1 || move || giroVel > 1e-4 || kick-- > 0 || s.ocean > 0.001 || s.luff > 0.001 || s.motion > 0.001 || since < 0.7;
    const settled = Math.abs(mouse.x - mouse.sx) < 0.004 && Math.abs(mouse.y - mouse.sy) < 0.004;
    stillFrames = !dynamic && settled ? stillFrames + 1 : 0;
    const still = stillFrames > 12;

    if (still) {
      mouse.sx = mouse.x;
      mouse.sy = mouse.y;
    } else {
      mouse.sx += (mouse.x - mouse.sx) * 0.04;
      mouse.sy += (mouse.y - mouse.sy) * 0.04;
    }
    sph.set(s.radius, THREE.MathUtils.clamp(s.phi + mouse.sy * 0.04, 0.02, Math.PI - 0.02), s.theta + giro - mouse.sx * 0.06);
    v.setFromSpherical(sph);
    camera.position.set(s.tgt[0] + v.x, s.tgt[1] + v.y, s.tgt[2] + v.z);
    // in mare la camera resta sopra le creste: le onde (fino a un metro e mezzo col vento forte)
    // altrimenti coprono l'obiettivo nelle inquadrature basse. Il minimo entra col mare
    const sopraOnde = 1.2 + 2.2 * cond.waveScale;
    camera.position.y += Math.max(0, sopraOnde - camera.position.y) * s.ocean;
    camera.lookAt(s.tgt[0], s.tgt[1], s.tgt[2]);
    camera.fov = s.fov;
    camera.updateMatrixWorld();
    if (!still) misuraSagoma(s, dt);
    // il campo allargato: le misure della sagoma vanno riscalate nello stesso rapporto
    const z = centro.zoom;
    if (z > 1.001) {
      camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(s.fov / 2)) * z));
      camera.updateMatrixWorld();
    }
    // la barca sta al centro dell'area libera fra indice, parole chiave e plancia: lo spostamento
    // dei fotogrammi della landing (pensato per le schede) qui non si usa
    const mg = margini();
    const offX = W / 2 - (mg.sinistra + W - mg.destra) / 2 + (centro.x * H) / 2 / z;
    const offY = mg.basso / 2 - mg.alto / 2 - (centro.y * H) / 2 / z;
    if (still) {
      post.jitter(offX);
      camera.view.offsetY += offY;
    } else camera.setViewOffset(W, H, offX, offY, W, H);
    camera.updateProjectionMatrix();

    const bu = backdrop.material.uniforms;
    bu.uTop.value.set(...s.bgTop);
    bu.uBot.value.set(...s.bgBot);
    bu.uGrid.value = s.grid * 0.9;
    bu.uRes.value.set(W, H);
    bu.uDpr.value = renderer.getPixelRatio();
    bu.uExposure.value = post.exposure;
    // il tema dei testi segue lo sfondo: chiaro nello studio, scuro sulla tavola e in mare
    const light = s.theme > 0.5;
    if (light !== document.body.classList.contains("light")) document.body.classList.toggle("light", light);

    focusW.set(...s.focus).applyMatrix4(boat.matrixWorld);
    s.exposure = lerp(1, cond.exposure, s.ocean);
    post.apply(s, focusW);
    if (!(still && post.accum.count >= 48)) {
      post.beginFrame();
      seaFx.render(dt, cond.flow, s.ocean);
      post.render(dt, still);
      post.endFrame();
      tone.update();
    }
    if (!still && lastTime) post.measure(time - lastTime);
    lastTime = time;
    updateHotspots(dt, W, H);

    onEvent("fotogramma", { s, wind, knots: cond.knots, rain: !!cond.rain, coast: cond.coast });

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    ready,
    steps: N,
    chapters: CHAPTERS,
    hotspots: hsEls,
    goTo,
    focus,
    get step() {
      return step;
    },
    get moving() {
      return !!move;
    },
    conditions: () => cond,
    setSeed: applyConditions,
  };
}
