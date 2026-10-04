import * as THREE from "three";
import { createFFT } from "./fft/simulation.js";
import { createDetailTexture, DETAIL_ENC } from "./fft/detail.js";

// Mare e cielo del capitolo Navigazione.
// Il mare è un oceano FFT (fft/simulation.js): tre cascate di onde calcolate sulla GPU da uno
// spettro JONSWAP guidato dal vento delle condizioni. Il vertex shader sposta la griglia con le
// mappe di spostamento, il fragment shader legge pendenze, Jacobiano e schiuma dalle stesse mappe.
// L'acqua scorre verso poppa (-X) per dare l'idea che la barca avanzi. Il cielo è una cupola che
// segue la camera: lo stesso colore d'orizzonte chiude la nebbia del mare, così non resta una riga
// sull'orizzonte.

// Sole, colori, vento e foschia arrivano dalle condizioni (conditions.js) con setConditions.

// Lato della FFT: 256 di base, ?fft=128 per i portatili lenti (un quarto del lavoro sulla GPU)
const FFT_SIZE = (() => {
  const v = parseInt(new URLSearchParams(location.search).get("fft"), 10);
  return [64, 128, 256, 512].includes(v) ? v : 256;
})();

// Direzione del vento nel piano x-z: come le onde di Gerstner di prima, quasi lungo la prua
const WIND_DIR = Math.atan2(0.25, 1);
// fetch per costa: nell'arcipelago le isole spezzano il mare, in mare aperto l'onda si allunga
const FETCH = { arcipelago: 25000, costa: 60000, aperto: 120000 };

// Spostamento dell'acqua nel punto p del piano (x, z del mondo), dalle tre cascate FFT.
// Lo usano il vertex shader del mare, il campionamento per il galleggiamento (simulation.js) e la
// fascia bagnata dello scafo (materials.js): tutti vedono la stessa acqua.
// spacing è il passo della griglia in quel punto: le cascate si leggono al livello di mipmap
// adatto, così i vertici radi in lontananza non campionano onde più corte di loro.
export const WATER_GLSL = /* glsl */ `
uniform sampler2D uDisp0;
uniform sampler2D uDisp1;
uniform sampler2D uDisp2;
uniform vec3 uCascade;
uniform vec2 uOff;
uniform float uHeading;
// le onde si spengono in lontananza e attorno alla barca restano più basse
float waterFade(vec2 p) {
  float hc = cos(uHeading), hs = sin(uHeading);
  vec2 lp = vec2(p.x * hc + p.y * hs, -p.x * hs + p.y * hc);
  float fade = 1.0 - smoothstep(300.0, 1400.0, length(p));
  return fade * mix(0.55, 1.0, smoothstep(6.0, 22.0, length(lp * vec2(0.55, 1.0))));
}
float waterLod(float spacing, float L) {
  return max(0.0, log2(spacing * ${FFT_SIZE.toFixed(1)} / L));
}
vec3 waterOffset(vec2 p, float spacing) {
  vec2 q = p + uOff;
  vec3 d = textureLod(uDisp0, q / uCascade.x, waterLod(spacing, uCascade.x)).xyz;
  d += textureLod(uDisp1, q / uCascade.y, waterLod(spacing, uCascade.y)).xyz;
  d += textureLod(uDisp2, q / uCascade.z, waterLod(spacing, uCascade.z)).xyz;
  return d * waterFade(p);
}
// altezza dell'acqua nel punto del mondo: le onde spostano anche in orizzontale, quindi si cerca
// il punto del piano che finisce lì (due passi bastano per la fascia bagnata)
float waterHeight(vec2 x) {
  vec2 p = x;
  for (int k = 0; k < 2; k++) p = x - waterOffset(p, 0.0).xz;
  return waterOffset(p, 0.0).y;
}
`;

