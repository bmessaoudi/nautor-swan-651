import * as THREE from "three";
import { WATER_GLSL } from "./ocean.js";

// Materiali del modello, rifiniti nel browser senza toccare il GLB.
// Molte mesh (coperta, scafo esterno, alberatura) non hanno UV: le texture si proiettano in
// triplanare nello spazio della barca, quindi seguono la barca quando sbanda.
// - Texture vere CC0 di Poly Haven (teak, pelle, maglina di cotone), normalizzate sulla loro
//   media: aggiungono venatura e grana senza cambiare i colori scelti per Lunz am Meer.
// - Dettagli procedurali: buccia d'arancia del gelcoat, antivegetativa non uniforme, spazzolatura
//   dell'alluminio.
// - Vele in dacron cross-cut (materiale Sail_Laminate, nome rimasto per compatibilità): atlante
//   di texture generato da scripts/sails/make_sail_textures.py, controluce economico e
//   fileggiare nel vertex shader (vedi SAIL_GLSL).
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
uniform vec2 uTriStretch;
vec4 triSample(sampler2D t, vec3 p, vec3 w, float s) {
  vec2 k = s * uTriStretch;
  return texture2D(t, triUvX(p) * k) * w.x + texture2D(t, p.xz * k) * w.y + texture2D(t, triUvZ(p) * k) * w.z;
}
// normal map triplanare con blend UDN: perturbazione nello spazio della barca
vec3 triNormal(sampler2D t, vec3 p, vec3 n, vec3 w, float s, float k) {
  vec2 k2 = s * uTriStretch;
  vec2 tx = texture2D(t, triUvX(p) * k2).xy * 2.0 - 1.0;
  vec2 ty = texture2D(t, p.xz * k2).xy * 2.0 - 1.0;
  vec2 tz = texture2D(t, triUvZ(p) * k2).xy * 2.0 - 1.0;
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

// Vele: atlante con la randa a sinistra (u 0,01-0,49) e il genoa a destra (u 0,51-0,99), v la quota.
// Le UV vengono da build_sail in scripts/blender/swan651_rig.py (SAIL_UV)
const SAIL_TEX = "/textures/sails/";
// quanta luce del sole passa da un solo strato di dacron (0-1) e quanto ne toglie ogni strato in più
const SAIL_TRANSLUCENCY = 0.5;
const SAIL_LAYER_ABSORB = 0.8;

const SAIL_GLSL = /* glsl */ `
// corda (0 inferitura, 1 balumina) e quota (0 base, 1 testa) dalle UV dell'atlante
vec2 sailCoord(vec2 tuv) {
  float c = tuv.x < 0.5 ? (tuv.x - 0.01) / 0.48 : (tuv.x - 0.51) / 0.48;
  return vec2(clamp(c, 0.0, 1.0), 1.0 - tuv.y);
}
// Spostamento lungo la normale e sua pendenza (per la luce), nello spazio della mesh (= barca).
// - balumina che vibra con il vento: onde corte che corrono verso poppa, ferme all'inferitura;
// - fileggiare (luff = influenza dello shape key Luffing): onde lunghe che partono dal bordo
//   d'entrata e corrono verso la balumina, crescono verso poppa, ferme in testa e alla base.
float sailWave(vec3 p, vec2 sc, float lee, float luff, float wind, float t, out vec2 grad) {
  float a1 = dot(p.xy, vec2(1.6, 0.7)) * 2.2 + t * 9.0;
  float a2 = p.y * 4.1 + t * 13.0;
  float kl = 0.03 * wind * lee;
  float d = (sin(a1) * 0.6 + sin(a2) * 0.4) * kl;
  grad = vec2(cos(a1) * 0.6 * 3.52, cos(a1) * 0.6 * 1.54 + cos(a2) * 0.4 * 4.1) * kl;
  float env = smoothstep(0.0, 0.3, sc.x) * (0.45 + 0.55 * sc.x)
    * smoothstep(0.0, 0.05, sc.y) * (1.0 - smoothstep(0.86, 1.0, sc.y));
  float kf = luff * (0.04 + 0.12 * wind) * env;
  float b1 = p.x * 2.3 + p.y * 0.25 + t * 10.0;
  float b2 = p.x * 3.4 - p.y * 0.5 + t * 15.0 + 1.7;
  d += (sin(b1) * 0.65 + sin(b2) * 0.35) * kf;
  grad += vec2(cos(b1) * 0.65 * 2.3 + cos(b2) * 0.35 * 3.4, cos(b1) * 0.65 * 0.25 - cos(b2) * 0.35 * 0.5) * kf;
  return d;
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
    // teak miele satinato: venatura stirata (diritta, non a cattedrale come un compensato) e più
    // contrastata, tono che cambia da un pannello all'altro, vernice satinata con un leggero riflesso
    Interior_Teak_Honey: { ...teak, mean: TEAK_MEAN, roughMean: 0.655, scale: 2.4, stretch: [0.4, 1], contrast: 1.5, boards: 0.07, normalK: 0.3, detail: 1, vertical: true, varnish: [0.55, 0.3], rough: null, roughness: 0.5, physical: true },
    // bordini, cornici e tientibene: teak più scuro e più lucido
    Interior_Teak_Dark: { ...teak, mean: TEAK_MEAN, roughMean: 0.655, scale: 3, stretch: [0.4, 1], contrast: 1.3, normalK: 0.25, detail: 1, vertical: true, varnish: [0.7, 0.22], rough: null, roughness: 0.4, physical: true },
    // la coperta: doghe da prua a poppa dalla texture già fatta, venatura dal teak di Poly Haven
    Teak_Deck: { map: deck.map, mean: [0.618, 0.485, 0.339], normal: teak.normal, scale: 1, normalScale: 2, normalK: 0.25, detail: 1, deck: true },
    // pelle dei divani trapuntata a rombi con i bottoni (solo nello shader: nessun poligono in più)
    Upholstery_Leather_Red: { ...leather, roughMean: 0.508, scale: 2.5, normalK: 0.9, sheen: [0.35, 0x8a2a2a, 0.5], physical: true, tuft: [0.17, 0.5] },
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

// Texture delle vele, caricate una volta sola (flipY falso: le UV vengono dal GLB)
let sailTexCache = null;
function sailTextures() {
  if (sailTexCache) return sailTexCache;
  const load = (name, srgb) => {
    const t = loader.load(SAIL_TEX + name);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  const weave = load("sails_weave.png", false);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  sailTexCache = { albedo: load("sails_albedo.png", true), normal: load("sails_normal.png", false), weave };
  return sailTexCache;
}

export function createMaterials(oceanShared, water) {
  const R = recipes();
  const sailTex = sailTextures();
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
      uTriStretch: { value: new THREE.Vector2(...(r.stretch || [1, 1])) },
      uTriContrast: { value: r.contrast ?? 1 },
      uTriBoards: { value: r.boards ?? 0 },
    };
    if (r.laminate) {
      u.uSailWeave = { value: sailTex.weave };
      u.uSailWeaveK = { value: 0.18 };
    }
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
    if (r.tuft) {
      defines.TUFT = r.tuft[0].toFixed(3);
      defines.TUFT_K = r.tuft[1].toFixed(3);
    }

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
          ${SAIL_GLSL}
          #endif
          varying vec3 vTriPos;
          varying vec3 vTriNrm;
          varying vec3 vWetW;`
        )
        .replace(
          "#include <project_vertex>",
          `#ifdef LAMINATE
          {
            // vibrazione della balumina e fileggiare (SAIL_GLSL); l'influenza dello shape key
            // Luffing, già impostata da main.js, scena.js e sailing.js, decide quanto la vela sbatte
            float luffK = 0.0;
            #if defined(USE_MORPHTARGETS) && !defined(USE_INSTANCING_MORPH)
            luffK = clamp(morphTargetInfluences[0], 0.0, 1.0);
            #endif
            vec2 sWg;
            float sWd = sailWave(position, sailCoord(uv), smoothstep(0.55, 1.0, aLeech), luffK, uWindSail, uTime, sWg);
            transformed += objectNormal * sWd;
            #ifndef FLAT_SHADED
            // la normale si inclina con la pendenza dell'onda, così le pieghe prendono luce e ombra
            vec3 sG = vec3(sWg, 0.0);
            sG -= objectNormal * dot(sG, objectNormal);
            vNormal = normalize(normalMatrix * normalize(objectNormal - sG));
            #ifdef FLIP_SIDED
            // vele trasparenti a due facce: three disegna prima il retro con FLIP_SIDED
            vNormal = -vNormal;
            #endif
            #endif
          }
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
          uniform float uTriContrast;
          uniform float uTriBoards;
          #ifdef LAMINATE
          uniform sampler2D uSailWeave;
          uniform float uSailWeaveK;
          #endif
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
          // venatura più marcata attorno al tono medio
          triCol = max(vec3(0.15), vec3(1.0) + (triCol - vec3(1.0)) * uTriContrast);
          diffuseColor.rgb *= mix(vec3(1.0), triCol, uTriDetail);
          // tavole e pannelli non sono tutti uguali: un tono che cambia ogni mezzo metro circa
          diffuseColor.rgb *= 1.0 + uTriBoards * (mNoise(floor(vTriPos * vec3(2.2, 1.1, 2.2)) + 7.0) - 0.5) * 2.0;
          #endif
          #ifdef TUFT
          // trapuntatura a rombi: cuscini gonfi fra i bottoni, sul piano dominante della faccia
          vec3 tuftU = vec3(1.0, 0.0, 0.0), tuftV = vec3(0.0, 0.0, 1.0);
          vec2 tuftP = vTriPos.xz;
          if (triWgt.x > triWgt.y && triWgt.x > triWgt.z) { tuftP = vTriPos.zy; tuftU = vec3(0.0, 0.0, 1.0); tuftV = vec3(0.0, 1.0, 0.0); }
          else if (triWgt.z > triWgt.y) { tuftP = vTriPos.xy; tuftU = vec3(1.0, 0.0, 0.0); tuftV = vec3(0.0, 1.0, 0.0); }
          vec2 tuftA = tuftP * (6.2831853 / TUFT);
          float tuftH = cos(tuftA.x) * cos(tuftA.y);
          // vicino ai bottoni (h -> 1) la piega si stringe; nelle pieghe la pelle è più scura
          float tuftS = 0.35 + 0.65 * smoothstep(0.55, 1.0, tuftH);
          vec2 tuftG = vec2(-sin(tuftA.x) * cos(tuftA.y), -cos(tuftA.x) * sin(tuftA.y)) * tuftS;
          float tuftB = smoothstep(0.93, 0.995, tuftH);
          diffuseColor.rgb *= (0.9 + 0.1 * (1.0 - tuftH * 0.5)) * (1.0 - 0.45 * tuftB);
          #endif
          #ifdef MOTTLE
          // antivegetativa: chiazze e aloni, mai un colore uniforme
          diffuseColor.rgb *= 1.0 - MOTTLE * (mNoise(vTriPos * 1.3) * 0.6 + mNoise(vTriPos * 7.0) * 0.4);
          #endif
          #ifdef LAMINATE
          // strati di tessuto dall'alfa della normal map dell'atlante (1 strato = 0,25)
          float sailLayers = texture2D(normalMap, vNormalMapUv).a * 4.0;
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
          // il dacron è opaco; rinforzi e nastri, più fitti e resinati, un filo più lisci
          roughnessFactor = clamp(roughnessFactor - 0.04 * (sailLayers - 1.0), 0.45, 1.0);
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
            #ifdef TUFT
            nb = normalize(nb + (tuftU * tuftG.x + tuftV * tuftG.y) * TUFT_K);
            #endif
            #ifdef ORANGE_PEEL
            // buccia d'arancia del gelcoat: si vede solo nei riflessi radenti
            nb = normalize(nb + mNoiseGrad(vTriPos * 38.0, 0.05) * ORANGE_PEEL * (1.0 - wet));
            #endif
            #if defined(TRI_NORMAL) || defined(ORANGE_PEEL) || defined(TUFT)
            normal = normalize((viewMatrix * vec4(uBoatRot * nb, 0.0)).xyz);
            #endif
            #ifdef LAMINATE
            // trama e grinze del dacron, ripetute ogni 60 cm nel piano della vela (x-y della barca)
            vec2 wv = texture2D(uSailWeave, vTriPos.xy / 0.6).xy * 2.0 - 1.0;
            vec3 wB = vec3(wv * uSailWeaveK, 0.0);
            vec3 wV = (viewMatrix * vec4(uBoatRot * wB, 0.0)).xyz;
            normal = normalize(normal + wV - normal * dot(wV, normal));
            #endif
          }`
        );
      if (r.laminate) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          `#if NUM_DIR_LIGHTS > 0
          {
            // Controluce economico: il sole dall'altra parte della vela passa attraverso il tessuto.
            // La faccia in ombra si schiarisce (di più guardando verso il sole) e dove gli strati
            // sono più d'uno (cuciture, nastri, rinforzi, stecche) passa meno luce: in trasparenza
            // appaiono più scuri. directionalLights[0] è il sole (l'unica luce con l'ombra).
            vec3 sL = directionalLights[0].direction;
            float sBack = max(dot(-normal, sL), 0.0);
            float sFwd = pow(max(dot(-normalize(vViewPosition), sL), 0.0), 5.0);
            float sTau = exp(-${SAIL_LAYER_ABSORB.toFixed(2)} * max(sailLayers - 1.0, 0.0));
            outgoingLight += directionalLights[0].color * diffuseColor.rgb * RECIPROCAL_PI
              * sTau * sBack * (0.6 + 1.6 * sFwd) * ${SAIL_TRANSLUCENCY.toFixed(2)};
          }
          #endif
          #include <opaque_fragment>`
        );
      }
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
      if (r.varnish) {
        m.clearcoat = r.varnish[0];
        m.clearcoatRoughness = r.varnish[1];
      }
      if (r.roughness !== undefined) m.roughness = r.roughness;
      if (r.laminate) {
        // dacron: atlante di colore e rilievi; il tono generale si regola qui (sostituisce il grigio del GLB)
        m.map = sailTex.albedo;
        m.normalMap = sailTex.normal;
        m.normalScale = new THREE.Vector2(1, 1);
        m.color.setRGB(0.66, 0.66, 0.66);
        m.roughness = 0.72;
        m.metalness = 0;
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
