import * as THREE from "three";
import { POLAR } from "./charts.js";

// Navigazione libera (esplorazione 3D, vista Navigazione): si governa la barca, si lascano e si
// cazzano randa e vela di prua, si issano e si ammainano gennaker e spinnaker.
//
// Riferimento: la barca sta al centro della scena e ruota su se stessa; mare, sole e paesaggio restano
// fermi e l'acqua le scorre sotto alla sua velocità, lungo la prua. heading è la rotta (radianti, verso
// dritta positivo), il vento reale soffia da una direzione fissa del mondo. Con il gioco spento la rotta
// torna a 0 e le vele alla regolazione del modello: la pagina a scroll resta identica.
//
// Fisica volutamente semplice ma credibile: la velocità viene dalla polare ORC dello Swan 651
// (charts.js), moltiplicata per l'efficienza delle vele. Ogni andatura ha una regolazione ideale
// delle scotte: troppo lasca la vela fileggia (shape key "Luffing" del modello), troppo cazzata stalla
// e fa sbandare di più. Il gennaker rende al lasco, lo spinnaker in poppa; stretti al vento collassano.

const D2R = THREE.MathUtils.degToRad;
const R2D = THREE.MathUtils.radToDeg;
const KN = 0.5144; // m/s per nodo
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a)); // angolo in (-π, π]
const bell = (x, c, w) => Math.exp(-(((x - c) / w) ** 2));

/** Direzione del mondo da cui soffia il vento: con rotta 0 arriva a 60° sulla sinistra, come nel modello. */
const WIND_FROM = D2R(-60);
/** Velocità di virata massima, gradi al secondo, raggiunta sopra i 6 nodi. */
const TURN_RATE = 11;
/** Velocità delle scotte da tastiera: frazione della corsa al secondo. */
const SHEET_RATE = 0.45;

// Geometria del modello (coordinate della barca, metri): albero, strallo, punte delle vele
const MAST = new THREE.Vector3(1.71, 0, 0);
const TACK = new THREE.Vector3(9.79, 2.27, 0);
const JIB_HEAD = new THREE.Vector3(1.8, 27.6, 0);
const JIB_CLEW = new THREE.Vector3(1.39, 3.12, 1.09);
const BOOM_END = new THREE.Vector3(-5.9, 2.4, 0.99);

// Velocità di polare in nodi per angolo al vento reale (gradi) e vento reale (nodi).
// Fuori dalla tabella: sotto 42° si va verso il "controvento" (zero a 28°), oltre 135° si scende
// fino all'82% in poppa piena con randa e fiocco.
function polarSpeed(twaDeg, tws) {
  const a = Math.abs(twaDeg);
  const rowAt = (rows, x) => {
    if (x <= rows[0][0]) return rows[0][1];
    for (let i = 1; i < rows.length; i++) {
      if (x <= rows[i][0]) return lerp(rows[i - 1][1], rows[i][1], (x - rows[i - 1][0]) / (rows[i][0] - rows[i - 1][0]));
    }
    return rows[rows.length - 1][1];
  };
  const forWind = (w) => {
    const rows = POLAR[w];
    if (a < 42) return rowAt(rows, 42) * smooth(28, 42, a);
    if (a > 135) return lerp(rowAt(rows, 135), rowAt(rows, 135) * 0.82, (a - 135) / 45);
    return rowAt(rows, a);
  };
  if (tws <= 10) return forWind(10) * (0.35 + 0.65 * tws / 10);
  if (tws <= 16) return lerp(forWind(10), forWind(16), (tws - 10) / 6);
  if (tws <= 20) return lerp(forWind(16), forWind(20), (tws - 16) / 4);
  return forWind(20) * (1 + Math.min(0.06, (tws - 20) * 0.01));
}

// Regolazione ideale della scotta (0 cazzata, 1 lascata) per un angolo al vento apparente
const idealEase = (awaDeg, from = 22, span = 140) => clamp((Math.abs(awaDeg) - from) / span, 0, 1);

