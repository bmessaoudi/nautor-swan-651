import * as THREE from "three";

// Vita a bordo: cime con la curva vera, bandiera di poppa, increspature delle vele.
// - Cime: catenaria risolta sulla CPU come in Sea of Thieves (lunghezza = distanza + lasco),
//   poi un tubo lungo la curva. Coordinate dalla geometria del GLB, barca in assetto dritto.
// - Bandiera: Austria, come Lunz am Meer (AUT 2895), mossa da onde nel vertex shader.
// - Vele: le increspature lungo la balumina stanno in materials.js (attributo aLeech calcolato qui).

// Catenaria fra A e B con lasco relativo; restituisce n punti
function catenary(A, B, slack, n = 28) {
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  const h = Math.hypot(dx, dz);
  const v = B.y - A.y;
  const chord = Math.hypot(h, v);
  const L = chord * (1 + slack);
  const pts = [];
  if (h < 0.05) {
    // quasi verticale: retta con un filo di pancia
    for (let i = 0; i <= n; i++) pts.push(new THREE.Vector3().lerpVectors(A, B, i / n));
    return pts;
  }
  // 2a·sinh(h/2a) = sqrt(L² - v²): si cerca a per bisezione (la funzione decresce con a)
  const target = Math.sqrt(L * L - v * v);
  let lo = 1e-3;
  let hi = 1e4;
  for (let k = 0; k < 80; k++) {
    const a = (lo + hi) / 2;
    const f = 2 * a * Math.sinh(h / (2 * a)) - target;
    if (!Number.isFinite(f) || f > 0) lo = a;
    else hi = a;
  }
  const a = (lo + hi) / 2;
  const x0 = h / 2 - a * Math.atanh(Math.min(0.999999, v / L));
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * h;
    const y = a * Math.cosh((x - x0) / a) - a * Math.cosh(x0 / a);
    pts.push(new THREE.Vector3(A.x + (dx * x) / h, A.y + y, A.z + (dz * x) / h));
  }
  return pts;
}

// Trama della cima: trefoli diagonali con una fibra colorata, come una scotta in poliestere
function ropeTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#e9e5da";
  g.fillRect(0, 0, 64, 64);
  for (let i = -64; i < 128; i += 8) {
    g.strokeStyle = i % 32 === 0 ? "#2d4f8a" : "rgba(120,110,95,0.45)";
    g.lineWidth = i % 32 === 0 ? 2 : 1.4;
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 64, 64);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const flagVert = /* glsl */ `
uniform float uTime;
uniform float uWind;
varying float vShade;
`;

