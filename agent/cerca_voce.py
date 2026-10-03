"""Scelta della voce del computer di bordo, tutta da riga di comando (niente dashboard).

    uv run cerca_voce.py cerca                      # voci italiane della Voice Library, anteprime in voci/
    uv run cerca_voce.py prova <voice_id>           # la voce legge una battuta di prova con gli audio tag
    uv run cerca_voce.py aggiungi <owner_id> <voice_id> <nome>   # aggiunge una voce della Library all'account
    uv run cerca_voce.py progetta                   # Voice Design da una descrizione: 3 anteprime in voci/
    uv run cerca_voce.py salva <generated_voice_id> <nome>       # salva la voce progettata scelta

Il voice_id scelto va in .env come ELEVEN_VOICE_ID.
"""

import asyncio
import base64
import os
import sys
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE / ".env.local")
load_dotenv(HERE / ".env")

API = "https://api.elevenlabs.io/v1"
OUT = HERE / "voci"

# Candidati trovati nella Voice Library il 3 ottobre 2026 (da verificare: possono essere stati ritirati)
CANDIDATI = ["Vittorio", "Max", "Nonno Ben", "Ginevra", "Manuela", "Francesco", "Simone", "Vera"]

BATTUTA = (
    "[warm] Benvenuto a bordo dello Swan 651. [chuckles] No, le scarpe puoi tenerle: è un museo, "
    "il teak non si offende. [curious] Vedi quell'albero? È alto come un palazzo di nove piani, "
    "[dry amusement] e negli anni Ottanta qualcuno ha pensato che fosse una buona idea portarlo in giro per gli oceani. "
    "[short pause] Aveva ragione, ovviamente."
)

DESCRIZIONE = (
    "Native Italian, neutral standard Italian accent. Male, 45-55. Excellent audio quality, studio-quality "
    "close-mic recording. Persona: charismatic nautical museum guide. Emotion: warm, wry, playful. A rich "
    "medium-low baritone with a smile in the voice. Relaxed conversational pace that quickens for anecdotes "
    "and slows before punchlines, dry ironic understatement, occasional soft chuckle, crisp diction, "
    "storytelling like an old sailor among friends, never theatrical or announcer-like."
)


def slug(s: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in s.lower()).strip("-")


async def cerca(http: aiohttp.ClientSession) -> None:
    OUT.mkdir(exist_ok=True)
    visti = {}
    ricerche = [{"search": n} for n in CANDIDATI] + [{"sort": "usage_character_count_1y"}]
    for extra in ricerche:
        params = {"language": "it", "page_size": "20", **extra}
        async with http.get(f"{API}/shared-voices", params=params) as res:
            res.raise_for_status()
            for v in (await res.json())["voices"]:
                visti.setdefault(v["voice_id"], v)
    for v in visti.values():
        print(f"\n{v['name']}  ({v.get('gender')}, {v.get('age')}, {v.get('accent')})")
        print(f"  voice_id {v['voice_id']}  owner {v['public_owner_id']}  uso 1 anno {v.get('usage_character_count_1y')}")
        print(f"  {(v.get('description') or '').strip()[:200]}")
        if url := v.get("preview_url"):
            async with http.get(url) as res:
                if res.ok:
                    (OUT / f"{slug(v['name'])}-{v['voice_id']}.mp3").write_bytes(await res.read())
    print(f"\nAnteprime in {OUT}")


async def prova(http: aiohttp.ClientSession, voice_id: str) -> None:
    OUT.mkdir(exist_ok=True)
    # eleven_v4 via Text to Dialogue: stessa famiglia di v4 Turbo, che passa solo dal WebSocket
    body = {"inputs": [{"text": BATTUTA, "voice_id": voice_id}], "model_id": "eleven_v4"}
    async with http.post(f"{API}/text-to-dialogue", json=body) as res:
        if not res.ok:
            sys.exit(f"Errore {res.status}: {await res.text()}")
        dest = OUT / f"prova-{voice_id}.mp3"
        dest.write_bytes(await res.read())
        print(f"Ascolta {dest}")


async def aggiungi(http: aiohttp.ClientSession, owner: str, voice_id: str, nome: str) -> None:
    async with http.post(f"{API}/voices/add/{owner}/{voice_id}", json={"new_name": nome}) as res:
        if not res.ok:
            sys.exit(f"Errore {res.status}: {await res.text()}")
        print(f"ELEVEN_VOICE_ID={(await res.json())['voice_id']}")


async def progetta(http: aiohttp.ClientSession) -> None:
    OUT.mkdir(exist_ok=True)
    body = {
        "voice_description": DESCRIZIONE,
        "model_id": "eleven_ttv_v3",
        "text": BATTUTA,
        "guidance_scale": 3.5,
    }
    async with http.post(f"{API}/text-to-voice/design", json=body) as res:
        if not res.ok:
            sys.exit(f"Errore {res.status}: {await res.text()}")
        for p in (await res.json())["previews"]:
            dest = OUT / f"design-{p['generated_voice_id']}.mp3"
            dest.write_bytes(base64.b64decode(p["audio_base_64"]))
            print(f"{p['generated_voice_id']}  ->  {dest}")
    print("Avvertenza ElevenLabs: le voci progettate su v4 possono essere meno espressive di quelle della Library.")


async def salva(http: aiohttp.ClientSession, generated: str, nome: str) -> None:
    body = {"voice_name": nome, "voice_description": DESCRIZIONE, "generated_voice_id": generated}
    async with http.post(f"{API}/text-to-voice", json=body) as res:
        if not res.ok:
            sys.exit(f"Errore {res.status}: {await res.text()}")
        print(f"ELEVEN_VOICE_ID={(await res.json())['voice_id']}")


async def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    headers = {"xi-api-key": os.environ["ELEVEN_API_KEY"]}
    async with aiohttp.ClientSession(headers=headers, timeout=aiohttp.ClientTimeout(total=180)) as http:
        match cmd:
            case "cerca":
                await cerca(http)
            case "prova":
                await prova(http, *args)
            case "aggiungi":
                await aggiungi(http, *args)
            case "progetta":
                await progetta(http)
            case "salva":
                await salva(http, *args)
            case _:
                sys.exit(__doc__)


if __name__ == "__main__":
    asyncio.run(main())
