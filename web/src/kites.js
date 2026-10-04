import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Spinnaker, gennaker e tangone da models/kites.glb (scripts/blender/swan651_kites.py), con il loro
// materiale e le cime che li tengono. La regia (angoli, issata, shape key) sta in sailing.js.
//
// Materiale: MeshStandardMaterial con due aggiunte economiche nello shader.
// - Controluce: quando la camera guarda la faccia in ombra, il sole che passa attraverso la tela la
//   schiarisce del colore del telo. Il canale alfa della texture è la trasparenza della tela (1 uno
//   strato, meno su cuciture, nastri e rinforzi), quindi in trasparenza quei punti si vedono più scuri.
//   Niente MeshPhysicalMaterial.transmission: costa un secondo passaggio di rendering.
// - Bordi liberi che vibrano: onde lungo la balumina (e l'inferitura dello spinnaker, che è libera
//   come la balumina) e lungo la base, ferme in penna. Come uWindSail in materials.js.

const loader = new GLTFLoader();

const kiteVert = /* glsl */ `
  // ampiezza in metri delle onde sui bordi liberi; nel gennaker l'inferitura è inferita allo strallo virtuale
  float kEdge = uKiteMode < 0.5
    ? max(smoothstep(0.84, 1.0, uv.x), smoothstep(0.16, 0.0, uv.x))
    : smoothstep(0.72, 1.0, uv.x);
  // in three la v del glTF è rovesciata: 0 in penna, 1 alla base
  kEdge = max(kEdge, 0.7 * smoothstep(0.88, 1.0, uv.y));
  kEdge *= smoothstep(0.0, 0.18, uv.y);
  transformed += objectNormal * kEdge * uKiteWind * 0.07 * (
    sin(dot(position, vec3(0.55, 0.9, 0.4)) * 1.6 + uTime * 8.0) * 0.65 +
    sin(position.y * 2.7 - uTime * 12.5) * 0.35);
`;

const kiteFrag = /* glsl */ `
  #if NUM_DIR_LIGHTS > 0
  {
    // il sole (la prima luce direzionale è quella che fa ombra) dall'altra parte della tela
    vec3 kL = directionalLights[0].direction;
    float kBack = saturate(-dot(geometryNormal, kL));
    // più forte quando si guarda verso il sole attraverso la vela
    float kFwd = pow(saturate(dot(-geometryViewDir, kL)), 3.0);
    vec3 kTint = diffuseColor.rgb * mix(vec3(1.0), diffuseColor.rgb, 0.35);
    reflectedLight.directDiffuse += directionalLights[0].color * kTint * kTrans * kBack * (0.32 + 0.55 * kFwd) * uKiteBack;
  }
  #endif
`;

/** Materiale della vela: parte da quello del glb (texture tri-radial) e aggiunge controluce e onde. */
function kiteMaterial(src, { clipping, uTime, uWind, uBack, mode }) {
  const map = src.map;
  map.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({
    name: src.name,
    map,
    roughness: 0.62,
    metalness: 0,
    side: THREE.DoubleSide,
    clippingPlanes: clipping,
    clipShadows: true,
  });
  const uniforms = { uTime, uKiteWind: uWind, uKiteMode: { value: mode }, uKiteBack: uBack };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uKiteWind;\nuniform float uKiteMode;")
      .replace("#include <project_vertex>", kiteVert + "\n#include <project_vertex>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uKiteBack;")
      // l'alfa della texture è la trasparenza della tela, non l'opacità della vela
      .replace("#include <map_fragment>", "#include <map_fragment>\nfloat kTrans = diffuseColor.a;\ndiffuseColor.a = opacity;")
      .replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\n" + kiteFrag);
  };
  mat.customProgramCacheKey = () => "kite";
  return mat;
}

/**
 * Carica il glb. Restituisce una promessa con le tre mesh (fuori da ogni gruppo, posizione azzerata)
 * e i punti notevoli dagli extras: perno (posizione originale del nodo), mura, bugna, penna.
 */
export function loadKites({ clipping, layer, uTime }) {
  const uWind = { value: 0 };
  const uBack = { value: 1 }; // intensità del controluce, comune alle due vele
  return loader.loadAsync("/models/kites.glb").then((gltf) => {
    const out = { uWind, uBack };
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const info = { ...o.userData, pivot: o.position.clone() };
      o.position.set(0, 0, 0);
      o.layers.enable(layer);
      o.castShadow = true;
      o.receiveShadow = false;
      if (o.name === "SpinnakerPole") {
        o.material = new THREE.MeshStandardMaterial({
          color: 0xcfd2d5, metalness: 0.85, roughness: 0.3, clippingPlanes: clipping, clipShadows: true,
        });
        out.pole = { mesh: o, length: info.length };
        return;
      }
      o.material = kiteMaterial(o.material, { clipping, uTime, uWind, uBack, mode: o.name === "Spinnaker" ? 0 : 1 });
      // shape key e onde spostano la tela oltre la sfera della forma piena
      o.geometry.computeBoundingSphere();
      o.geometry.boundingSphere.radius *= 1.25;
      const dict = o.morphTargetDictionary;
      out[o.name.toLowerCase()] = {
        mesh: o,
        info,
        curl: dict.Arricciata,
        flat: dict.Sventata,
      };
    });
    return out;
  });
}

