// Sfera della voce, al centro dei comandi: acqua di mare che si muove dentro un vetro.
// Reagisce al livello della voce (dell'agente quando parla, della persona quando ascolta),
// gira più in fretta quando l'agente elabora. Canvas piccolo e un solo shader: il costo è
// trascurabile, e quando la sfera è spenta il ciclo si ferma.

const VERT = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform float uTime, uPhase, uSpin, uLevel, uOn, uThink;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / (0.5 * uRes.y);
  float r = length(uv);
  // la sfera respira piano e si gonfia con la voce
  float R = 0.8 + 0.035 * uLevel + 0.012 * sin(uTime * 0.9);
  float mask = smoothstep(R, R - 0.025, r);
  float z = sqrt(max(0.0, 1.0 - (r * r) / (R * R)));
  // coordinate curvate sulla superficie: il moto sembra scorrere attorno a una sfera
  vec2 p = uv / R * (1.0 + 0.7 * (1.0 - z));
  // fase e vortice arrivano già integrati dalla CPU: cambiare velocità non fa saltare il moto
  float t = uPhase;
  float ang = uSpin;
  p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * p;
  vec2 q = vec2(fbm(p * 1.5 + vec2(t, -t * 0.7)), fbm(p * 1.5 + vec2(-t * 0.8, t * 0.5) + 3.1));
  float n = fbm(p * 2.1 + q * (1.3 + 0.7 * uLevel) + vec2(0.0, t * 1.3));

  vec3 deep = vec3(0.0, 0.13, 0.24);
  vec3 sea = vec3(0.08, 0.48, 0.67);
  vec3 cyan = vec3(0.61, 0.79, 0.88);
  vec3 foam = vec3(0.95, 0.98, 1.0);
  vec3 col = mix(deep, sea, smoothstep(0.2, 0.62, n));
  col = mix(col, cyan, smoothstep(0.55, 0.82, n + q.x * 0.3));
  col = mix(col, foam, smoothstep(0.78, 0.98, n + 0.12 * uLevel));
  // luce dall'alto, bordo che si accende, riflesso del vetro
  col *= 0.5 + 0.65 * z;
  col += pow(1.0 - z, 3.0) * vec3(0.35, 0.65, 1.0) * (0.45 + 0.5 * uLevel);
  col += smoothstep(0.32, 0.0, length(uv - vec2(-0.3, 0.36) * R)) * 0.22;
  // spenta: acqua ferma e grigia dietro il vetro, non un buco nero
  col = mix(vec3(dot(col, vec3(0.3, 0.5, 0.2))) * 0.55 + 0.06, col, uOn);

  float glow = exp(-9.0 * max(r - R, 0.0)) * (0.18 + 0.55 * uLevel) * uOn * (1.0 - mask);
  gl_FragColor = vec4(col * mask + vec3(0.3, 0.6, 1.0) * glow, max(mask, glow));
}`;

export function createOrb(canvas) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
    gl.attachShader(prog, sh);
  }
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(["uRes", "uTime", "uPhase", "uSpin", "uLevel", "uOn", "uThink"].map((k) => [k, gl.getUniformLocation(prog, k)]));

  function size() {
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    if (canvas.width !== w) {
      canvas.width = canvas.height = w;
      gl.viewport(0, 0, w, w);
    }
  }

  let on = 0;
  let onTarget = 0;
  let think = 0;
  let thinkTarget = 0;
  let level = 0;
  let source = () => 0;
  let raf = 0;
  let last = performance.now();
  let time = Math.random() * 100;
  let phase = Math.random() * 100;
  let spin = 0;

  function draw() {
    size();
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uPhase, phase);
    gl.uniform1f(u.uSpin, spin);
    gl.uniform1f(u.uLevel, level);
    gl.uniform1f(u.uOn, on);
    gl.uniform1f(u.uThink, think);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    on += (onTarget - on) * Math.min(1, dt * 2.5);
    think += (thinkTarget - think) * Math.min(1, dt * 3);
    // la voce cambia di continuo: il livello la segue morbido, senza inseguire ogni sillaba
    const l = Math.min(1, source() * 1.5);
    level += (l - level) * Math.min(1, dt * (l > level ? 4 : 1.8));
    // mentre parla l'acqua accelera appena; il vortice resta di quando elabora
    phase += dt * (0.1 + 0.4 * think + 0.18 * level);
    spin += dt * 0.7 * think;
    draw();
    // spenta e ferma: niente più fotogrammi
    if (onTarget === 0 && on < 0.002) {
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function wake() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  draw();
  return {
    // stato dell'agente: off, connecting, listening, thinking, speaking, error
    setState(s) {
      onTarget = s === "off" || s === "error" ? 0 : s === "connecting" || s === "initializing" ? 0.45 : 1;
      thinkTarget = s === "thinking" || s === "connecting" || s === "initializing" ? 1 : 0;
      wake();
    },
    // funzione che restituisce il livello della voce da seguire (0..1)
    setSource(fn) {
      source = fn || (() => 0);
    },
  };
}
