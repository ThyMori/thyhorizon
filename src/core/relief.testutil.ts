// Aide pour les TESTS uniquement : charge le vrai fichier de relief depuis le disque (jamais importé par le jeu).
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { Relief, ReliefGrid, RELIEF_HEADER_BYTES, createRelief, decodeReliefDeltas, parseReliefHeader } from './relief';

let cached: Relief | null = null; // une seule lecture pour tous les tests d'un fichier

// Le vrai relief du jeu (src/data/relief.bin).
export function loadRealRelief(): Relief {
  if (cached) return cached;
  const file = new Uint8Array(readFileSync(new URL('../data/relief.bin', import.meta.url)));
  const header = parseReliefHeader(file);
  const deltas = new Uint8Array(inflateSync(file.subarray(RELIEF_HEADER_BYTES)));
  cached = createRelief(decodeReliefDeltas(header, deltas));
  return cached;
}

// Un petit monde de pure fantaisie pour tester les calculs : la hauteur ne dépend que de la fonction donnée (lat, lon → mètres).
export function fakeRelief(fn: (lat: number, lon: number) => number, width = 72, height = 37): Relief {
  const grid: ReliefGrid = { width, height, metersPerUnit: 1, data: new Int16Array(width * height) };
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) grid.data[j * width + i] = Math.round(fn(90 - (j * 180) / (height - 1), (i * 360) / width));
  return createRelief(grid);
}
