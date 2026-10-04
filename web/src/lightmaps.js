import * as THREE from "three";
import { ktx2Loader } from "./gltf-loader.js";

// Luce cotta degli interni (scripts/blender/bake_interior.py).
// GLTFLoader non importa le lightmap: dopo il caricamento si assegnano a mano alle mesh degli
// interni, che hanno il secondo set di UV (TEXCOORD_1, attributo uv1).
// - lightMap: irradianza del giorno a barca chiusa (oblò e tambucci), normalizzata in 8 bit;
//   interior.json dice il fattore per tornare al valore vero.
// - aoMap a due canali: R occlusione ambientale (scurisce la luce dello studio e del cielo negli
//   angoli), G luce delle plafoniere senza colore. Le plafoniere le somma lo shader con il colore
//   caldo e un livello che si regola: così si accendono senza luci vere nella scena.
// I materiali degli interni si clonano: alcuni (acciaio) sono condivisi con l'esterno, che non ha uv1.

const DIR = "/models/lightmaps/";

// taratura a occhio sulle foto: la luce cotta si somma a sole, cielo e mappa d'ambiente
const LIGHT_K = 0.8;
const LAMP_K = 0.22;
const AO_K = 1.0;

// Luce diretta (sole e luci dello studio) sulle superfici cotte: ridotta, e scurita negli angoli
// dall'occlusione, altrimenti piatta com'è la sua natura copre la luce cotta
const DIRECT_K = 0.35;
const DIRECT_AO = 1.0;

// Ginocchio sulla luce cotta: sotto i tambucci l'irradianza è dieci volte quella del resto della
// cabina, e i materassi crema finivano nella spalla del tone mapping (pesca con un bordo rosa).
// Sotto KNEE la luce passa quasi intatta, sopra si appiattisce dolcemente.
const KNEE = 1.8;

const LAMP_GLSL = /* glsl */ `
#include <lights_fragment_maps>
#if defined( RE_IndirectDiffuse ) && defined( USE_AOMAP ) && defined( USE_LIGHTMAP )
  vec3 bakedIrr = lightMapIrradiance + uLampColor * texture2D( aoMap, vAoMapUv ).g;
  // sulla luminanza, non canale per canale: altrimenti il canale più alto si schiaccia di più e la tinta gira
  float bakedLum = dot( bakedIrr, vec3( 0.2126, 0.7152, 0.0722 ) );
  irradiance += bakedIrr / ( 1.0 + bakedLum / ${KNEE.toFixed(2)} ) - lightMapIrradiance;
#endif`;

const DIRECT_GLSL = /* glsl */ `
#include <aomap_fragment>
#ifdef USE_AOMAP
  reflectedLight.directDiffuse *= ${DIRECT_K.toFixed(3)} * mix( 1.0, ambientOcclusion, ${DIRECT_AO.toFixed(3)} );
#endif`;

// KTX2 (ETC1S) o WebP: vedi la nota sulla qualità più sotto
const LIGHTMAP_KTX2 = false;

// Le mappe sono .ktx2 (scripts/optimize-glb.mjs --ktx2-dir) o, in mancanza, WebP
function loadTexture(renderer, name) {
  const ktx = name.replace(/\.(webp|png|jpe?g)$/i, ".ktx2");
  const viaKtx = renderer && ktx !== name && LIGHTMAP_KTX2;
  return new Promise((res, rej) => {
    const loader = viaKtx ? ktx2Loader(renderer) : new THREE.TextureLoader();
    loader.load(DIR + (viaKtx ? ktx : name), res, undefined, rej);
  });
}

export function createLightmaps(renderer = null) {
  const mats = [];
  const lampColor = new THREE.Color();
  const lampU = { value: new THREE.Color(0, 0, 0) };
  let base = 0;
  let lampBase = 0;
  let level = 0;

  function update() {
    for (const m of mats) m.lightMapIntensity = base;
    lampU.value.copy(lampColor).multiplyScalar(lampBase * level);
  }

  return {
    // Carica le mappe e le aggancia alle mesh Interior* di root. Senza mappe non fa nulla.
    async apply(root) {
      let meta;
      try {
        meta = await (await fetch(DIR + "interior.json")).json();
      } catch {
        return false;
      }
      let light, ao;
      try {
        [light, ao] = await Promise.all([loadTexture(renderer, meta.light), loadTexture(renderer, meta.ao)]);
      } catch {
        return false;
      }
      for (const t of [light, ao]) {
        // come le texture glTF: niente capovolgimento, uv del secondo set
        t.flipY = false;
        t.channel = 1;
        t.colorSpace = THREE.SRGBColorSpace;
        // isole a pochi pixel l'una dall'altra: le mipmap mescolerebbero superfici vicine
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
        t.needsUpdate = true;
      }
      // irradianza di Cycles -> lightMap di three (diffusa di Lambert: fattore pi greco)
      base = meta.scale * Math.PI * LIGHT_K;
      lampBase = (meta.lampScale || 0) * Math.PI * LAMP_K;
      lampColor.setRGB(...(meta.lampColor || [1, 0.71, 0.42]), THREE.SRGBColorSpace);
      const clones = new Map();
      const cloneFor = (m) => {
        if (clones.has(m)) return clones.get(m);
        const c = m.clone();
        // clone() non copia la patch di materials.js e duplica i piani di taglio: si riprendono
        const patch = m.onBeforeCompile;
        c.onBeforeCompile = (shader, r) => {
          patch.call(c, shader, r);
          shader.fragmentShader = shader.fragmentShader.replace("#include <aomap_fragment>", DIRECT_GLSL);
          shader.uniforms.uLampColor = lampU;
          shader.fragmentShader = "uniform vec3 uLampColor;\n" + shader.fragmentShader.replace("#include <lights_fragment_maps>", LAMP_GLSL);
        };
        const key = m.customProgramCacheKey.bind(m);
        c.customProgramCacheKey = () => key() + "|lightmap";
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
      update();
      return true;
    },
    // plafoniere: 0 spente (resta la luce del giorno), 1 accese
    setLevel(x) {
      level = Math.min(1, Math.max(0, x));
      update();
    },
    get ready() {
      return mats.length > 0;
    },
  };
}
