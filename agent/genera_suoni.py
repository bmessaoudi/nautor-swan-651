"""Genera i suoni della pagina a voce con ElevenLabs Sound Effects.

Legge l'elenco e i prompt da web/src/bordo/suoni.json e scrive web/public/audio/bordo/<id>.mp3.
Salta i file che esistono già: per rigenerarne uno lo si cancella, oppure si passa --forza.

    uv run genera_suoni.py            # tutti quelli mancanti
    uv run genera_suoni.py fx-porta   # solo alcuni
    uv run genera_suoni.py --forza    # tutti da capo
"""

import asyncio
import json
import os
import sys
from pathlib import Path

import aiohttp
from dotenv import load_dotenv

# .env.local lo scrive la CLI di LiveKit (lk app env -w) con le credenziali del progetto Cloud
load_dotenv(Path(__file__).parent / ".env.local")
load_dotenv(Path(__file__).parent / ".env")

ROOT = Path(__file__).resolve().parent.parent
ELENCO = ROOT / "web/src/bordo/suoni.json"
OUT = ROOT / "web/public/audio/bordo"
URL = "https://api.elevenlabs.io/v1/sound-generation"


async def genera(http: aiohttp.ClientSession, suono: dict, loop: bool, sem: asyncio.Semaphore) -> None:
    dest = OUT / f"{suono['id']}.mp3"
    async with sem:
        body = {
            "text": suono["prompt"],
            "duration_seconds": suono["durata"],
            "prompt_influence": suono.get("influenza", 0.45),
            "loop": loop,
            "model_id": "eleven_text_to_sound_v2",
        }
        async with http.post(URL, params={"output_format": "mp3_44100_128"}, json=body) as res:
            if res.status != 200:
                print(f"  {suono['id']}: errore {res.status} {await res.text()}")
                return
            dest.write_bytes(await res.read())
            print(f"  {suono['id']}: {dest.stat().st_size // 1024} KB")


async def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    forza = "--forza" in sys.argv
    elenco = json.loads(ELENCO.read_text())
    OUT.mkdir(parents=True, exist_ok=True)

    lavori = [(s, True) for s in elenco["ambienti"]] + [(s, False) for s in elenco["effetti"]]
    if args:
        lavori = [(s, loop) for s, loop in lavori if s["id"] in args]
    elif not forza:
        lavori = [(s, loop) for s, loop in lavori if not (OUT / f"{s['id']}.mp3").exists()]
    if not lavori:
        print("Niente da generare.")
        return

    print(f"Genero {len(lavori)} suoni in {OUT.relative_to(ROOT)}")
    sem = asyncio.Semaphore(3)
    headers = {"xi-api-key": os.environ["ELEVEN_API_KEY"]}
    async with aiohttp.ClientSession(headers=headers, timeout=aiohttp.ClientTimeout(total=180)) as http:
        await asyncio.gather(*(genera(http, s, loop, sem) for s, loop in lavori))


if __name__ == "__main__":
    asyncio.run(main())
