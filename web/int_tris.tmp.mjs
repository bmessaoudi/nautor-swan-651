import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(process.argv[2]);
let tot = 0, intr = 0;
const uv1 = [];
for (const n of doc.getRoot().listNodes()) {
  const m = n.getMesh(); if (!m) continue;
  let t = 0;
  for (const p of m.listPrimitives()) {
    const idx = p.getIndices(); t += (idx ? idx.getCount() : p.getAttribute("POSITION").getCount()) / 3;
    if (n.getName().startsWith("Interior") && p.getAttribute("TEXCOORD_1")) { const a = p.getAttribute("TEXCOORD_1"); uv1.push(`${n.getName()}:${a.getComponentType()}${a.getNormalized()?"n":""}`); }
  }
  tot += t; if (n.getName().startsWith("Interior")) intr += t;
}
console.log("tot", tot, "interior", intr, "uv1", [...new Set(uv1)].join(" "));
