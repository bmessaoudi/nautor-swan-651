"""Computer di bordo dello Swan 651: agente vocale che guida il museo web.

Orecchie Deepgram Flux, cervello Claude Opus 5.5, voce ElevenLabs Eleven v4 Turbo.
I tool muovono la pagina con le RPC di LiveKit (web/src/bordo/bridge.js).

    uv run agent.py dev
"""

import asyncio
import json
import re
import logging
import os
from pathlib import Path
from collections.abc import AsyncIterable
from typing import Any, Literal

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from livekit import rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    RunContext,
    SimulationContext,
    cli,
    function_tool,
    llm,
)
from livekit.agents.types import NOT_GIVEN, NotGivenOr
from livekit.agents.voice import room_io
from livekit.agents.utils import is_given
from livekit.plugins import anthropic, deepgram, elevenlabs
from livekit.plugins.anthropic import llm as anthropic_llm

from simulazione.pagina import PaginaSimulata, carica_indice

# .env.local lo scrive la CLI di LiveKit (lk app env -w) con le credenziali del progetto Cloud
load_dotenv(Path(__file__).parent / ".env.local")
load_dotenv(Path(__file__).parent / ".env")
logger = logging.getLogger("computer-di-bordo")

HERE = Path(__file__).parent
AGENT_NAME = "computer-di-bordo"
# Haiku 4.5: misurato il 3 ottobre, prima parola in circa 0,9 s contro 3-4 s di Opus 5.5 e
# Sonnet 5.5 dopo un tool. Con BORDO_MODELLO si prova un altro modello (claude-sonnet-5-5,
# claude-opus-5-5)
MODEL = os.environ.get("BORDO_MODELLO") or "claude-haiku-4-5"
# Il plugin riconosce solo i 4.6 fra i modelli senza prefill: sui modelli 5 vale lo stesso
anthropic_llm._NO_PREFILL_PATTERNS = (*anthropic_llm._NO_PREFILL_PATTERNS, "claude-opus-5", "claude-sonnet-5")

TTS_MODEL = os.environ.get("ELEVEN_MODEL") or "eleven_v4_turbo"
# gli audio tag ([chuckles], [whispers]...) li capiscono solo v3 e v4; con Flash si tolgono
TAG_AUDIO = TTS_MODEL.startswith(("eleven_v3", "eleven_v4"))

SALUTO = (
    "[warm] Computer di bordo acceso. Benvenuto sullo Swan 651: diciannove metri e novantotto di "
    "eleganza finlandese, e io, che ne sono la memoria. [chuckles] Una memoria degli anni Ottanta, "
    "ma lucidissima. Per parlarmi tieni premuta la sfera al centro della plancia, o la barra "
    "spaziatrice, e lasciala quando hai finito. La camera la guido io, ma se preferisci "
    "esplorare da solo usa il menù a sinistra: tocchi un argomento e ti ci porto."
)

ATMOSFERE = Literal["alba", "mattino", "mezzogiorno", "pomeriggio", "tramonto", "foschia", "pioggia", "a caso"]


class ClaudeLLM(anthropic.LLM):
    """Il plugin non espone effort né i fallback lato server: si passano a ogni richiesta.

    Effort basso perché in voce conta il tempo alla prima parola; su Opus 5.5 il default
    sarebbe medium e il thinking non si può spegnere. max_tokens copre thinking e risposta.
    """

    def __init__(self, *, effort: str = "low", **kwargs: Any) -> None:
        super().__init__(model=MODEL, caching="ephemeral", max_tokens=8000, **kwargs)
        self._effort = effort

    def chat(self, *, extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN, **kwargs: Any):
        extra = dict(extra_kwargs) if is_given(extra_kwargs) else {}
        body = dict(extra.get("extra_body", {}))
        if not MODEL.startswith("claude-haiku"):
            # Haiku 4.5 non ha effort né fallback: senza thinking risponde già subito
            body["output_config"] = {"effort": self._effort}
            # se un classificatore rifiuta, il server riprova da sé su un modello adatto
            body["fallbacks"] = "default"
            extra["extra_headers"] = {
                **extra.get("extra_headers", {}),
                "anthropic-beta": "server-side-fallback-2026-07-01",
            }
        # Sonnet 5.5 può non ragionare (Opus 5.5 no): in voce conta il tempo alla prima parola
        if MODEL.startswith("claude-sonnet-5-5"):
            body["thinking"] = {"type": "between_tools"}
        extra["extra_body"] = body
        return super().chat(extra_kwargs=extra, **kwargs)


class Dato(BaseModel):
    """Un numero da mostrare a schermo accanto alle parole chiave."""

    valore: str = Field(description='Il valore con l\'unità, breve: "3,23 m", "14,4 t", "1985".')
    etichetta: str = Field(description='Cosa misura, una o due parole: "pescaggio", "zavorra".')


