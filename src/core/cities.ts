// Les villes réelles du monde (≥ 5 000 habitants) lues dans src/data/cities.bin, avec leur position dans le monde du jeu. Logique pure.
// Le fichier est fabriqué par scripts/build-cities.mjs (voir son en-tête pour le format). Source : GeoNames, CC BY 4.0.

import { latLonToWorld } from './geo';

const HEADER = 8; // « THPL » + nombre de villes
const RECORD = 18; // octets par ville
const INDEX_CELL = 25000; // côté des cases de l'index de recherche (m)

export interface Cities {
  readonly count: number; // nombre de villes
  readonly lat: Float64Array; // latitude réelle (degrés)
  readonly lon: Float64Array; // longitude réelle (degrés)
  readonly x: Float64Array; // position dans le monde du jeu (m, est)
  readonly z: Float64Array; // position dans le monde du jeu (m, sud)
  readonly pop: Uint32Array; // habitants
  readonly country: string[]; // code pays à 2 lettres
  name(i: number): string; // nom de la ville i
  nearby(x: number, z: number, radius: number): number[]; // numéros des villes à moins de `radius` mètres de (x, z)
}

// Une case de l'index : entiers (colonne, ligne) rangés dans une seule clé.
const cellKey = (ci: number, cj: number): number => (ci + 4096) * 8192 + (cj + 4096);

// Lit le contenu de cities.bin. Lève une erreur claire si le fichier est abîmé.
export function parseCities(bytes: Uint8Array): Cities {
  if (bytes.length < HEADER || String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== 'THPL') throw new Error('fichier des villes illisible (signature)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); // lecture d'entiers
  const count = view.getUint32(4, true); // nombre de villes
  const namesBase = HEADER + count * RECORD; // début de la zone des noms
  if (namesBase > bytes.length) throw new Error('fichier des villes tronqué');
  const lat = new Float64Array(count);
  const lon = new Float64Array(count);
  const x = new Float64Array(count);
  const z = new Float64Array(count);
  const pop = new Uint32Array(count);
  const country: string[] = new Array<string>(count);
  const nameAt = new Uint32Array(count); // décalage du nom de chaque ville
  const cells = new Map<number, number[]>(); // index : case → villes qu'elle contient
  for (let i = 0; i < count; i++) {
    const o = HEADER + i * RECORD; // début de l'enregistrement
    lat[i] = view.getInt32(o, true) / 1e4;
    lon[i] = view.getInt32(o + 4, true) / 1e4;
    pop[i] = view.getUint32(o + 8, true);
    country[i] = String.fromCharCode(bytes[o + 12]!, bytes[o + 13]!);
    nameAt[i] = view.getUint32(o + 14, true);
    const w = latLonToWorld(lat[i]!, lon[i]!); // position dans le monde du jeu
    x[i] = w.x;
    z[i] = w.z;
    const key = cellKey(Math.floor(w.x / INDEX_CELL), Math.floor(w.z / INDEX_CELL));
    const list = cells.get(key);
    if (list) list.push(i);
    else cells.set(key, [i]);
  }
  const decoder = new TextDecoder('utf-8'); // les noms sont en UTF-8
  return {
    count,
    lat,
    lon,
    x,
    z,
    pop,
    country,
    name(i: number): string {
      const start = namesBase + (nameAt[i] ?? 0); // début du nom
      let end = start; // on cherche l'octet 0 qui le termine
      while (end < bytes.length && bytes[end] !== 0) end++;
      return decoder.decode(bytes.subarray(start, end));
    },
    nearby(px: number, pz: number, radius: number): number[] {
      const out: number[] = [];
      const r2 = radius * radius;
      const c0 = Math.floor((px - radius) / INDEX_CELL);
      const c1 = Math.floor((px + radius) / INDEX_CELL);
      const j0 = Math.floor((pz - radius) / INDEX_CELL);
      const j1 = Math.floor((pz + radius) / INDEX_CELL);
      for (let ci = c0; ci <= c1; ci++) {
        for (let cj = j0; cj <= j1; cj++) {
          for (const i of cells.get(cellKey(ci, cj)) ?? []) if ((x[i]! - px) ** 2 + (z[i]! - pz) ** 2 <= r2) out.push(i); // dans le rayon
        }
      }
      return out;
    },
  };
}
