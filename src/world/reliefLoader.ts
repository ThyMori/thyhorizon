// Charge le fichier du relief réel (src/data/relief.bin) : téléchargement, décompression, décodage.
// Ce fichier est sur le réseau du jeu lui-même (rien n'est demandé à un service externe) et se met en cache hors ligne.

import reliefUrl from '../data/relief.bin?url';
import { RELIEF_HEADER_BYTES, ReliefGrid, decodeReliefDeltas, parseReliefHeader } from '../core/relief';

// Décompresse des octets au format zlib avec l'outil du navigateur.
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('ce navigateur est trop ancien pour lire le relief du monde');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Télécharge et prépare la grille de relief.
export async function loadReliefGrid(): Promise<ReliefGrid> {
  const response = await fetch(reliefUrl);
  if (!response.ok) throw new Error(`relief du monde introuvable (${response.status})`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const header = parseReliefHeader(bytes);
  return decodeReliefDeltas(header, await inflate(bytes.subarray(RELIEF_HEADER_BYTES)));
}


