// Collegamento al computer di bordo: token, stanza LiveKit, microfono, voce dell'agente,
// trascrizioni e messaggi di testo. La pagina riceve solo eventi; i comandi dell'agente
// arrivano al ponte (bridge.js).
import { Room, RoomEvent, Track } from "livekit-client";
import { createBridge } from "./bridge.js";

// Il server dei token gira accanto all'agente (agent/token_server.py)
const TOKEN_URL = import.meta.env.VITE_BORDO_TOKEN_URL || "http://localhost:8790/token";

export function createCollegamento(site, { onState, onVoice, onMic, onTranscript, onGiro }) {
  let room = null;
  let bridge = null;
  let micPub = null;
  let parlando = false;
  let audioEls = [];

  async function accendi() {
    onState("connecting");
    try {
      const res = await fetch(TOKEN_URL);
      if (!res.ok) throw new Error(`token: ${res.status}`);
      const { url, token } = await res.json();

      room = new Room({ adaptiveStream: false, dynacast: false });
      bridge = createBridge(site, room, { onSpegni: spegni });
      if (import.meta.env.DEV) window.__bordo = room;

      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        const a = track.attach();
        a.style.display = "none";
        document.body.appendChild(a);
        audioEls.push(a);
        onVoice(track.mediaStreamTrack);
      });
      // l'agente pubblica il proprio stato (in ascolto, elabora, parla) come attributo
      room.on(RoomEvent.ParticipantAttributesChanged, (changed, p) => {
        if (p === room.localParticipant) return;
        const s = changed["lk.agent.state"];
        if (s) onState(s);
        // il giro guidato: l'agente lo accende e lo spegne, la pagina lo fa proseguire
        if ("bordo.giro" in changed) onGiro?.(changed["bordo.giro"] === "1");
      });
      let agenteCaduto = false;
      room.on(RoomEvent.Disconnected, () => cleanup(agenteCaduto ? "error" : "off"));
      // se l'agente esce senza che glielo si chieda, la plancia lo segnala
      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        if (!p.isAgent) return;
        agenteCaduto = true;
        room?.disconnect();
      });
      // trascrizioni: dell'agente per i sottotitoli, della persona per sapere che ha parlato
      room.registerTextStreamHandler("lk.transcription", async (reader, info) => {
        const own = info.identity === room.localParticipant.identity;
        const id = reader.info.attributes?.["lk.segment_id"] || reader.info.id;
        let text = "";
        for await (const chunk of reader) {
          text += chunk;
          onTranscript({ own, id, text, final: false });
        }
        onTranscript({ own, id, text, final: true });
      });

      // il clic sul pulsante è anche il gesto che sblocca audio e microfono nel browser
      await room.startAudio();
      await room.connect(url, token);
      micPub = await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      // push to talk: il microfono resta muto finché non si tiene premuto
      await micPub?.mute();
      if (micPub?.track) onMic?.(micPub.track.mediaStreamTrack);
      onState("initializing");
    } catch (err) {
      console.error("[bordo]", err);
      await room?.disconnect();
      cleanup("error");
    }
  }

  function cleanup(state) {
    if (!room && !bridge) return;
    bridge?.dispose();
    bridge = null;
    for (const a of audioEls) a.remove();
    audioEls = [];
    room = null;
    micPub = null;
    parlando = false;
    onState(state);
  }

  async function spegni() {
    const r = room;
    if (r) await r.disconnect();
    cleanup("off");
  }

  // l'agente è il partecipante con il flag di agente; le RPC di turno vanno a lui
  async function rpcAgente(method) {
    const agente = room && [...room.remoteParticipants.values()].find((p) => p.isAgent);
    if (!agente) return;
    try {
      await room.localParticipant.performRpc({ destinationIdentity: agente.identity, method, payload: "" });
    } catch (err) {
      console.warn("[bordo]", method, err);
    }
  }

  return {
    accendi,
    spegni,
    // push to talk: si apre il microfono e si avvisa l'agente (che smette di parlare)
    async inizioTurno() {
      if (!room || parlando) return;
      parlando = true;
      await micPub?.unmute();
      await rpcAgente("agente.inizioTurno");
    },
    // al rilascio l'agente chiude il turno e risponde; il microfono si chiude poco dopo, per
    // non tagliare l'ultima sillaba
    async fineTurno() {
      if (!room || !parlando) return;
      parlando = false;
      await new Promise((r) => setTimeout(r, 200));
      await rpcAgente("agente.fineTurno");
      if (!parlando) await micPub?.mute();
    },
    get acceso() {
      return !!room;
    },
    // testo all'agente come se fosse detto a voce (suggerimenti, azioni sulla pagina)
    invia(text) {
      if (room?.state === "connected") room.localParticipant.sendText(text, { topic: "lk.chat" }).catch(() => {});
    },
    pubblicaStato() {
      bridge?.publish();
    },
  };
}
