import * as THREE from "three";
import { EffectPass } from "postprocessing";
import {
  AerialPerspectiveEffect, AtmosphereParameters, PrecomputedTexturesLoader, SkyMaterial, getSunLightColor,
} from "@takram/three-atmosphere";
import {
  CloudsEffect, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE,
} from "@takram/three-clouds";
import {
  DataTextureLoader, Ellipsoid, Geodetic, STBNLoader, parseUint8Array, radians,
} from "@takram/three-geospatial";
import { SKY } from "./ocean.js";

// Cielo fisico e nuvole volumetriche del capitolo Navigazione.
// Atmosfera di Bruneton (@takram/three-atmosphere) e nuvole in raymarching con mappe d'ombra
// (@takram/three-clouds), versioni fissate in package.json: l'autore sta riscrivendo tutto per
// WebGPU con un'API diversa.
//
// Le librerie lavorano sul globo (coordinate ECEF): la scena locale si appoggia sul golfo di
// Botnia davanti a Pietarsaari, dove nasce lo Swan, con X verso nord, Y in alto e Z verso est.
// Il sole non viene dalla data ma dalle condizioni (cond.sunDir), così ogni preset resta com'è.
//
// Pezzi:
//   mesh       cielo nella scena (quad a schermo intero dietro a tutto): sotto il mare che sfuma
//              in lontananza serve un cielo vero, non uno sfondo del post-processing
//   passes     nuvole e prospettiva aerea, da mettere nel composer subito dopo l'occlusione
//   envMap()   mappa d'ambiente PMREM per scafo e cromature
//   uniforms + SKY_PHYS  cubemap del cielo e nuvole dell'ultimo fotogramma per i riflessi del mare
//
// Le uniformi della chunk SKY di ocean.js (uZenith, uHorizon) vengono ricavate dal cielo fisico:
// foschia del mare e della terra prendono così lo stesso colore dell'orizzonte vero.

const ASSETS = "/sky/";
// Pietarsaari (Jakobstad), al largo: 63,70 N, 22,62 E, livello del mare
const ORIGIN = new Geodetic(radians(22.62), radians(63.7), 0);

// Qualità: preset della libreria più risoluzione delle nuvole, relativa al buffer del composer
// (che su uno schermo retina è già a 2x: 0,5 vuol dire circa un punto per pixel CSS; le nuvole
// sono morbide). Niente upscaling temporale della libreria: ricostruisce le nuvole da 16 fotogrammi
// e lasciava un fantasma sulle vele quando la camera gira (limite noto di three-clouds). Al suo
// posto un antialiasing temporale corto, a risoluzione più bassa. "spenta" toglie le nuvole e tiene il cielo
// fisico. Si sceglie con ?cielo=alta|media|bassa|spenta; la qualità adattiva di post.js scende di
// un gradino (mai fino a "spenta") prima di abbassare la risoluzione di tutto.
export const SKY_QUALITY = ["alta", "media", "bassa", "spenta"];
const QUALITY = {
  alta: { preset: "high", scale: 0.5, shafts: true },
  media: { preset: "medium", scale: 0.35, shafts: false },
  bassa: { preset: "low", scale: 0.25, shafts: false },
  spenta: null,
};

