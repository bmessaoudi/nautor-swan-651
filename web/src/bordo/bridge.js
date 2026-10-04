// Ponte fra il computer di bordo (agente vocale, cartella agent/) e la pagina.
// L'agente chiama questi metodi via RPC di LiveKit; la pagina gli manda lo stato con gli
// attributi del partecipante a ogni cambio di passo.
import { RoomEvent, RpcError } from "livekit-client";
import { makeConditions } from "../conditions.js";
import { PASSI } from "./passi.js";
import { IMMAGINI } from "./immagini.js";
import { GRAFICI } from "./media.js";

export const CHAPTER_NAMES = ["Blueprint", "Esterni", "Interni", "Navigazione"];
const PRESETS = ["alba", "mattino", "mezzogiorno", "pomeriggio", "tramonto", "foschia", "pioggia"];

export function chapterOf(chapters, step) {
  const i = chapters.findLastIndex((c) => step >= c);
  return i < 0 ? "Apertura" : CHAPTER_NAMES[i];
}

// Indice dei contenuti per l'agente: lo riceve all'avvio, così testi, passi, dettagli e
// immagini hanno una sola fonte (passi.js, story.js, immagini.js)
function readIndex(site) {
  const { scena } = site;
  return {
    passi: PASSI.map((p, i) => ({ passo: i, capitolo: chapterOf(scena.chapters, i), ...p })),
    capitoli: CHAPTER_NAMES.map((nome, i) => ({ nome, passo: scena.chapters[i] })),
    hotspots: scena.hotspots.map((h) => ({ id: h.id, passo: h.steps[0], titolo: h.title, testo: h.text })),
    immagini: [...GRAFICI, ...IMMAGINI].map(({ id, titolo, descrizione }) => ({ id, titolo, descrizione })),
    atmosfere: PRESETS,
  };
}

function state(site) {
  const { scena } = site;
  const passo = scena.step;
  const c = scena.conditions();
  return {
    passo,
    capitolo: chapterOf(scena.chapters, passo),
    titolo: PASSI[passo]?.titolo || "",
    mare: c ? `${c.label}, ${c.knots} nodi, ${c.coastLabel}` : "",
    immagine: site.immagineCorrente() || "",
  };
}

export function createBridge(site, room, { onSpegni } = {}) {
  const { scena } = site;

  // Lo stesso preset ha molti semi: si cerca il primo che lo produce partendo da un punto a caso
  function seedFor(preset) {
    const start = 1 + Math.floor(Math.random() * 90000);
    for (let s = start; s < start + 400; s++) if (makeConditions(s).preset === preset) return s;
    return start;
  }

  const handlers = {
    // l'indice supera il limite di una risposta RPC (15 KB): parte come stream di testo
    "sito.indice": async (_args, caller) => {
      await room.localParticipant.sendText(JSON.stringify(readIndex(site)), { topic: "sito.indice", destinationIdentities: [caller] });
      return {};
    },
    "sito.stato": () => state(site),
    "sito.vaiAlPasso": ({ passo, titolo, dati }) => {
      scena.focus(null);
      const to = scena.goTo(passo);
      // se la camera si muove, all'arrivo torna da solo il pannello del passo
      if (!scena.moving) site.nascondiImmagine();
      site.mostraParole(titolo, dati, { attendi: scena.moving });
      // la durata del volo (ms) serve all'agente per far partire il racconto all'arrivo
      return { passo: to, durata: scena.restante };
    },
    "sito.mostraDettaglio": ({ id, titolo, dati }) => {
      const h = scena.hotspots[id];
      if (!h) throw new Error(`dettaglio ${id} inesistente`);
      scena.goTo(h.steps[0]);
      if (!scena.moving) site.nascondiImmagine();
      scena.focus(id);
      site.mostraParole(titolo || h.title, dati, { attendi: scena.moving });
      return { passo: h.steps[0], titolo: h.title, durata: scena.restante };
    },
    "sito.mostraParole": ({ titolo, dati }) => {
      site.mostraParole(titolo, dati);
      return {};
    },
    "sito.mostraImmagine": ({ id }) => {
      if (!site.mostraImmagine(id)) throw new Error(`immagine ${id} inesistente`);
      return {};
    },
    "sito.nascondiImmagine": () => {
      site.nascondiImmagine();
      return {};
    },
    "sito.cambiaMare": ({ atmosfera }) => {
      const seed = PRESETS.includes(atmosfera) ? seedFor(atmosfera) : 1 + Math.floor(Math.random() * 99999);
      scena.setSeed(seed);
      const c = scena.conditions();
      // il mare si vede solo nel capitolo Navigazione: se si è altrove, ci si va
      let passo = scena.step;
      if (passo < scena.chapters[3]) passo = scena.goTo(scena.chapters[3]);
      return { passo, mare: `${c.label}, ${c.knots} nodi, ${c.coastLabel}`, durata: scena.restante };
    },
    // si risponde prima di staccare, altrimenti l'agente resta in attesa della risposta
    "sito.spegni": () => {
      setTimeout(() => onSpegni?.(), 300);
      return {};
    },
  };

  for (const [method, fn] of Object.entries(handlers)) {
    room.registerRpcMethod(method, async (data) => {
      try {
        const args = data.payload ? JSON.parse(data.payload) : {};
        return JSON.stringify(await fn(args, data.callerIdentity));
      } catch (err) {
        // il messaggio arriva all'agente, che lo passa a Claude come errore del tool
        throw new RpcError(1500, err.message);
      }
    });
  }

  let last = "";
  function publish() {
    if (room.state !== "connected") return;
    const s = state(site);
    const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    room.localParticipant.setAttributes({ "sito.stato": key }).catch(() => {});
  }
  // il ponte nasce prima della connessione: il primo stato parte appena si entra nella stanza
  room.on(RoomEvent.Connected, publish);

  return {
    publish,
    dispose() {
      room.off(RoomEvent.Connected, publish);
      for (const method of Object.keys(handlers)) room.unregisterRpcMethod(method);
    },
  };
}