def build_instructions(index: dict[str, Any]) -> str:
    """Prompt + contenuti della pagina + conoscenza. Tutto stabile per la sessione: si mette in cache."""
    parts = [(HERE / "prompt.md").read_text()]

    pagina = ["# Le scene, passo per passo (il testo è ciò che sai, non ciò che si vede)"]
    for p in index["passi"]:
        riga = f"Passo {p['passo']} ({p['capitolo']}"
        riga += f", {p['sezione']})" if p["sezione"] else ")"
        riga += f": {p['titolo']}. {p['testo']}"
        if p["dati"]:
            riga += " Dati: " + "; ".join(f"{d['etichetta']} {d['valore']}" for d in p["dati"]) + "."
        pagina.append(riga)
    capitoli = ", ".join(f"{c['nome']} dal passo {c['passo']}" for c in index["capitoli"])
    pagina.append(f"Capitoli: {capitoli}. Il passo 0 è l'apertura, l'ultimo è la chiusura.")
    pagina.append("Il mare e le condizioni meteo si vedono solo nel capitolo Navigazione.")
    parts.append("\n\n".join(pagina))

    dettagli = ["# Dettagli indicabili sulla barca (id per mostra_dettaglio)"]
    for h in index["hotspots"]:
        dettagli.append(f"id {h['id']}, passo {h['passo']}: {h['titolo']}. {h['testo']}")
    parts.append("\n".join(dettagli))

    immagini = ["# Foto e grafici (id per mostra_immagine)"]
    for i in index["immagini"]:
        immagini.append(f"{i['id']}: {i['descrizione']}")
    parts.append("\n".join(immagini))

    for f in sorted((HERE / "knowledge").glob("*.md")):
        parts.append(f.read_text())
    return "\n\n".join(parts)


def dati_json(dati: list[Dato]) -> list[dict[str, str]]:
    return [d.model_dump() for d in dati[:3]]


class ComputerDiBordo(Agent):
    def __init__(
        self,
        *,
        visitor: rtc.RemoteParticipant | None,
        room: rtc.Room,
        index: dict[str, Any],
        pagina: PaginaSimulata | None = None,
    ) -> None:
        super().__init__(instructions=build_instructions(index))
        self._visitor = visitor
        self._room = room
        self._last = len(index["passi"]) - 1
        # nelle simulations la pagina è finta e risponde in processo
        self._pagina = pagina

    async def _sito(self, method: str, **args: Any) -> dict[str, Any]:
        if self._pagina:
            try:
                return self._pagina.chiama(method, args)
            except ValueError as e:
                raise llm.ToolError(f"La pagina non ha risposto: {e}") from e
        try:
            res = await self._room.local_participant.perform_rpc(
                destination_identity=self._visitor.identity,
                method=method,
                payload=json.dumps(args),
                response_timeout=5.0,
            )
        except rtc.RpcError as e:
            raise llm.ToolError(f"La pagina non ha risposto: {e.message}") from e
        return json.loads(res)

    def nota_schermo(self) -> str:
        """Ciò che la pagina mostra adesso, dall'attributo che la pagina aggiorna a ogni passo."""
        if self._pagina:
            s = self._pagina.stato()
        else:
            raw = self._visitor.attributes.get("sito.stato")
            if not raw:
                return ""
            s = json.loads(raw)
        nota = f"[A schermo: passo {s['passo']}, {s['capitolo']}, {s['titolo']}"
        if s["capitolo"] == "Navigazione" and s.get("mare"):
            nota += f"; mare: {s['mare']}"
        if s.get("immagine"):
            nota += f"; immagine aperta: {s['immagine']}"
        return nota + "]"

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        # La nota entra nel messaggio stesso: resta nella cronologia senza cambiarne il
        # prefisso, così la cache del prompt regge turno dopo turno
        if nota := self.nota_schermo():
            new_message.content.insert(0, nota)

    @function_tool
    async def vai_al_passo(self, context: RunContext, passo: int, titolo: str, dati: list[Dato]) -> str:
        """Porta la camera a un passo e mostra le parole chiave di ciò di cui parli. Lo spostamento dura due o tre secondi.

        Args:
            passo: numero del passo, da 0 all'ultimo.
            titolo: parole chiave a schermo, da una a quattro parole: "Pinna in piombo", "Sottocoperta".
            dati: da zero a tre numeri da mostrare; lista vuota se non servono.
        """
        if not 0 <= passo <= self._last:
            raise llm.ToolError(f"I passi vanno da 0 a {self._last}.")
        r = await self._sito("sito.vaiAlPasso", passo=passo, titolo=titolo, dati=dati_json(dati))
        return f"La camera va al passo {r['passo']}."

    @function_tool
    async def mostra_dettaglio(self, context: RunContext, id: int, dati: list[Dato]) -> str:
        """Inquadra un dettaglio della barca, lo indica con un'etichetta e mostra il suo nome come parole chiave.

        Args:
            id: id del dettaglio, dall'elenco dei dettagli indicabili.
            dati: da zero a tre numeri da mostrare; lista vuota se non servono.
        """
        r = await self._sito("sito.mostraDettaglio", id=id, dati=dati_json(dati))
        return f"Indicato «{r['titolo']}», al passo {r['passo']}."

    @function_tool
    async def mostra_parole(self, context: RunContext, titolo: str, dati: list[Dato]) -> str:
        """Cambia le parole chiave a schermo senza muovere la camera, quando il discorso passa a un altro punto.

        Args:
            titolo: parole chiave, da una a quattro parole.
            dati: da zero a tre numeri da mostrare; lista vuota se non servono.
        """
        await self._sito("sito.mostraParole", titolo=titolo, dati=dati_json(dati))
        return "Parole chiave aggiornate."

    @function_tool
    async def mostra_immagine(self, context: RunContext, id: str) -> str:
        """Apre una foto o un grafico accanto alla barca, al posto del pannello della scena. Al prossimo spostamento della camera torna il pannello della nuova scena.

        Args:
            id: id dall'elenco delle foto e dei grafici.
        """
        await self._sito("sito.mostraImmagine", id=id)
        return f"Immagine {id} aperta."

    @function_tool
    async def nascondi_immagine(self, context: RunContext) -> str:
        """Chiude la foto o il grafico che hai aperto e rimette il pannello della scena."""
        await self._sito("sito.nascondiImmagine")
        return "Immagine chiusa, torna il pannello della scena."

    @function_tool
    async def cambia_mare(self, context: RunContext, atmosfera: ATMOSFERE) -> str:
        """Cambia ora del giorno, vento e costa della scena in mare. Se serve porta la camera al capitolo Navigazione.

        Args:
            atmosfera: l'atmosfera richiesta, oppure "a caso".
        """
        r = await self._sito("sito.cambiaMare", atmosfera=atmosfera)
        return f"Ora in scena: {r['mare']} (passo {r['passo']})."

    @function_tool
    async def spegni(self, context: RunContext) -> None:
        """Spegne il computer di bordo quando la persona saluta o chiede di chiudere. Saluta prima di usarlo."""
        await context.wait_for_playout()
        await self._sito("sito.spegni")


