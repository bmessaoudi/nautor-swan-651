import * as THREE from "three";

// Effetti fra barca e mare, eseguiti prima del rendering principale:
// 1. Riflesso planare: la barca vista da una camera specchiata sotto il pelo dell'acqua, a un
//    terzo della risoluzione. Il mare lo legge in coordinate di schermo, deformato dalle onde.
//    (Black Flag usa riflessi in screen space; sul mare un piano è più semplice e più corretto.)
// 2. Schiuma come in Sea of Thieves: ogni fotogramma si disegna dall'alto l'impronta dello scafo
//    al galleggiamento, il bordo diventa schiuma e il buffer si sfoca e scorre verso poppa con
//    l'acqua. Ne escono onda di prua e scia che seguono lo scafo vero, anche sbandato.

export const BOAT_LAYER = 1;

// Dominio della schiuma in metri, nello spazio del mondo (la barca è ferma all'origine)
export const FOAM_BOX = { x0: -56, x1: 16, z0: -18, z1: 18 };
const FOAM_RES = [576, 288];

const fsVert = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

export function createSeaFx(renderer, scene, camera) {
  // ---------- Riflesso ----------
  const reflRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const reflCam = new THREE.PerspectiveCamera();
  reflCam.matrixAutoUpdate = false;
  reflCam.matrixWorldAutoUpdate = false;
  reflCam.layers.set(BOAT_LAYER);
  const mirror = new THREE.Matrix4().makeScale(1, -1, 1);
  const keepAbove = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.02)];

  // ---------- Schiuma ----------
  const W = FOAM_BOX.x1 - FOAM_BOX.x0;
  const D = FOAM_BOX.z1 - FOAM_BOX.z0;
  const maskRT = new THREE.WebGLRenderTarget(FOAM_RES[0], FOAM_RES[1], { depthBuffer: true });
  const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  let foamA = new THREE.WebGLRenderTarget(FOAM_RES[0], FOAM_RES[1], opts);
  let foamB = new THREE.WebGLRenderTarget(FOAM_RES[0], FOAM_RES[1], opts);
  // camera dall'alto: destra = +X, alto dello schermo = -Z
  const topCam = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 1, 120);
  topCam.position.set((FOAM_BOX.x0 + FOAM_BOX.x1) / 2, 60, (FOAM_BOX.z0 + FOAM_BOX.z1) / 2);
  topCam.up.set(0, 0, -1);
  topCam.lookAt(topCam.position.x, 0, topCam.position.z);
  topCam.updateMatrixWorld();
  topCam.layers.set(BOAT_LAYER);
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  // lo scafo tagliato poco sopra l'acqua, visto dall'alto, riempie l'impronta al galleggiamento
  const keepBelow = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.12)];

  const feedback = new THREE.ShaderMaterial({
    uniforms: {
      tPrev: { value: null },
      tMask: { value: maskRT.texture },
      uShift: { value: 0 },
      uDecay: { value: 0.98 },
      uTexel: { value: new THREE.Vector2(1 / FOAM_RES[0], 1 / FOAM_RES[1]) },
      uInject: { value: 1 },
    },
    vertexShader: fsVert,
    fragmentShader: /* glsl */ `
      uniform sampler2D tPrev; uniform sampler2D tMask;
      uniform float uShift; uniform float uDecay; uniform vec2 uTexel; uniform float uInject;
      varying vec2 vUv;
      void main() {
        // l'acqua scorre verso -X: quello che ora è qui, un istante fa era più a prua
        vec2 p = vUv + vec2(uShift, 0.0);
        vec2 t = uTexel * 1.2;
        float prev = texture2D(tPrev, p).r * 0.4
          + (texture2D(tPrev, p + vec2(t.x, 0.0)).r + texture2D(tPrev, p - vec2(t.x, 0.0)).r
          +  texture2D(tPrev, p + vec2(0.0, t.y)).r + texture2D(tPrev, p - vec2(0.0, t.y)).r) * 0.15;
        // bordo dell'impronta: massimo dei vicini meno il centro
        float m = texture2D(tMask, vUv).r;
        float mx = 0.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853982;
          mx = max(mx, texture2D(tMask, vUv + vec2(cos(a), sin(a)) * uTexel * 3.0).r);
          mx = max(mx, texture2D(tMask, vUv + vec2(cos(a), sin(a)) * uTexel * 6.0).r * 0.7);
        }
        float edge = clamp(mx - m, 0.0, 1.0);
        // più schiuma a prua (u alto) dove lo scafo apre l'acqua
        float bow = mix(0.7, 1.0, smoothstep(0.55, 0.85, vUv.x));
        float f = max(prev * uDecay, edge * uInject * bow);
        // dentro lo scafo niente schiuma; ai bordi del dominio si spegne
        f *= 1.0 - m;
        f *= smoothstep(0.0, 0.02, vUv.x) * smoothstep(1.0, 0.98, vUv.x) * smoothstep(0.0, 0.04, vUv.y) * smoothstep(1.0, 0.96, vUv.y);
        gl_FragColor = vec4(f, f, f, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), feedback);
  quad.frustumCulled = false;
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // Uniformi lette dal mare
  const uniforms = {
    uRefl: { value: reflRT.texture },
    uReflOn: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uFoamTex: { value: foamA.texture },
    uFoamBox: { value: new THREE.Vector4(FOAM_BOX.x0, FOAM_BOX.z0, W, D) },
  };

  const size = new THREE.Vector2();
  const clear = new THREE.Color();

  return {
    uniforms,
    debug: () => ({ maskRT, foam: foamA, reflRT }),
    // dt in secondi, flow in m/s; on = quanto si vede il mare
    render(dt, flow, on) {
      uniforms.uReflOn.value = on;
      if (on < 0.005) return;
      const prevTarget = renderer.getRenderTarget();
      const prevClipping = renderer.clippingPlanes;
      const prevAuto = renderer.shadowMap.autoUpdate;
      const prevBg = scene.background;
      const prevOverride = scene.overrideMaterial;
      renderer.getClearColor(clear);
      const prevAlpha = renderer.getClearAlpha();
      renderer.shadowMap.autoUpdate = false;
      scene.background = null;
      renderer.setClearColor(0x000000, 0);

      // riflesso a un terzo della risoluzione: le onde lo deformano comunque
      renderer.getDrawingBufferSize(size);
      uniforms.uResolution.value.copy(size);
      const rw = Math.max(1, Math.floor(size.x / 3));
      const rh = Math.max(1, Math.floor(size.y / 3));
      if (reflRT.width !== rw || reflRT.height !== rh) reflRT.setSize(rw, rh);
      camera.updateMatrixWorld();
      reflCam.matrixWorld.multiplyMatrices(mirror, camera.matrixWorld);
      reflCam.matrixWorldInverse.copy(reflCam.matrixWorld).invert();
      reflCam.projectionMatrix.copy(camera.projectionMatrix);
      reflCam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      renderer.clippingPlanes = keepAbove;
      renderer.setRenderTarget(reflRT);
      renderer.clear();
      renderer.render(scene, reflCam);

      // impronta dello scafo e schiuma
      renderer.clippingPlanes = keepBelow;
      scene.overrideMaterial = white;
      renderer.setRenderTarget(maskRT);
      renderer.clear();
      renderer.render(scene, topCam);
      scene.overrideMaterial = prevOverride;
      renderer.clippingPlanes = [];

      feedback.uniforms.tPrev.value = foamA.texture;
      feedback.uniforms.uShift.value = (flow * dt) / W;
      feedback.uniforms.uDecay.value = Math.pow(0.6, dt); // dopo un secondo resta il 60%
      renderer.setRenderTarget(foamB);
      renderer.render(quadScene, quadCam);
      [foamA, foamB] = [foamB, foamA];
      uniforms.uFoamTex.value = foamA.texture;

      renderer.setRenderTarget(prevTarget);
      renderer.clippingPlanes = prevClipping;
      renderer.shadowMap.autoUpdate = prevAuto;
      scene.background = prevBg;
      renderer.setClearColor(clear, prevAlpha);
    },
  };
}
