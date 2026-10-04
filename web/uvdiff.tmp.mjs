import { NodeIO } from "@gltf-transform/core";
const io = new NodeIO();
const get = async (f) => { const d = await io.read(f); const n = d.getRoot().listNodes().find((n) => n.getName() === "Interior_Bulkheads"); return n.getMesh().listPrimitives().map((p) => [p.getAttribute("TEXCOORD_1").getArray(), p.getAttribute("POSITION").getArray()]); };
const A = await get(process.argv[2]), B = await get(process.argv[3]);
A.forEach(([ua, pa], i) => { const [ub, pb] = B[i]; let mu = 0, mp = 0, n = 0; for (let k = 0; k < ua.length; k++) { const d = Math.abs(ua[k] - ub[k]); if (d > 1e-6) n++; mu = Math.max(mu, d); } for (let k = 0; k < pa.length; k++) mp = Math.max(mp, Math.abs(pa[k] - pb[k])); console.log(i, ua.length, ub.length, "maxUV", mu, "count", n, "maxPos", mp); });
