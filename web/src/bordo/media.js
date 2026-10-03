// Grafici che il computer di bordo può mostrare come immagini: riusano charts.js della landing
import { drawMap, drawPolar } from "../charts.js";
import { drawScheda, drawRegistro, drawDimensioni, drawCarena, drawArmo, drawVele, drawPesi, drawPalmares } from "./disegni.js";

export const GRAFICI = [
  {
    id: "grafico-polare",
    titolo: "Polare",
    didascalia: "Lunz am Meer, certificato ORC",
    descrizione: "Diagramma polare: velocità della barca per angolo al vento con 10, 16 e 20 nodi di vento reale.",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 200 300");
      drawPolar(svg);
      return `<span class="l10">10 kn</span><span class="l16">16 kn</span><span class="l20">20 kn</span>`;
    },
  },
  {
    id: "grafico-rotte",
    titolo: "Dove può andare",
    didascalia: "Tre rotte possibili",
    descrizione: "Mappa con tre rotte: Mediterraneo fra Porto Cervo e Capri (circa 260 miglia), traversata atlantica Canarie e Antigua (circa 2.700), Pacifico fra Panama e Marchesi (circa 4.000).",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 640 360");
      drawMap(svg);
      return `<span class="lmed">Mediterraneo</span><span class="latl">Atlantico</span><span class="lpac">Pacifico</span>`;
    },
  },
  {
    id: "grafico-scheda",
    titolo: "Scheda tecnica",
    didascalia: "Dati generali",
    descrizione: "Scheda generale con il profilo dello scafo: progetto Germán Frers, cantiere Nautor's Swan, costruita dal 1982 al 1991 in 19 esemplari, 19,98 m di lunghezza, 5,31 m di baglio, 36,0 t di dislocamento, 14,4 t di zavorra, armo sloop, circa 194 m² di vele di bolina.",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 400 324");
      drawScheda(svg);
    },
  },
  {
    id: "grafico-registro",
    titolo: "Diciannove scafi",
    didascalia: "Pietarsaari, 1982-1991",
    descrizione: "Registro dei 19 scafi di Swan 651: i 13 con nome noto (Futuro, Adrienne II, Ichiban, Show Me, Rosbeg, Lunz am Meer, Deneb, Whisper of V, Tihama, Spirit of Helsinki, White Knight of NY, Geronimo, Aurora) e i 6 numeri senza nome identificato. Lunz am Meer in evidenza.",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 400 236");
      return drawRegistro(svg);
    },
  },
  {
    id: "grafico-dimensioni",
    titolo: "Le misure",
    didascalia: "Profilo e pianta, tavola 651-002",
    descrizione: "Profilo e pianta dello scafo quotati: lunghezza 19,98 m, galleggiamento 16,80 m, baglio 5,31 m.",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 400 260");
      drawDimensioni(svg);
    },
  },
  {
    id: "grafico-carena",
    titolo: "Sotto la linea d'acqua",
    didascalia: "Versione Mod",
    descrizione: "Profilo della carena con l'opera viva in evidenza: pinna di chiglia con bulbo in piombo, timone su skeg, pescaggio 3,23 m.",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 400 172");
      drawCarena(svg);
    },
  },
  {
    id: "grafico-armo",
    titolo: "Il piano velico",
    didascalia: "Misure IRC, Lunz am Meer",
    descrizione: "Piano velico quotato dello sloop in testa d'albero: P 24,00 m, E 7,04 m, J 8,05 m, I stimata circa 25,3 m, tre ordini di crocette.",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 260 300");
      return drawArmo(svg);
    },
  },
  {
    id: "grafico-vele",
    titolo: "Le superfici",
    didascalia: "Metri quadrati di tela",
    descrizione: "Confronto a barre delle superfici: randa 86,1 m², fiocco 107,9, genoa 150% 161,8, spinnaker 388.",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 400 206");
      drawVele(svg);
    },
  },
  {
    id: "grafico-pesi",
    titolo: "La zavorra",
    didascalia: "Piombo sul dislocamento",
    descrizione: "Anello con la quota della zavorra sul dislocamento: 14,4 t di piombo su 36,0 t, il 40% del peso.",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 400 220");
      drawPesi(svg);
    },
  },
  {
    id: "grafico-palmares",
    titolo: "Il palmarès",
    didascalia: "Lunz am Meer, 2012-2026",
    descrizione: "Linea del tempo dei risultati di Lunz am Meer: dal tredicesimo posto alla Swan Cup 2012 alle vittorie nella classe Classics by Frers del 2018 e del 2026, con Tre Golfi 2019 e Middle Sea Race 2018.",
    disegna(svg) {
      svg.setAttribute("viewBox", "0 0 400 248");
      drawPalmares(svg);
    },
  },
];