/** Posizione di un vertice con gli shape key attuali (glTF: morph relativi), nel riferimento della mesh. */
export function morphedVertex(mesh, index, target) {
  const g = mesh.geometry;
  target.fromBufferAttribute(g.attributes.position, index);
  const inf = mesh.morphTargetInfluences;
  const morphs = g.morphAttributes.position;
  for (let i = 0; i < morphs.length; i++) {
    if (inf[i]) {
      target.x += morphs[i].getX(index) * inf[i];
      target.y += morphs[i].getY(index) * inf[i];
      target.z += morphs[i].getZ(index) * inf[i];
    }
  }
  return target;
}

const ropeMat = new Map();
/**
 * Cima che cambia forma a ogni fotogramma: un tubo a quattro facce su una spezzata, con i vertici
 * riscritti nello stesso buffer (niente geometria nuova per fotogramma).
 */
export class Rope {
  constructor({ segments = 20, radius = 0.012, color = 0xe9e5da, clipping, layer }) {
    this.n = segments;
    this.r = radius;
    const verts = (segments + 1) * 4;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < segments; i++) {
      for (let k = 0; k < 4; k++) {
        const a = i * 4 + k;
        const b = i * 4 + ((k + 1) % 4);
        idx.push(a, a + 4, b, b, a + 4, b + 4);
      }
    }
    g.setIndex(idx);
    const key = color;
    if (!ropeMat.has(key)) ropeMat.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, clippingPlanes: clipping, clipShadows: true }));
    this.mesh = new THREE.Mesh(g, ropeMat.get(key));
    this.mesh.frustumCulled = false;
    this.mesh.layers.enable(layer);
    this.pts = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
    this._t = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
  }

  /**
   * Spezzata per i punti dati, ognuno con il suo lasco: sag[i] è la freccia (metri) del tratto i,
   * una parabola verso il basso. I segmenti si distribuiscono sui tratti in proporzione alla lunghezza.
   */
  set(points, sag = []) {
    const lens = [];
    let tot = 0;
    for (let i = 1; i < points.length; i++) {
      const l = points[i].distanceTo(points[i - 1]);
      lens.push(l);
      tot += l;
    }
    const segs = lens.length;
    const counts = lens.map((l) => Math.max(1, Math.round((this.n * l) / Math.max(tot, 1e-6))));
    // il conto torna sempre a n: si aggiusta il tratto più lungo
    let extra = this.n - counts.reduce((a, b) => a + b, 0);
    while (extra !== 0) {
      let best = 0;
      for (let s = 1; s < segs; s++) if (lens[s] > lens[best] && (extra > 0 || counts[s] > 1)) best = s;
      if (extra < 0 && counts[best] <= 1) break;
      counts[best] += Math.sign(extra);
      extra -= Math.sign(extra);
    }
    let k = 0;
    for (let s = 0; s < segs && k < this.n; s++) {
      const m = counts[s];
      for (let j = 0; j < m && k < this.n; j++, k++) {
        const t = j / m;
        const p = this.pts[k];
        p.lerpVectors(points[s], points[s + 1], t);
        p.y -= 4 * (sag[s] || 0) * t * (1 - t);
      }
    }
    for (; k <= this.n; k++) this.pts[k].copy(points[points.length - 1]);
    this.write();
  }

  write() {
    const pos = this.mesh.geometry.attributes.position;
    const nor = this.mesh.geometry.attributes.normal;
    const { pts, r, _t: t, _a: a, _b: b } = this;
    for (let i = 0; i <= this.n; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[Math.min(this.n, i + 1)];
      t.subVectors(p1, p0);
      if (t.lengthSq() < 1e-10) t.set(0, 1, 0);
      t.normalize();
      // una perpendicolare qualsiasi, stabile: si parte dall'alto o dal lato se la cima è verticale
      a.set(0, 1, 0);
      if (Math.abs(t.y) > 0.9) a.set(1, 0, 0);
      a.cross(t).normalize();
      b.crossVectors(t, a);
      for (let k = 0; k < 4; k++) {
        const ang = (k * Math.PI) / 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const nx = a.x * c + b.x * s;
        const ny = a.y * c + b.y * s;
        const nz = a.z * c + b.z * s;
        const v = i * 4 + k;
        nor.setXYZ(v, nx, ny, nz);
        pos.setXYZ(v, pts[i].x + nx * r, pts[i].y + ny * r, pts[i].z + nz * r);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
  }
}
