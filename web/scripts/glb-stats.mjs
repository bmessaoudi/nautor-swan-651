// Statistiche di un GLB: peso, triangoli disegnati e unici, istanze, texture e memoria GPU stimata.
// Uso: node scripts/glb-stats.mjs file.glb [altro.glb ...]
import { statSync } from "node:fs";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import { read as readKTX } from "ktx-parse";

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });

// Memoria GPU di una texture con le mipmap (un terzo in più).
// PNG e JPEG diventano RGBA8; KTX2 si transcodifica in un formato compresso:
// ETC1S -> BC1/ETC1 (4 bit per pixel, 8 se c'è alfa), UASTC -> BC7/ASTC 4x4 (8 bit per pixel).
function gpuBytes(tex) {
  const [w, h] = tex.getSize() || [0, 0];
  const mime = tex.getMimeType();
  let bpp = 32;
  if (mime === "image/ktx2") {
    const k = readKTX(tex.getImage());
    const uastc = k.dataFormatDescriptor[0].colorModel === 166;
    bpp = uastc ? 8 : 4;
  }
  return Math.round(((w * h * bpp) / 8) * 4 / 3);
}

for (const file of process.argv.slice(2)) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  let drawn = 0;
  let unique = 0;
  const seen = new Set();
  let instanced = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const inst = node.getExtension("EXT_mesh_gpu_instancing");
    const count = inst ? inst.listAttributes()[0].getCount() : 1;
    if (inst) instanced += count;
    let t = 0;
    for (const p of mesh.listPrimitives()) t += (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3;
    drawn += t * count;
    if (!seen.has(mesh)) { seen.add(mesh); unique += t; }
  }
  const tex = root.listTextures().map((t) => ({ name: t.getName(), mime: t.getMimeType(), size: t.getSize(), bytes: t.getImage().byteLength, gpu: gpuBytes(t) }));
  const gpu = tex.reduce((a, t) => a + t.gpu, 0);
  console.log(`\n${file}`);
  console.log(`  peso ${(statSync(file).size / 1024).toFixed(0)} KB, nodi ${root.listNodes().length}, mesh ${root.listMeshes().length}, istanze GPU ${instanced}`);
  console.log(`  triangoli disegnati ${drawn}, unici ${unique}`);
  console.log(`  estensioni ${root.listExtensionsUsed().map((e) => e.extensionName).join(", ") || "nessuna"}`);
  for (const t of tex) console.log(`  texture ${t.name} ${t.mime} ${t.size?.join("x")} file ${(t.bytes / 1024).toFixed(0)} KB, GPU ${(t.gpu / 1048576).toFixed(2)} MB`);
  console.log(`  memoria texture stimata ${(gpu / 1048576).toFixed(2)} MB`);
  const morph = root.listMeshes().filter((m) => m.listPrimitives().some((p) => p.listTargets().length)).map((m) => m.getName());
  console.log(`  mesh con morph target: ${morph.join(", ")}`);
}
