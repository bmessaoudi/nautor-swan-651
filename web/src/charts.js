import { geoNaturalEarth1, geoPath, geoGraticule10 } from "d3-geo";
import { line, curveCatmullRom } from "d3-shape";
import { feature } from "topojson-client";
import land110 from "world-atlas/land-110m.json";

const NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  parent?.appendChild(n);
  return n;
};

// ---------- Mappa delle rotte ----------
const PORTS = {
  "Porto Cervo": [9.55, 41.13],
  Capri: [14.24, 40.55],
  "Las Palmas": [-15.42, 28.13],
  Antigua: [-61.78, 17.0],
  Panama: [-79.9, 9.36],
  "Galápagos": [-90.3, -0.74],
  "Nuku Hiva": [-140.1, -8.9],
};

const ROUTES = {
  med: [PORTS["Porto Cervo"], [11.6, 40.9], PORTS.Capri],
  atl: [PORTS["Las Palmas"], [-25, 22], [-45, 17.5], PORTS.Antigua],
  pac: [PORTS.Antigua, [-72, 12.5], PORTS.Panama, [-79.5, 7], PORTS["Galápagos"], [-115, -5], PORTS["Nuku Hiva"]],
};

export function drawMap(svg) {
  const projection = geoNaturalEarth1().rotate([62, 0]);
  projection.fitExtent([[8, 8], [632, 352]], {
    type: "MultiPoint",
    coordinates: [[-148, -14], [22, 50], [-148, 50], [22, -14]],
  });
  const path = geoPath(projection);
  const g = el("g", {}, svg);
  el("path", { class: "grat", d: path(geoGraticule10()) }, g);
  el("path", { class: "land", d: path(feature(land110, land110.objects.land)) }, g);
  for (const [key, coords] of Object.entries(ROUTES)) {
    el("path", { class: `route ${key}`, d: path({ type: "LineString", coordinates: coords }), pathLength: 1 }, g);
  }
  for (const [name, c] of Object.entries(PORTS)) {
    const [x, y] = projection(c);
    el("circle", { class: "port", cx: x, cy: y, r: 2.2 }, g);
    const below = name === "Capri";
    const t = el("text", { class: "port-lab", x: x + 5, y: below ? y + 11 : y - 5 }, g);
    t.textContent = name.toUpperCase();
  }
}

// ---------- Polare stimata ----------
// Velocità della barca (nodi) per angolo al vento reale, con 10, 16 e 20 nodi di vento
const POLAR = {
  10: [[38, 6.4], [45, 7.0], [60, 7.9], [90, 8.6], [120, 8.4], [150, 7.0], [180, 6.0]],
  16: [[36, 7.6], [45, 8.3], [60, 9.2], [90, 10.1], [120, 10.6], [150, 9.6], [180, 8.4]],
  20: [[35, 8.0], [45, 8.6], [60, 9.6], [90, 10.8], [120, 11.6], [150, 10.9], [180, 9.6]],
};

export function drawPolar(svg) {
  const cx = 40;
  const cy = 150;
  const R = 130 / 12; // pixel per nodo
  const pt = (a, kn) => {
    const r = (a * Math.PI) / 180;
    return [cx + kn * R * Math.sin(r), cy - kn * R * Math.cos(r)];
  };
  for (const kn of [4, 8, 12]) {
    const [x0, y0] = pt(0, kn);
    const [x1, y1] = pt(180, kn);
    el("path", { class: "ring", d: `M${x0},${y0} A${kn * R},${kn * R} 0 0 1 ${x1},${y1}` }, svg);
    const t = el("text", { x: cx - 4, y: cy - kn * R + 3, "text-anchor": "end" }, svg);
    t.textContent = `${kn} kn`;
  }
  for (let a = 0; a <= 180; a += 30) {
    const [x, y] = pt(a, 12.6);
    el("line", { class: "ax", x1: cx, y1: cy, x2: x, y2: y }, svg);
    const [lx, ly] = pt(a, 13.4);
    const t = el("text", { x: lx, y: ly + 3, "text-anchor": "middle" }, svg);
    t.textContent = `${a}°`;
  }
  const gen = line().curve(curveCatmullRom.alpha(0.5));
  for (const [tws, pts] of Object.entries(POLAR)) {
    el("path", { class: `curve c${tws}`, d: gen(pts.map(([a, kn]) => pt(a, kn))), pathLength: 1 }, svg);
  }
}