// Luminanza relativa della libreria: il sole a radianza unitaria vale 1, il cielo azzurro circa
// 0,05. La nostra scena è tarata a mano (sole a 3,4, orizzonte attorno a 0,6): si scala tutta
// l'atmosfera con un solo fattore, condiviso da cielo, nuvole e prospettiva aerea, perché le
// uniformi delle librerie puntano agli stessi vettori di AtmosphereParameters.DEFAULT.
const ATMO = AtmosphereParameters.DEFAULT;
const BASE_SUN = ATMO.sunRadianceToRelativeLuminance.clone();
const BASE_SKY = ATMO.skyRadianceToRelativeLuminance.clone();
// Bilanciamento del bianco "luce diurna", come una fotocamera: la luce del sole fuori
// dall'atmosfera, convertita in RGB, è un po' calda, e le nuvole lontane (sole caldo più luce
// azzurra diffusa dall'aria) venivano rosa lilla. Si divide per il colore del sole, a luminanza
// invariata.
const WB = (() => {
  const s = ATMO.solarIrradiance.clone().multiply(BASE_SUN);
  const l = 0.2126 * s.x + 0.7152 * s.y + 0.0722 * s.z;
  return new THREE.Vector3(l / s.x, l / s.y, l / s.z);
})();
const ONE = new THREE.Vector3(1, 1, 1);
// tint: tinta della sola luce diffusa dall'aria (cielo, foschia, luce del cielo sulle nuvole)
function setAtmosphereGain(k, tint = ONE, sunTint = ONE) {
  ATMO.sunRadianceToRelativeLuminance.copy(BASE_SUN).multiply(WB).multiply(sunTint).multiplyScalar(k);
  ATMO.skyRadianceToRelativeLuminance.copy(BASE_SKY).multiply(WB).multiply(tint).multiplyScalar(k);
}

// ---------- Chunk per i riflessi del mare (per l'integrazione) ----------
// skyEnv(dir): cielo senza nuvole vicine, dalla cubemap (con il velo delle nuvole medie).
// skyClouds(dir): nuvole e foschia volumetriche dell'ultimo fotogramma, lette sullo schermo nella
// direzione dir (all'infinito). Fuori dallo schermo restituisce 0.
// skyReflect(dir): le due cose insieme, da usare al posto di skyColor(r) nel riflesso dell'acqua.
// dir in coordinate del mondo. Le uniformi sono in sky.uniforms (stessi oggetti, si aggiornano da sole).
export const SKY_PHYS = /* glsl */ `
uniform samplerCube uSkyEnv;
uniform sampler2D uSkyClouds;
uniform mat4 uSkyViewProj;
uniform float uSkyCloudsOn;
vec3 skyEnv(vec3 dir) {
  return textureCube(uSkyEnv, dir).rgb;
}
vec4 skyClouds(vec3 dir) {
  vec4 c = uSkyViewProj * vec4(dir, 0.0);
  if (c.w <= 0.0) return vec4(0.0);
  vec2 uv = c.xy / c.w * 0.5 + 0.5;
  // sfuma sui bordi dello schermo: lì il riflesso torna alla sola cubemap
  vec2 e = smoothstep(0.0, 0.06, uv) * smoothstep(1.0, 0.94, uv);
  return texture2D(uSkyClouds, clamp(uv, 0.0, 1.0)) * e.x * e.y * uSkyCloudsOn;
}
vec3 skyReflect(vec3 dir) {
  vec4 c = skyClouds(dir);
  return skyEnv(dir) * (1.0 - c.a) + c.rgb;
}
`;

// Codice aggiunto al fragment di SkyMaterial: sole delle condizioni (il disco fisico della libreria
// supera la mezza precisione una volta scalato), fascia di foschia sull'orizzonte come nel cielo di
// prima, mare scuro sotto l'orizzonte nella mappa d'ambiente, dissolvenza con lo studio.
const SKY_DECL = /* glsl */ `
uniform mat4 worldToECEFMatrix;
uniform vec3 cameraPosition;
uniform float uOpacity;
uniform float uSunDisk;
uniform float uHazeBand;
uniform float uEnvMode;
uniform vec3 uEnvSea;
uniform vec3 uEnvCloud;
uniform float uEnvCover;
${SKY}
`;
const SKY_MAIN = /* glsl */ `
  {
    // ginocchio morbido sulla luminanza (tinta invariata): a filo d'orizzonte, dalla parte del sole,
    // il cielo fisico arriva a 2-3. Il tone mapping Neutral lo sbiancava e il grading caldo delle
    // luci lo rendeva lilla: bande ciano e lilla sopra l'orizzonte.
    float L = dot(outputColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    float Lc = L < 0.8 ? L : 0.8 + 0.4 * (1.0 - exp(-(L - 0.8) / 0.4));
    outputColor.rgb *= Lc / max(L, 1e-5);
    vec3 wdir = normalize(transpose(mat3(worldToECEFMatrix)) * rayDirection);
    float sd = max(dot(wdir, uSunDir), 0.0);
    outputColor.rgb += uSunCol * smoothstep(0.9993, 0.9997, sd) * 6.0 * uSunDisk * (1.0 - uEnvMode * 0.9);
    if (uEnvMode > 0.5) {
      // mappa d'ambiente: velo delle nuvole sopra, mare sotto
      outputColor.rgb = mix(outputColor.rgb, uEnvCloud, uEnvCover * smoothstep(-0.02, 0.35, wdir.y));
      outputColor.rgb = mix(outputColor.rgb, uEnvSea, 1.0 - smoothstep(-0.03, 0.0, wdir.y));
    } else {
      vec3 tone = hazeTone(normalize(vec3(wdir.x, 0.0, wdir.z)));
      outputColor.rgb = mix(outputColor.rgb, tone, 1.0 - smoothstep(-0.02, uHazeBand, wdir.y));
    }
  }
  outputColor.a = uOpacity;
`;

