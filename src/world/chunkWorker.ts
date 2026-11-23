// Worker : un processus en arrière-plan qui calcule les tuiles du monde sans jamais bloquer l'affichage.
// Il reçoit « fabrique la tuile (cx, cz) au détail lod » et renvoie le maillage prêt à l'emploi.

import { ChunkData, buildChunk } from '../core/chunk';
import { createRelief } from '../core/relief';
import type { ReliefGrid } from '../core/relief';
import { Terrain, createTerrain } from '../core/terrain';

// Messages envoyés au worker.
export type WorkerRequest =
  | { type: 'init'; seed: number; relief: ReliefGrid } // choisit la graine du monde et reçoit le relief réel
  | { type: 'build'; cx: number; cz: number; lod: number }; // fabrique une tuile

// Messages renvoyés par le worker.
export type WorkerResponse =
  | { ok: true; data: ChunkData } // tuile prête
  | { ok: false; cx: number; cz: number; lod: number; message: string }; // échec

// Dans un worker, « self » est le contexte global : on lui donne un type minimal qui décrit ce qu'on utilise.
const ctx = self as unknown as {
  postMessage(message: WorkerResponse, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

let terrain: Terrain | null = null; // le terrain de ce worker (créé à l'initialisation)

ctx.onmessage = (event) => {
  const msg = event.data; // le message reçu
  if (msg.type === 'init') {
    terrain = createTerrain(msg.seed, createRelief(msg.relief)); // chaque worker a son propre terrain, identique grâce à la graine et au relief
    return;
  }
  if (!terrain) return; // pas encore initialisé : on ignore
  try {
    const data = buildChunk(terrain, msg.cx, msg.cz, msg.lod); // calcul du maillage
    // Les tableaux sont TRANSFÉRÉS (pas copiés) : plus rapide, et le worker n'en a plus besoin.
    ctx.postMessage({ ok: true, data }, [data.positions.buffer, data.normals.buffer, data.colors.buffer, data.indices.buffer]);
  } catch (error) {
    ctx.postMessage({ ok: false, cx: msg.cx, cz: msg.cz, lod: msg.lod, message: String(error) }, []); // on prévient le jeu
  }
};
