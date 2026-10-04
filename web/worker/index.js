// Worker di nautor-swan-demo: serve il sito statico (dist) e, su /token, apre la stanza del
// computer di bordo. È la versione in produzione di agent/token_server.py e agent/crediti.py:
// stesso controllo del credito, stessa risposta 402. L'accesso lo filtra Cloudflare Access.
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from "livekit-server-sdk";

const AGENT_NAME = "computer-di-bordo";
// sotto questi margini una visita si fermerebbe a metà
const MIN_CARATTERI_ELEVENLABS = 2000;
const MIN_SALDO_DEEPGRAM = 0.1;
const CACHE_MS = 60_000;
const TIMEOUT_MS = 6000;

// messaggi con cui i fornitori dicono che il credito è finito
const SENZA_CREDITO = /credit balance|insufficient[_ ]credits?|quota_exceeded|exceeds your quota|payment required/i;

// per isolato: basta a non ripetere i controlli a ogni accensione
let cache = null;

const chiama = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

// Anthropic non ha un endpoint del saldo: una richiesta minima a Haiku dice se c'è credito
async function anthropic(env) {
  const res = await chiama("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1, messages: [{ role: "user", content: "ok" }] }),
  });
  if (res.ok) return true;
  const testo = await res.text();
  if (res.status === 402 || SENZA_CREDITO.test(testo)) return false;
  console.warn("Anthropic: risposta inattesa", res.status, testo.slice(0, 200));
  return true;
}

async function elevenlabs(env) {
  const res = await chiama("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": env.ELEVEN_API_KEY } });
  if (!res.ok) {
    console.warn("ElevenLabs: risposta inattesa", res.status);
    return true;
  }
  const d = await res.json();
  let restano = d.character_limit - d.character_count;
  // con l'uso a consumo attivo il limite si può superare
  if (d.can_extend_character_limit && d.max_character_limit_extension) restano += d.max_character_limit_extension;
  return restano >= MIN_CARATTERI_ELEVENLABS;
}

// il saldo si legge solo con una chiave che ha lo scope billing:read; senza, si salta
async function deepgram(env) {
  const headers = { Authorization: `Token ${env.DEEPGRAM_API_KEY}` };
  const res = await chiama("https://api.deepgram.com/v1/projects", { headers });
  if (!res.ok) {
    console.warn("Deepgram: risposta inattesa", res.status);
    return true;
  }
  let saldo = 0;
  for (const p of (await res.json()).projects) {
    const r = await chiama(`https://api.deepgram.com/v1/projects/${p.project_id}/balances`, { headers });
    if (r.status === 403) return true;
    if (!r.ok) {
      console.warn("Deepgram: risposta inattesa", r.status);
      return true;
    }
    saldo += (await r.json()).balances.reduce((s, b) => s + b.amount, 0);
  }
  return saldo >= MIN_SALDO_DEEPGRAM;
}

// nomi dei servizi senza credito; vuoto se si può accendere. Un servizio irraggiungibile non blocca
async function senzaCredito(env) {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.mancano;
  const controlli = { Anthropic: anthropic, ElevenLabs: elevenlabs, Deepgram: deepgram };
  const esiti = await Promise.allSettled(Object.values(controlli).map((c) => c(env)));
  const mancano = [];
  Object.keys(controlli).forEach((nome, i) => {
    const e = esiti[i];
    if (e.status === "rejected") console.warn(`${nome}: controllo del credito non riuscito`, e.reason);
    else if (!e.value) mancano.push(nome);
  });
  cache = { at: Date.now(), mancano };
  return mancano;
}

async function token(env) {
  // senza credito l'agente resterebbe muto: la plancia lo dice invece di sembrare rotta
  const mancano = await senzaCredito(env);
  if (mancano.length) return Response.json({ errore: "crediti", servizi: mancano }, { status: 402 });

  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const room = `bordo-${hex(4)}`;
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { identity: `visitatore-${hex(3)}`, name: "Visitatore" });
  at.addGrant({ roomJoin: true, room, canUpdateOwnMetadata: true });
  // il token stesso chiede a LiveKit di mandare il computer di bordo (dispatch esplicito)
  at.roomConfig = new RoomConfiguration({ agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })] });
  return Response.json({ url: env.LIVEKIT_URL, token: await at.toJwt() }, { headers: { "cache-control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/token" && request.method === "GET") return token(env);
    return env.ASSETS.fetch(request);
  },
};
