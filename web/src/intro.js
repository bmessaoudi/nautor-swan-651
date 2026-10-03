// Intro come nella home di Wikiswan: il video parte subito sotto la velatura, scorre una
// volta e alla fine (o al clic sulla CTA) si passa al museo con una dissolvenza.
// Con riduzione del movimento il video resta sul fotogramma fermo e nulla si muove da solo.

const MUSEUM_HREF = "/modello.html";
/** Durata della dissolvenza in uscita, uguale alla transizione di .page-fade. */
const FADE_MS = 900;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const hero = document.querySelector(".hero");
const video = hero.querySelector(".hero-video");
const canvas = hero.querySelector(".hero-ripple");
const cta = hero.querySelector(".cta");

let leaving = false;
function leave() {
  if (leaving) return;
  leaving = true;
  document.body.classList.add("leaving");
  setTimeout(() => location.assign(MUSEUM_HREF), reducedMotion ? 0 : FADE_MS);
}

cta.addEventListener("click", (event) => {
  // Cmd/Ctrl-clic e simili restano al browser (nuova scheda, ecc.).
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  leave();
});
video.addEventListener("ended", leave);

// Tornando indietro dal museo la pagina può uscire dalla bfcache ancora velata.
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  leaving = false;
  document.body.classList.remove("leaving");
});

// Precarica il museo mentre scorre il video: il modello 3D e le risorse che modello.html
// richiama (lette dalla pagina stessa, così valgono anche i nomi con hash della build).
// Finiscono nella cache HTTP, e il museo all'arrivo si apre senza attese.
function prefetch(href, crossOrigin = null) {
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.href = href;
  // Stessa modalità della richiesta vera (Vite mette crossorigin su script e CSS), così la cache combacia.
  if (crossOrigin !== null) link.crossOrigin = crossOrigin;
  document.head.appendChild(link);
}

/** Texture dei materiali del museo: stesso elenco di recipes() in materials.js. */
const MUSEUM_TEXTURES = [
  "teak_veneer_diff.jpg", "teak_veneer_nor_gl.jpg", "teak_veneer_rough.jpg",
  "leather_red_02_nor_gl.jpg", "leather_red_02_rough.jpg",
  "cotton_jersey_diff.jpg", "cotton_jersey_nor_gl.jpg", "cotton_jersey_rough.jpg",
  "teak_deck.png",
];

function preloadMuseum() {
  prefetch("/models/swan651.glb");
  for (const name of MUSEUM_TEXTURES) prefetch(`/textures/${name}`);
  fetch(MUSEUM_HREF)
    .then((response) => response.text())
    .then((html) => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      for (const node of doc.querySelectorAll('script[src], link[rel="stylesheet"], link[rel="modulepreload"]')) {
        prefetch(node.getAttribute("src") || node.getAttribute("href"), node.getAttribute("crossorigin"));
      }
    })
    .catch(() => {});
}

// Dopo il load, per non rubare banda al video e alle immagini dell'intro.
if (document.readyState === "complete") preloadMuseum();
else window.addEventListener("load", preloadMuseum, { once: true });

// play() esplicito invece dell'attributo autoplay, così la riduzione del movimento può
// rinunciarci. Se il browser lo blocca, l'intro resta sul fotogramma fermo.
if (!reducedMotion) video.play().catch(() => {});

// Increspature sull'acqua del video, guidate dal mouse: muovendosi si lascia una scia di
// piccoli anelli, cliccando cade una goccia più forte. Disegnate su un canvas WebGL sopra
// il <video>, che resta il fallback su touch, con riduzione del movimento o senza WebGL.

/** Gocce tenute in GPU: le più vecchie vengono sovrascritte da quelle nuove. */
const MAX_DROPS = 24;
/** Secondi in cui una goccia continua a incresparsi prima di svanire. */
const DROP_LIFE = 2.6;
/** Spostamento minimo del cursore (px CSS) tra due gocce durante il movimento. */
const DROP_SPACING = 36;
/** Limite ai pixel del dispositivo: l'effetto è morbido, la risoluzione retina non serve. */
const MAX_DPR = 1.5;

const VERTEX = /* glsl */ `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Ogni goccia è un anello che si allarga, con ampiezza che cala con l'età e con la distanza
// dal fronte d'onda. Lo spostamento sommato sfasa la lettura dell'immagine e la pendenza
// aggiunge un leggero riflesso, così le creste prendono la luce come l'acqua.
const FRAGMENT = /* glsl */ `
precision mediump float;
uniform sampler2D u_img;
uniform vec2 u_res;
uniform vec2 u_imgSize;
uniform float u_time;
uniform float u_dpr;
uniform vec4 u_drops[${MAX_DROPS}];

