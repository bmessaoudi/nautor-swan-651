import { NodeIO } from "@gltf-transform/core";
import { createHash } from "crypto";
const io = new NodeIO();
async function h(f) { const d = await io.read(f); const o = {}; for (const n of d.getRoot().listNodes()) { const m = n.getMesh(); if (!m || !n.getName().startsWith("Interior")) continue; const hs = createHash("md5"); for (const p of m.listPrimitives()) { const a = p.getAttribute("TEXCOORD_1"); if (a) hs.update(Buffer.from(a.getArray().buffer)); } o[n.getName()] = hs.digest("hex").slice(0, 8); } return o; }
const a = await h(process.argv[2]), b = await h(process.argv[3]);
console.log(Object.keys(a).map((k) => `${k}:${a[k] === b[k] ? "uguale" : "DIVERSO"}`).join(" "));