export const SKY = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
vec3 skyColor(vec3 r) {
  float h = r.y;
  vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, max(h, 0.0)));
  float sd = max(dot(r, uSunDir), 0.0);
  c += uSunCol * (pow(sd, 6.0) * 0.18 + pow(sd, 64.0) * 0.35);
  return c;
}
// Foschia a due colori, come la nebbia volumetrica di Black Flag: verso il sole prende il bagliore
// del cielo, dalla parte opposta è più fredda e scura. Il cielo usa la stessa tinta all'orizzonte,
// così mare e cupola si chiudono senza riga.
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogHeight;
vec3 hazeTone(vec3 dirH) {
  vec3 sunward = skyColor(dirH);
  vec3 opposite = mix(uHorizon, uZenith, 0.18) * 0.93;
  float ph = dot(dirH, normalize(vec3(uSunDir.x, 0.0, uSunDir.z))) * 0.5 + 0.5;
  return mix(opposite, sunward, 0.45 + 0.55 * ph);
}
vec3 hazeColor(vec3 world) {
  vec2 d = world.xz - cameraPosition.xz;
  return hazeTone(normalize(vec3(d.x, 0.0, d.y)));
}
// più densa vicino all'acqua: le cime delle montagne escono dalla foschia
float hazeAmount(vec3 world) {
  float h = exp(-max(world.y, 0.0) / uFogHeight);
  return smoothstep(uFogNear, uFogFar, length(world.xz - cameraPosition.xz)) * mix(0.55, 1.0, h);
}
`;


const oceanVert = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying vec2 vFlow;
varying float vFade;
${WATER_GLSL}

void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  // passo della griglia radiale in quel punto (anelli in progressione geometrica, vedi radialGrid)
  float spacing = 0.03 * length(p.xz) + 0.02;
  vec3 off = waterOffset(p.xz, spacing);
  // le mappe di pendenze e schiuma sono legate all'acqua, non al punto spostato: il fragment
  // shader le legge nel punto di partenza. uOff è lo spostamento dell'acqua rispetto alla barca
  // (setCourse): con la rotta dritta vale (tempo × velocità, 0)
  vFlow = p.xz + uOff;
  vFade = waterFade(p.xz);
  p += off;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const oceanFrag = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uFoam;
uniform float uCrestFoam;
uniform float uStreaks;
uniform float uSunRadius;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uSss;
uniform sampler2D uRefl;
uniform float uReflOn;
uniform vec2 uResolution;
uniform mat4 projectionMatrix;
uniform sampler2D uFoamTex;
uniform vec4 uFoamBox;
uniform float uHeading;
uniform sampler2D uDeriv0;
uniform sampler2D uDeriv1;
uniform sampler2D uDeriv2;
uniform vec3 uCascade;
uniform sampler2D uDetailTex;
uniform float uDetail;
uniform vec2 uWind;
uniform sampler2D uFoamPat;
varying vec3 vWorld;
varying vec2 vFlow;
varying float vFade;
${SKY}

vec2 rot(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
vec2 dec(vec2 t) { return (t * 2.0 - 1.0) * ${DETAIL_ENC.toFixed(2)}; }
// Increspature di dettaglio: pendenze nel piano del mondo. Lati 6,1 m (onde da 2 m a 11 cm) e
// 1,37 m (da 45 a 2,5 cm), rapporto non intero. Ogni lettura scorre lungo la sua direzione, a
// velocità vicine a quelle di fase di quelle onde. Ogni scala si spegne quando il pixel copre
// più di un decimo del suo lato (la mipmap da sola, di taglio, lascerebbe scintillare l'orizzonte)
// e la pendenza persa va nella ruvidità del riflesso del sole, come la mipmap di Toksvig.
vec2 detailSlope(float footprint, out float lost) {
  vec2 wper = vec2(-uWind.y, uWind.x);
  vec2 wq = vec2(dot(vFlow, uWind), dot(vFlow, wper));
  vec4 a1 = texture2D(uDetailTex, (rot(wq, 0.32) - vec2(uTime * 1.3, 0.0)) / 6.1);
  vec4 a2 = texture2D(uDetailTex, (rot(wq, -0.41) - vec2(uTime * 0.9, 0.0)) / 6.1 + vec2(0.43, 0.17));
  vec4 b1 = texture2D(uDetailTex, (rot(wq, 0.55) - vec2(uTime * 0.5, 0.0)) / 1.37);
  vec4 b2 = texture2D(uDetailTex, (rot(wq, -0.27) - vec2(uTime * 0.34, 0.0)) / 1.37 + vec2(0.61, 0.29));
  float wA = 1.0 - smoothstep(6.1 / 90.0, 6.1 / 10.0, footprint);
  float wB = 1.0 - smoothstep(1.37 / 90.0, 1.37 / 10.0, footprint);
  float aA = uDetail * 0.707;
  float aB = uDetail * 0.6 * 0.707;
  vec2 g = (rot(dec(a1.rg), -0.32) + rot(dec(a2.ba), 0.41)) * aA * wA
         + (rot(dec(b1.rg), -0.55) + rot(dec(b2.ba), 0.27)) * aB * wB;
  lost = 2.0 * (aA * aA * (1.0 - wA) + aB * aB * (1.0 - wB));
  return uWind * g.x + wper * g.y;
}

// Sole come disco e non come punto (Karis 2013, usato da Sea of Thieves per il sole basso):
// si prende il punto del disco più vicino al raggio riflesso.
float areaSpec(vec3 n, vec3 v, vec3 l, float radius, float rough) {
  vec3 r = reflect(-v, n);
  vec3 toRay = dot(l, r) * r - l;
  vec3 lp = normalize(l + toRay * clamp(radius / max(length(toRay), 1e-4), 0.0, 1.0));
  vec3 h = normalize(lp + v);
  float a = rough * rough;
  float a2 = a * a;
  float nh = max(dot(n, h), 0.0);
  float d = nh * nh * (a2 - 1.0) + 1.0;
  float D = a2 / (3.14159 * d * d);
  // normalizzazione dell'area: allargare il disco non deve aggiungere energia
  float norm = a / clamp(a + radius * 0.5, 1e-4, 1.0);
  return D * norm * norm * max(dot(n, lp), 0.0);
}

void main() {
  float d = length(vWorld.xz - cameraPosition.xz);
  float far = smoothstep(25.0, 260.0, d);

  // pendenze, Jacobiano e schiuma delle tre cascate (con mipmap: in lontananza si mediano da sole)
  vec4 c0 = texture2D(uDeriv0, vFlow / uCascade.x);
  vec4 c1 = texture2D(uDeriv1, vFlow / uCascade.y);
  vec4 c2 = texture2D(uDeriv2, vFlow / uCascade.z);
  vec2 slope = (c0.xy + c1.xy + c2.xy) * vFade;
  // increspature sotto la cascata più piccola (fft/detail.js): due scale, ognuna letta due volte
  // con direzioni e velocità diverse attorno al vento, così cambiano forma invece di scivolare
  // rigide. Seguono l'acqua (vFlow comprende uOff) e non si smorzano attorno allo scafo.
  // impronta del pixel sull'acqua in metri: distanza per angolo del pixel, allungata di taglio
  // (media geometrica dei due assi). fwidth(vFlow) sarebbe costante per triangolo e la griglia
  // radiale disegnerebbe anelli dove la sfumatura cambia gradino
  vec3 vd = vWorld - cameraPosition;
  float footprint = length(vd) * 2.0 / (projectionMatrix[1][1] * uResolution.y) / sqrt(max(abs(vd.y) / length(vd), 0.03));
  float lost;
  slope += detailSlope(footprint, lost);
  vec3 n = normalize(vec3(-slope.x, 1.0, -slope.y));
  // in lontananza un filo più piatta: il riflesso del cielo non deve sfarfallare
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), far * 0.35));
  // maschera delle creste (Sea of Thieves): dove le onde comprimono la superficie il Jacobiano
  // scende sotto 1. Lì la luce attraversa meno acqua. Le cascate si sommano come scarti da 1
  float jac = 1.0 + (c0.z + c1.z + c2.z - 3.0) * vFade;
  float peak = clamp((1.0 - jac) * 1.4, 0.0, 1.0);

  vec3 vdir = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, vdir), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-vdir, n);
  r.y = abs(r.y);
  vec3 refl = skyColor(r);
  // riflesso planare della barca, deformato dalle onde
  vec2 suv = gl_FragCoord.xy / uResolution + n.xz * 0.075 * (1.0 - far);
  vec4 boatRefl = texture2D(uRefl, suv);
  refl = mix(refl, boatRefl.rgb, boatRefl.a * uReflOn);

  // corpo dell'acqua: dal colore profondo a quello della luce che attraversa le creste.
  // Conta l'angolo di vista, la direzione del sole (onde in controluce) e la maschera delle creste.
  vec3 sunH = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
  float back = pow(clamp(dot(-vdir, sunH) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  float crest = clamp(vWorld.y * 0.45 + 0.4, 0.0, 1.0);
  float sssAmt = clamp(peak * (0.35 + back * 0.9) + crest * back * 0.45 + pow(1.0 - ndv, 3.0) * peak * 0.3, 0.0, 1.0);
  vec3 body = mix(uDeep, uMid, crest * 0.6);
  body = mix(body, uSss * (0.6 + uSunCol * 0.6), sssAmt * (1.0 - far * 0.8));

  vec3 col = mix(body, refl, fres * (1.0 - boatRefl.a * uReflOn * 0.15));

  // sole: disco più largo quando è basso, riflesso più ruvido in lontananza
  // la pendenza delle increspature spente in lontananza allarga il riflesso (α² = α0² + 2σ²)
  float r0 = mix(0.06, 0.2, far);
  float spec = areaSpec(n, vdir, uSunDir, uSunRadius, sqrt(sqrt(r0 * r0 * r0 * r0 + lost)));
  col += uSunCol * spec * 0.22 * (1.0 - boatRefl.a * uReflOn);

  // Schiuma. Le maschere dicono dove ce n'è e quanto è fresca (Jacobiano delle creste, strisce,
  // buffer della scia); la forma la dà una foto di schiuma vera (ambientCG Foam001, CC0),
  // equalizzata: il valore del texel è il suo quantile. Così la maschera fa da soglia: fresca
  // copre quasi tutto, mentre si spegne restano solo i filamenti più chiari e si sfalda a merletto.
  // Due scale ruotate e sfalsate (rapporto non intero) nascondono la ripetizione, una terza molto
  // larga varia la quantità da un'onda all'altra.
  float fa = texture2D(uFoamPat, mat2(0.8, -0.6, 0.6, 0.8) * vFlow / 6.7).r;
  float fb = texture2D(uFoamPat, mat2(0.36, 0.93, -0.93, 0.36) * vFlow / 2.3 + vec2(0.37, 0.71) + uTime * vec2(0.006, 0.004)).r;
  float coarse = texture2D(uFoamPat, mat2(0.6, 0.8, -0.8, 0.6) * vFlow / 53.0).r;
  float fp = fa * 0.62 + fb * 0.38;
  // creste: la schiuma della FFT, dove l'onda si ripiega e nei secondi dopo (si spegne piano)
  float fftFoam = clamp(c0.a + c1.a * 0.8 + c2.a * 0.35, 0.0, 1.0) * vFade;
  float crestFoam = clamp(fftFoam * (0.5 + coarse) * 1.7, 0.0, 1.0) * step(0.001, uCrestFoam);
  // strisce lungo il vento da forza 5 in su: la stessa foto stirata lungo il vento, letta da una
  // mipmap a 32 px (stirata a piena risoluzione darebbe graffi paralleli); il merletto lo fa fp.
  // La foto è equalizzata: con la mipmap i valori si stringono attorno a 0,5, la soglia lascia strisce rade
  vec2 sq = vec2(dot(vFlow, uWind) / 70.0, dot(vFlow, vec2(-uWind.y, uWind.x)) / 3.2);
  float streak = smoothstep(0.68, 0.9, textureLod(uFoamPat, sq, 4.0).r) * uStreaks * (1.0 - far * 0.6);

  // schiuma attorno allo scafo e scia, dal buffer (seafx.js)
  // il buffer della schiuma segue la barca: si legge nel suo riferimento (seafx.js ruota la camera)
  float fc = cos(uHeading), fs = sin(uHeading);
  vec2 bl = vec2(vWorld.x * fc + vWorld.z * fs, -vWorld.x * fs + vWorld.z * fc);
  vec2 fuv = vec2((bl.x - uFoamBox.x) / uFoamBox.z, (uFoamBox.y + uFoamBox.w - bl.y) / uFoamBox.w);
  float inside = step(0.0, fuv.x) * step(fuv.x, 1.0) * step(0.0, fuv.y) * step(fuv.y, 1.0);
  float hullFoam = texture2D(uFoamTex, clamp(fuv, 0.0, 1.0)).r * inside * 1.15;

  float amount = clamp(crestFoam + streak * 0.5 + hullFoam, 0.0, 1.0);
  // soglia sulla foto: a 1 copre quasi tutto, a 0,3 restano i filamenti più chiari. Il bordo è
  // morbido e la densità segue la foto: la schiuma vera è un velo di bolle, non un foglio bianco
  float thr = 1.0 - 0.92 * amount;
  float lace = smoothstep(thr - 0.1, thr + 0.16, fp) * (0.35 + 0.65 * fp) * (0.6 + 0.4 * amount);
  // in lontananza la trama è più fine del pixel: si passa alla copertura media, niente scintillio
  float foam = mix(lace, amount * 0.6, smoothstep(0.04, 0.3, footprint));
  vec3 foamCol = vec3(0.9, 0.93, 0.95) * (0.55 + 0.45 * max(dot(n, uSunDir), 0.0)) + uSunCol * 0.08;
  col = mix(col, foamCol, clamp(foam * uFoam, 0.0, 0.92));

  // foschia verso l'orizzonte, dello stesso colore del cielo in basso
  col = mix(col, hazeColor(vWorld), hazeAmount(vWorld));
  gl_FragColor = vec4(col, uOpacity * (1.0 - smoothstep(1050.0, 1500.0, d)));
}
`;