vec2 coverUv(vec2 p) {
  vec2 uv = p / u_res;
  float canvasAspect = u_res.x / u_res.y;
  float imgAspect = u_imgSize.x / u_imgSize.y;
  if (canvasAspect > imgAspect) {
    uv.y = (uv.y - 0.5) * imgAspect / canvasAspect + 0.5;
  } else {
    uv.x = (uv.x - 0.5) * canvasAspect / imgAspect + 0.5;
  }
  return uv;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 offset = vec2(0.0);
  float shade = 0.0;
  float speed = 320.0 * u_dpr;
  float width = 70.0 * u_dpr;

  for (int i = 0; i < ${MAX_DROPS}; i++) {
    vec4 drop = u_drops[i];
    float age = u_time - drop.z;
    if (drop.w <= 0.0 || age < 0.0 || age > ${DROP_LIFE.toFixed(1)}) continue;
    vec2 delta = p - drop.xy;
    float dist = length(delta);
    float front = dist - age * speed;
    float envelope = exp(-age * 1.6) * exp(-(front * front) / (width * width));
    float wave = sin(front * 0.09 / u_dpr) * envelope * drop.w;
    vec2 dir = dist > 0.001 ? delta / dist : vec2(0.0);
    offset += dir * wave * 5.0 * u_dpr;
    shade += wave;
  }

  vec4 color = texture2D(u_img, coverUv(p + offset));
  gl_FragColor = vec4(color.rgb + shade * 0.03, 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function setupRipple() {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!finePointer || reducedMotion) return;

  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false });
  if (!gl) return;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);

  // Due triangoli a schermo intero.
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    res: gl.getUniformLocation(program, "u_res"),
    imgSize: gl.getUniformLocation(program, "u_imgSize"),
    time: gl.getUniformLocation(program, "u_time"),
    dpr: gl.getUniformLocation(program, "u_dpr"),
    drops: gl.getUniformLocation(program, "u_drops"),
  };

  const drops = new Float32Array(MAX_DROPS * 4);
  let nextDrop = 0;
  let lastDropAt = null;
  let lastDropTime = -Infinity;
  let frame = 0;
  let texture = null;
  const start = performance.now();
  const now = () => (performance.now() - start) / 1000;
  let dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  const draw = () => {
    if (!texture) return;
    // Un fotogramma nuovo a ogni disegno (appena il video ne ha uno da dare).
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
    }
    gl.uniform2f(uniforms.res, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, now());
    gl.uniform1f(uniforms.dpr, dpr);
    gl.uniform4fv(uniforms.drops, drops);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw();
  };

  // Anima finché il video scorre o un'increspatura è ancora viva, altrimenti tiene l'ultimo fotogramma.
  const loop = () => {
    draw();
    const t = now();
    let alive = !video.paused && !video.ended;
    for (let i = 0; i < MAX_DROPS; i++) {
      if (drops[i * 4 + 3] > 0 && t - drops[i * 4 + 2] < DROP_LIFE) alive = true;
    }
    frame = alive ? requestAnimationFrame(loop) : 0;
  };

  const addDrop = (clientX, clientY, strength) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;
    const i = nextDrop * 4;
    drops[i] = x * dpr;
    drops[i + 1] = y * dpr;
    drops[i + 2] = now();
    drops[i + 3] = strength;
    nextDrop = (nextDrop + 1) % MAX_DROPS;
    if (!frame) frame = requestAnimationFrame(loop);
  };

  const startVideo = () => {
    if (!video.videoWidth) return;
    if (!texture) {
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform2f(uniforms.imgSize, video.videoWidth, video.videoHeight);
      resize();
      canvas.classList.add("ready");
    }
    if (!frame) frame = requestAnimationFrame(loop);
  };

  // "loadeddata" mette il primo fotogramma (fermo) sotto le increspature prima che parta il video.
  video.addEventListener("loadeddata", startVideo);
  video.addEventListener("playing", startVideo);
  if (video.readyState >= video.HAVE_CURRENT_DATA) startVideo();

  new ResizeObserver(resize).observe(canvas);

  // Eventi letti dalla sezione, così velature e testi sopra il canvas non li bloccano.
  hero.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const t = now();
    const moved = lastDropAt ? Math.hypot(event.clientX - lastDropAt.x, event.clientY - lastDropAt.y) : Infinity;
    if (moved < DROP_SPACING && t - lastDropTime < 0.25) return;
    lastDropAt = { x: event.clientX, y: event.clientY };
    lastDropTime = t;
    addDrop(event.clientX, event.clientY, 0.55);
  });
  hero.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse") return;
    addDrop(event.clientX, event.clientY, 1.4);
  });
}

setupRipple();
