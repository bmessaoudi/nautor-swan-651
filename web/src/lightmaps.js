import * as THREE from "three";

// Luce cotta degli interni (scripts/blender/bake_interior.py).
// GLTFLoader non importa le lightmap: dopo il caricamento si assegnano a mano alle mesh degli
// interni, che hanno il secondo set di UV (TEXCOORD_1, attributo uv1).
// - lightMap: irradianza a barca chiusa (oblò, tambucci, plafoniere calde), normalizzata in 8 bit;
//   interior.json dice il fattore per tornare al valore vero.
// - aoMap: occlusione ambientale, scurisce la luce indiretta dello studio e del cielo negli angoli.
// I materiali degli interni si clonano: alcuni (acciaio) sono condivisi con l'esterno, che non ha uv1.

const DIR = "/models/lightmaps/";

// taratura a occhio sulle foto: la luce cotta si somma a sole, cielo e mappa d'ambiente
const LIGHT_K = 0.3;
const AO_K = 0.9;
// livello a luci spente (resta il giorno da oblò e tambucci)
const OFF_LEVEL = 0.4;

export function createLightmaps() {
  const mats = [];
  let base = 0;
  let level = 1;
  let meta = null;

  function setIntensity() {
    for (const m of mats) m.lightMapIntensity = base * level;
  }

  return {
    // Carica le mappe e le aggancia alle mesh Interior* di root. Senza mappe non fa nulla.
    async apply(root) {
      try {
        meta = await (await fetch(DIR + "interior.json")).json();
      } catch {
        return false;
      }
      const loader = new THREE.TextureLoader();
      const load = (name) =>
        new Promise((res, rej) =>
          loader.load(DIR + name, (t) => {
            // come le texture glTF: niente capovolgimento, uv del secondo set
            t.flipY = false;
            t.channel = 1;
            t.colorSpace = THREE.SRGBColorSpace;
            // isole a 2 pixel l'una dall'altra: le mipmap mescolerebbero superfici vicine
            t.generateMipmaps = false;
            t.minFilter = THREE.LinearFilter;
            res(t);
          }, undefined, rej)
        );
      let light, ao;
      try {
        [light, ao] = await Promise.all([load(meta.light), load(meta.ao)]);
      } catch {
        return false;
      }
      // irradianza di Cycles -> lightMap di three (diffusa di Lambert: fattore pi greco)
      base = meta.scale * Math.PI * LIGHT_K;
      const clones = new Map();
      const cloneFor = (m) => {
        if (clones.has(m)) return clones.get(m);
        const c = m.clone();
        // clone() non copia la patch di materials.js e duplica i piani di taglio: si riprendono
        c.onBeforeCompile = m.onBeforeCompile;
        c.customProgramCacheKey = m.customProgramCacheKey;
        c.defines = { ...m.defines };
        c.clippingPlanes = m.clippingPlanes;
        c.lightMap = light;
        c.aoMap = ao;
        c.aoMapIntensity = AO_K;
        c.needsUpdate = true;
        clones.set(m, c);
        mats.push(c);
        return c;
      };
      root.traverse((o) => {
        if (!o.isMesh || !o.name.startsWith("Interior") || !o.geometry.attributes.uv1) return;
        o.material = Array.isArray(o.material) ? o.material.map(cloneFor) : cloneFor(o.material);
      });
      setIntensity();
      return true;
    },
    // 0 = plafoniere spente (resta la luce del giorno), 1 = accese
    setLevel(x) {
      level = OFF_LEVEL + (1 - OFF_LEVEL) * Math.min(1, Math.max(0, x));
      setIntensity();
    },
    get ready() {
      return mats.length > 0;
    },
  };
}
