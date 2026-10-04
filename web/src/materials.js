import * as THREE from "three";
import { WATER_GLSL } from "./ocean.js";

// Materiali del modello, rifiniti nel browser senza toccare il GLB.
// Molte mesh (coperta, scafo esterno, alberatura) non hanno UV: le texture si proiettano in
// triplanare nello spazio della barca, quindi seguono la barca quando sbanda.
// - Texture vere CC0 di Poly Haven (teak, pelle, maglina di cotone), normalizzate sulla loro
//   media: aggiungono venatura e grana senza cambiare i colori scelti per Lunz am Meer.
// - Dettagli procedurali: buccia d'arancia del gelcoat, fibre e cuciture delle vele in laminato,
//   antivegetativa non uniforme, spazzolatura dell'alluminio.
// - Bagnato solo dove arriva l'acqua (idea di Crimson Desert): fascia sopra il galleggiamento
//   che segue le onde, spruzzi a prua, coperta umida verso prua.

const TEX = "/textures/";

// Onde: la stessa acqua FFT del mare (ocean.js), solo l'altezza. Vicino allo scafo le onde sono
// già più basse (waterFade), come nel mare disegnato
const WAVE_GLSL = /* glsl */ `
uniform float uTime;
${WATER_GLSL}
`;

const NOISE_GLSL = /* glsl */ `
float mHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float mNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mHash(i), mHash(i + vec3(1,0,0)), f.x), mix(mHash(i + vec3(0,1,0)), mHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(mHash(i + vec3(0,0,1)), mHash(i + vec3(1,0,1)), f.x), mix(mHash(i + vec3(0,1,1)), mHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
vec3 mNoiseGrad(vec3 p, float e) {
  float n = mNoise(p);
  return vec3(mNoise(p + vec3(e, 0, 0)) - n, mNoise(p + vec3(0, e, 0)) - n, mNoise(p + vec3(0, 0, e)) - n) / e;
}
`;

const TRI_GLSL = /* glsl */ `
vec3 triWeights(vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); return w / (w.x + w.y + w.z); }
// uv per piano. Con TRI_VERTICAL la venatura sulle facce verticali corre in verticale
vec2 triUvX(vec3 p) {
  #ifdef TRI_VERTICAL
  return p.yz;
  #else
  return p.zy;
  #endif
}
vec2 triUvZ(vec3 p) {
  #ifdef TRI_VERTICAL
  return p.yx;
  #else
  return p.xy;
  #endif
}
vec4 triSample(sampler2D t, vec3 p, vec3 w, float s) {
  return texture2D(t, triUvX(p) * s) * w.x + texture2D(t, p.xz * s) * w.y + texture2D(t, triUvZ(p) * s) * w.z;
}
// normal map triplanare con blend UDN: perturbazione nello spazio della barca
vec3 triNormal(sampler2D t, vec3 p, vec3 n, vec3 w, float s, float k) {
  vec2 tx = texture2D(t, triUvX(p) * s).xy * 2.0 - 1.0;
  vec2 ty = texture2D(t, p.xz * s).xy * 2.0 - 1.0;
  vec2 tz = texture2D(t, triUvZ(p) * s).xy * 2.0 - 1.0;
  #ifdef TRI_VERTICAL
  vec3 px = vec3(0.0, tx.x, tx.y);
  vec3 pz = vec3(tz.y, tz.x, 0.0);
  #else
  vec3 px = vec3(0.0, tx.y, tx.x);
  vec3 pz = vec3(tz.x, tz.y, 0.0);
  #endif
  vec3 py = vec3(ty.x, 0.0, ty.y);
  return normalize(n + (px * w.x + py * w.y + pz * w.z) * k);
}
`;

