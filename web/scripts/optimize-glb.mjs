// Ottimizza i GLB esportati da Blender per il web: istanze GPU, meshopt e texture KTX2.
//
//   pnpm run modello                                  modello principale (models -> public/models)
//   node scripts/optimize-glb.mjs in.glb out.glb      un GLB qualunque
//   node scripts/optimize-glb.mjs --ktx2-dir public/models/lightmaps
//                                                     converte in .ktx2 le immagini di una cartella
//
// Cosa fa, nell'ordine:
// 1. dedup degli accessor e delle texture uguali (i nomi dei materiali restano: materials.js li legge);
// 2. quantizzazione (KHR_mesh_quantization) di POSITION, NORMAL e TEXCOORD_n. Le mesh con morph
//    target (le vele) restano intere in float, morph compresi: lo shader della balumina in
//    materials.js lavora in coordinate locali e in metri. Gli attributi custom (_NOME) e i colori
//    non si toccano;
// 3. istanze GPU (EXT_mesh_gpu_instancing) per le mesh condivise da più nodi, cioè l'attrezzatura
//    di coperta costruita come mesh condivise in swan651_rig.py;
// 4. compressione meshopt (EXT_meshopt_compression, modo senza perdite sui dati già quantizzati);
// 5. texture in KTX2 (KHR_texture_basisu): UASTC per le normal map, ETC1S per tutto il resto
//    (colore, ruvidità, lightmap). Lo spazio colore viene dallo slot del materiale.
// Le texture esterne (lightmap, texture delle vele caricate a parte) si convertono con --ktx2-dir:
// accanto a ogni .png, .jpg o .webp nasce un .ktx2 con lo stesso nome, da caricare con il KTX2Loader
// condiviso di src/gltf-loader.js. Nomi con "nor" o "normal" vanno in UASTC; nomi con rough, metal,
// ao, orm, mask restano lineari; il resto (colore e lightmap) è sRGB.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO, PropertyType } from "@gltf-transform/core";
import { ALL_EXTENSIONS, EXTMeshoptCompression, KHRTextureBasisu } from "@gltf-transform/extensions";
import { dedup, getTextureColorSpace, instance, listTextureSlots, prune, quantize, reorder } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { encodeToKTX2 } from "ktx2-encoder";
import sharp from "sharp";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Il transcoder Basis del KTX2Loader si serve da public/basis (copiato da three, stessa versione)
function copyTranscoder() {
  const src = join(WEB, "node_modules/three/examples/jsm/libs/basis");
  const dst = join(WEB, "public/basis");
  mkdirSync(dst, { recursive: true });
  for (const f of ["basis_transcoder.js", "basis_transcoder.wasm"]) copyFileSync(join(src, f), join(dst, f));
}