server = AgentServer()


async def chiedi_indice(ctx: JobContext, visitor: rtc.RemoteParticipant) -> dict[str, Any]:
    # La pagina manda il proprio indice: testi, passi, dettagli e immagini hanno una sola fonte.
    # Arriva come stream di testo perché supera il limite di una risposta RPC (15 KB)
    arrivato: asyncio.Future[str] = asyncio.get_running_loop().create_future()

    def ricevi_indice(reader: rtc.TextStreamReader, _identity: str) -> None:
        async def leggi() -> None:
            text = await reader.read_all()
            if not arrivato.done():
                arrivato.set_result(text)

        asyncio.create_task(leggi())

    ctx.room.register_text_stream_handler("sito.indice", ricevi_indice)
    await ctx.room.local_participant.perform_rpc(
        destination_identity=visitor.identity, method="sito.indice", payload="{}", response_timeout=10.0
    )
    return json.loads(await asyncio.wait_for(arrivato, timeout=10.0))


@server.rtc_session(agent_name=AGENT_NAME)
async def entrypoint(ctx: JobContext) -> None:
    await ctx.connect()
    # Nelle simulations (lk agent simulate) non c'è il browser: indice e pagina sono finti
    sim = ctx.simulation_context()
    if sim:
        index = carica_indice()
        visitor, pagina = None, PaginaSimulata(index)
    else:
        visitor, pagina = await ctx.wait_for_participant(), None
        index = await chiedi_indice(ctx, visitor)

    session = AgentSession(
        stt=deepgram.STTv2(
            model="flux-general-multi",
            language_hint=["it"],
            # col push to talk il turno lo chiude il rilascio: basta poco silenzio per chiudere la frase
            eot_timeout_ms=900,
            keyterm=["Swan", "Nautor", "Frers", "Fazer", "Pietarsaari", "Whitbread", "skeg", "randa", "genoa"],
        ),
        llm=ClaudeLLM(effort=os.environ.get("BORDO_EFFORT", "low")),
        tts=elevenlabs.TTS(
            model=TTS_MODEL,
            voice_id=os.environ.get("ELEVEN_VOICE_ID") or elevenlabs.tts.DEFAULT_VOICE_ID,
            language="it",
            # i numeri arrivano in cifre dal prompt: ElevenLabs li legge in italiano
            apply_text_normalization="on",
        ),
        **turn_options(sim),
        tts_text_transforms=["filter_markdown", "filter_emoji", *([] if TAG_AUDIO else [togli_tag])],
    )
    # una sessione chiusa (errore o visitatore uscito) chiude anche il job: l'agente lascia
    # la stanza e la plancia lo vede spegnersi
    session.on("close", lambda ev: ctx.shutdown(reason=str(ev.reason)))
    agent = ComputerDiBordo(visitor=visitor, room=ctx.room, index=index, pagina=pagina)

    # Il testo dalla pagina (suggerimenti cliccati, capitoli aperti dai puntini) segue la
    # stessa strada della voce, con la nota di ciò che è a schermo
    async def testo(sess: AgentSession, ev: room_io.TextInputEvent) -> None:
        async with sess._claim_user_turn():
            # force: con le interruzioni spente (push to talk) ogni battuta nasce non
            # interrompibile, e senza force interrupt() rifiuta di fermarla
            await sess.interrupt(force=True)
            nota = agent.nota_schermo()
            sess.generate_reply(user_input=f"{nota} {ev.text}" if nota else ev.text)

    await session.start(
        agent,
        room=ctx.room,
        room_options=room_io.RoomOptions(text_input=room_io.TextInputOptions(text_input_cb=testo)),
        # sessioni registrate su LiveKit Cloud: trascrizioni e audio per derivarne scenari
        record=True,
    )
    if not sim:
        # Push to talk: la pagina apre e chiude il turno con due RPC. Fra un turno e l'altro
        # l'audio in ingresso è spento
        session.input.set_audio_enabled(False)
        lp = ctx.room.local_participant

        @lp.register_rpc_method("agente.inizioTurno")
        async def inizio_turno(data: rtc.RpcInvocationData) -> str:
            # chi preme per parlare zittisce subito l'agente, anche a metà frase
            try:
                session.interrupt(force=True)
            except RuntimeError:
                pass
            session.clear_user_turn()
            session.input.set_audio_enabled(True)
            return "ok"

        @lp.register_rpc_method("agente.fineTurno")
        async def fine_turno(data: rtc.RpcInvocationData) -> str:
            session.input.set_audio_enabled(False)
            # Flux chiude la trascrizione dopo un attimo di silenzio: se non arriva in tempo si usa
            # quella provvisoria, che con Flux è già buona
            session.commit_user_turn(transcript_timeout=0.9, stt_flush_duration=0.9)
            return "ok"

        @lp.register_rpc_method("agente.annullaTurno")
        async def annulla_turno(data: rtc.RpcInvocationData) -> str:
            session.input.set_audio_enabled(False)
            session.clear_user_turn()
            return "ok"

    # mentre la voce saluta, la cache del prompt si scalda: la prima domanda non la paga a freddo
    asyncio.create_task(scalda_cache(session.llm, agent))
    await session.say(SALUTO if TAG_AUDIO else re.sub(r"\[[^\]]*\]\s*", "", SALUTO))


