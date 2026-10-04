// Confronta un GLB ottimizzato con l'originale: nomi, materiali, morph target e scarto dei vertici in metri.
// Uso: node scripts/glb-compare.mjs originale.glb ottimizzato.glb
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const [a, b] = await Promise.all(process.argv.slice(2, 4).map((f) => io.read(f)));

// Posizioni in coordinate di scena, per mesh (le istanze diventano una copia per istanza)
function worldPositions(doc) {
  const out = new Map();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const inst = node.getExtension("EXT_mesh_gpu_instancing");
    const m = node.getWorldMatrix();
    const mats = [];
    if (inst) {
      const T = inst.getAttribute("TRANSLATION"), R = inst.getAttribute("ROTATION"), S = inst.getAttribute("SCALE");
      const n = (T || R || S).getCount();
      for (let i = 0; i < n; i++) {
        const t = T ? T.getElement(i, []) : [0, 0, 0], r = R ? R.getElement(i, []) : [0, 0, 0, 1], s = S ? S.getElement(i, []) : [1, 1, 1];
        mats.push(mul(m, trs(t, r, s)));
      }
    } else mats.push(m);
    const pts = [];
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute("POSITION");
      const el = [];
      for (const mm of mats) for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, el); pts.push(apply(mm, el)); }
    }
    out.set(mesh.getName(), (out.get(mesh.getName()) || []).concat(pts));
  }
  return out;
}
function trs(t, q, s) {
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function apply(m, p) {
  return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
}

const pa = worldPositions(a), pb = worldPositions(b);
let worst = 0;
for (const [name, pts] of pa) {
  const q = pb.get(name);
  if (!q) { console.log("MANCA", name); continue; }
  // il riordino cambia l'ordine dei vertici: si confronta il punto più vicino su una griglia
  const grid = new Map();
  const key = (p) => p.map((v) => Math.round(v / 0.05)).join(",");
  for (const p of q) { const k = key(p); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
  let err = 0;
  for (const p of pts) {
    let best = Infinity;
    const [i, j, k] = p.map((v) => Math.round(v / 0.05));
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
      for (const r of grid.get(`${i + di},${j + dj},${k + dk}`) || []) best = Math.min(best, Math.hypot(r[0] - p[0], r[1] - p[1], r[2] - p[2]));
    }
    err = Math.max(err, best);
  }
  worst = Math.max(worst, err);
  if (err > 0.002 || pts.length !== q.length) console.log(`  ${name}: vertici ${pts.length} -> ${q.length}, scarto massimo ${(err * 1000).toFixed(2)} mm`);
}
console.log(`scarto massimo su tutte le mesh: ${(worst * 1000).toFixed(2)} mm`);

// Morph target: devono essere identici, bit per bit
for (const ma of a.getRoot().listMeshes()) {
  const mb = b.getRoot().listMeshes().find((m) => m.getName() === ma.getName());
  if (!ma.listPrimitives().some((p) => p.listTargets().length)) continue;
  const same = ma.listPrimitives().every((p, i) => {
    const q = mb.listPrimitives()[i];
    const eq = (x, y) => x && y && x.getArray().constructor === y.getArray().constructor && x.getCount() === y.getCount();
    const sortKey = (acc) => Array.from(acc.getArray()).sort().join(",");
    return ["POSITION", "NORMAL"].every((s) => eq(p.getAttribute(s), q.getAttribute(s)) && sortKey(p.getAttribute(s)) === sortKey(q.getAttribute(s)))
      && p.listTargets().every((t, k) => ["POSITION", "NORMAL"].every((s) => !t.getAttribute(s) || sortKey(t.getAttribute(s)) === sortKey(q.listTargets()[k].getAttribute(s))));
  });
  console.log(`morph ${ma.getName()}: ${same ? "attributi e target identici (float, solo riordinati)" : "DIVERSI"}; extras ${JSON.stringify(mb.getExtras())}`);
}
const names = (d) => d.getRoot().listMaterials().map((m) => m.getName()).sort().join(",");
console.log("materiali uguali:", names(a) === names(b));
const nodeNames = (d) => new Set(d.getRoot().listNodes().map((n) => n.getName()));
const missing = [...nodeNames(a)].filter((n) => !nodeNames(b).has(n));
console.log("nodi non più presenti (diventati istanze):", missing.length, missing.filter((n) => !/^(Winch|Cleat|Block_|Stopper|Fairlead|GenoaCar)/.test(n)).join(", ") || "solo attrezzatura in istanza");
