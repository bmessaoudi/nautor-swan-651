// Caricamento dei GLB ottimizzati da scripts/optimize-glb.mjs (meshopt, KTX2, istanze GPU).
// Lo usano la landing (main.js) e la pagina a voce (bordo/scena.js); legge anche i GLB non ottimizzati.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

let ktx2 = null;

// Un solo KTX2Loader per pagina: il transcoder Basis (public/basis) gira in un worker.
// Serve anche per le texture .ktx2 sciolte, per esempio le lightmap: ktx2Loader(renderer).load(url)
export function ktx2Loader(renderer) {
  if (!ktx2) ktx2 = new KTX2Loader().setTranscoderPath("/basis/").detectSupport(renderer);
  return ktx2;
}

export function createGLTFLoader(renderer) {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Loader(renderer));
}

// Spigoli per il disegno a linee. Un InstancedMesh (attrezzatura di coperta) disegna la stessa
// geometria in più punti: gli spigoli si ripetono per ogni istanza in un'unica geometria.
export function edgesOf(mesh, angle) {
  const edges = new THREE.EdgesGeometry(mesh.geometry, angle);
  if (!mesh.isInstancedMesh) return edges;
  const m = new THREE.Matrix4();
  const parts = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    parts.push(edges.clone().applyMatrix4(m));
  }
  edges.dispose();
  return mergeGeometries(parts);
}