function makeSkyMaterial(shared, own) {
  const m = new SkyMaterial({ sun: false, moon: false, ground: false });
  m.fragmentShader = m.fragmentShader
    .replace("void main()", `${SKY_DECL}\nvoid main()`)
    .replace("outputColor.a = 1.0;", SKY_MAIN);
  Object.assign(m.uniforms, shared, own);
  m.transparent = true;
  m.depthWrite = false;
  // profondità 1 (gl_Position.z = w): resta dietro a barca e mare anche fra i trasparenti
  m.depthTest = true;
  return m;
}

function loadTexture(url) {
  return new THREE.TextureLoader().load(url, (t) => {
    t.minFilter = THREE.LinearMipMapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
  });
}
function load3D(url, size) {
  return new DataTextureLoader(THREE.Data3DTexture, parseUint8Array, {
    width: size, height: size, depth: size,
    format: THREE.RedFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, wrapR: THREE.RepeatWrapping,
    colorSpace: THREE.NoColorSpace,
  }).load(url);
}

const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

export function createSky(renderer, camera, shared, { quality = "media" } = {}) {
  // ---------- Riferimento sul globo ----------
  const worldToECEF = new THREE.Matrix4();
  Ellipsoid.WGS84.getNorthUpEastFrame(ORIGIN.toECEF(), worldToECEF);
  const rot = new THREE.Matrix3().setFromMatrix4(worldToECEF);
  const sunECEF = new THREE.Vector3(0, 1, 0);

  // ---------- Tabelle dell'atmosfera ----------
  // Precalcolate (EXR della libreria, circa 4 MB in tutto). Il generatore sulla GPU eviterebbe il
  // download, ma avanza con requestIdleCallback e con la scena che disegna di continuo ci metteva
  // ~19 s. Senza la tabella dello scattering di ordine superiore: serve solo ai raggi di luce
  // (qualità "alta"), che senza restano un filo più chiari.
  let ready = false;
  let textures = null;

  // ---------- Cielo nella scena ----------
  const own = {
    uHazeBand: { value: 0.1 },
    uEnvMode: { value: 0 },
    uEnvSea: { value: new THREE.Color() },
    uEnvCloud: { value: new THREE.Color() },
    uEnvCover: { value: 0 },
  };
  const skyMat = makeSkyMaterial(shared, own);
  skyMat.worldToECEFMatrix.copy(worldToECEF);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;

  // ---------- Nuvole ----------
  const clouds = new CloudsEffect(camera);
  clouds.worldToECEFMatrix.copy(worldToECEF);
  clouds.localWeatherTexture = loadTexture(ASSETS + "local_weather.png");
  clouds.turbulenceTexture = loadTexture(ASSETS + "turbulence.png");
  clouds.shapeTexture = load3D(ASSETS + "shape.bin", CLOUD_SHAPE_TEXTURE_SIZE);
  clouds.shapeDetailTexture = load3D(ASSETS + "shape_detail.bin", CLOUD_SHAPE_DETAIL_TEXTURE_SIZE);
  const stbn = new STBNLoader().load(ASSETS + "stbn.bin");
  clouds.stbnTexture = stbn;

  // ---------- Prospettiva aerea ----------
  // Qui serve solo a comporre nuvole e foschia volumetrica sopra la scena. L'illuminazione resta
  // quella delle luci della scena, e anche trasmittanza e luce diffusa dall'aria sono spente: entro
  // il chilometro e mezzo del mare non si vedono (c'è già la foschia di ocean.js) e costano
  // letture delle tabelle 3D su ogni pixel.
  const aerial = new AerialPerspectiveEffect(camera, { sky: false, sunLight: false, skyLight: false, transmittance: false, inscatter: false, correctGeometricError: false });
  aerial.worldToECEFMatrix.copy(worldToECEF);
  aerial.uniforms.get("stbnTexture").value = stbn;

  const link = () => {
    const on = cloudsPass.enabled;
    aerial.overlay = on ? clouds.atmosphereOverlay : null;
    aerial.shadow = on ? clouds.atmosphereShadow : null;
    aerial.shadowLength = on ? clouds.atmosphereShadowLength : null;
    skyMat.shadowLength = on ? clouds.atmosphereShadowLength : null;
  };
  clouds.events.addEventListener("change", link);

  // un solo passaggio a schermo intero per nuvole e composizione (gli effetti si fondono in un
  // unico shader): con due EffectPass separati si pagava una copia in più dell'immagine
  const cloudsPass = new EffectPass(camera, clouds, aerial);

  // ---------- Uniformi per i riflessi del mare ----------
  const envRT = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const uniforms = {
    uSkyEnv: { value: envRT.texture },
    uSkyClouds: { value: null },
    uSkyViewProj: { value: new THREE.Matrix4() },
    uSkyCloudsOn: { value: 0 },
  };

  // ---------- Mappa d'ambiente ----------
  // un secondo SkyMaterial con dissolvenza piena e il mare sotto l'orizzonte
  const envShared = { ...shared, uOpacity: { value: 1 } };
  const envMat = makeSkyMaterial(envShared, { ...own, uEnvMode: { value: 1 } });
  envMat.worldToECEFMatrix.copy(worldToECEF);
  const envScene = new THREE.Scene();
  const envQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), envMat);
  envQuad.frustumCulled = false;
  envScene.add(envQuad);
  const cubeCam = new THREE.CubeCamera(0.1, 10, envRT);

  // Sonda: la cubemap letta in poche direzioni (orizzonte e 45° tutto attorno) per ricavare i
  // colori della chunk SKY. Si legge una texture 8 × 2 invece delle facce del cubo, così non
  // contano le convenzioni di orientamento delle facce.
  const PROBE_N = 8;
  const probeRT = new THREE.WebGLRenderTarget(PROBE_N, 2, { type: THREE.FloatType, depthBuffer: false });
  const probeMat = new THREE.ShaderMaterial({
    uniforms: { uCube: { value: envRT.texture }, uSunAz: { value: 0 } },
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      uniform samplerCube uCube; uniform float uSunAz;
      void main() {
        float az = uSunAz + (floor(gl_FragCoord.x) + 0.5) / ${PROBE_N}.0 * 6.2831853;
        float el = gl_FragCoord.y < 1.0 ? 0.05 : 0.8;
        vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
        gl_FragColor = vec4(textureCube(uCube, d).rgb, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const probeScene = new THREE.Scene();
  const probeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), probeMat);
  probeQuad.frustumCulled = false;
  probeScene.add(probeQuad);
  const probeCam = new THREE.Camera();
  const probeBuf = new Float32Array(PROBE_N * 2 * 4);

  function renderEnv() {
    const prevTarget = renderer.getRenderTarget();
    cubeCam.update(renderer, envScene);
    renderer.setRenderTarget(probeRT);
    renderer.render(probeScene, probeCam);
    renderer.readRenderTargetPixels(probeRT, 0, 0, PROBE_N, 2, probeBuf);
    renderer.setRenderTarget(prevTarget);
    // media della metà opposta al sole (azimut fra 112° e 248° dal sole): il bagliore
    // attorno al sole lo aggiunge già la chunk SKY con uSunCol
    const avg = (row, all = false) => {
      const c = new THREE.Color(0, 0, 0);
      let n = 0;
      for (let i = 0; i < PROBE_N; i++) {
        const d = Math.min(i, PROBE_N - 1 - i);
        if (d < 2 && !all) continue;
        const o = (row * PROBE_N + i) * 4;
        c.r += probeBuf[o]; c.g += probeBuf[o + 1]; c.b += probeBuf[o + 2];
        n++;
      }
      return c.multiplyScalar(1 / n);
    };
    return { horizon: avg(0), zenith: avg(1), ring: avg(0, true) };
  }

  let cond = null;
  let q = QUALITY[quality] ? quality : "media";
  const tint = new THREE.Vector3(1, 1, 1);
  const sunTint = new THREE.Vector3(1, 1, 1);
  const sunLight = new THREE.Color();
  const ecefOrigin = ORIGIN.toECEF();

  function applyQuality() {
    const Q = QUALITY[q];
    cloudsPass.enabled = !!Q && active;
    if (Q) {
      clouds.qualityPreset = Q.preset;
      clouds.temporalUpscale = false;
      clouds.resolutionScale = Q.scale;
      clouds.lightShafts = Q.shafts;
      // peso del fotogramma nuovo nell'antialiasing: 0,1 della libreria lascia ancora una scia
      clouds.cloudsPass.resolveMaterial.uniforms.temporalAlpha.value = 0.3;
    }
    link();
  }

  let active = true;
  // secondi in cui la qualità adattiva non deve misurare: arrivo in mare, dissolvenza dallo studio
  // e cambio di qualità hanno picchi di carico (shader, tabelle) che non dicono nulla del regime
  let settle = 0;

  // Nuvole per preset. Copertura dalla condizione; la pioggia e la foschia abbassano gli strati e
  // aggiungono foschia volumetrica (approssimata, costa poco).
  function setClouds(c) {
    const L = clouds.cloudLayers;
    const wet = c.rain ? 1 : 0;
    const fog = c.preset === "foschia" ? 1 : 0;
    // nuvole sparse fino a ~0,7, poi coltre: con 0,5 di copertura il tramonto era già coperto
    const sparse = 0.12 + c.clouds * 0.45;
    clouds.coverage = THREE.MathUtils.lerp(sparse, 0.82, THREE.MathUtils.smoothstep(c.clouds, 0.7, 0.97));
    // cumuli bassi e medi, cirri alti; con la pioggia una coltre più bassa e spessa
    L[0].set({ channel: "r", altitude: wet ? 450 : 750, height: wet ? 900 : 650, densityScale: wet ? 0.3 : 0.2, shadow: true });
    L[1].set({ channel: "g", altitude: wet ? 900 : 1100, height: wet ? 1600 : 1200, densityScale: wet ? 0.3 : 0.2, shadow: true });
    L[2].set({ channel: "b", altitude: 7500, height: 500, densityScale: c.clouds > 0.7 ? 0.001 : 0.003, shapeAmount: 0.4, shapeDetailAmount: 0, coverageFilterWidth: 0.5 });
    // Niente strato di nebbia bassa (canale a): con la camera dentro il volume il raymarching a
    // risoluzione ridotta lasciava una grana fitta su barca e mare. La nebbia vicina resta quella
    // del mare (hazeAmount di ocean.js), qui si alza solo la foschia volumetrica lontana.
    L[3].set({ channel: "a", height: 0 });
    clouds.clouds.hazeDensityScale = 3e-5 * (1 + fog * 12 + wet * 8);
    clouds.clouds.hazeExponent = fog || wet ? 3e-3 : 1e-3;
    // le nuvole scorrono col vento (velocità esagerata di qualche volta, sennò non si vede)
    const ms = c.knots * 0.5144;
    clouds.localWeatherVelocity.set(ms * 4e-6, ms * 1.5e-6);
  }

  // colore (in RGB, con il bilanciamento del bianco) della luce del cielo a livello del mare,
  // letto sulla CPU dalla tabella dell'irradianza: riga r = raggio della Terra, colonna dal seno
  // dell'altezza del sole (parametrizzazione di Bruneton: x = mu_s / 2 + 1 / 2)
  function skyIrradianceHue(muS) {
    const t = textures.irradianceTexture;
    const { data, width, height } = t.image;
    const stride = data.length / (width * height);
    const x = Math.round(THREE.MathUtils.clamp(muS * 0.5 + 0.5, 0, 1) * (width - 1));
    const o = x * stride;
    return new THREE.Color(data[o] * BASE_SKY.x * WB.x, data[o + 1] * BASE_SKY.y * WB.y, data[o + 2] * BASE_SKY.z * WB.z);
  }

  function setConditions(c) {
    cond = c;
    sunECEF.copy(c.sunDir).applyMatrix3(rot).normalize();
    for (const m of [skyMat, envMat]) m.sunDirection.copy(sunECEF);
    clouds.sunDirection.copy(sunECEF);
    aerial.sunDirection.copy(sunECEF);
    setClouds(c);

    // quanto è coperto: sopra ~0,6 il cielo diventa grigio e l'orizzonte prende la tinta delle condizioni
    const overcast = THREE.MathUtils.smoothstep(c.clouds, 0.55, 0.97);
    own.uHazeBand.value = 0.1 + overcast * 0.35;
    own.uEnvSea.value.copy(c.mid).multiplyScalar(0.6);
    if (!ready) return;

    // 1. cielo limpido a guadagno 1, misura dell'orizzonte
    setAtmosphereGain(1);
    own.uEnvCover.value = 0;
    probeMat.uniforms.uSunAz.value = Math.atan2(c.sunDir.z, c.sunDir.x);
    const clear = renderEnv();
    // 2. guadagno: l'orizzonte fisico (media tutto attorno) prende la luminanza di quello delle
    //    condizioni, su cui sono tarate luci ed esposizione. Al tramonto resta più scuro del
    //    mezzogiorno perché lo è anche cond.horizon.
    const gain = THREE.MathUtils.clamp(lum(c.horizon) / Math.max(lum(clear.ring), 1e-5), 1, 400);
    // Con il cielo coperto la luce diffusa è grigia: la libreria non sa che sopra la coltre c'è
    // ombra e colora d'azzurro foschia, base delle nuvole e cielo fra gli strati. Si porta la tinta
    // dell'aria verso quella dell'orizzonte delle condizioni (a luminanza invariata).
    const ch = (col, i) => [col.r, col.g, col.b][i] / Math.max(lum(col), 1e-6);
    // riferimento: la luce del cielo su una superficie orizzontale al livello del mare (tabella
    // dell'irradianza), che è quella che illumina coltre e foschia. Con il colore dell'orizzonte
    // la correzione veniva troppo rossa e la coltre diventava malva.
    const ref = skyIrradianceHue(c.sunDir.y);
    tint.set(...[0, 1, 2].map((i) => THREE.MathUtils.lerp(1, ch(c.horizon, i) / Math.max(ch(ref, i), 1e-3), overcast)));
    // anche il sole che arriva sopra la coltre perde il colore (sennò grigio azzurro più sole
    // caldo dava una coltre color malva)
    getSunLightColor(textures.transmittanceTexture, ecefOrigin, sunECEF, sunLight);
    const sl = lum(sunLight);
    sunTint.set(...[sunLight.r, sunLight.g, sunLight.b].map((v) => THREE.MathUtils.lerp(1, sl / Math.max(v, 1e-6), overcast)));
    setAtmosphereGain(gain, tint, sunTint);
    // colore della luce del sole al livello del mare, con guadagno e bilanciamento (per le luci)
    getSunLightColor(textures.transmittanceTexture, ecefOrigin, sunECEF, api.sunLight);
    // 3. velo delle nuvole nella mappa d'ambiente: grigio chiaro con la luminanza dell'orizzonte
    const h = clear.horizon.clone().multiplyScalar(gain);
    h.r *= tint.x; h.g *= tint.y; h.b *= tint.z;
    own.uEnvCloud.value.setScalar(lum(h) * 0.95).lerp(h, 0.25);
    own.uEnvCover.value = THREE.MathUtils.clamp(c.clouds * 0.5 + overcast * 0.5, 0, 0.95);
    const env = renderEnv();
    // 4. colori della chunk SKY: dal cielo fisico, verso quelli delle condizioni quando è coperto
    shared.uHorizon.value.copy(env.horizon).lerp(c.horizon, overcast);
    shared.uZenith.value.copy(env.zenith).lerp(c.zenith, overcast);
    api.gain = gain;
  }

  // ---------- Tabelle pronte ----------
  const readyPromise = new Promise((resolve, reject) => {
    new PrecomputedTexturesLoader({ format: "exr", higherOrderScattering: false })
      .setType(renderer)
      .load(ASSETS + "atmosphere/", (t) => {
        textures = t;
        for (const target of [skyMat, envMat, clouds, aerial]) Object.assign(target, textures);
        ready = true;
        if (cond) setConditions(cond);
        resolve();
      }, undefined, reject);
  });

  const view = new THREE.Matrix4();

  const api = {
    mesh,
    passes: [cloudsPass],
    clouds,
    aerial,
    uniforms,
    gain: 1,
    // luce del sole che arriva al mare (stesse unità del cielo): per chi vuole legare le luci al cielo
    sunLight: new THREE.Color(1, 1, 1),
    ready: readyPromise,
    get quality() {
      return q;
    },
    // ?cielo=alta|media|bassa|spenta
    setQuality(level) {
      if (!SKY_QUALITY.includes(level)) return;
      q = level;
      applyQuality();
      settle = 2;
    },
    // vero mentre la misura dei tempi va ignorata (vedi settle)
    get settling() {
      return settle > 0;
    },
    // un gradino in meno (dalla qualità adattiva di post.js); restituisce true se ha cambiato
    degrade() {
      if (!active) return false;
      const i = SKY_QUALITY.indexOf(q);
      if (i >= SKY_QUALITY.length - 2) return false; // "spenta" solo a mano
      api.setQuality(SKY_QUALITY[i + 1]);
      return true;
    },
    setConditions,
    // Mappa d'ambiente PMREM del cielo (velo delle nuvole compreso), come ocean.envMap
    envMap(pmrem) {
      if (ready) renderEnv();
      return pmrem.fromCubemap(envRT.texture).texture;
    },
    // ogni fotogramma, prima di disegnare: dissolvenza e matrici per i riflessi
    update(t, dt, opacity) {
      const on = opacity > 0.005 && ready;
      if (on !== active) {
        active = on;
        applyQuality();
        settle = 3;
      }
      settle = on && opacity < 0.999 ? 3 : Math.max(0, settle - dt);
      mesh.visible = on;
      // la composizione del cielo segue la dissolvenza fra studio e mare
      aerial.blendMode.opacity.value = opacity;
      // nuvole del fotogramma precedente per i riflessi (stesso contenuto della composizione)
      uniforms.uSkyClouds.value = cloudsPass.enabled ? clouds.atmosphereOverlay?.map ?? null : null;
      uniforms.uSkyCloudsOn.value = uniforms.uSkyClouds.value ? 1 : 0;
      view.copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
      uniforms.uSkyViewProj.value.multiplyMatrices(camera.projectionMatrix, view);
    },
    dispose() {
      if (textures) for (const t of Object.values(textures)) t?.dispose();
      envRT.dispose();
      probeRT.dispose();
    },
  };
  applyQuality();
  return api;
}
