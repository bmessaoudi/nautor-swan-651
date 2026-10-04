"""Server dei token per la plancia del sito.

Il browser chiede un token, entra in una stanza nuova e il token stesso chiede a LiveKit
di mandarci il computer di bordo (dispatch esplicito per nome dell'agente).

    uv run token_server.py
"""

import os
from pathlib import Path
import secrets

from aiohttp import web
from dotenv import load_dotenv
from livekit import api

from crediti import senza_credito

# .env.local lo scrive la CLI di LiveKit (lk app env -w) con le credenziali del progetto Cloud
load_dotenv(Path(__file__).parent / ".env.local")
load_dotenv(Path(__file__).parent / ".env")

AGENT_NAME = "computer-di-bordo"
PORT = int(os.environ.get("BORDO_TOKEN_PORT", "8790"))
# il sito in sviluppo gira su Vite; in produzione si imposta l'origine reale
ALLOWED_ORIGINS = os.environ.get("BORDO_ALLOWED_ORIGINS", "http://localhost:5173").split(",")


def cors(request: web.Request, response: web.StreamResponse) -> web.StreamResponse:
    origin = request.headers.get("Origin", "")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    return response


async def token(request: web.Request) -> web.Response:
    # senza credito l'agente resterebbe muto: la plancia lo dice invece di sembrare rotta
    mancano = await senza_credito()
    if mancano:
        return cors(request, web.json_response({"errore": "crediti", "servizi": mancano}, status=402))
    room = f"bordo-{secrets.token_hex(4)}"
    identity = f"visitatore-{secrets.token_hex(3)}"
    jwt = (
        api.AccessToken()
        .with_identity(identity)
        .with_name("Visitatore")
        .with_grants(api.VideoGrants(room_join=True, room=room, can_update_own_metadata=True))
        .with_room_config(
            api.RoomConfiguration(agents=[api.RoomAgentDispatch(agent_name=AGENT_NAME)])
        )
        .to_jwt()
    )
    return cors(request, web.json_response({"url": os.environ["LIVEKIT_URL"], "token": jwt}))


app = web.Application()
app.router.add_get("/token", token)

if __name__ == "__main__":
    web.run_app(app, host="127.0.0.1", port=PORT)