export function createRigging({ boat, clipping, layer }) {
  const group = new THREE.Group();
  const ropeMap = ropeTexture();
  const ropeMat = new THREE.MeshStandardMaterial({ map: ropeMap, roughness: 0.85, clippingPlanes: clipping, clipShadows: true, side: THREE.DoubleSide });
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  function rope(points, radius = 0.011) {
    const curve = new THREE.CatmullRomCurve3(points);
    const len = curve.getLength();
    const geo = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * 10)), radius, 6, false);
    // la trama si ripete ogni 4 cm lungo la cima
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 0.04));
    const m = new THREE.Mesh(geo, ropeMat);
    m.castShadow = true;
    m.layers.enable(layer);
    group.add(m);
    return m;
  }

  // Scotta del fiocco: dalla bugna al passascotte sul binario, poi al winch primario di dritta
  const clew = V(1.39, 3.12, 1.09);
  const lead = V(-0.7, 1.84, 1.6);
  const winchJ = V(-3.38, 1.78, 1.73);
  rope(catenary(clew, lead, 0.004));
  rope(catenary(lead, winchJ, 0.01));
  // la coda della scotta, lasca, che scende dal winch nel pozzetto
  rope(catenary(winchJ, V(-3.0, 1.0, 1.15), 0.12));

  // Randa: paranco sotto il boma, quattro rinvii quasi verticali, poi al winch del pozzetto
  const boomPt = V(-5.35, 2.72, 0.78);
  const traveller = V(-5.35, 1.42, 0.55);
  for (let i = 0; i < 4; i++) {
    const o = (i - 1.5) * 0.035;
    rope([V(boomPt.x + o, boomPt.y, boomPt.z), V(traveller.x + o, traveller.y, traveller.z)], 0.008);
  }
  const winchM = V(-4.69, 1.76, 1.69);
  rope(catenary(traveller, winchM, 0.05));
  rope(catenary(winchM, V(-4.4, 1.0, 1.2), 0.15));

  // Bandiera di poppa su un'asta inclinata verso poppa, sul giardinetto di sinistra
  const staffBase = V(-8.85, 1.42, -0.95);
  const staffTop = V(-9.35, 2.95, -0.95);
  const staff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.018, staffBase.distanceTo(staffTop), 8),
    new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.45, clippingPlanes: clipping })
  );
  staff.position.copy(staffBase).lerp(staffTop, 0.5);
  staff.quaternion.setFromUnitVectors(V(0, 1, 0), staffTop.clone().sub(staffBase).normalize());
  staff.castShadow = true;
  staff.layers.enable(layer);
  group.add(staff);

  // Rosso-bianco-rosso, proporzioni 3:2
  const fc = document.createElement("canvas");
  fc.width = 96;
  fc.height = 64;
  const fg = fc.getContext("2d");
  fg.fillStyle = "#c8102e";
  fg.fillRect(0, 0, 96, 64);
  fg.fillStyle = "#f4f2ee";
  fg.fillRect(0, 21.3, 96, 21.4);
  const flagTex = new THREE.CanvasTexture(fc);
  flagTex.colorSpace = THREE.SRGBColorSpace;
  const fw = 1.05;
  const fh = 0.7;
  const flagGeo = new THREE.PlaneGeometry(fw, fh, 24, 10);
  flagGeo.translate(-fw / 2, -fh / 2, 0); // inferitura sull'asta, la bandiera va verso poppa (-X)
  const flagUniforms = { uTime: { value: 0 }, uWind: { value: 0.3 } };
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, roughness: 0.75, side: THREE.DoubleSide, clippingPlanes: clipping });
  flagMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, flagUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${flagVert}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        // distanza dall'asta: l'onda cresce verso la punta libera
        float s = clamp(-position.x / ${fw.toFixed(3)}, 0.0, 1.0);
        float ph = position.x * 7.0 + uTime * (4.0 + uWind * 6.0);
        float amp = (0.04 + 0.12 * uWind) * s;
        transformed.z += sin(ph) * amp + sin(ph * 0.53 + position.y * 3.0) * amp * 0.5;
        // con poco vento la bandiera ricade lungo l'asta
        transformed.y -= (1.0 - uWind) * s * s * 0.45;
        transformed.x *= mix(0.75, 1.0, uWind);
        vShade = cos(ph) * s;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vShade;")
      .replace("#include <map_fragment>", "#include <map_fragment>\n        diffuseColor.rgb *= 0.85 + 0.15 * vShade;");
  };
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.copy(staffTop).add(V(0.02, -0.04, 0));
  flag.castShadow = true;
  flag.layers.enable(layer);
  group.add(flag);

  boat.add(group);

  return {
    group,
    // Attributo aLeech sulle vele: 0 all'inferitura, 1 sulla balumina (lì le vele vibrano)
    tagSail(mesh) {
      const g = mesh.geometry;
      const p = g.attributes.position;
      g.computeBoundingBox();
      const bb = g.boundingBox;
      const head = new THREE.Vector3();
      let top = -Infinity;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > top) { top = p.getY(i); head.fromBufferAttribute(p, i); }
      // inferitura: il vertice più a prua in basso; balumina: il più a poppa in basso
      const tack = new THREE.Vector3();
      const clewV = new THREE.Vector3();
      let bestT = -Infinity;
      let bestC = -Infinity;
      const q = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        q.fromBufferAttribute(p, i);
        const low = -(q.y - bb.min.y);
        if (q.x + low * 0.3 > bestT) { bestT = q.x + low * 0.3; tack.copy(q); }
        if (-q.x + low * 0.3 > bestC) { bestC = -q.x + low * 0.3; clewV.copy(q); }
      }
      const line = new THREE.Line3();
      const tmp = new THREE.Vector3();
      const arr = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) {
        q.fromBufferAttribute(p, i);
        line.set(tack, head);
        const dl = line.closestPointToPoint(q, true, tmp).distanceTo(q);
        line.set(clewV, head);
        const dr = line.closestPointToPoint(q, true, tmp).distanceTo(q);
        arr[i] = dl / Math.max(1e-4, dl + dr);
      }
      g.setAttribute("aLeech", new THREE.BufferAttribute(arr, 1));
    },
    update(t, wind) {
      flagUniforms.uTime.value = t;
      flagUniforms.uWind.value = wind;
    },
  };
}
