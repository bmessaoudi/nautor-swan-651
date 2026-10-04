// Pagina del museo guidato a voce (/bordo/). Si entra al buio: ci sono solo i comandi di vetro,
// e col pulsante di accensione si accendono la sfera della voce e poi la barca.
// Lo schermo mostra la barca, poche parole chiave e, quando servono, foto o grafici: il
// racconto lo fa il computer di bordo. A sinistra un indice di argomenti da chiedere.
import "./pagina.css";
import { createScena } from "./scena.js";
import { createSuoni } from "./suoni.js";
import { createCollegamento } from "./bordo.js";
import { createPlancia } from "./plancia.js";
import { createLivello } from "./livello.js";
import { INDICE } from "./indice.js";
import { IMMAGINI } from "./immagini.js";
import { GRAFICI } from "./media.js";
import { PASSI } from "./passi.js";

const $ = (sel) => document.querySelector(sel);
const LABELS = {
  off: "Spento",
  connecting: "Accensione",
  initializing: "Accensione",
  listening: "Tieni premuto per parlare",
  thinking: "Elabora",
  speaking: "Parla",
  error: "Non raggiungibile",
};

const suoni = createSuoni();
// assegnato più sotto: la scena manda eventi già mentre nasce
let collegamento = null;

// ---------- Comandi ----------
const plancia = createPlancia($("#plancia"));
const statoEl = $("#plancia .stato");
// lo stile è caricato e la plancia c'è: la pagina sfuma dal navy (vedi lo stile in bordo/index.html)
// (la lettura di offsetHeight fissa prima l'opacità 0, così la transizione parte davvero)
void document.body.offsetHeight;
document.body.classList.add("visibile");
// Indietro verso la landing: la pagina sfuma nel navy prima di cambiare, come all'arrivo
$("#indietro").addEventListener("click", (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  const href = e.currentTarget.href;
  document.body.classList.remove("visibile");
  setTimeout(() => location.assign(href), 800);
});
// Tornando con il pulsante indietro del browser la pagina arriva dalla cache sfumata e senza
// collegamento: si ricarica da capo
addEventListener("pageshow", (e) => {
  if (e.persisted) location.reload();
});

// ---------- Scena ----------
// spazio occupato da indice e comandi, misurato una volta e a ogni ridimensionamento
const NESSUN_MARGINE = { sinistra: 0, destra: 0, alto: 0, basso: 0 };
let margini = NESSUN_MARGINE;
function misuraMargini() {
  const el = $("#plancia");
  const scala = parseFloat(getComputedStyle(document.body).getPropertyValue("--scala-plancia")) || 1;
  const largo = innerWidth > 900;
  margini = {
    sinistra: largo ? 290 : 0,
    // colonna delle parole chiave e delle foto, a destra
    destra: largo ? Math.min(440, innerWidth * 0.3) + innerWidth * 0.06 : 0,
    // sul telefono le parole stanno in alto
    alto: largo ? 0 : 150,
    basso: Math.min(innerHeight * 0.3, el.offsetHeight * scala + 18),
  };
}
addEventListener("resize", misuraMargini);
misuraMargini();

