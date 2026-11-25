// Worker : un processus en arrière-plan qui calcule les tuiles du monde sans jamais bloquer l'affichage.
// Il reçoit « fabrique la tuile (cx, cz) au détail lod » et renvoie le maillage prêt à l'emploi.

import { CHUNK_SIZE, ChunkData, buildChunk } from '../core/chunk';
import { parseCities } from '../core/cities';
import { createRelief } from '../core/relief';
import type { ReliefGrid } from '../core/relief';
import { Terrain, createTerrain } from '../core/terrain';
import { VillageSystem } from '../core/villageSystem';
import { realClimate } from './climateData';

// Messages envoyés au worker.
export type WorkerRequest =
  | { type: 'init'; seed: number; relief: ReliefGrid; cities: Uint8Array } // choisit la graine du monde et reçoit le relief réel et les villes
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
let villages: VillageSystem | null = null; // les villages (pour en écarter les arbres)

ctx.onmessage = (event) => {
  const msg = event.data; // le message reçu
  if (msg.type === 'init') {
    terrain = createTerrain(msg.seed, createRelief(msg.relief), realClimate); // chaque worker a son propre terrain, identique grâce à la graine et au relief
    villages = new VillageSystem(parseCities(msg.cities), terrain); // les villes du monde
    return;
  }
  if (!terrain) return; // pas encore initialisé : on ignore
  try {
    const data = buildChunk(terrain, msg.cx, msg.cz, msg.lod, villages ? villages.blockerForChunk(msg.cx, msg.cz, CHUNK_SIZE) : null, villages ? villages.dirtForChunk(msg.cx, msg.cz, CHUNK_SIZE) : null); // calcul du maillage (sans arbres dans les villages ni sur les chemins, avec la terre peinte)
    // Les tableaux sont TRANSFÉRÉS (pas copiés) : plus rapide, et le worker n'en a plus besoin.
    ctx.postMessage({ ok: true, data }, [data.positions.buffer, data.normals.buffer, data.colors.buffer, data.indices.buffer]);
  } catch (error) {
    ctx.postMessage({ ok: false, cx: msg.cx, cz: msg.cz, lod: msg.lod, message: String(error) }, []); // on prévient le jeu
  }
};