// Trama della schiuma, ripetibile, in scala di grigi (vedi la schiuma nel fragment shader).
// Finché non arriva il texel vale 0: la soglia non passa e la schiuma semplicemente non c'è.
function foamPattern() {
  const tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/sea/foam.jpg`);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Griglia polare: fitta vicino alla barca, rada verso l'orizzonte (l'idea del LOD di Black Flag,
// senza patch: la barca è sempre al centro).
function radialGrid(rMin, rMax, rings, segs) {
  const pos = [];
  const idx = [];
  pos.push(0, 0, 0);
  for (let i = 0; i < rings; i++) {
    const r = rMin * Math.pow(rMax / rMin, i / (rings - 1));
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
  }
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = 1 + i * segs + j;
      const b = 1 + i * segs + ((j + 1) % segs);
      const c = a + segs;
      const d = b + segs;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const skyFrag = /* glsl */ `
uniform float uOpacity;
uniform float uSunDisk;
varying vec3 vDir;
${SKY}
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir);
  // disco del sole
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunCol * smoothstep(0.9993, 0.9997, sd) * 6.0 * uSunDisk;
  // vicino e sotto l'orizzonte il cielo prende la tinta della foschia
  vec3 tone = hazeTone(normalize(vec3(dir.x, 0.0, dir.z)));
  col = mix(col, tone, 1.0 - smoothstep(-0.02, 0.1, dir.y));
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;