// Teli per gennaker e spinnaker, disegnati su una tela
function kiteTexture(stripes) {
  const c = document.createElement("canvas");
  c.width = 8;
  c.height = 256;
  const g = c.getContext("2d");
  let y = 0;
  for (const [color, h] of stripes) {
    g.fillStyle = color;
    g.fillRect(0, y, 8, h);
    y += h;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Superficie di una vela da vento in poppa: triangolo penna-mura-bugna con la pancia in avanti.
// s va dalla penna (0) alla base (1), t dall'inferitura (0) alla balumina (1).
function kiteGeometry(H, T, C, bulgeDir, depth) {
  const rows = 22;
  const cols = 16;
  const pos = [];
  const uv = [];
  const idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= rows; i++) {
    const s = i / rows;
    for (let j = 0; j <= cols; j++) {
      const t = j / cols;
      p.copy(H)
        .addScaledVector(T.clone().sub(H), s * (1 - t))
        .addScaledVector(C.clone().sub(H), s * t)
        .addScaledVector(bulgeDir, depth * Math.sin(Math.PI * t) * s ** 0.7 * (1 - 0.25 * s));
      pos.push(p.x, p.y, p.z);
      uv.push(t, 1 - s);
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j;
      const b = a + cols + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createSailing({ boat, root, sails, rigging, ocean, clipping, layer }) {
  // prima la rotta, poi sbandata e beccheggio nel riferimento della barca
  boat.rotation.order = "YXZ";
  // ---------- Vele del modello su perni che ruotano ----------
  const mainsail = root.getObjectByName("Mainsail");
  const boom = root.getObjectByName("Boom");
  const headsail = root.getObjectByName("Headsail");
  const parent = mainsail.parent;

  // randa e boma girano attorno all'albero
  const mainPivot = new THREE.Group();
  mainPivot.position.copy(MAST);
  parent.add(mainPivot);
  mainPivot.attach(boom);
  mainPivot.attach(mainsail);
  const mainBase = Math.atan2(BOOM_END.z, MAST.x - BOOM_END.x); // angolo del boma nel modello

  // il fiocco gira attorno allo strallo
  const jibPivot = new THREE.Group();
  jibPivot.position.copy(TACK);
  parent.add(jibPivot);
  jibPivot.attach(headsail);
  const stay = JIB_HEAD.clone().sub(TACK).normalize();
  const clewArm = JIB_CLEW.clone().sub(TACK);
  clewArm.addScaledVector(stay, -clewArm.dot(stay));
  const jibBase = Math.asin(clewArm.z / clewArm.length());
  // verso di rotazione attorno allo strallo che porta la bugna verso dritta (+z)
  const jibSign = clewArm.clone().applyAxisAngle(stay, 0.1).z > clewArm.z ? 1 : -1;
  const jibQ = new THREE.Quaternion();

  // i materiali delle vele restano quelli di materials.js (shader del laminato e della balumina):
  // il fiocco sotto gennaker e spinnaker si nasconde, non si sfuma
  const jibMeshes = sails.filter((m) => m.name.startsWith("Headsail"));
  const mainMeshes = sails.filter((m) => m.name.startsWith("Mainsail"));

  // ---------- Gennaker e spinnaker ----------
  // costruiti per la bugna a dritta; dall'altra parte si specchiano come le altre vele
  function kite(H, T, C, bulge, depth, stripes) {
    const pivot = new THREE.Group();
    pivot.position.copy(H);
    const mat = new THREE.MeshStandardMaterial({
      map: kiteTexture(stripes), side: THREE.DoubleSide, roughness: 0.62, clippingPlanes: clipping, clipShadows: true,
    });
    const mesh = new THREE.Mesh(kiteGeometry(new THREE.Vector3(), T.clone().sub(H), C.clone().sub(H), bulge.normalize(), depth), mat);
    mesh.castShadow = true;
    mesh.layers.enable(layer);
    pivot.add(mesh);
    pivot.visible = false;
    boat.add(pivot);
    return { pivot, mesh, up: 0, target: 0 };
  }
  const kites = {
    // asimmetrico: mura a prua sul musone, bugna a poppa sottovento
    gennaker: kite(
      new THREE.Vector3(1.9, 26.6, 0), new THREE.Vector3(10.9, 2.5, 0), new THREE.Vector3(-1.5, 4.2, 6.2),
      new THREE.Vector3(0.75, 0.05, 0.66), 3.2,
      [["#f4f4f2", 150], ["#003660", 26], ["#157aac", 18], ["#f4f4f2", 62]],
    ),
    // simmetrico: mura al tangone sopravvento, bugna sottovento, grande pancia in avanti
    spinnaker: kite(
      new THREE.Vector3(2.0, 26.8, 0), new THREE.Vector3(6.8, 3.6, -4.8), new THREE.Vector3(1.0, 3.6, 7.2),
      new THREE.Vector3(1, 0.06, 0.18), 4.6,
      [["#003660", 70], ["#f4f4f2", 22], ["#157aac", 90], ["#f4f4f2", 22], ["#003660", 52]],
    ),
  };

  // ---------- Stato ----------
  const st = {
    active: false,
    heading: 0,
    speed: 0, // m/s
    steer: 0,
    mainEase: 0.15,
    jibEase: 0.15,
    mainAngle: mainBase, // angolo con segno (positivo = vela a dritta)
    jibAngle: jibBase,
    heel: 0, // gradi, con segno (positivo = sbanda a dritta)
    luffMain: 0,
    luffJib: 0,
    twa: 0,
    awa: 0,
    aws: 0,
    trimMain: 0,
    trimJib: 0,
  };
  const pos = new THREE.Vector2(); // spostamento percorso nel mondo
  let furl = 0; // quanto il fiocco è avvolto mentre è su una vela da poppa
  const keys = new Set();

  // ---------- Interfaccia ----------
  const hud = document.getElementById("sail-hud");
  const $ = (sel) => hud.querySelector(sel);
  const mainRange = $("#hud-main");
  const jibRange = $("#hud-jib");
  const jibLabel = $("[data-jib-label]");
  const mainSheet = $('[data-sheet="main"]');
  const jibSheet = $('[data-sheet="jib"]');
  // tacche dello strumento del vento: ogni 10°, più lunghe ogni 30°
  const ticks = $("[data-ticks]");
  for (let a = 0; a < 360; a += 10) {
    const major = a % 30 === 0;
    const r = (a * Math.PI) / 180;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const r0 = major ? 47 : 50;
    line.setAttribute("x1", (Math.sin(r) * r0).toFixed(2));
    line.setAttribute("y1", (-Math.cos(r) * r0).toFixed(2));
    line.setAttribute("x2", (Math.sin(r) * 54).toFixed(2));
    line.setAttribute("y2", (-Math.cos(r) * 54).toFixed(2));
    if (major) line.setAttribute("class", "major");
    ticks.appendChild(line);
  }
  mainRange.addEventListener("input", () => (st.mainEase = mainRange.value / 100));
  jibRange.addEventListener("input", () => (st.jibEase = jibRange.value / 100));
  // timone dai bottoni: tenuti premuti, anche col dito
  hud.querySelectorAll("[data-steer]").forEach((b) => {
    const dir = Number(b.dataset.steer);
    const on = (e) => {
      e.preventDefault();
      b.setPointerCapture?.(e.pointerId);
      st.btnSteer = dir;
    };
    const off = () => {
      if (st.btnSteer === dir) st.btnSteer = 0;
    };
    b.addEventListener("pointerdown", on);
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("lostpointercapture", off);
  });
  hud.querySelectorAll("[data-kite]").forEach((b) => b.addEventListener("click", () => toggleKite(b.dataset.kite)));

  function toggleKite(name) {
    const k = kites[name];
    const hoisting = k.target === 0;
    for (const [n, other] of Object.entries(kites)) other.target = n === name && hoisting ? 1 : 0;
    syncKiteButtons();
  }
  function syncKiteButtons() {
    hud.querySelectorAll("[data-kite]").forEach((b) => {
      const up = kites[b.dataset.kite].target === 1;
      b.setAttribute("aria-pressed", String(up));
      b.textContent = `${up ? "Ammaina" : "Issa"} ${b.dataset.kite}`;
    });
    const flying = Object.values(kites).some((k) => k.target === 1);
    jibLabel.textContent = flying ? "Scotta del " + (kites.gennaker.target ? "gennaker" : "spinnaker") : "Fiocco";
  }

  const KEYS = { ArrowLeft: 1, ArrowRight: 1, a: 1, d: 1, w: 1, s: 1, q: 1, e: 1, g: 1, p: 1 };
  addEventListener("keydown", (e) => {
    if (!st.active || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!KEYS[k] || e.target instanceof HTMLInputElement && (k === "ArrowLeft" || k === "ArrowRight")) return;
    e.preventDefault();
    if (k === "g" && !e.repeat) toggleKite("gennaker");
    else if (k === "p" && !e.repeat) toggleKite("spinnaker");
    else keys.add(k);
  });
  addEventListener("keyup", (e) => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
  addEventListener("blur", () => keys.clear());

  const fmt = (n, d = 1) => n.toFixed(d).replace(".", ",");
  const sideWord = (a) => (a >= 0 ? "dritta" : "sinistra");
  function pointOfSail(twa) {
    const a = Math.abs(twa);
    if (a < 32) return "Controvento: le vele fileggiano";
    if (a < 60) return "Bolina";
    if (a < 80) return "Bolina larga";
    if (a < 110) return "Traverso";
    if (a < 150) return "Lasco";
    return "Poppa";
  }
  // stesse soglie per la parola e per il colore: oltre ±0,14 dalla regolazione ideale
  const TRIM_OK = 0.14;
  const trimWord = (d) => (d > TRIM_OK ? "troppo lasca" : d < -TRIM_OK ? "troppo cazzata" : "regolata bene");

  let hudTick = 0;
  function updateHud() {
    if (performance.now() - hudTick < 120) return;
    hudTick = performance.now();
    $("[data-speed]").textContent = fmt(st.speed / KN);
    $("[data-pos]").textContent = pointOfSail(st.twa);
    $("[data-tw]").textContent = `${Math.round(Math.abs(st.twa))}° a ${sideWord(st.twa)}`;
    $("[data-aw]").textContent = `${Math.round(Math.abs(st.awa))}° · ${fmt(st.aws / KN, 0)} kn`;
    $("[data-trim-main]").textContent = trimWord(st.trimMain);
    $("[data-trim-main]").dataset.state = Math.abs(st.trimMain) > TRIM_OK ? "off" : "ok";
    $("[data-trim-jib]").textContent = trimWord(st.trimJib);
    $("[data-trim-jib]").dataset.state = Math.abs(st.trimJib) > TRIM_OK ? "off" : "ok";
    // bussola: la prua è in alto, le frecce indicano da dove arriva il vento
    $("[data-wind-true]").setAttribute("transform", `rotate(${st.twa.toFixed(1)})`);
    $("[data-wind-app]").setAttribute("transform", `rotate(${st.awa.toFixed(1)})`);
    // fascia verde sulla corsa: la regolazione giusta per l'andatura, ±TRIM_OK attorno all'ideale
    const band = (el, ideal) => {
      el.style.setProperty("--from", `${(Math.max(0, ideal - TRIM_OK) * 100).toFixed(1)}%`);
      el.style.setProperty("--to", `${(Math.min(1, ideal + TRIM_OK) * 100).toFixed(1)}%`);
    };
    band(mainSheet, st.mainIdeal ?? 0);
    band(jibSheet, st.jibIdeal ?? 0);
    $("[data-rudder]").style.setProperty("--steer", st.steer.toFixed(3));
    if (document.activeElement !== mainRange) mainRange.value = Math.round(st.mainEase * 100);
    if (document.activeElement !== jibRange) jibRange.value = Math.round(st.jibEase * 100);
  }

  // ---------- Avvio e fine ----------
  function start(cond) {
    st.active = true;
    document.documentElement.classList.add("sailing");
    // si riparte dalla rotta attuale, con vele regolate per l'andatura e velocità quasi di polare
    const twa = R2D(wrap(WIND_FROM - st.heading));
    st.speed = Math.max(st.speed, polarSpeed(twa, cond.knots) * KN * 0.8);
    // le scotte si regolano sul vento apparente al primo fotogramma di gioco
    st.autoTrim = true;
    syncKiteButtons();
  }
  function stop() {
    st.active = false;
    keys.clear();
    st.btnSteer = 0;
    for (const k of Object.values(kites)) k.target = 0;
    document.documentElement.classList.remove("sailing");
  }

  return {
    get active() {
      return st.active;
    },
    /**
     * Da chiamare a ogni fotogramma. on: la vista Navigazione dell'esplorazione è attiva.
     * Restituisce rotta, velocità (m/s) e sbandata (gradi, null se decide la pagina a scroll).
     */
    update(dt, on, cond) {
      dt = Math.min(dt, 0.1);
      // al primo fotogramma l'acqua parte già alla velocità delle condizioni, come prima
      if (st.speed === 0 && !on) st.speed = cond.flow;
      if (on && !st.active) start(cond);
      if (!on && st.active) stop();

      const tws = cond.knots;
      let heelTarget = null;

      if (st.active) {
        // ---- comandi
        const steerIn = (keys.has("ArrowLeft") || keys.has("a") ? -1 : 0) + (keys.has("ArrowRight") || keys.has("d") ? 1 : 0) + (st.btnSteer || 0);
        st.steer += (clamp(steerIn, -1, 1) - st.steer) * Math.min(1, dt * 4);
        if (keys.has("w")) st.mainEase -= SHEET_RATE * dt;
        if (keys.has("s")) st.mainEase += SHEET_RATE * dt;
        if (keys.has("q")) st.jibEase -= SHEET_RATE * dt;
        if (keys.has("e")) st.jibEase += SHEET_RATE * dt;
        st.mainEase = clamp(st.mainEase, 0, 1);
        st.jibEase = clamp(st.jibEase, 0, 1);

        // ---- governo: si gira tanto più quanto più si va veloci (il timone ha bisogno d'acqua)
        const kn = st.speed / KN;
        st.heading = wrap(st.heading + D2R(TURN_RATE) * st.steer * (0.25 + 0.75 * Math.min(1, kn / 6)) * dt);

        // ---- vento reale e apparente (angoli con segno: positivo = da dritta)
        const twa = wrap(WIND_FROM - st.heading);
        const ax = -tws * KN * Math.cos(twa) - st.speed;
        const az = -tws * KN * Math.sin(twa);
        st.twa = R2D(twa);
        st.awa = R2D(Math.atan2(-az, -ax));
        st.aws = Math.hypot(ax, az);

        if (st.autoTrim) {
          st.mainEase = st.jibEase = idealEase(st.awa);
          st.autoTrim = false;
        }

        // ---- vele
        const kiteName = kites.gennaker.target ? "gennaker" : kites.spinnaker.target ? "spinnaker" : null;
        const a = Math.abs(st.twa);
        const eff = (ease, ideal) => Math.exp(-(((ease - ideal) / 0.2) ** 2));
        const mainIdeal = idealEase(st.awa);
        st.mainIdeal = mainIdeal;
        st.trimMain = st.mainEase - mainIdeal;
        let power;
        let bonus = 1;
        let broach = 0;
        if (kiteName) {
          const kiteIdeal = idealEase(st.awa, 40, 120);
          st.jibIdeal = kiteIdeal;
          st.trimJib = st.jibEase - kiteIdeal;
          const kEff = eff(st.jibEase, kiteIdeal);
          if (kiteName === "gennaker") {
            bonus = a < 70 ? 0.8 : 1 + 0.2 * bell(a, 115, 40);
            broach = a < 70 ? smooth(70, 50, a) * 6 : 0;
          } else {
            bonus = a < 100 ? 0.62 : 1 + 0.3 * bell(a, 150, 35);
            broach = a < 100 ? smooth(100, 75, a) * 10 : 0;
          }
          // la vela da poppa conta solo quando è su del tutto
          const up = kites[kiteName].up;
          power = 0.4 * eff(st.mainEase, mainIdeal) + 0.6 * lerp(eff(st.jibEase, idealEase(st.awa)), kEff, up);
          bonus = lerp(1, bonus, up);
          broach *= up;
        } else {
          const jibIdeal = idealEase(st.awa);
          st.jibIdeal = jibIdeal;
          st.trimJib = st.jibEase - jibIdeal;
          power = 0.55 * eff(st.mainEase, mainIdeal) + 0.45 * eff(st.jibEase, jibIdeal);
        }
        const irons = smooth(36, 26, a); // controvento
        st.luffMain = Math.max(irons, smooth(0.08, 0.3, st.trimMain));
        st.luffJib = Math.max(irons, kiteName ? 0 : smooth(0.08, 0.3, st.trimJib));
        const stall = Math.max(smooth(0.12, 0.35, -st.trimMain), smooth(0.12, 0.35, -st.trimJib));

        // ---- velocità: verso quella di polare per l'efficienza, con l'inerzia di 36 tonnellate
        const target = polarSpeed(st.twa, tws) * KN * (0.25 + 0.75 * power) * bonus;
        st.speed += (target - st.speed) * (1 - Math.exp(-dt / 3.5));

        // ---- sbandata: forte di bolina, leggera in poppa; cresce se si stalla o la vela da poppa strappa
        const side = st.twa >= 0 ? -1 : 1; // vele e sbandata sottovento
        const close = 0.25 + 0.75 * (1 - smooth(40, 170, a));
        heelTarget = side * (cond.heel * close * (0.5 + 0.5 * power) * (1 - irons) + stall * 5 + broach);
        st.heel += (heelTarget - st.heel) * Math.min(1, dt * 1.5);

        // ---- angoli delle vele: sottovento, aperti quanto la scotta è lascata
        st.mainTarget = side * (D2R(4) + st.mainEase * D2R(80));
        st.jibTarget = side * (D2R(3) + st.jibEase * D2R(55));
        for (const [name, k] of Object.entries(kites)) {
          k.side = side;
          k.trim = st.jibEase;
          k.collapse = name === "gennaker" ? smooth(70, 50, a) : smooth(105, 80, a);
        }
      } else {
        // ---- pagina a scroll o altre viste: si torna alla rotta dritta e alla regolazione del modello
        st.heading = wrap(st.heading * Math.exp(-dt * 2.2));
        if (Math.abs(st.heading) < 1e-4) st.heading = 0;
        st.speed += (cond.flow - st.speed) * (1 - Math.exp(-dt * 1.5));
        st.mainTarget = mainBase;
        st.jibTarget = jibBase;
        st.luffMain = st.luffJib = 0;
        st.heel += (0 - st.heel) * Math.min(1, dt * 2);
        if (Math.abs(st.heel) < 0.05) st.heel = 0;
      }

      // ---- vele che si spostano: con il segno che cambia passano dal centro (virata, abbattuta)
      const approach = (cur, tgt, rate) => cur + clamp(tgt - cur, -rate * dt, rate * dt);
      st.mainAngle = approach(st.mainAngle, st.mainTarget, D2R(70));
      st.jibAngle = approach(st.jibAngle, st.jibTarget, D2R(110));
      const mainSide = st.mainAngle >= 0 ? 1 : -1;
      mainPivot.scale.z = mainSide;
      mainPivot.rotation.y = mainSide * (Math.abs(st.mainAngle) - mainBase);
      const jibSide = st.jibAngle >= 0 ? 1 : -1;
      jibPivot.scale.z = jibSide;
      jibPivot.quaternion.copy(jibQ.setFromAxisAngle(stay, jibSign * jibSide * (Math.abs(st.jibAngle) - jibBase)));
      // le scotte valgono solo con le vele come nel modello
      const asModel = Math.abs(st.mainAngle - mainBase) < 1e-3 && Math.abs(st.jibAngle - jibBase) < 1e-3;
      for (const r of rigging?.sheets ?? []) r.visible = asModel;

      // ---- gennaker e spinnaker: si issano dalla penna in giù, il fiocco intanto si avvolge
      furl = 0;
      const t = performance.now() / 1000;
      for (const k of Object.values(kites)) {
        k.up = clamp(k.up + Math.sign(k.target - k.up) * dt / 2.2, 0, 1);
        const h = k.up * k.up * (3 - 2 * k.up);
        k.pivot.visible = h > 0.01;
        if (!k.pivot.visible) continue;
        furl = Math.max(furl, h);
        const flog = (k.collapse || 0) * (0.5 + 0.5 * Math.sin(t * 9));
        const breathe = 1 + 0.02 * Math.sin(t * 2.1);
        k.pivot.scale.set(h, h, h * (k.side || 1) * (1 - 0.55 * flog) * breathe);
        k.pivot.rotation.y = (k.side || 1) * ((k.trim ?? 0.5) - 0.5) * 0.45;
      }

      // ---- la barca ruota, l'acqua le scorre sotto lungo la prua
      boat.rotation.y = -st.heading;
      pos.x += Math.cos(st.heading) * st.speed * dt;
      pos.y += Math.sin(st.heading) * st.speed * dt;
      ocean.setCourse(st.heading, pos);

      if (st.active) updateHud();
      return { heading: st.heading, speed: st.speed, heel: st.active || st.heel !== 0 ? st.heel : null };
    },
    /**
     * Dopo il ciclo delle vele di main.js. Interviene solo in navigazione libera (o mentre se ne esce):
     * fileggiare per vela e fiocco avvolto sotto gennaker e spinnaker. Altrimenti la pagina a scroll
     * resta com'è.
     */
    applySails(t) {
      // a metà issata della vela da poppa il fiocco è già avvolto
      if (furl > 0.5) for (const m of jibMeshes) m.visible = false;
      if (!st.active && st.luffMain === 0 && st.luffJib === 0) return;
      const flutter = (x) => x * (0.78 + 0.22 * Math.sin(t * 7.0) * Math.sin(t * 2.3));
      for (const m of mainMeshes) m.morphTargetInfluences[0] = flutter(st.luffMain);
      for (const m of jibMeshes) m.morphTargetInfluences[0] = flutter(st.luffJib);
    },
  };
}
