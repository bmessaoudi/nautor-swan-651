import * as THREE from "three";

// Mare e cielo del capitolo Navigazione.
// Il mare è un piano con onde di Gerstner nel vertex shader; il dettaglio fine (increspature,
// schiuma, onda di prua e scia) è nel fragment shader. L'acqua scorre verso poppa (-X) per
// dare l'idea che la barca avanzi. Il cielo è una cupola che segue la camera: lo stesso
// colore d'orizzonte chiude la nebbia del mare, così non resta una riga sull'orizzonte.

// Direzione del sole in mare: alto a poppa sulla dritta, la barca è in luce nelle viste di poppa
// e in controluce in quelle di prua.
export const SUN_DIR = new THREE.Vector3(-0.62, 0.36, 0.7).normalize();

const WAVES = [
  // direzione xy, ripidità, lunghezza d'onda (m)
  [1.0, 0.25, 0.11, 38],
  [0.7, -0.6, 0.09, 19],
  [0.9, 0.9, 0.07, 10],
  [-0.3, 1.0, 0.05, 6],
];
const FLOW = 4.6; // m/s, circa 9 nodi

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
  return s;
}
`;

const SKY = /* glsl */ `
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
`;

const oceanVert = /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[4];
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vFlow;

vec3 gerstner(vec4 w, vec2 p, inout vec3 tang, inout vec3 bin) {
  float k = 6.2831853 / w.w;
  float c = sqrt(9.8 / k);
  vec2 d = normalize(w.xy);
  float f = k * (dot(d, p) - c * uTime);
  float a = w.z / k;
  float s = sin(f), co = cos(f);
  tang += vec3(-d.x * d.x * w.z * s, d.x * w.z * co, -d.x * d.y * w.z * s);
  bin  += vec3(-d.x * d.y * w.z * s, d.y * w.z * co, -d.y * d.y * w.z * s);
  return vec3(d.x * a * co, a * s, d.y * a * co);
}

void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 q = p.xz + vec2(uTime * ${FLOW.toFixed(1)}, 0.0);
  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 bin = vec3(0.0, 0.0, 1.0);
  vec3 off = vec3(0.0);
  for (int i = 0; i < 4; i++) off += gerstner(uWaves[i], q, tang, bin);
  // le onde si spengono in lontananza (e attorno alla barca restano più basse)
  float fade = 1.0 - smoothstep(300.0, 1400.0, length(p.xz));
  fade *= mix(0.55, 1.0, smoothstep(6.0, 22.0, length(p.xz * vec2(0.55, 1.0))));
  p += off * fade;
  vWorld = p;
  vFlow = q;
  vNormal = normalize(mix(vec3(0.0, 1.0, 0.0), normalize(cross(bin, tang)), fade));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const oceanFrag = /* glsl */ `
uniform float uTime;
uniform float uOpacity;
uniform float uFoam;
uniform vec3 uDeep;
uniform vec3 uMid;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vFlow;
${NOISE}
${SKY}

