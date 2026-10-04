import * as THREE from "three";
import { POLAR } from "./charts.js";
import { loadKites, morphedVertex, Rope } from "./kites.js";

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
const MAST_FRONT = 1.89; // faccia di prua dell'albero, dove scorre il carrello del tangone

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

  // ---------- Gennaker e spinnaker (kites.js, models/kites.glb) ----------
  // Si caricano a parte: finché non arrivano il gioco va avanti e i bottoni issano vele che non ci sono
  // ancora. Costruite con la bugna a dritta; dall'altra parte si specchiano come le altre vele.
  // Ogni vela sta in tre gruppi: root nel suo perno (penna dello spinnaker sull'asse dell'albero, mura
  // del gennaker sul musone), pivot per l'angolo e lo specchio, hoist per l'issata (scala lungo l'asse
  // della vela: verticale per lo spinnaker, inferitura per il gennaker).
  const kites = {
    gennaker: { up: 0, target: 0, ready: false },
    spinnaker: { up: 0, target: 0, ready: false },
  };
  let pole = null;
  const ropes = [];
  loadKites({ clipping, layer, uTime: ocean.shared.uTime })
    .then((K) => {
      kiteWind = K.uWind;
      for (const name of ["spinnaker", "gennaker"]) {
        const src = K[name];
        const k = kites[name];
        k.mesh = src.mesh;
        k.info = src.info;
        k.curl = src.curl;
        k.flat = src.flat;
        k.root = new THREE.Group();
        k.root.position.copy(src.info.pivot);
        k.pivot = new THREE.Group();
        k.hoist = new THREE.Group(); // scala nel riferimento dell'asse
        k.axisIn = new THREE.Group(); // riporta nel riferimento della vela
        // asse della vela: verticale per lo spinnaker, dalla mura alla penna per il gennaker
        k.axis = name === "spinnaker" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(...src.info.head).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), k.axis);
        k.hoist.quaternion.copy(q);
        k.axisIn.quaternion.copy(q).invert();
        k.root.add(k.pivot);
        k.pivot.add(k.hoist);
        k.hoist.add(k.axisIn);
        k.axisIn.add(k.mesh);
        k.root.visible = false;
        boat.add(k.root);
        // l'esportatore riordina i vertici: mura e bugna si cercano negli angoli delle UV (base: v = 1)
        k.tackIdx = uvCorner(src.mesh, 0, 1);
        k.clewIdx = uvCorner(src.mesh, 1, 1);
        k.ready = true;
      }
      // il gennaker si apre ruotando attorno all'inferitura: verso che porta la bugna sottovento (+z)
      const g = kites.gennaker;
      const clew = new THREE.Vector3(...g.info.clew);
      g.openSign = clew.clone().applyAxisAngle(g.axis, 0.1).z > clew.z ? 1 : -1;
      // spinnaker: angolo della mura nel modello (gradi da prua, sopravvento), il tangone parte da lì
      const s = kites.spinnaker;
      const tack = new THREE.Vector3(...s.info.tack);
      s.tackAngle = Math.atan2(-tack.z, tack.x);
      s.tackRadius = Math.hypot(tack.x, tack.z);
      s.tackY = s.info.pivot.y + tack.y;
      pole = { mesh: K.pole.mesh, length: K.pole.length };
      pole.mesh.visible = false;
      boat.add(pole.mesh);
      const R = (o) => {
        const r = new Rope({ clipping, layer, ...o });
        r.mesh.visible = false;
        boat.add(r.mesh);
        ropes.push(r);
        return r;
      };
      // cime: braccio e scotta in poliestere chiaro, caricabasso e amantiglio più sottili e scuri
      s.guy = R({ segments: 24, radius: 0.012 });
      s.sheet = R({ segments: 28, radius: 0.012, color: 0xdfe2e6 });
      s.downhaul = R({ segments: 6, radius: 0.009, color: 0x2a3440 });
      s.lift = R({ segments: 8, radius: 0.008, color: 0x2a3440 });
      g.sheet = R({ segments: 28, radius: 0.012, color: 0xdfe2e6 });
      g.tackLine = R({ segments: 4, radius: 0.012, color: 0x2a3440 });
      if (import.meta.env.DEV) window.__kites = { kites, pole, st, K };
    })
    .catch((err) => console.error("Vele da poppa non caricate", err));
  let kiteWind = null;

  // vertice più vicino a un angolo delle UV (u corda, v rovesciata dal glTF: 0 in penna, 1 alla base)
  function uvCorner(mesh, u, v) {
    const uv = mesh.geometry.attributes.uv;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < uv.count; i++) {
      const d = (uv.getX(i) - u) ** 2 + (uv.getY(i) - v) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

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

  // ---------- Cime delle vele da poppa (riferimento della barca) ----------
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const tmpA = new THREE.Vector3();
  const tackP = new THREE.Vector3();
  const clewP = new THREE.Vector3();
  const poleFoot = new THREE.Vector3();
  const poleTip = new THREE.Vector3();
  const poleDir = new THREE.Vector3();
  const liftTop = new THREE.Vector3();
  const X_AXIS = new THREE.Vector3(1, 0, 0);
  // bozzello di poppa e verricello della scotta, bozzello al traverso e verricello del braccio
  const SHEET_BLOCK = V3(-8.3, 1.5, 1.95);
  const SHEET_WINCH = V3(-4.6, 1.78, 1.95);
  const GUY_BLOCK = V3(-0.8, 1.6, 2.45);
  const GUY_WINCH = V3(-3.6, 1.78, 1.95);
  const STEM = V3(9.94, 1.9, 0);
  const DOWNHAUL_FOOT = V3(MAST.x + 1.1, 1.85, 0);
  const onSide = (v, s) => new THREE.Vector3(v.x, v.y, v.z * s);
  const sides = { 1: {}, [-1]: {} };
  for (const s of [1, -1]) {
    sides[s] = { sheetBlock: onSide(SHEET_BLOCK, s), sheetWinch: onSide(SHEET_WINCH, s), guyBlock: onSide(GUY_BLOCK, s), guyWinch: onSide(GUY_WINCH, s) };
  }
  const vertexInBoat = (mesh, idx, out) => boat.worldToLocal(mesh.localToWorld(morphedVertex(mesh, idx, out)));
  const downhaulTop = new THREE.Vector3();
  const liftFoot = new THREE.Vector3();

  function kiteLines(name, k, sgn, h2) {
    vertexInBoat(k.mesh, k.tackIdx, tackP);
    vertexInBoat(k.mesh, k.clewIdx, clewP);
    // scotta: dalla bugna al bozzello di poppa sottovento, poi al verricello; più lasca se si lasca
    const lee = sides[sgn];
    const sheetSag = 0.15 + 0.9 * Math.max(0, k.delta || 0) + 0.6 * (1 - h2);
    k.sheet.set([clewP, lee.sheetBlock, lee.sheetWinch], [sheetSag, 0.02]);
    k.sheet.mesh.visible = true;
    if (name === "gennaker") {
      k.tackLine.set([STEM, tackP]);
      k.tackLine.mesh.visible = true;
      return;
    }
    // tangone: dall'attacco sull'albero verso la mura della vela piena (non di quella che sale)
    poleFoot.set(MAST_FRONT, k.tackY - 0.35, 0);
    // in abbattuta la varea scende e passa sotto lo strallo da un lato all'altro (poleSide da ±1 a 0)
    const ps = k.poleSide;
    tmpA.set(MAST.x + Math.cos(k.poleAng) * k.tackRadius, k.tackY - 2.6 * (1 - Math.abs(ps)), -ps * Math.sin(k.poleAng) * k.tackRadius);
    // all'inizio dell'issata il tangone si alza dalla coperta, puntato a prua
    const deploy = smooth(0, 0.35, k.up);
    poleTip.set(MAST.x + k.tackRadius * 0.98, 2.1, 0).lerp(tmpA, deploy);
    poleDir.subVectors(poleTip, poleFoot);
    const len = poleDir.length();
    pole.mesh.position.copy(poleFoot);
    pole.mesh.quaternion.setFromUnitVectors(X_AXIS, poleDir.divideScalar(len));
    pole.mesh.scale.set(len / pole.length, 1, 1);
    // braccio: dalla mura alla varea del tangone, al bozzello al traverso sopravvento, al verricello
    const wind = sides[-sgn];
    k.guy.set([tackP, poleTip, wind.guyBlock, wind.guyWinch], [0.02 + 0.4 * (1 - h2), 0, 0.02]);
    // caricabasso dalla varea alla coperta davanti all'albero, amantiglio da metà tangone all'albero
    k.downhaul.set([downhaulTop.copy(poleFoot).lerp(poleTip, 0.92), DOWNHAUL_FOOT]);
    k.lift.set([liftFoot.copy(poleFoot).lerp(poleTip, 0.5), liftTop.set(MAST_FRONT, k.tackY + 7.5, 0)]);
    for (const r of [k.guy, k.downhaul, k.lift]) r.mesh.visible = true;
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
          k.awa = Math.abs(st.awa);
          // scostamento della scotta dalla regolazione ideale della vela da poppa (positivo = lasca)
          k.delta = kiteName === name ? st.trimJib : 0;
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

      // ---- gennaker e spinnaker
      furl = 0;
      const t = performance.now() / 1000;
      if (kiteWind) kiteWind.value = clamp(st.aws / KN / 18, 0.3, 1.1);
      for (const [name, k] of Object.entries(kites)) {
        // un'issata dura circa quattro secondi, l'ammainata uguale
        k.up = clamp(k.up + Math.sign(k.target - k.up) * dt / 4.2, 0, 1);
        if (!k.ready) continue;
        const vis = k.up > 0.002;
        k.root.visible = vis;
        if (name === "spinnaker" && pole) pole.mesh.visible = vis;
        if (!vis) {
          for (const r of name === "spinnaker" ? [k.guy, k.sheet, k.downhaul, k.lift] : [k.sheet, k.tackLine]) r.mesh.visible = false;
          k.poleAng = k.sgn = null;
          continue;
        }
        furl = Math.max(furl, smooth(0, 0.6, k.up));
        // abbattuta. Lo spinnaker è simmetrico: ruota attorno all'albero fino a stare dritto davanti alla
        // prua, lì mura e bugna si scambiano (la vela specchiata è identica) e riparte dall'altra parte;
        // il tangone intanto passa sotto lo strallo (abbattuta a tangone immerso, quella dei 65 piedi).
        // Il gennaker non è simmetrico: passa dal centro sventando, la bugna gira davanti allo strallo
        const want = k.side ?? 1;
        if (k.sgn == null) k.sgn = k.poleSide = k.sideS = want;
        let gybe = 0;
        if (name === "spinnaker") {
          if (want !== k.sgn && k.poleAng != null && Math.abs(k.poleAng - k.tackAngle) < D2R(1.5)) k.sgn = want;
          k.poleSide = approach(k.poleSide, k.sgn === want ? want : 0, 1.4);
          gybe = 1 - Math.abs(k.poleSide);
          k.pivot.scale.z = k.sgn;
        } else {
          k.sideS = approach(k.sideS, want, 1.1);
          k.sgn = k.sideS >= 0 ? 1 : -1;
          gybe = 1 - Math.abs(k.sideS);
          k.pivot.scale.z = k.sgn * Math.max(0.12, Math.abs(k.sideS));
        }
        const sgn = k.sgn;
        // issata: prima sale la penna con la vela chiusa nella calza, poi la tela si apre e si gonfia
        const h1 = smooth(0, 0.62, k.up);
        const h2 = smooth(0.5, 1, k.up);
        k.hoist.scale.set(lerp(0.06, 1, h2), lerp(0.04, 1, h1), lerp(0.06, 1, h2));

        // shape key: arricciata con la scotta troppo lasca, sventata stretta al vento, a metà issata o
        // mentre si abbatte. Regolata bene l'inferitura è appena sul punto di arricciarsi, come vuole la
        // regolazione vera
        const curl = (0.1 + 0.9 * smooth(0.06, 0.3, k.delta || 0)) * (0.8 + 0.2 * Math.sin(t * 2.6));
        let flat = (k.collapse || 0) * (0.62 + 0.38 * Math.sin(t * 4.7) * Math.sin(t * 1.3 + 0.5));
        flat = Math.max(flat, 1 - h2, (name === "spinnaker" ? 0.35 : 0.9) * smooth(0, 0.5, gybe));
        k.mesh.morphTargetInfluences[k.curl] = curl * (1 - flat);
        k.mesh.morphTargetInfluences[k.flat] = flat;
        if (import.meta.env.DEV && window.__kites?.force) Object.assign(k.mesh.morphTargetInfluences, window.__kites.force);

        if (name === "spinnaker") {
          // tangone perpendicolare al vento apparente sul lato sopravvento (da 10° dallo strallo al
          // traverso); la scotta lo sposta: lascandola la bugna va avanti e il tangone indietro
          const ideal = clamp((k.awa ?? 180) - 90, 10, 82);
          // in abbattuta la vela va prima al centro (penna, mura e bugna simmetriche rispetto alla prua)
          const target = want !== sgn ? k.tackAngle : D2R(clamp(ideal + (k.delta || 0) * 45, 6, 88));
          k.poleAng = k.poleAng == null ? target : approach(k.poleAng, target, D2R(want !== sgn ? 45 : 30));
          k.pivot.rotation.y = sgn * (k.poleAng - k.tackAngle);
          k.root.position.y = lerp(k.tackY + 1.2, k.info.pivot.y, h1);
        } else {
          // il gennaker si apre attorno all'inferitura quanto la scotta è lascata
          const open = (st.active ? st.jibEase - 0.42 : 0) * D2R(55);
          k.pivot.quaternion.setFromAxisAngle(k.axis, sgn * k.openSign * open);
        }
        k.root.updateMatrixWorld(true);
        kiteLines(name, k, sgn, h2);
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
