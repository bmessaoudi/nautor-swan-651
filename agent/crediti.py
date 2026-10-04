"""Credito delle API a pagamento del computer di bordo.

Senza credito l'agente entra nella stanza e resta muto, e la plancia sembra rotta. Il server dei
token lo controlla prima di aprire una stanza; l'agente usa `errore_di_credito` per riconoscere
un credito finito a visita in corso.

- Anthropic non ha un endpoint del saldo: si manda una richiesta minima a Haiku (8 token in
  entrata, 1 in uscita) e si guarda se torna l'errore "credit balance is too low".
- ElevenLabs espone i caratteri usati e il limite del periodo.
- Deepgram espone il saldo solo a una chiave con lo scope `billing:read`; senza, si salta.

Un servizio irraggiungibile o una risposta inattesa non bloccano l'accensione: si blocca solo
quando un servizio dice chiaramente che il credito è finito.
"""

import asyncio
import logging
import os
import re
import time

import aiohttp

logger = logging.getLogger("crediti")

# sotto questi margini una visita si fermerebbe a metà
MIN_CARATTERI_ELEVENLABS = int(os.environ.get("BORDO_MIN_CARATTERI", "2000"))
MIN_SALDO_DEEPGRAM = float(os.environ.get("BORDO_MIN_SALDO_DEEPGRAM", "0.10"))
CACHE_SECONDI = 60

_TIMEOUT = aiohttp.ClientTimeout(total=6)
_cache: tuple[float, list[str]] | None = None
_lock = asyncio.Lock()

# messaggi con cui i fornitori dicono che il credito è finito
_SENZA_CREDITO = re.compile(
    r"credit balance|insufficient[_ ]credits?|quota_exceeded|exceeds your quota|payment required",
    re.IGNORECASE,
)


def errore_di_credito(err: BaseException) -> bool:
    """Vero se l'errore di un plugin (LLM, STT, TTS) dice che il credito è finito."""
    if getattr(err, "status_code", None) == 402:
        return True
    return bool(_SENZA_CREDITO.search(f"{err} {getattr(err, 'body', '') or ''}"))


async def _anthropic(http: aiohttp.ClientSession) -> bool:
    async with http.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
        },
        json={
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "ok"}],
        },
    ) as res:
        if res.ok:
            return True
        testo = await res.text()
        if res.status == 402 or _SENZA_CREDITO.search(testo):
            return False
        logger.warning("Anthropic: risposta inattesa %s %s", res.status, testo[:200])
        return True


async def _elevenlabs(http: aiohttp.ClientSession) -> bool:
    async with http.get(
        "https://api.elevenlabs.io/v1/user/subscription",
        headers={"xi-api-key": os.environ["ELEVEN_API_KEY"]},
    ) as res:
        if not res.ok:
            logger.warning("ElevenLabs: risposta inattesa %s", res.status)
            return True
        d = await res.json()
    restano = d["character_limit"] - d["character_count"]
    # con l'uso a consumo attivo il limite si può superare
    if d.get("can_extend_character_limit") and d.get("max_character_limit_extension"):
        restano += d["max_character_limit_extension"]
    return restano >= MIN_CARATTERI_ELEVENLABS


async def _deepgram(http: aiohttp.ClientSession) -> bool:
    auth = {"Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}"}
    async with http.get("https://api.deepgram.com/v1/projects", headers=auth) as res:
        if not res.ok:
            logger.warning("Deepgram: risposta inattesa %s", res.status)
            return True
        progetti = (await res.json())["projects"]
    saldo = 0.0
    for p in progetti:
        url = f"https://api.deepgram.com/v1/projects/{p['project_id']}/balances"
        async with http.get(url, headers=auth) as res:
            if res.status == 403:
                logger.info("Deepgram: la chiave non ha lo scope billing:read, saldo non controllato")
                return True
            if not res.ok:
                logger.warning("Deepgram: risposta inattesa %s", res.status)
                return True
            saldo += sum(b["amount"] for b in (await res.json())["balances"])
    return saldo >= MIN_SALDO_DEEPGRAM


async def senza_credito() -> list[str]:
    """Nomi dei servizi senza credito sufficiente; lista vuota se si può accendere."""
    global _cache
    async with _lock:
        if _cache and time.monotonic() - _cache[0] < CACHE_SECONDI:
            return _cache[1]
        controlli = {"Anthropic": _anthropic, "ElevenLabs": _elevenlabs, "Deepgram": _deepgram}
        async with aiohttp.ClientSession(timeout=_TIMEOUT) as http:
            esiti = await asyncio.gather(*(c(http) for c in controlli.values()), return_exceptions=True)
        mancano = []
        for nome, esito in zip(controlli, esiti):
            if isinstance(esito, BaseException):
                logger.warning("%s: controllo del credito non riuscito: %r", nome, esito)
            elif not esito:
                mancano.append(nome)
        _cache = (time.monotonic(), mancano)
        return mancano
