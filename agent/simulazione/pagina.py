"""La pagina /bordo/ finta per le simulations di LiveKit (lk agent simulate).

Nelle simulations non c'è un browser: i metodi sito.* rispondono da qui, con le stesse
risposte e gli stessi errori di web/src/bordo/bridge.js, e lo stato a schermo segue i tool.
L'indice è quello esportato dalla pagina (cd web && pnpm run indice-agente).

Dalla cartella agent/:
    lk agent simulate text --scenarios simulazione/scenari.yaml agent.py
    lk agent simulate audio --concurrency 4 --scenarios simulazione/scenari.yaml agent.py
Le run audio stanno sotto le 5 in parallelo: il progetto ammette 5 connessioni di barge-in
contemporanee, e quelle in più falsano le misure sul turn-taking.
"""

import json
import random
from pathlib import Path
from typing import Any

INDICE = Path(__file__).parent / "indice.json"
# come makeConditions in web/src/conditions.js: in foschia vento debole, in pioggia forte
VENTO = {"foschia": (6, 14), "pioggia": (16, 27)}
COSTE = ["arcipelago", "costa alta", "mare aperto"]


def carica_indice() -> dict[str, Any]:
    return json.loads(INDICE.read_text())


class PaginaSimulata:
    def __init__(self, index: dict[str, Any]) -> None:
        self._index = index
        self._navigazione = next(c["passo"] for c in index["capitoli"] if c["nome"] == "Navigazione")
        self._immagini = {i["id"] for i in index["immagini"]}
        self.passo = 0
        self.immagine = ""
        self.mare = ""
        self.spenta = False
        # ogni chiamata della sessione, per giudicare lo stato finale in on_simulation_end
        self.chiamate: list[tuple[str, dict[str, Any]]] = []

    def capitolo(self, passo: int) -> str:
        nome = "Apertura"
        for c in self._index["capitoli"]:
            if passo >= c["passo"]:
                nome = c["nome"]
        return nome

    def stato(self) -> dict[str, Any]:
        return {
            "passo": self.passo,
            "capitolo": self.capitolo(self.passo),
            "titolo": self._index["passi"][self.passo]["titolo"],
            "mare": self.mare,
            "immagine": self.immagine,
        }

    def chiama(self, method: str, args: dict[str, Any]) -> dict[str, Any]:
        """Come i gestori RPC della pagina: un ValueError è l'errore che la pagina rimanda."""
        self.chiamate.append((method, args))
        match method:
            case "sito.vaiAlPasso":
                self.passo = args["passo"]
                self.immagine = ""
                return {"passo": self.passo}
            case "sito.mostraDettaglio":
                hs = self._index["hotspots"]
                if not 0 <= args["id"] < len(hs):
                    raise ValueError(f"dettaglio {args['id']} inesistente")
                h = hs[args["id"]]
                self.passo = h["passo"]
                self.immagine = ""
                return {"passo": h["passo"], "titolo": h["titolo"]}
            case "sito.mostraParole":
                return {}
            case "sito.mostraImmagine":
                if args["id"] not in self._immagini:
                    raise ValueError(f"immagine {args['id']} inesistente")
                self.immagine = args["id"]
                return {}
            case "sito.nascondiImmagine":
                self.immagine = ""
                return {}
            case "sito.cambiaMare":
                atmosfera = args["atmosfera"]
                if atmosfera not in self._index["atmosfere"]:
                    atmosfera = random.choice(self._index["atmosfere"])
                nodi = random.randint(*VENTO.get(atmosfera, (9, 24)))
                self.mare = f"{atmosfera.capitalize()}, {nodi} nodi, {random.choice(COSTE)}"
                if self.passo < self._navigazione:
                    self.passo = self._navigazione
                return {"passo": self.passo, "mare": self.mare}
            case "sito.spegni":
                self.spenta = True
                return {}
        raise ValueError(f"metodo {method} sconosciuto")
