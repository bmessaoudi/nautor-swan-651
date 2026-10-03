// Comandi del computer di bordo: pulsanti flottanti di vetro (come il "liquid glass" di iOS)
// attorno alla sfera della voce. A sinistra l'accensione, al centro la sfera da tenere premuta
// per parlare, a destra sottotitoli e suoni raccolti in una sola capsula.
import { createOrb } from "./orb.js";

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONE = {
  power: svg(`<path d="M12 3.5v8"/><path d="M6.6 6.8a7.5 7.5 0 1 0 10.8 0"/>`),
  cc: svg(`<rect x="3" y="5.5" width="18" height="13" rx="3.2"/><path d="M10.4 10.2a2.4 2.4 0 1 0 0 3.6"/><path d="M17 10.2a2.4 2.4 0 1 0 0 3.6"/>`),
  // altoparlante con le onde quando i suoni sono attivi, barrato quando sono spenti
  audio: svg(
    `<path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z"/><g class="acceso"><path d="M15.6 9.2a4 4 0 0 1 0 5.6"/><path d="M18.2 6.8a7.4 7.4 0 0 1 0 10.4"/></g><g class="spento"><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/></g>`
  ),
};

const tasto = (k, label, pressed) =>
  `<button type="button" class="tasto" data-k="${k}" aria-pressed="${pressed}" aria-label="${label}" title="${label}">${ICONE[k]}</button>`;

export function createPlancia(root) {
  root.innerHTML = `
    <div class="dock">
      <div class="vetro capsula">${tasto("power", "Accendi o spegni il computer di bordo", false)}</div>
      <div class="vetro sfera"><canvas class="orb"></canvas></div>
      <div class="vetro capsula">
        ${tasto("cc", "Sottotitoli", false)}
        ${tasto("audio", "Suoni d'ambiente", true)}
      </div>
    </div>
    <span class="stato mono" aria-live="polite"></span>`;

  const orb = createOrb(root.querySelector(".orb"));
  const leva = (k) => root.querySelector(`.tasto[data-k="${k}"]`);

  return {
    orb,
    leva,
    setLeva(k, on) {
      leva(k).setAttribute("aria-pressed", String(on));
    },
    // all'accensione la sfera si gonfia e il vetro prende luce
    async accensione() {
      root.classList.add("accensione");
      await new Promise((r) => setTimeout(r, 700));
      root.classList.remove("accensione");
    },
  };
}
