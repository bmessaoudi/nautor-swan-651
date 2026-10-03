import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { SKY } from "./ocean.js";
import { makeRng } from "./conditions.js";

// Fauna del capitolo Navigazione: gabbiani reali attorno all'albero e lontani, tursiopi che
// saltano davanti alla prua. Modelli con scheletro (scripts/blender/fauna.py), compressi con
// meshopt e caricati in modo asincrono: finché non arrivano, la scena va avanti senza.
// - Gabbiani: due animazioni (Flap, Glide) mescolate con i pesi, così si passa dal battito
//   alla planata senza scatti. Col vento planano di più e sbandano a raffiche.
// - Delfini: solo con mare calmo o medio (forza 5 al massimo) e senza pioggia.
// Tutto segue la dissolvenza uOpacity e la foschia della chunk SKY, come il paesaggio.

const URL_GULL = "/models/fauna/gull.glb";
const URL_DOLPHIN = "/models/fauna/dolphin.glb";
const G = 9.81;
const BOW = 9.6; // prua dello Swan 651 rispetto all'origine della barca (x)

// Materiale standard (sole, cielo e mappa d'ambiente come lo scafo) più la foschia della scena
function faunaMaterial(shared, roughness) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, transparent: true });
  m.onBeforeCompile = (sh) => {
    for (const k of ["uZenith", "uHorizon", "uSunDir", "uSunCol", "uFogNear", "uFogFar", "uFogHeight"]) sh.uniforms[k] = shared[k];
    sh.vertexShader = "varying vec3 vFaunaW;\n" + sh.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n  vFaunaW = (modelMatrix * vec4(transformed, 1.0)).xyz;"
    );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vFaunaW;\n${SKY}`)
      .replace(
        "#include <opaque_fragment>",
        `// luce riflessa dal mare e diffusa dall'aria: in controluce pance e ali non diventano nere
  outgoingLight += diffuseColor.rgb * uHorizon * 0.14;
  #include <opaque_fragment>
  // prospettiva aerea come in landscape.js: i gabbiani lontani si sciolgono nel cielo
  float fDist = length(vFaunaW.xz - cameraPosition.xz);
  float fAerial = max(hazeAmount(vFaunaW), (1.0 - exp(-fDist / 750.0)) * 0.82);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor(vFaunaW), fAerial);`
      );
  };
  return m;
}

// Spruzzi dei delfini: punti che volano e ricadono, presi da un piccolo serbatoio
const splashVert = /* glsl */ `
attribute float aLife;
attribute float aSize;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * 900.0 / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const splashFrag = /* glsl */ `
uniform float uOpacity;
uniform vec3 uSunCol;
uniform vec3 uHorizon;
varying float vLife;
void main() {
  if (vLife <= 0.0) discard;
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d) * vLife * 0.75;
  vec3 col = mix(uHorizon, vec3(1.0), 0.6) * 0.75 + uSunCol * 0.25;
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

function createSplash(shared, count = 260) {
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const size = new Float32Array(count);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aLife", new THREE.BufferAttribute(life, 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const pts = new THREE.Points(
    g,
    new THREE.ShaderMaterial({
      vertexShader: splashVert,
      fragmentShader: splashFrag,
      uniforms: { uOpacity: shared.uOpacity, uSunCol: shared.uSunCol, uHorizon: shared.uHorizon },
      transparent: true,
      depthWrite: false,
    })
  );
  pts.frustumCulled = false;
  let next = 0;
  return {
    points: pts,
    emit(x, y, z, dirX, n, strength) {
      for (let i = 0; i < n; i++) {
        const k = next;
        next = (next + 1) % count;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 0.35;
        pos.set([x + Math.cos(a) * r, y, z + Math.sin(a) * r], k * 3);
        const up = (1.5 + Math.random() * 2.5) * strength;
        const out = (0.4 + Math.random() * 1.2) * strength;
        vel.set([Math.cos(a) * out + dirX * strength * 1.5, up, Math.sin(a) * out], k * 3);
        life[k] = 1;
        size[k] = 0.05 + Math.random() * 0.09;
      }
    },
    update(dt) {
      let alive = false;
      for (let k = 0; k < count; k++) {
        if (life[k] <= 0) continue;
        alive = true;
        vel[k * 3 + 1] -= G * dt;
        pos[k * 3] += vel[k * 3] * dt;
        pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
        pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
        life[k] -= dt * 1.1;
        if (pos[k * 3 + 1] < -0.2) life[k] = 0;
      }
      if (alive) {
        g.attributes.position.needsUpdate = true;
        g.attributes.aLife.needsUpdate = true;
        g.attributes.aSize.needsUpdate = true;
      }
    },
    clear() {
      life.fill(0);
      g.attributes.aLife.needsUpdate = true;
    },
  };
}

export function createFauna(shared) {
  const group = new THREE.Group(); // gabbiani: attorno all'albero, non seguono la rotta
  const pod = new THREE.Group(); // delfini: ruotano con la prua nella navigazione libera
  group.add(pod);
  const gullMat = faunaMaterial(shared, 0.85);
  const dolphinMat = faunaMaterial(shared, 0.32); // pelle bagnata: riflette il cielo
  const splash = createSplash(shared);
  pod.add(splash.points);

  let models = null;
  let cond = null;
  let gulls = [];
  let dolphins = [];
  let podState = null;

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  Promise.all([load(URL_GULL), load(URL_DOLPHIN)])
    .then(([gull, dolphin]) => {
      models = { gull, dolphin };
      if (cond) populate();
    })
    .catch((err) => console.warn("Fauna non caricata", err));

  function instance(gltf, mat) {
    const root = cloneSkinned(gltf.scene);
    root.traverse((o) => {
      if (o.isMesh) {
        o.material = mat;
        o.castShadow = true;
      }
    });
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
    return { root, mixer, actions };
  }

  function clear() {
    for (const q of [...gulls, ...dolphins]) {
      q.mixer.stopAllAction();
      q.root.removeFromParent();
    }
    gulls = [];
    dolphins = [];
    podState = null;
    splash.clear();
  }

  function populate() {
    clear();
    const c = cond;
    // generatore proprio: non sposta le estrazioni del paesaggio, che usa c.rng
    const rng = makeRng((c.seed * 7919 + 17) >>> 0);
    const wind = THREE.MathUtils.clamp((c.knots - 6) / 18, 0, 1);

    // Gabbiani vicini: 3-8 attorno all'albero (con la pioggia pochi), qualcuno lontano
    const near = c.rain ? rng.int(1, 3) : rng.int(3, 8);
    const far = c.rain ? 0 : rng.int(2, 6);
    for (let i = 0; i < near + far; i++) {
      const isFar = i >= near;
      const b = instance(models.gull, gullMat);
      const speed = rng.range(7, 10.5); // velocità di crociera di un gabbiano reale, m/s
      // i vicini girano attorno all'albero fuori dalle vele (raggio 13 m e oltre, centro quasi
      // sull'albero) e all'altezza delle vele, così entrano nelle inquadrature del capitolo
      const r = isFar ? rng.range(70, 220) : rng.range(13, 32);
      const q = {
        ...b,
        far: isFar,
        cx: isFar ? rng.range(-150, 150) : rng.range(-3, 3),
        cz: isFar ? rng.range(-150, 150) : rng.range(-3, 3),
        r,
        dir: rng() < 0.5 ? -1 : 1,
        w: speed / r,
        a: rng() * Math.PI * 2,
        wob: rng.range(0.08, 0.2),
        wobF: rng.range(0.05, 0.15),
        y: isFar ? rng.range(10, 45) : rng.range(7, 20),
        yLo: isFar ? 8 : 5,
        yHi: isFar ? 55 : 24,
        vy: 0,
        phase: rng() * 100,
        flap: rng() < 0.5 ? 1 : 0, // peso attuale del battito (1) rispetto alla planata (0)
        flapping: rng() < 0.5,
        timer: rng.range(0.5, 4),
        wind,
        scale: rng.range(1.1, 1.3), // apertura 1,55-1,8 m: gabbiano reale grande o mugnaiaccio
        pos: new THREE.Vector3(),
        // il primo del gruppo è "curioso": gira fra la camera e l'albero, così almeno uno si vede da vicino
        curious: i === 0 && !isFar,
      };
      b.root.scale.setScalar(q.scale);
      // fasi sfalsate: ogni gabbiano parte da un punto diverso del ciclo e batte a un ritmo suo
      const fl = b.actions.Flap;
      const gl = b.actions.Glide;
      fl.play();
      gl.play();
      fl.time = rng() * fl.getClip().duration;
      gl.time = rng() * gl.getClip().duration;
      fl.timeScale = rng.range(0.88, 1.12);
      gl.timeScale = rng.range(0.7, 1.1);
      b.root.traverse((o) => {
        if (o.isMesh) o.castShadow = !isFar;
      });
      group.add(b.root);
      gulls.push(q);
    }

    // Delfini: solo con mare calmo o medio, e non sempre
    if (!c.rain && c.force <= 5 && rng() < 0.8) {
      const n = rng.int(2, 4);
      for (let i = 0; i < n; i++) {
        const b = instance(models.dolphin, dolphinMat);
        b.actions.Swim.play();
        b.actions.Swim.time = rng() * b.actions.Swim.getClip().duration;
        b.root.visible = false;
        b.root.scale.setScalar(rng.range(0.85, 1.05));
        pod.add(b.root);
        dolphins.push({ ...b, jump: null, lane: (i % 2 ? 1 : -1) * rng.range(1.6, 3.8), ahead: rng.range(1, 6) });
      }
      podState = { rng, wait: rng.range(3, 7), calm: 1 - THREE.MathUtils.clamp((c.force - 2) / 4, 0, 0.6) };
    }
  }

  // Un salto: arco balistico da sotto la superficie, il corpo segue la tangente
  function startJump(d, delay, rng) {
    const h = rng.range(1.0, 2.0) * podState.calm + 0.4;
    const vy = Math.sqrt(2 * G * (h + 0.9));
    d.jump = {
      t: -delay,
      T: (2 * vy) / G,
      vy,
      x0: BOW + d.ahead + rng.range(-1, 1),
      vx: rng.range(2.8, 4.2), // un po' più veloci della barca: la superano saltando
      z: d.lane + rng.range(-0.5, 0.5),
      y0: -0.9,
      splashIn: false,
      splashOut: false,
    };
  }

  function updateGull(q, t, dt, cam) {
    if (q.curious && cam) {
      // centro del giro a metà strada verso la camera, inseguito piano: niente scatti quando la camera si muove
      // il cerchio resta comunque a 11 m dall'albero: mai dentro le vele
      const dist = Math.max(Math.hypot(cam.position.x, cam.position.z), 1);
      q.r = THREE.MathUtils.clamp(dist * 0.22, 7, 16);
      const dc = Math.max(dist * 0.45, 11 + q.r);
      const k = q.placed ? Math.min(1, dt * 0.25) : 1; // la prima volta si piazza subito
      q.cx += ((cam.position.x / dist) * dc - q.cx) * k;
      q.cz += ((cam.position.z / dist) * dc - q.cz) * k;
      q.w = 8 / q.r;
      // quota poco sopra la camera: si vede contro il cielo, non sparisce oltre il bordo alto
      q.yLo = Math.max(4, cam.position.y + 2);
      q.yHi = q.yLo + 7;
      if (!q.placed) q.y = q.yLo + 3;
      q.placed = true;
    }
    // battito e planata a turni: col vento si plana più a lungo, con la pioggia si batte di più
    q.timer -= dt;
    if (q.timer <= 0) {
      q.flapping = !q.flapping;
      const glideLong = 2.5 + q.wind * 6 + (q.far ? 3 : 0);
      q.timer = q.flapping ? 1.2 + Math.random() * 2.8 * (1 - q.wind * 0.5) : glideLong * (0.5 + Math.random());
    }
    // sotto la fascia di quota si torna a battere, sopra si plana
    if (q.y < q.yLo) q.flapping = true;
    if (q.y > q.yHi) q.flapping = false;
    q.flap += ((q.flapping ? 1 : 0) - q.flap) * Math.min(1, dt * 2.5);
    q.actions.Flap.setEffectiveWeight(q.flap);
    q.actions.Glide.setEffectiveWeight(1 - q.flap);

    // quota: sale battendo, scende piano in planata; col vento le termiche la sostengono
    const targetVy = q.flap * 0.9 - (1 - q.flap) * (0.45 - q.wind * 0.3);
    q.vy += (targetVy - q.vy) * Math.min(1, dt * 1.5);
    q.y += q.vy * dt;

    // giro attorno al centro, con il raggio che respira: niente cerchi da compasso
    q.a += q.dir * q.w * dt;
    const rr = q.r * (1 + q.wob * Math.sin(t * q.wobF + q.phase));
    const x = q.cx + Math.cos(q.a) * rr;
    const z = q.cz + Math.sin(q.a) * rr;
    const dx = x - q.pos.x;
    const dz = z - q.pos.z;
    const first = q.pos.lengthSq() === 0;
    q.pos.set(x, q.y, z);
    q.root.position.copy(q.pos);
    if (first) return;
    const hv = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
    const yaw = Math.atan2(-dz, dx);
    // sbandata della virata coordinata (tan = v^2 / r g), più le raffiche col vento forte
    const bank = Math.atan((hv * hv) / (rr * G));
    const gust = q.wind * 0.22 * (Math.sin(t * 2.3 + q.phase) * 0.6 + Math.sin(t * 5.1 + q.phase * 1.7) * 0.4);
    // virata verso il centro: a destra (rollio positivo) se il centro sta alla destra del muso
    const rightX = Math.sin(yaw), rightZ = Math.cos(yaw); // +Z del modello è la destra
    const side = Math.sign((q.cx - x) * rightX + (q.cz - z) * rightZ) || 1;
    const pitch = Math.atan2(q.vy, Math.max(hv, 1)) * 0.8;
    q.root.rotation.set(side * bank + gust, yaw, pitch, "YZX");
  }

  function updatePod(t, dt) {
    if (!podState) return;
    const rng = podState.rng;
    podState.wait -= dt;
    if (podState.wait <= 0 && dolphins.every((d) => !d.jump)) {
      // un gruppo che salta in sequenza, a volte due volte di fila
      let delay = 0;
      for (const d of dolphins) {
        if (rng() < 0.85) startJump(d, delay, rng);
        delay += rng.range(0.15, 0.6);
      }
      podState.wait = rng.range(7, 16);
    }
    for (const d of dolphins) {
      const j = d.jump;
      if (!j) continue;
      j.t += dt;
      if (j.t < 0) continue;
      if (j.t > j.T + 0.35) {
        d.jump = null;
        d.root.visible = false;
        // a volte ripartono subito, come fanno davanti alle prue
        if (rng() < 0.35) startJump(d, rng.range(0.6, 1.2), rng);
        continue;
      }
      const y = j.y0 + j.vy * j.t - 0.5 * G * j.t * j.t;
      const x = j.x0 + j.vx * j.t;
      const vy = j.vy - G * j.t;
      d.root.visible = true;
      d.root.position.set(x, y, j.z);
      // assetto lungo la traiettoria, con un filo di rollio
      d.root.rotation.set(Math.sin(j.t * 2) * 0.08, 0, Math.atan2(vy, j.vx * 1.6), "YZX");
      // in aria la coda si ferma quasi: l'animazione rallenta fuori dall'acqua
      d.actions.Swim.timeScale = y > 0 ? 0.35 : 1.4;
      if (!j.splashIn && vy > 0 && y > -0.15) {
        j.splashIn = true;
        splash.emit(x + 0.9, 0, j.z, 1, 26, 0.9);
      }
      if (!j.splashOut && vy < 0 && y < 0.2) {
        j.splashOut = true;
        splash.emit(x + 0.6, 0, j.z, 1, 40, 1.1);
      }
    }
    splash.update(dt);
  }

  const api = {
    group,
    // Le condizioni cambiano col seme: si ricostruisce tutto, appena i modelli ci sono
    build(c) {
      cond = c;
      if (models) populate();
    },
    // cam: per il gabbiano curioso; heading: rotta della navigazione libera (sailing.js),
    // i delfini restano davanti alla prua
    update(t, dt, opacity, cam, heading = 0) {
      const vis = opacity > 0.005 && !!models;
      group.visible = vis;
      if (!vis) return;
      gullMat.opacity = dolphinMat.opacity = opacity;
      dt = Math.min(dt, 0.1); // dopo una scheda in secondo piano niente salti
      pod.rotation.y = -heading;
      for (const q of gulls) {
        updateGull(q, t, dt, cam);
        q.mixer.update(dt);
      }
      updatePod(t, dt);
      for (const d of dolphins) if (d.root.visible) d.mixer.update(dt);
    },
  };
  // per le verifiche dalla console: stato di gabbiani e delfini
  if (import.meta.env.DEV) window.__fauna = { api, get gulls() { return gulls; }, get dolphins() { return dolphins; }, get pod() { return podState; } };
  return api;
}