async function decode(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

// kind: "normal" (UASTC), "srgb" o "linear" (ETC1S)
async function encode(image, kind) {
  const common = { isKTX2File: true, generateMipmap: true, imageDecoder: decode, enableDebug: false };
  const srgb = kind === "srgb";
  const opts = kind === "normal"
    ? { ...common, isUASTC: true, uastcLDRQualityLevel: 2, needSupercompression: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false }
    : { ...common, isUASTC: false, qualityLevel: 230, compressionLevel: 2, needSupercompression: false, isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb };
  // il WASM di Basis stampa il resoconto di ogni mipmap: qui si tace
  const log = console.log;
  console.log = () => {};
  try {
    return await encodeToKTX2(image, opts);
  } finally {
    console.log = log;
  }
}

function textureKind(texture) {
  if (listTextureSlots(texture).includes("normalTexture")) return "normal";
  return getTextureColorSpace(texture) === "srgb" ? "srgb" : "linear";
}

function fileKind(name) {
  if (/nor(mal)?[^a-z]|nor(mal)?$/i.test(name.replace(extname(name), ""))) return "normal";
  if (/rough|metal|(^|[^a-z])ao([^a-z]|$)|occlusion|orm|mask/i.test(name)) return "linear";
  return "srgb";
}

// Le mesh con morph target non vanno quantizzate. quantize() non ha un filtro per mesh: per il suo
// giro le loro primitive ricevono attributi segnaposto a 8 bit (che salta, perché già piccoli) e i
// nodi si staccano (così nessuna correzione di scala finisce sul nodo); poi torna tutto com'era.
async function quantizeExceptMorphs(doc) {
  const root = doc.getRoot();
  const parked = [];
  const SEM = /^(POSITION|NORMAL|TEXCOORD_\d+)$/;
  for (const mesh of root.listMeshes()) {
    if (!mesh.listPrimitives().some((p) => p.listTargets().length)) continue;
    const nodes = mesh.listParents().filter((p) => p.propertyType === PropertyType.NODE);
    for (const n of nodes) n.setMesh(null);
    const prims = mesh.listPrimitives().map((prim) => {
      const saved = {};
      for (const sem of prim.listSemantics().filter((s) => SEM.test(s))) {
        saved[sem] = prim.getAttribute(sem);
        const n = saved[sem].getElementSize();
        const ph = doc.createAccessor().setType(saved[sem].getType()).setArray(Int8Array.from({ length: 2 * n }, (_, i) => (i < n ? 0 : 1)));
        prim.setAttribute(sem, ph);
      }
      return { prim, saved };
    });
    parked.push({ mesh, prims, nodes });
  }
  await doc.transform(
    quantize({
      pattern: /^(POSITION|NORMAL|TEXCOORD_\d+)$/,
      patternTargets: /^$/,
      quantizePosition: 16,
      quantizeNormal: 10,
      quantizeTexcoord: 14,
      cleanup: false,
    })
  );
  for (const { mesh, prims, nodes } of parked) {
    for (const { prim, saved } of prims) {
      for (const [sem, acc] of Object.entries(saved)) {
        const ph = prim.getAttribute(sem);
        prim.setAttribute(sem, acc);
        ph.dispose();
      }
    }
    for (const n of nodes) n.setMesh(mesh);
  }
  return parked.map((p) => p.mesh.getName());
}

export async function optimizeGLB(input, output) {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  const doc = await io.read(input);
  const root = doc.getRoot();

  await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.TEXTURE] }));
  const morphs = await quantizeExceptMorphs(doc);
  await doc.transform(instance({ min: 2 }));
  // il nodo delle istanze prende il nome della mesh (gli oggetti restano leggibili per nome nel web)
  for (const node of root.listNodes()) {
    if (node.getExtension("EXT_mesh_gpu_instancing") && !node.getName()) node.setName(node.getMesh().getName());
  }
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: "size" }),
    prune({ keepAttributes: true, keepLeaves: true, keepExtras: true, keepSolidTextures: true })
  );

  // Texture: una alla volta, l'encoder Basis in WASM è pesante
  for (const texture of root.listTextures()) {
    const mime = texture.getMimeType();
    if (mime !== "image/png" && mime !== "image/jpeg") continue;
    const kind = textureKind(texture);
    texture.setImage(await encode(texture.getImage(), kind)).setMimeType("image/ktx2");
    if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.(png|jpe?g)$/i, ".ktx2"));
    console.log(`  ktx2 ${texture.getName() || texture.getURI()}: ${kind === "normal" ? "UASTC" : "ETC1S " + kind}`);
  }
  if (root.listTextures().some((t) => t.getMimeType() === "image/ktx2")) doc.createExtension(KHRTextureBasisu).setRequired(true);

  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  await io.write(output, doc);
  const kb = (f) => (statSync(f).size / 1024).toFixed(0);
  console.log(`${input} (${kb(input)} KB) -> ${output} (${kb(output)} KB); morph intatti: ${morphs.join(", ") || "nessuno"}`);
}

export async function convertFolder(dir) {
  for (const f of readdirSync(dir)) {
    if (!/\.(png|jpe?g|webp)$/i.test(f)) continue;
    const src = join(dir, f);
    const dst = src.replace(/\.(png|jpe?g|webp)$/i, ".ktx2");
    const kind = fileKind(f);
    writeFileSync(dst, await encode(new Uint8Array(readFileSync(src)), kind));
    console.log(`  ${f} -> ${dst.split("/").pop()} (${kind === "normal" ? "UASTC" : "ETC1S " + kind}), ${(statSync(src).size / 1024).toFixed(0)} -> ${(statSync(dst).size / 1024).toFixed(0)} KB`);
  }
}

const args = process.argv.slice(2);
copyTranscoder();
const k = args.indexOf("--ktx2-dir");
if (k >= 0) {
  await convertFolder(resolve(args[k + 1]));
  args.splice(k, 2);
}
if (args.length || k < 0) {
  const input = resolve(args[0] || join(WEB, "../models/swan651.glb"));
  const output = resolve(args[1] || join(WEB, "public/models/swan651.glb"));
  if (!existsSync(input)) throw new Error(`Manca ${input}: esporta prima da Blender (scripts/blender/build_and_export.py)`);
  await optimizeGLB(input, output);
}