// ---------- Galleggiamento ----------
// L'altezza dell'acqua sotto lo scafo si legge dalla GPU, con la stessa funzione del vertex shader
// (waterOffset): la barca galleggia sull'acqua disegnata, cascata fine compresa. La lettura è
// asincrona (PBO e fence): il dato arriva uno o due fotogrammi dopo, meno del filo d'inerzia
// che float() aggiunge comunque. Lo scafo (19,98 × 5,31 m, centrato nell'origine, prua verso +X)
// si campiona su una griglia 5 × 3 dentro la linea di galleggiamento: le onde più corte della
// barca si compensano fra i punti, come su uno scafo vero.
const HULL_X = [-7, -3.5, 0, 3.5, 7];
const HULL_Z = [-2.1, 0, 2.1];
const HULL = HULL_X.flatMap((bx) => HULL_Z.map((bz) => [bx, bz]));

// piano ai minimi quadrati sulla griglia simmetrica: la media è il sollevamento, le pendenze
// lungo la prua e lungo il baglio danno beccheggio e rollio
// (rollio col segno della sbandata, rotation.x: positivo è la dritta che scende)
function fitPlane(heights, out) {
  let sum = 0, sx = 0, sz = 0, sxx = 0, szz = 0;
  HULL.forEach(([bx, bz], i) => {
    const h = heights[i];
    sum += h; sx += bx * h; sz += bz * h; sxx += bx * bx; szz += bz * bz;
  });
  out.heave = sum / HULL.length;
  out.pitch = Math.atan(sx / sxx);
  out.roll = -Math.atan(sz / szz);
  return out;
}