async def scalda_cache(model: llm.LLM, agent: Agent) -> None:
    ctx = llm.ChatContext()
    ctx.add_message(role="system", content=agent.instructions)
    ctx.add_message(role="user", content="(prova di sistema: rispondi solo ok)")
    try:
        async with model.chat(chat_ctx=ctx, tools=agent.tools) as stream:
            async for _ in stream:
                pass
    except Exception as e:
        logger.warning("cache non scaldata: %s", e)


async def togli_tag(text: AsyncIterable[str]) -> AsyncIterable[str]:
    """Toglie gli audio tag dal testo per i modelli che li leggerebbero ad alta voce.
    Un tag può arrivare spezzato fra due pezzi dello stream: si trattiene finché non si chiude."""
    resto = ""
    async for chunk in text:
        resto += chunk
        aperta = resto.rfind("[")
        if aperta > resto.rfind("]"):
            pronto, resto = resto[:aperta], resto[aperta:]
        else:
            pronto, resto = resto, ""
        if pronto := re.sub(r"\[[^\]]*\]\s*", "", pronto):
            yield pronto
    if resto := re.sub(r"\[[^\]]*\]\s*", "", resto):
        yield resto


def turn_options(sim: SimulationContext | None) -> dict[str, Any]:
    """Push to talk: il turno lo decide chi visita tenendo premuto lo strumento centrale (o la
    barra spaziatrice). Niente rilevamento automatico dei turni né interruzioni da rumore, e
    quindi niente VAD: il microfono conta solo mentre è premuto.

    Nelle simulations nessuno preme la sfera: il turno lo chiude Flux."""
    if sim:
        return {"turn_handling": {"turn_detection": "stt"}}
    return {"turn_handling": {"turn_detection": "manual", "interruption": {"enabled": False}}}


if __name__ == "__main__":
    cli.run_app(server)