// Ingresso centrato in verticale: la sfera scende (o sale) di metà della differenza fra invito e nota.
// Le misure offset* ignorano la scala della plancia, che il CSS applica da sé.
function centraIngresso() {
  const spinta = ($("#ingresso").offsetHeight - $("#ingresso-sotto").offsetHeight) / 2;
  const dock = $("#plancia .dock");
  const sottoSfera = $("#plancia").offsetHeight - dock.offsetTop - dock.offsetHeight / 2;
  document.body.style.setProperty("--spinta", `${spinta}px`);
  document.body.style.setProperty("--sotto-sfera", `${sottoSfera}px`);
}
// ricalcolo quando invito o nota cambiano altezza: finestra, font caricato, nota che a barca
// pronta passa da "Caricamento" all'avviso del microfono
const osservaIngresso = new ResizeObserver(centraIngresso);
osservaIngresso.observe($("#ingresso"));
osservaIngresso.observe($("#ingresso-sotto"));
centraIngresso();
const pct = $("#ingresso-sotto .pct");
const scena = createScena({
  canvas: $("#gl"),
  margini: () => (document.body.dataset.fase === "visita" ? margini : NESSUN_MARGINE),
  onEvent(name, data) {
    if (name === "fotogramma") {
      suoni.frame(data);
      return;
    }
    suoni.event(name, data);
    if (name === "caricamento") pct.textContent = `${Math.round(data * 100)}%`;
    if (name === "passo") {
      aggiornaIndice(data);
      if (document.body.dataset.fase === "visita") arrivaAlPasso(data);
      collegamento?.pubblicaStato();
    }
    if (name === "mare") collegamento?.pubblicaStato();
  },
});
// la scena 3D lavora davvero solo quando si vede: all'ingresso e durante l'accensione il canvas
// è nascosto dal CSS (post.pace la tiene a un fotogramma ogni mezzo secondo)
const scenaVisibile = () => !["ingresso", "accensione"].includes(document.body.dataset.fase);
scena.visible = scenaVisibile();
new MutationObserver(() => (scena.visible = scenaVisibile())).observe(document.body, { attributes: true, attributeFilter: ["data-fase"] });