export function createOcean(renderer) {
  // Uniformi condivise fra mare, cielo e paesaggio
  const shared = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uZenith: { value: new THREE.Color(0x2a64a8) },
    uHorizon: { value: new THREE.Color(0xbfd2e0) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(0xfff0d8) },
    uSunDisk: { value: 1 },
    uFogNear: { value: 180 },
    uFogFar: { value: 1300 },
    uFogHeight: { value: 250 },
    uFlow: { value: 4.6 },
    uOff: { value: new THREE.Vector2() },
    uHeading: { value: 0 },
    uWaveScale: { value: 1 },
  };

  const fft = createFFT(renderer, { size: FFT_SIZE, water: { glsl: WATER_GLSL, uniforms: { uOff: shared.uOff, uHeading: shared.uHeading } } });
  // uniformi dell'acqua per chi deve conoscerne l'altezza (materials.js, con WATER_GLSL)
  const water = { ...fft.uniforms, uOff: shared.uOff, uHeading: shared.uHeading };

  const geo = radialGrid(1.5, 1600, 190, 288);
  const mat = new THREE.ShaderMaterial({
    vertexShader: oceanVert,
    fragmentShader: oceanFrag,
    transparent: true,
    uniforms: {
      ...shared,
      ...water,
      uFoam: { value: 1 },
      uDeep: { value: new THREE.Color(0x03182b) },
      uMid: { value: new THREE.Color(0x0d4566) },
      uSss: { value: new THREE.Color(0x1f8f86) },
      uCrestFoam: { value: 0 },
      uStreaks: { value: 0 },
      uSunRadius: { value: 0.03 },
      // riflesso e schiuma dello scafo: le texture arrivano da seafx.js
      uRefl: { value: null },
      uReflOn: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFoamTex: { value: null },
      uFoamBox: { value: new THREE.Vector4(0, 0, 1, 1) },
      // increspature di dettaglio (fft/detail.js) e direzione del vento nel piano x-z
      uDetailTex: { value: createDetailTexture() },
      uDetail: { value: 0.08 },
      uWind: { value: new THREE.Vector2(Math.cos(WIND_DIR), Math.sin(WIND_DIR)) },
      // trama della schiuma: foto CC0 di ambientCG (Foam001), 512 px equalizzata, 108 KB
      uFoamPat: { value: foamPattern() },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  const skyMat = new THREE.ShaderMaterial({
    vertexShader: skyVert,
    fragmentShader: skyFrag,
    uniforms: shared,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), skyMat);
  sky.frustumCulled = false;
  sky.renderOrder = -1;

  // il "mare" visto dal basso nella mappa d'ambiente: un disco scuro sotto l'orizzonte
  const envSea = new THREE.MeshBasicMaterial({ color: 0x0b3048 });
  let foamBase = 1;
  // ripidità delle creste e soglia della schiuma, dalle condizioni
  let choppy = 0.8;
  const foamParams = { bias: 0.75, gain: 6 };
  const floatRaw = { heave: 0, pitch: 0, roll: 0 };
  const floatState = { heave: 0, pitch: 0, roll: 0 };
  let floatReady = false;
  const hullPts = HULL.map(() => [0, 0]);

  return {
    mesh,
    sky,
    shared,
    // uniformi dell'acqua FFT (mappe di spostamento, lati delle cascate, rotta): con WATER_GLSL
    // danno waterHeight(xz) a chi deve sapere dov'è il pelo dell'acqua (materials.js)
    waves: water,
    fft,
    // collega le uniformi di seafx.js (stessi oggetti, si aggiornano da sole)
    linkSeaFx(u) {
      Object.assign(mat.uniforms, u);
    },
    // collega il cielo fisico di sky.js: il riflesso dell'acqua passa da skyColor (la cupola
    // dipinta) a skyReflect (cubemap del cielo più nuvole volumetriche lette sullo schermo).
    // La chunk arriva da fuori perché sky.js importa già SKY da qui (import circolare).
    linkSky(uniforms, chunk) {
      Object.assign(mat.uniforms, uniforms);
      mat.fragmentShader = mat.fragmentShader
        .replace("void main() {", `${chunk}\nvoid main() {`)
        .replace("vec3 refl = skyColor(r);", "vec3 refl = skyReflect(r);");
      mat.needsUpdate = true;
    },
    // Mappa d'ambiente del cielo per i riflessi su scafo e cromature
    envMap(pmrem) {
      const s = new THREE.Scene();
      const dome = new THREE.Mesh(sky.geometry, skyMat.clone());
      dome.material.uniforms = { ...shared, uOpacity: { value: 1 } };
      dome.scale.setScalar(0.01);
      s.add(dome);
      const sea = new THREE.Mesh(new THREE.CircleGeometry(30, 32), envSea);
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -2;
      s.add(sea);
      const tex = pmrem.fromScene(s, 0.02).texture;
      dome.material.dispose();
      sea.geometry.dispose();
      return tex;
    },
    setConditions(c) {
      shared.uSunDir.value.copy(c.sunDir);
      shared.uZenith.value.copy(c.zenith);
      shared.uHorizon.value.copy(c.horizon);
      shared.uSunCol.value.copy(c.sun);
      shared.uSunDisk.value = c.disk;
      shared.uFogNear.value = c.fog[0];
      shared.uFogFar.value = c.fog[1];
      shared.uFogHeight.value = c.fogHeight;
      shared.uFlow.value = c.flow;
      shared.uWaveScale.value = c.waveScale;
      mat.uniforms.uDeep.value.copy(c.deep);
      mat.uniforms.uMid.value.copy(c.mid);
      // turchese delle creste: il colore dell'acqua schiarito verso il verde acqua
      mat.uniforms.uSss.value.copy(c.mid).lerp(new THREE.Color(0x2aa898), 0.55).multiplyScalar(1.15);
      mat.uniforms.uCrestFoam.value = c.crestFoam;
      mat.uniforms.uStreaks.value = c.streaks;
      // increspature: pendenza quadratica media di ogni scala, con il vento (Cox e Munk 1954:
      // la varianza delle pendenze cresce lineare con il vento). Circa 0,09 a 6 nodi, 0,15 a 25
      mat.uniforms.uDetail.value = Math.sqrt(0.0025 + 0.0016 * c.knots * 0.5144);
      // il sole basso si allarga per l'atmosfera: scia di luce più ampia al tramonto
      mat.uniforms.uSunRadius.value = 0.025 + 0.11 * (1 - Math.min(1, c.sunDir.y / 0.5));
      envSea.color.copy(c.mid).multiplyScalar(0.6);
      foamBase = c.foam;
      // Spettro: il vento in nodi dà energia e lunghezza delle onde, la costa il fetch.
      // waveScale (0,6 con vento leggero, 1,35 con vento forte) dà la ripidità delle creste
      fft.setSpectrum({ speed: Math.max(2, c.knots * 0.5144), dir: WIND_DIR, fetch: FETCH[c.coast] ?? 60000 }, c.seed);
      choppy = 0.6 + 0.5 * c.waveScale;
      // schiuma dal Jacobiano: assente fino a forza 3, sulle creste che frangono con vento fresco
      foamParams.bias = c.crestFoam > 0 ? 0.62 + 0.16 * c.crestFoam : -1;
    },
    // Rotta della barca: heading in radianti (verso dritta positivo), pos lo spostamento percorso
    // sul piano del mondo (x, z). La barca ruota su se stessa al centro della scena; onde, sole e
    // paesaggio restano fermi e l'acqua scorre alla velocità della barca lungo la sua prua.
    setCourse(heading, pos) {
      shared.uHeading.value = heading;
      shared.uOff.value.set(pos.x, pos.y);
    },
    // Galleggiamento: come sta la barca sull'acqua disegnata dallo shader (letta dalla GPU, vedi
    // sopra). Restituisce sollevamento (m), beccheggio e rollio (radianti, prua che sale e dritta
    // che scende positivi), con un filo d'inerzia: 30 tonnellate non seguono ogni increspatura.
    // dt è il passo del fotogramma.
    float(t, dt) {
      const h = fft.heights;
      if (!h) return floatState;
      fitPlane(h, floatRaw);
      // il sollevamento segue l'acqua più da vicino (lo scafo non deve affondare né staccarsi),
      // beccheggio e rollio con più inerzia
      const step = Math.min(dt, 0.1);
      const kh = floatReady ? 1 - Math.exp(-step / 0.2) : 1;
      const ka = floatReady ? 1 - Math.exp(-step / 0.5) : 1;
      floatReady = true;
      floatState.heave += (floatRaw.heave - floatState.heave) * kh;
      floatState.pitch += (floatRaw.pitch * 0.85 - floatState.pitch) * ka;
      floatState.roll += (floatRaw.roll * 0.85 - floatState.roll) * ka;
      return floatState;
    },
    update(t, opacity, foam, cam) {
      shared.uTime.value = t;
      shared.uOpacity.value = opacity;
      mat.uniforms.uFoam.value = foam * foamBase;
      mesh.visible = sky.visible = opacity > 0.005;
      sky.position.copy(cam.position);
      // nello studio il mare non si vede: niente FFT
      if (!mesh.visible) return;
      fft.update(t, choppy, foamParams);
      // punti dello scafo nel mondo con la rotta di adesso: prua (cos h, sin h), dritta (-sin h, cos h)
      const hc = Math.cos(shared.uHeading.value), hs = Math.sin(shared.uHeading.value);
      HULL.forEach(([bx, bz], i) => {
        hullPts[i][0] = bx * hc - bz * hs;
        hullPts[i][1] = bx * hs + bz * hc;
      });
      fft.sample(hullPts);
    },
  };
}
