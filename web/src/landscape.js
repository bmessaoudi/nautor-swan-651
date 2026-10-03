import * as THREE from "three";
import { SKY } from "./ocean.js";

// Paesaggio del capitolo Navigazione, generato dal seme delle condizioni: vele lontane e pioggia.
// Isole e coste sono in terrain.js, nuvole e cielo in sky.js, gabbiani in fauna.js.
// La barca è ferma all'origine e l'acqua scorre verso -X: anche le barche scorrono, e
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

// ---------- Paesaggio ----------

export function createLandscape(shared) {
  const group = new THREE.Group();
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
  let wrap = 2000;
  let flow = 4.6;

  function clear() {
    for (const o of group.children) {
      o.traverse((m) => {
        if (m.geometry) m.geometry.dispose();
        if (m.material && m.material !== sceneryMat) m.material.dispose();
      });
    }
    group.clear();
    if (rain) {
      rain.geometry.dispose();
      rain.material.dispose();
      rainGroup.clear();
      rain = null;
    }
    movers = [];
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
    rain: rainGroup,
    build,
    update(t, opacity) {
      const vis = opacity > 0.005;
      group.visible = rainGroup.visible = vis;
      if (!vis) return;
      sceneryMat.uniforms.uOpacity.value = opacity;
      const span = wrap * 2;
      for (const m of movers) {
        let x = m.x0 - flow * m.speed * t;
        x = ((((x + wrap) % span) + span) % span) - wrap;
        m.mesh.position.x = x;
        m.mesh.position.y = m.bob * Math.sin(t * 0.9 + m.phase);
      }
    },
  };
}