void main() {
  float d = length(vWorld.xz - cameraPosition.xz);
  float far = smoothstep(25.0, 260.0, d);

  // increspature: normale perturbata da rumore che scorre con l'acqua
  vec2 q = vFlow * 0.2 + vec2(0.0, uTime * 0.05);
  float e = 0.12;
  float h0 = fbm(q);
  float hx = fbm(q + vec2(e, 0.0));
  float hz = fbm(q + vec2(0.0, e));
  vec3 rip = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * 0.16 * (1.0 - far);
  vec3 n = normalize(vNormal + rip);
  n = normalize(mix(n, vec3(0.0, 1.0, 0.0), far * 0.7));

  vec3 vdir = normalize(cameraPosition - vWorld);
  float ndv = max(dot(n, vdir), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 r = reflect(-vdir, n);
  r.y = abs(r.y);
  vec3 refl = skyColor(r);

  // corpo dell'acqua: più chiaro sulle creste, luce che passa nelle onde controsole
  float crest = clamp(vWorld.y * 0.55 + 0.45, 0.0, 1.0);
  vec3 body = mix(uDeep, uMid, crest);
  float sss = pow(clamp(dot(vdir, -uSunDir) * 0.5 + 0.5, 0.0, 1.0), 3.0) * smoothstep(0.0, 0.8, vWorld.y);
  body += vec3(0.02, 0.2, 0.19) * sss;

  vec3 col = mix(body, refl, fres);

  // sole: riflesso stretto da vicino, scia luminosa più larga e tenue in lontananza
  vec3 hv = normalize(uSunDir + vdir);
  float spec = pow(max(dot(n, hv), 0.0), mix(1200.0, 160.0, far));
  col += uSunCol * spec * mix(2.6, 0.7, far);

  // schiuma sulle creste
  float fn = fbm(vFlow * 0.55);
  float foam = smoothstep(0.85, 1.25, vWorld.y + fn * 0.55) * 0.55;

  // onda di prua lungo lo scafo e scia a poppa (la barca è ferma all'origine, l'acqua scorre)
  vec2 b = vWorld.xz;
  float ell = length(vec2(b.x / 8.9, b.y / 2.65));
  float ring = smoothstep(1.32, 1.0, ell) * smoothstep(0.92, 1.02, ell);
  ring *= 0.35 + 0.65 * smoothstep(-4.0, 8.0, b.x);
  float aft = max(-b.x - 7.6, 0.0);
  float wakeW = 1.3 + aft * 0.2;
  float wake = step(b.x, -7.6) * smoothstep(wakeW, wakeW * 0.25, abs(b.y)) * exp(-aft * 0.03);
  float churn = fbm(vFlow * 1.3 + uTime * 0.35);
  foam += (ring * 1.0 + wake * 0.75) * smoothstep(0.32, 0.72, churn);
  col = mix(col, vec3(0.92, 0.95, 0.96), clamp(foam * uFoam, 0.0, 0.92));

  // foschia verso l'orizzonte, dello stesso colore del cielo in basso
  col = mix(col, uHorizon, smoothstep(180.0, 1300.0, d));
  gl_FragColor = vec4(col, uOpacity * (1.0 - smoothstep(1050.0, 1500.0, d)));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

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
varying vec3 vDir;
${SKY}
void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyColor(dir);
  // disco del sole
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunCol * smoothstep(0.9993, 0.9997, sd) * 4.0;
  // sotto l'orizzonte il cielo resta del colore della foschia
  col = mix(col, uHorizon, smoothstep(0.0, -0.05, dir.y));
  gl_FragColor = vec4(col, uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createOcean() {
  // Uniformi condivise fra mare e cielo
  const shared = {
    uTime: { value: 0 },
    uOpacity: { value: 0 },
    uZenith: { value: new THREE.Color(0x2a64a8) },
    uHorizon: { value: new THREE.Color(0xbfd2e0) },
    uSunDir: { value: SUN_DIR.clone() },
    uSunCol: { value: new THREE.Color(0xfff0d8) },
  };

  const geo = new THREE.PlaneGeometry(3200, 3200, 400, 400);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: oceanVert,
    fragmentShader: oceanFrag,
    transparent: true,
    uniforms: {
      ...shared,
      uWaves: { value: WAVES.map((w) => new THREE.Vector4(...w)) },
      uFoam: { value: 1 },
      uDeep: { value: new THREE.Color(0x03182b) },
      uMid: { value: new THREE.Color(0x0d4566) },
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

  return {
    mesh,
    sky,
    // Mappa d'ambiente del cielo per i riflessi su scafo e cromature
    envMap(pmrem) {
      const s = new THREE.Scene();
      const dome = new THREE.Mesh(sky.geometry, skyMat.clone());
      dome.material.uniforms = { ...shared, uOpacity: { value: 1 } };
      dome.scale.setScalar(0.01);
      s.add(dome);
      // il "mare" visto dal basso nella mappa: un disco scuro sotto l'orizzonte
      const sea = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshBasicMaterial({ color: 0x0b3048 }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -2;
      s.add(sea);
      return pmrem.fromScene(s, 0.02).texture;
    },
    update(t, opacity, foam, cam) {
      shared.uTime.value = t;
      shared.uOpacity.value = opacity;
      mat.uniforms.uFoam.value = foam;
      mesh.visible = sky.visible = opacity > 0.005;
      sky.position.copy(cam.position);
    },
  };
}