// ---------- Parole chiave ----------
// Un titolo breve e al massimo tre dati, scelti dall'agente. Durante uno spostamento lungo
// compaiono a metà strada, insieme alla scena a cui si riferiscono.
const paroleEl = $("#parole");
let pendingParole = null;
function mostraParole(titolo, dati = [], { attendi = false } = {}) {
  paroleEl.classList.remove("on");
  if (attendi) {
    pendingParole = [titolo, dati];
    return;
  }
  // senza parole dell'agente resta il titolo del passo: la colonna non si svuota
  if (!titolo && !dati?.length) titolo = PASSI[scena.step]?.titolo;
  if (!titolo) return;
  setTimeout(() => {
    paroleEl.querySelector(".parole-titolo").textContent = titolo || "";
    paroleEl.querySelector(".parole-dati").innerHTML = (dati || [])
      .slice(0, 3)
      .map((d) => `<div><dd>${esc(d.valore)}</dd><dt class="mono">${esc(d.etichetta)}</dt></div>`)
      .join("");
    paroleEl.classList.add("on");
  }, 180);
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- Foto e grafici ----------
// La colonna di destra non resta mai vuota: ogni passo ha un suo pannello (passi.js), che
// compare all'arrivo. L'agente può aprire un'altra foto sopra; quando la chiude, o quando la
// camera va altrove, torna il pannello del passo. Sul telefono il pannello coprirebbe la
// barca: lì compaiono solo le foto scelte dall'agente.
const mediaEl = $("#media");
const largo = matchMedia("(min-width: 901px)");
let immagine = null;
let cambio = 0;
function mostraImmagine(id) {
  const g = GRAFICI.find((x) => x.id === id);
  const img = IMMAGINI.find((x) => x.id === id);
  if (!g && !img) return false;
  if (id === immagine) return true;
  immagine = id;
  document.body.classList.add("con-media");
  collegamento?.pubblicaStato();
  // se c'è già qualcosa aperto, prima sfuma e poi cambia
  clearTimeout(cambio);
  if (mediaEl.classList.contains("on")) {
    mediaEl.classList.remove("on");
    cambio = setTimeout(() => riempiMedia(g, img), 420);
  } else riempiMedia(g, img);
  return true;
}
function riempiMedia(g, img) {
  const id = (g || img).id;
  const corpo = mediaEl.querySelector(".media-corpo");
  if (g) {
    corpo.innerHTML = `<svg class="grafico ${id}"></svg><div class="legenda mono"></div>`;
    corpo.querySelector(".legenda").innerHTML = g.disegna(corpo.querySelector("svg")) || "";
  } else {
    corpo.innerHTML = `<img src="${img.file}" alt="${esc(img.descrizione)}" />`;
  }
  const it = g || img;
  mediaEl.querySelector(".media-titolo").textContent = it.titolo;
  mediaEl.querySelector(".media-didascalia").textContent = it.didascalia || "";
  // il grafico si disegna (tratteggio animato) solo quando è visibile
  requestAnimationFrame(() => requestAnimationFrame(() => mediaEl.classList.add("on")));
}
function chiudiMedia() {
  clearTimeout(cambio);
  mediaEl.classList.remove("on");
  document.body.classList.remove("con-media");
  immagine = null;
  collegamento?.pubblicaStato();
}
const pannelloDi = (step) => (largo.matches ? PASSI[step]?.pannello : null);
// chiude la foto scelta dall'agente: al suo posto torna il pannello del passo
function nascondiImmagine() {
  const pannello = document.body.dataset.fase === "visita" && pannelloDi(scena.step);
  if (pannello) mostraImmagine(pannello);
  else if (immagine) chiudiMedia();
}
largo.addEventListener("change", () => {
  if (document.body.dataset.fase === "visita") nascondiImmagine();
});

// All'arrivo a un passo: le parole chieste dall'agente o, se non ne ha date, il titolo del
// passo; poi il pannello del passo al posto di qualunque foto precedente.
function arrivaAlPasso(step) {
  const [titolo, dati] = pendingParole || [null, []];
  pendingParole = null;
  mostraParole(titolo || PASSI[step]?.titolo, dati);
  nascondiImmagine();
}

// ---------- Indice ----------
// l'indice sta su una card: il mare e il cielo dietro non tolgono leggibilità alle voci
const indiceEl = $("#indice .indice-voci");
indiceEl.innerHTML = INDICE.map(
  (g) => `<div class="gruppo"><span class="mono">${g.gruppo}</span>${g.voci
    .map((v) => `<button type="button" data-passo="${v.passo ?? ""}">${v.nome}</button>`)
    .join("")}</div>`
).join("");
const voci = [...indiceEl.querySelectorAll("button")];
voci.forEach((b) =>
  b.addEventListener("click", () => {
    const passo = b.dataset.passo === "" ? null : +b.dataset.passo;
    if (collegamento.acceso) {
      // l'agente ne parla come se gliel'avessero chiesto, e decide lui dove portare la camera
      collegamento.invia(`[Argomento scelto dall'indice: ${b.textContent}]`);
      b.classList.add("chiesto");
      return;
    }
    // a computer spento l'indice porta almeno alla scena
    if (passo == null) return;
    scena.focus(null);
    scena.goTo(passo);
    mostraParole(b.textContent, [], { attendi: scena.moving });
  })
);
function aggiornaIndice(step) {
  voci.forEach((b) => b.classList.toggle("qui", b.dataset.passo !== "" && +b.dataset.passo === step));
}

// ---------- Voce ----------
let livelloVoce = null;
let livelloMic = null;
let stato = "off";
let premuto = false;

function setState(s) {
  stato = s;
  $("#plancia").dataset.state = s;
  if (!premuto) statoEl.textContent = LABELS[s] || s;
  const on = s !== "off" && s !== "error";
  plancia.setLeva("power", on);
  plancia.orb.setState(s);
  suoni.setSpeaking(s === "speaking");
  if (!on) {
    livelloVoce?.stop();
    livelloMic?.stop();
    livelloVoce = livelloMic = null;
  }
}
// la sfera segue la voce di chi visita mentre tiene premuto, quella dell'agente quando parla
plancia.orb.setSource(() => {
  if (premuto) return livelloMic?.get() ?? 0;
  if (stato === "speaking") return livelloVoce?.get() ?? 0;
  return 0;
});

collegamento = createCollegamento(
  { scena, mostraParole, mostraImmagine, nascondiImmagine, immagineCorrente: () => immagine },
  {
    onState: setState,
    onVoice(track) {
      livelloVoce?.stop();
      livelloVoce = createLivello(track);
    },
    onMic(track) {
      livelloMic?.stop();
      livelloMic = createLivello(track);
    },
    onTranscript: sottotitolo,
  }
);

// ---------- Push to talk ----------
// Si parla tenendo premuta la sfera o la barra spaziatrice: il
// microfono è aperto solo in quel momento, così rumori e voci intorno non interrompono.
const centro = $("#plancia .sfera");
centro.setAttribute("role", "button");
centro.setAttribute("aria-label", "Tieni premuto per parlare");
function premi() {
  if (premuto || !collegamento.acceso || stato === "connecting" || stato === "initializing") return;
  premuto = true;
  $("#plancia").classList.add("premuto");
  statoEl.textContent = "Ti ascolto";
  suoni.setSpeaking(true);
  collegamento.inizioTurno();
}
function rilascia() {
  if (!premuto) return;
  premuto = false;
  $("#plancia").classList.remove("premuto");
  statoEl.textContent = LABELS[stato] || stato;
  suoni.setSpeaking(stato === "speaking");
  collegamento.fineTurno();
}
centro.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  centro.setPointerCapture(e.pointerId);
  premi();
});
centro.addEventListener("pointerup", rilascia);
centro.addEventListener("pointercancel", rilascia);
addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || e.target.closest("button")) return;
  e.preventDefault();
  premi();
});
addEventListener("keyup", (e) => {
  if (e.code === "Space") rilascia();
});
addEventListener("blur", rilascia);

