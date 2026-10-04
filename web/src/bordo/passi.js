// Contenuti dei passi per il computer di bordo: sono i testi delle schede della landing
// (index.html), che nella pagina a voce non vanno a schermo ma diventano ciò che l'agente sa.
// Il passo i corrisponde al fotogramma chiave i di story.js. "pannello" è la foto o il grafico
// che riempie la colonna di destra quando si arriva al passo (id di immagini.js o media.js).
// "inquadratura" dice all'agente cosa mostra la camera al passo (da KEYS in story.js e da scena.js):
// serve per dire "guarda..." in modo coerente con ciò che si vede.
export const PASSI = [
  {
    "sezione": "Germán Frers per Nautor's Swan, 1982-1991",
    "titolo": "Swan 651",
    "pannello": "grafico-scheda",
    "inquadratura": "La tavola di progetto: la barca intera di profilo, vele comprese, in linee chiare su fondo blu da carta di progetto, vista da lontano.",
    "testo": "Diciannove scafi. Un maxi da regata pensato per attraversare gli oceani.",
    "dati": []
  },
  {
    "sezione": "01 / Blueprint",
    "titolo": "Da che idea nasce",
    "pannello": "tavola-profilo-pianta-651-002",
    "inquadratura": "Ancora la tavola blu, un po' più vicina: il profilo di fianco con l'albero e le vele al centro, la barca spostata di lato per lasciare posto al pannello.",
    "testo": "All'inizio degli anni Ottanta Frers porta in un cruiser di serie la tecnologia dei maxi Grand Prix e l'esperienza della Whitbread, il giro del mondo a tappe. Il cantiere di Pietarsaari chiede una barca che vinca in regata senza smettere di essere una casa sul mare.",
    "dati": []
  },
  {
    "sezione": "01 / Blueprint",
    "titolo": "Per chi è stata pensata",
    "pannello": "grafico-dimensioni",
    "inquadratura": "Dall'alto, a picco: la pianta della barca intera disegnata a linee sul fondo blu, piccola e precisa come in una tavola di progetto.",
    "testo": "Per un armatore che naviga con la famiglia e un piccolo equipaggio professionale. Per chi vuole correre a Porto Cervo a settembre e attraversare l'Atlantico a novembre, sulla stessa barca e con lo stesso comfort.",
    "dati": [
      {
        "etichetta": "Lunghezza",
        "valore": "19,98 m"
      },
      {
        "etichetta": "Baglio",
        "valore": "5,31 m"
      },
      {
        "etichetta": "Galleggiamento",
        "valore": "16,80 m"
      },
      {
        "etichetta": "Esemplari",
        "valore": "19"
      }
    ]
  },
  {
    "sezione": "01 / Blueprint",
    "titolo": "L'armo",
    "pannello": "grafico-armo",
    "inquadratura": "Dal basso, vicino alla prua: lo sguardo sale lungo l'albero fino alla testa d'albero, con sartie e crocette disegnate a linee sul fondo blu.",
    "testo": "Sloop in testa d'albero, tre ordini di crocette, paterazzo e volanti. In origine le manovre erano tutte manuali, con i coffee grinder in pozzetto. Su diversi scafi oggi alcuni verricelli sono elettrici. Misure dal certificato IRC di uno Swan 651.",
    "dati": [
      {
        "etichetta": "P (randa)",
        "valore": "24,00 m"
      },
      {
        "etichetta": "E (base randa)",
        "valore": "7,04 m"
      },
      {
        "etichetta": "J",
        "valore": "8,05 m"
      },
      {
        "etichetta": "Superficie di bolina",
        "valore": "~194 m²"
      }
    ]
  },
  {
    "sezione": "02",
    "titolo": "Esterni",
    "pannello": "swan-cup-porto-cervo",
    "inquadratura": "Il disegno diventa barca: lo scafo bianco prende corpo in uno studio luminoso, visto di tre quarti da prua, con le ultime linee del progetto che svaniscono e lo sfondo sfocato.",
    "testo": "La linea diventa scafo. Gelcoat bianco, carena rossa, il filetto che corre sotto la falchetta.",
    "dati": []
  },
  {
    "sezione": "02 / Lo scafo",
    "titolo": "Uno scafo da maxi",
    "pannello": "grafico-carena",
    "inquadratura": "Primo piano basso, quasi a pelo dell'acqua, di tre quarti da poppa: lo specchio di poppa, la carena rossa, il timone e lo skeg; l'albero esce dal bordo in alto e lo sfondo è sfocato.",
    "testo": "Slancio di prua lungo, poppa a specchio rovescio che lascia lo spigolo basso a sessanta centimetri dall'acqua. Sotto, una pinna con scarpa in piombo e il timone appeso allo skeg, che lo protegge in oceano.",
    "dati": []
  },
  {
    "sezione": "02 / Il piano di coperta",
    "titolo": "Una coperta per manovrare",
    "pannello": "pianta-coperta-swan-651",
    "inquadratura": "Dall'alto sulla coperta, senza vele: il teak, il pozzetto, la tuga stretta e i passavanti, con un effetto modellino che sfoca i bordi dell'immagine.",
    "testo": "Un pozzetto di manovra profondo e protetto, con la timoneria rialzata a poppa sopra la cabina armatoriale. La tuga è stretta, larga circa metà della coperta, per lasciare passavanti ampi. Teak su tutta la superficie.",
    "dati": []
  },
  {
    "sezione": "02 / Le vele",
    "titolo": "Le vele si gonfiano",
    "pannello": "grafico-vele",
    "inquadratura": "Dal basso, di fianco alla prua: le vele issate e gonfie riempiono l'inquadratura, a fuoco in alto, mentre lo scafo resta sfocato in primo piano.",
    "testo": "Randa e genoa in laminato. Con il vento in poppa entra in gioco lo spinnaker da 388 m², il doppio dell'intera superficie di bolina.",
    "dati": [
      {
        "etichetta": "Randa",
        "valore": "86,1 m²"
      },
      {
        "etichetta": "Fiocco",
        "valore": "107,9 m²"
      },
      {
        "etichetta": "Genoa 150%",
        "valore": "161,8 m²"
      },
      {
        "etichetta": "Spinnaker",
        "valore": "388 m²"
      }
    ]
  },
  {
    "sezione": "02 / Caratteristiche marine",
    "titolo": "Peso dove serve",
    "pannello": "grafico-pesi",
    "inquadratura": "Di fianco, all'altezza del galleggiamento: tutta la carena con la pinna, la scarpa in piombo e il timone sotto la linea dell'acqua; l'albero esce dal bordo in alto.",
    "testo": "Quattordici tonnellate di piombo, il 40% del dislocamento, tutte sotto il galleggiamento. È ciò che permette alla barca di portare tela con vento forte senza sbandare troppo.",
    "dati": [
      {
        "etichetta": "Dislocamento",
        "valore": "36,0 t"
      },
      {
        "etichetta": "Zavorra",
        "valore": "14,4 t"
      },
      {
        "etichetta": "Pescaggio",
        "valore": "3,23 m"
      },
      {
        "etichetta": "Rapporto D/L",
        "valore": "212"
      }
    ]
  },
  {
    "sezione": "03",
    "titolo": "Interni",
    "pannello": "dinette",
    "inquadratura": "Dall'alto, di tre quarti da poppa: la coperta si toglie come in uno spaccato e si accendono le luci di cabina, con un breve sfarfallio, sugli interni in legno.",
    "testo": "Si toglie la coperta. Sotto, quindici metri di spazio vivibile disegnati come una casa: zona armatore a poppa, vita comune al centro, ospiti e vele a prua.",
    "dati": []
  },
  {
    "sezione": "03 / Disposizione",
    "titolo": "Da poppa a prua",
    "pannello": "pianta-interni-swan-651",
    "inquadratura": "Gli interni visti dall'alto, a picco, come la tavola della disposizione: le cabine da poppa a prua una accanto all'altra, con l'effetto modellino.",
    "testo": "Cabina armatoriale a poppa, con bagno e doccia Sala macchine sotto il pozzetto Cucina a sinistra, carteggio e cabina ospiti a dritta Dinette con tavolo a U attorno all'albero Due cabine e due bagni prodieri Cabina a V e gavone delle vele",
    "dati": []
  },
  {
    "sezione": "03 / Ospiti",
    "titolo": "Otto ospiti, due di equipaggio",
    "pannello": "cabina-armatore",
    "inquadratura": "Come una casa delle bambole vista da poppa, bassa: la cabina armatoriale in primo piano e il resto degli interni che sfuma nello sfocato verso prua.",
    "testo": "Nella configurazione tipica quattro cabine ospiti, tre bagni e una cabina per due di equipaggio. La cabina armatoriale è separata dal resto della barca dalla sala macchine: chi possiede il 651 ha la sua casa nella casa. Fonti: Second Wind (Fraser) e Show Me (Brewer). Alcuni scafi hanno layout diversi; il modello segue la tavola di Adrienne II, scafo modificato.",
    "dati": [
      {
        "etichetta": "Cabine ospiti",
        "valore": "4"
      },
      {
        "etichetta": "Bagni",
        "valore": "3"
      },
      {
        "etichetta": "Equipaggio",
        "valore": "2"
      }
    ]
  },
  {
    "sezione": "03 / Materiali",
    "titolo": "Teak, holly, pelle",
    "pannello": "barografo",
    "inquadratura": "Dentro la dinette, vicinissimi: divani in pelle rossa, tavolo e teak caldo sotto le luci di cabina, con un solo punto a fuoco e tutto il resto morbido.",
    "testo": "La ricerca stilistica Swan di quegli anni è nordica e calda: teak miele satinato in ogni superficie, pagliolo a listelli di teak e holly, cielino bianco a doghe, divani in pelle rossa. Prima rifinitura degli interni: cuscini a moduli, porte ad arco, librerie, cucina e carteggio. Bagni e cabine restano semplificati.",
    "dati": []
  },
  {
    "sezione": "04",
    "titolo": "Navigazione",
    "pannello": "di-bolina-sbandata",
    "inquadratura": "In mare aperto, di tre quarti da poppa: la barca sbandata naviga tra le onde sotto il cielo, con la luce e il vento delle condizioni del mare scelte.",
    "testo": "Fuori dal cantiere, in mare aperto. È qui che il disegno di Frers si spiega.",
    "dati": []
  },
  {
    "sezione": "04 / Velocità",
    "titolo": "Otto nodi di media, per settimane",
    "pannello": "grafico-polare",
    "inquadratura": "Affiancati, bassi sull'acqua vicino alla prua: le onde in primo piano, lo scafo che corre e le vele alte contro il cielo.",
    "testo": "Con sedici metri e mezzo di galleggiamento la velocità critica dello scafo sfiora i dieci nodi, e al lasco con vento fresco la barca la supera. Polare dal certificato ORC di uno Swan 651. Il punto di bolina è ricavato dal VMG con un angolo di 42° stimato. Velocità critica 9,9 kn.",
    "dati": []
  },
  {
    "sezione": "04 / Rotte",
    "titolo": "Dove può andare",
    "pannello": "grafico-rotte",
    "inquadratura": "Vista larga dall'alto, da poppa: la barca piccola in mezzo al mare, con l'orizzonte e la costa sullo sfondo.",
    "testo": "Mediterraneo, Porto Cervo e Capri, ~260 mn Traversata atlantica, Canarie e Antigua, ~2.700 mn Pacifico, Panama e Marchesi, ~4.000 mn",
    "dati": []
  },
  {
    "sezione": "04 / Blue water",
    "titolo": "Progettata per l'oceano",
    "pannello": "spirit-of-helsinki-citta-del-capo",
    "inquadratura": "Da prua, dall'altro lato: la prua che taglia le onde e le vele piene sopra, con il mare sfocato attorno.",
    "testo": "Blue water vuol dire poter stare settimane lontano da un porto. Timone protetto dallo skeg, pozzetto profondo e sicuro, 1.100 litri di gasolio e circa 1.300 di acqua, un diesel Perkins da 116 cavalli. Spirit of Helsinki, che allora si chiamava Fazer Finland, arrivò terza alla Whitbread 1985-86.",
    "dati": [
      {
        "etichetta": "Autonomia a 7-8 kn",
        "valore": "~700 mn"
      },
      {
        "etichetta": "Zavorra / dislocamento",
        "valore": "40%"
      },
      {
        "etichetta": "SA/D",
        "valore": "18,1"
      },
      {
        "etichetta": "Motore",
        "valore": "116 hp"
      }
    ]
  },
  {
    "sezione": "Germán Frers, 1982-1991",
    "titolo": "Diciannove scafi",
    "pannello": "ritratto-ad-acquerello",
    "inquadratura": "La camera si allontana: la barca sbandata diventa piccola tra mare e cielo, con tanto cielo sopra di lei.",
    "testo": "Il prossimo capitolo: la storia di ognuno di loro.",
    "dati": []
  }
];
