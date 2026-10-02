import * as THREE from "three";

// Mare con onde di Gerstner calcolate nel vertex shader.
// L'acqua scorre verso poppa (-X) per dare l'idea che la barca avanzi.
const WAVES = [
  // direzione xy, ripidità, lunghezza d'onda (m)
  [1.0, 0.25, 0.12, 34],
  [0.7, -0.6, 0.09, 17],
  [0.9, 0.9, 0.07, 9],
  [-0.3, 1.0, 0.05, 5.5],
];

const vert = /* glsl */ `
uniform float uTime;
uniform vec4 uWaves[4];
varying vec3 vWorld;
varying vec3 vNormal;

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
  // avanzamento della barca: circa 9 nodi
  vec2 q = p.xz + vec2(uTime * 4.6, 0.0);
  vec3 tang = vec3(1.0, 0.0, 0.0);
  vec3 bin = vec3(0.0, 0.0, 1.0);
  vec3 off = vec3(0.0);
  float fade = 1.0 - smoothstep(300.0, 1400.0, length(p.xz));
  for (int i = 0; i < 4; i++) off += gerstner(uWaves[i], q, tang, bin);
  p += off * fade;
  vWorld = p;
  vNormal = normalize(cross(bin, tang));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const frag = /* glsl */ `
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform float uOpacity;
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec3 n = normalize(vNormal);
  vec3 vdir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, vdir), 0.0), 4.0);
  vec3 col = mix(uDeep, uMid, clamp(0.35 + vWorld.y * 0.45, 0.0, 1.0));
  col = mix(col, uSky, fres * 0.6);
  vec3 h = normalize(uSunDir + vdir);
  col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, h), 0.0), 220.0) * 1.6;
  // schiuma sulle creste
  col = mix(col, vec3(0.92), smoothstep(0.6, 1.0, vWorld.y) * 0.35);
  float d = length(vWorld.xz - cameraPosition.xz);
  float fog = smoothstep(250.0, 1300.0, d);
  col = mix(col, uHorizon, fog);
  gl_FragColor = vec4(col, uOpacity * (1.0 - smoothstep(900.0, 1500.0, d)));
  #include <colorspace_fragment>
}
`;

export function createOcean() {
  const geo = new THREE.PlaneGeometry(3200, 3200, 360, 360);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uWaves: { value: WAVES.map((w) => new THREE.Vector4(...w)) },
      uDeep: { value: new THREE.Color(0x06243d) },
      uMid: { value: new THREE.Color(0x15557a) },
      uSky: { value: new THREE.Color(0x7aa3c8) },
      uHorizon: { value: new THREE.Color(0xdde6ea) },
      uSunDir: { value: new THREE.Vector3(-0.4, 0.5, 0.6).normalize() },
      uOpacity: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  return {
    mesh,
    update(t, opacity) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uOpacity.value = opacity;
      mesh.visible = opacity > 0.005;
    },
    setHorizon(rgb) {
      mat.uniforms.uHorizon.value.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
    },
  };
}