const loader = new THREE.TextureLoader();
function tex(name, srgb = false) {
  const t = loader.load(TEX + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

// Ricette per nome del materiale nel GLB.
// map/normal/rough: texture; mean: media della texture (per normalizzarla); scale: ripetizioni al metro.
function recipes() {
  const teak = { map: tex("teak_veneer_diff.jpg", true), normal: tex("teak_veneer_nor_gl.jpg"), rough: tex("teak_veneer_rough.jpg") };
  const leather = { normal: tex("leather_red_02_nor_gl.jpg"), rough: tex("leather_red_02_rough.jpg") };
  const cotton = { map: tex("cotton_jersey_diff.jpg", true), normal: tex("cotton_jersey_nor_gl.jpg"), rough: tex("cotton_jersey_rough.jpg") };
  const deck = { map: tex("teak_deck.png", true) };
  const TEAK_MEAN = [0.688, 0.509, 0.34];
  return {
    Interior_Teak_Honey: { ...teak, mean: TEAK_MEAN, roughMean: 0.655, scale: 1.4, normalK: 0.35, detail: 1, vertical: true },
    // la coperta: doghe da prua a poppa dalla texture già fatta, venatura dal teak di Poly Haven
    Teak_Deck: { map: deck.map, mean: [0.618, 0.485, 0.339], normal: teak.normal, scale: 1, normalScale: 2, normalK: 0.25, detail: 1, deck: true },
    Upholstery_Leather_Red: { ...leather, roughMean: 0.508, scale: 2.5, normalK: 0.9, sheen: [0.35, 0x8a2a2a, 0.5], physical: true },
    Mattress_Cream: { ...cotton, mean: [0.761, 0.669, 0.616], roughMean: 0.802, scale: 5, normalK: 0.6, detail: 0.6, sheen: [0.6, 0xfff3e0, 0.7], physical: true },
    Headliner_White_Vinyl: { normal: leather.normal, scale: 7, normalK: 0.35 },
    Gelcoat_White: { orangePeel: 0.02, wet: true },
    Hull_Paint: { orangePeel: 0.02, wet: true },
    Stripe_Red: { orangePeel: 0.02, wet: true },
    Antifouling_Red: { mottle: 0.18, wet: true },
    Keel_Antifoul: { mottle: 0.18, wet: true },
    Sail_Laminate: { laminate: true },
    Spar_Aluminium: { brushed: true },
    Toerail_Aluminium: { brushed: true },
  };
}

export function createMaterials(oceanShared, water) {
  const R = recipes();
  // uniformi comuni: la barca (per lo spazio triplanare) e lo stato del mare
  const common = {
    uBoatInv: { value: new THREE.Matrix4() },
    uBoatRot: { value: new THREE.Matrix3() },
    uWet: { value: 0 },
    uWindSail: { value: 0 },
    uRain: { value: 0 },
    uTime: oceanShared.uTime,
    uFlow: oceanShared.uFlow,
    // mappe dell'acqua FFT, lati delle cascate e rotta (ocean.waves, da leggere con WATER_GLSL)
    ...water,
  };

  function patch(mat, r) {
    const defines = mat.defines || (mat.defines = {});
    if (r.vertical) defines.TRI_VERTICAL = "";
    const u = {
      uTriMap: { value: r.map || null },
      uTriNormal: { value: r.normal || null },
      uTriRough: { value: r.rough || null },
      // le medie sono misurate sui file (sRGB), la texture si legge in lineare: si convertono
      uTriMean: { value: new THREE.Vector3().setFromColor(new THREE.Color().setRGB(...(r.mean || [1, 1, 1]), THREE.SRGBColorSpace)) },
      uTriRoughMean: { value: r.roughMean || 1 },
      uTriScale: { value: r.scale || 1 },
      uTriNormalScale: { value: r.normalScale || r.scale || 1 },
      uTriNormalK: { value: r.normalK || 0 },
      uTriDetail: { value: r.detail ?? 0 },
    };
    if (r.map) defines.TRI_MAP = "";
    if (r.normal) defines.TRI_NORMAL = "";
    if (r.rough) defines.TRI_ROUGH = "";
    if (r.orangePeel) defines.ORANGE_PEEL = r.orangePeel.toFixed(3);
    if (r.mottle) defines.MOTTLE = r.mottle.toFixed(3);
    if (r.laminate) defines.LAMINATE = "";
    if (r.brushed) defines.BRUSHED = "";
    if (r.wet) defines.WET_HULL = "";
    if (r.deck) defines.WET_DECK = "";
    if (r.wet && r.orangePeel) defines.BACK_LINING = "";

    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, common, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform mat4 uBoatInv;
          uniform float uWindSail;
          uniform float uTime;
          #ifdef LAMINATE
          attribute float aLeech;
          #endif
          varying vec3 vTriPos;
          varying vec3 vTriNrm;
          varying vec3 vWetW;`
        )
        .replace(
          "#include <project_vertex>",
          `#ifdef LAMINATE
          // la balumina vibra con il vento: onde che corrono verso poppa, ferme all'inferitura
          float lee = smoothstep(0.55, 1.0, aLeech);
          transformed += objectNormal * (sin(dot(position.xy, vec2(1.6, 0.7)) * 2.2 + uTime * 9.0) * 0.6
            + sin(position.y * 4.1 + uTime * 13.0) * 0.4) * 0.03 * uWindSail * lee;
          #endif
          #include <project_vertex>`
        )
        .replace(
          "#include <fog_vertex>",
          `#include <fog_vertex>
          vec4 triW = modelMatrix * vec4(transformed, 1.0);
          vWetW = triW.xyz;
          vTriPos = (uBoatInv * triW).xyz;
          vTriNrm = normalize(mat3(uBoatInv) * mat3(modelMatrix) * objectNormal);`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
          uniform mat3 uBoatRot;
          uniform float uWet;
          uniform float uRain;
          uniform sampler2D uTriMap;
          uniform sampler2D uTriNormal;
          uniform sampler2D uTriRough;
          uniform vec3 uTriMean;
          uniform float uTriRoughMean;
          uniform float uTriScale;
          uniform float uTriNormalScale;
          uniform float uTriNormalK;
          uniform float uTriDetail;
          varying vec3 vTriPos;
          varying vec3 vTriNrm;
          varying vec3 vWetW;
          ${WAVE_GLSL}
          ${NOISE_GLSL}
          ${TRI_GLSL}
          float wetMask() {
            #if defined(WET_HULL)
            // altezza sopra l'onda in quel punto; la fascia è più alta a prua per gli spruzzi
            if (!gl_FrontFacing) return 0.0;
            float above = vWetW.y - waterHeight(vWetW.xz);
            float bow = smoothstep(3.0, 9.0, vTriPos.x);
            float reach = 0.25 + 0.35 * mNoise(vec3(vTriPos.x * 0.7, 0.0, vTriPos.z * 2.0)) + bow * 0.9;
            // colature verticali sotto la fascia bagnata
            float drip = smoothstep(0.55, 0.9, mNoise(vec3(vTriPos.x * 9.0, vTriPos.y * 0.8, vTriPos.z * 9.0)));
            float sea = uWet * clamp(1.0 - smoothstep(0.0, reach, above) + drip * (1.0 - smoothstep(0.0, reach * 2.2, above)) * 0.6, 0.0, 1.0);
            // con la pioggia tutto lo scafo è lucido d'acqua, a rigoli
            return max(sea, uRain * (0.6 + 0.3 * drip));
            #elif defined(WET_DECK)
            // coperta umida a prua, a chiazze, più sul lato sottovento (più basso)
            float bow = smoothstep(2.0, 8.5, vTriPos.x);
            float lee = smoothstep(1.4, -0.2, vWetW.y);
            float patches = smoothstep(0.35, 0.75, mNoise(vTriPos * vec3(0.9, 0.9, 1.6)));
            return max(uWet * clamp(bow * patches + lee * 0.6, 0.0, 1.0), uRain * (0.8 + 0.2 * patches));
            #else
            return 0.0;
            #endif
          }`
        )
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
          vec3 triN = normalize(vTriNrm) * (gl_FrontFacing ? 1.0 : -1.0);
          vec3 triWgt = triWeights(triN);
          #ifdef TRI_MAP
          vec3 triCol = triSample(uTriMap, vTriPos, triWgt, uTriScale).rgb / uTriMean;
          diffuseColor.rgb *= mix(vec3(1.0), triCol, uTriDetail);
          #endif
          #ifdef MOTTLE
          // antivegetativa: chiazze e aloni, mai un colore uniforme
          diffuseColor.rgb *= 1.0 - MOTTLE * (mNoise(vTriPos * 1.3) * 0.6 + mNoise(vTriPos * 7.0) * 0.4);
          #endif
          #ifdef LAMINATE
          // vela in laminato: fibre nere a losanga nel piano della vela, cuciture orizzontali
          vec2 sp = vTriPos.xy;
          // le fibre si aprono a ventaglio dalla testa della vela, con spaziatura irregolare
          vec2 head = vec2(1.0, 27.0);
          float ang = atan(sp.x - head.x, head.y - sp.y);
          float jit = mNoise(vec3(sp * 0.35, 1.0)) * 0.6;
          float f1 = abs(fract(ang * 38.0 + jit) - 0.5);
          float f2 = abs(fract(dot(sp, vec2(-0.8, 0.6)) * 1.6 + jit) - 0.5);
          float fibre = max(smoothstep(0.05, 0.0, f1), smoothstep(0.03, 0.0, f2) * 0.6) * (0.6 + 0.4 * mNoise(vec3(sp * 3.0, 2.0)));
          float seam = smoothstep(0.012, 0.0, abs(fract(sp.y / 1.35) - 0.5) - 0.488);
          diffuseColor.rgb *= 1.0 - fibre * 0.13 - seam * 0.16;
          #endif
          #ifdef BACK_LINING
          // l'interno del guscio non ha le fasce della vernice esterna: è il rivestimento crema
          if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.68, 0.6, 0.47);
          #endif
          float wet = wetMask();
          // bagnato: più scuro e saturo, quasi a specchio
          diffuseColor.rgb = mix(diffuseColor.rgb, pow(diffuseColor.rgb, vec3(1.25)) * 0.82, wet);`
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
          #ifdef TRI_ROUGH
          roughnessFactor = clamp(roughnessFactor * triSample(uTriRough, vTriPos, triWgt, uTriScale).r / uTriRoughMean, 0.04, 1.0);
          #endif
          #ifdef BRUSHED
          // spazzolatura lungo l'asse del pezzo: righe fini di ruvidità
          roughnessFactor *= 0.8 + 0.4 * mNoise(vec3(vTriPos.x * 0.6, vTriPos.y * 0.6 + vTriPos.z * 140.0, vTriPos.z * 0.6));
          #endif
          #ifdef LAMINATE
          roughnessFactor = mix(roughnessFactor, 0.35, fibre * 0.6);
          #endif
          roughnessFactor = mix(roughnessFactor, 0.06, wet);`
        )
        .replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
          {
            vec3 nb = triN;
            #ifdef TRI_NORMAL
            nb = triNormal(uTriNormal, vTriPos, nb, triWgt, uTriNormalScale, uTriNormalK * (1.0 - wet * 0.7));
            #endif
            #ifdef ORANGE_PEEL
            // buccia d'arancia del gelcoat: si vede solo nei riflessi radenti
            nb = normalize(nb + mNoiseGrad(vTriPos * 38.0, 0.05) * ORANGE_PEEL * (1.0 - wet));
            #endif
            #if defined(TRI_NORMAL) || defined(ORANGE_PEEL)
            normal = normalize((viewMatrix * vec4(uBoatRot * nb, 0.0)).xyz);
            #endif
          }`
        );
      if (mat.isMeshPhysicalMaterial && mat.clearcoat > 0) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <clearcoat_normal_fragment_maps>",
          `#include <clearcoat_normal_fragment_maps>
          #ifdef ORANGE_PEEL
          clearcoatNormal = normalize(clearcoatNormal + (viewMatrix * vec4(uBoatRot * mNoiseGrad(vTriPos * 38.0, 0.05), 0.0)).xyz * ORANGE_PEEL * 0.6 * (1.0 - wet));
          #endif`
        );
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <lights_physical_fragment>",
          `#include <lights_physical_fragment>
          material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.03, wet);`
        );
      }
    };
    mat.customProgramCacheKey = () => mat.name + JSON.stringify(defines);
    mat.needsUpdate = true;
  }

  return {
    common,
    // Sostituisce o rifinisce un materiale; restituisce quello da usare sulla mesh
    upgrade(mat) {
      const r = R[mat.name];
      if (!r) return mat;
      let m = mat;
      if (r.physical && !mat.isMeshPhysicalMaterial) {
        m = new THREE.MeshPhysicalMaterial();
        THREE.MeshStandardMaterial.prototype.copy.call(m, mat);
        m.name = mat.name;
      }
      if (r.sheen) {
        m.sheen = r.sheen[0];
        m.sheenColor = new THREE.Color(r.sheen[1]);
        m.sheenRoughness = r.sheen[2];
      }
      patch(m, r);
      return m;
    },
    update(boat, wet, wind, rain = 0) {
      common.uBoatInv.value.copy(boat.matrixWorld).invert();
      common.uBoatRot.value.setFromMatrix4(boat.matrixWorld);
      common.uWet.value = wet;
      common.uWindSail.value = wind;
      common.uRain.value = rain;
    },
  };
}
