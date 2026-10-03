import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { SKY } from "./ocean.js";
import { makeRng } from "./conditions.js";

// Fauna del capitolo Navigazione: gabbiani reali attorno all'albero e lontani. Modello con scheletro (scripts/blender/fauna.py), compressi con
// meshopt e caricati in modo asincrono: finché non arrivano, la scena va avanti senza.
// Due animazioni (Flap, Glide) mescolate con i pesi, così si passa dal battito alla planata
// senza scatti. Col vento planano di più e sbandano a raffiche.
// Tutto segue la dissolvenza uOpacity e la foschia della chunk SKY, come il paesaggio.

const URL_GULL = "/models/fauna/gull.glb";
const G = 9.81;

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

export function createFauna(shared) {
  const group = new THREE.Group(); // attorno all'albero, non segue la rotta
  const gullMat = faunaMaterial(shared, 0.85);

  let models = null;
  let cond = null;
  let gulls = [];

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));
  load(URL_GULL)
    .then((gull) => {
      models = { gull };
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
    for (const q of gulls) {
      q.mixer.stopAllAction();
      q.root.removeFromParent();
    }
    gulls = [];
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

  const api = {
    group,
    // Le condizioni cambiano col seme: si ricostruisce tutto, appena i modelli ci sono
    build(c) {
      cond = c;
      if (models) populate();
    },
    // cam: per il gabbiano curioso
    update(t, dt, opacity, cam) {
      const vis = opacity > 0.005 && !!models;
      group.visible = vis;
      if (!vis) return;
      gullMat.opacity = opacity;
      dt = Math.min(dt, 0.1); // dopo una scheda in secondo piano niente salti
      for (const q of gulls) {
        updateGull(q, t, dt, cam);
        q.mixer.update(dt);
      }
    },
  };
  // per le verifiche dalla console: stato dei gabbiani
  if (import.meta.env.DEV) window.__fauna = { api, get gulls() { return gulls; } };
  return api;
}