// ---------- Pulsanti ----------
plancia.leva("power").addEventListener("click", async () => {
  if (!scena.ready.done) return;
  if (collegamento.acceso) {
    suoni.event("spegnimento");
    collegamento.spegni();
    return;
  }
  plancia.setLeva("power", true);
  if (document.body.dataset.fase === "ingresso") await accendiPlancia();
  suoni.event("accensione");
  collegamento.accendi();
});

const ccEl = $("#cc");
let ccTimer = 0;
plancia.leva("cc").addEventListener("click", () => {
  const on = !document.body.classList.contains("cc-on");
  document.body.classList.toggle("cc-on", on);
  plancia.setLeva("cc", on);
});
function sottotitolo({ own, text, final }) {
  if (own) return;
  clearTimeout(ccTimer);
  // gli audio tag ([chuckles], [whispers]...) sono per la voce, non per chi legge
  const pulito = text.replace(/\[[^\]]*\]\s*/g, "").trim();
  // un segmento può durare un paragrafo: si mostrano solo le ultime frasi, al massimo due righe
  const frasi = pulito.match(/[^.!?…]+[.!?…]*\s*/g) || [pulito];
  let coda = "";
  for (let i = frasi.length - 1; i >= 0 && (coda + frasi[i]).length <= 150; i--) coda = frasi[i] + coda;
  ccEl.textContent = (coda || frasi.at(-1)).trim();
  ccEl.classList.add("on");
  if (final) ccTimer = setTimeout(() => ccEl.classList.remove("on"), 3500);
}

plancia.leva("audio").addEventListener("click", () => {
  suoni.setMuted(!suoni.muted);
  plancia.setLeva("audio", !suoni.muted);
});

// ---------- Ingresso ----------
// Tutto spento: i comandi al centro. Il pulsante accende la sfera, poi la barca appare e i
// comandi scendono al loro posto.
scena.ready.then(() => {
  scena.ready.done = true;
  document.body.classList.add("pronta");
});
async function accendiPlancia() {
  await suoni.start();
  document.body.dataset.fase = "accensione";
  plancia.orb.setState("connecting");
  await plancia.accensione();
  await new Promise((r) => setTimeout(r, 450));
  document.body.dataset.fase = "visita";
  aggiornaIndice(scena.step);
  arrivaAlPasso(scena.step);
}

// per provare plancia e regia dalla console; ?passo=N apre direttamente una scena
if (import.meta.env.DEV) {
  Object.assign(window, { __pagina: { plancia, scena, setState, mostraParole, mostraImmagine } });
  const passo = new URLSearchParams(location.search).get("passo");
  if (passo !== null) {
    scena.ready.then(() => {
      document.body.dataset.fase = "visita";
      scena.goTo(+passo, { immediato: true });
    });
  }
}
