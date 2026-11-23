// Le relief réel de la Terre, en basse résolution (grille de 10 minutes d'arc ≈ 18 km).
// Logique pure : décodage du fichier, lecture à une latitude/longitude, mesure de la « rugosité » locale.
// Le fichier est produit par scripts/build-relief.mjs ; le détail fin du terrain est inventé par-dessus (voir terrain.ts).

import { clamp } from './math';

// La grille : lignes du nord (90°) au sud (−90°), colonnes de la longitude 0° vers l'est sur 360° (elle se referme sur elle-même).
export interface ReliefGrid {
  width: number; // nombre de colonnes (360° au total)
  height: number; // nombre de lignes (180° au total, bords compris)
  metersPerUnit: number; // chaque valeur de « data » vaut ce nombre de mètres
  data: Int16Array; // altitudes (positives) et profondeurs (négatives), width × height valeurs
}

// En-tête du fichier (16 octets).
export interface ReliefHeader {
  width: number;
  height: number;
  metersPerUnit: number;
}

export const RELIEF_HEADER_BYTES = 16; // taille de l'en-tête

// Lit l'en-tête du fichier ; lève une erreur claire si ce n'est pas le bon fichier.
export function parseReliefHeader(bytes: Uint8Array): ReliefHeader {
  if (bytes.length < RELIEF_HEADER_BYTES || String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!) !== 'THRL') {
    throw new Error('fichier de relief illisible');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = { width: view.getUint16(4, true), height: view.getUint16(6, true), metersPerUnit: view.getUint16(8, true) };
  if (header.width < 4 || header.height < 4 || header.metersPerUnit < 1) throw new Error('en-tête de relief invalide');
  return header;
}

// Reconstruit la grille à partir des différences décompressées (octets int16, ligne par ligne).
export function decodeReliefDeltas(header: ReliefHeader, deltaBytes: Uint8Array): ReliefGrid {
  const n = header.width * header.height;
  if (deltaBytes.length !== n * 2) throw new Error('données de relief incomplètes');
  const deltas = new Int16Array(deltaBytes.buffer.slice(deltaBytes.byteOffset, deltaBytes.byteOffset + n * 2)); // copie alignée
  const data = new Int16Array(n);
  for (let j = 0; j < header.height; j++) {
    let acc = 0; // valeur de la case de gauche
    for (let i = 0; i < header.width; i++) {
      acc += deltas[j * header.width + i]!; // la différence s'ajoute à la case de gauche
      data[j * header.width + i] = acc;
    }
  }
  return { width: header.width, height: header.height, metersPerUnit: header.metersPerUnit, data };
}

// Interpolation cubique de Catmull-Rom entre p1 et p2 (t de 0 à 1), avec p0 et p3 pour la courbure.
const cubic = (p0: number, p1: number, p2: number, p3: number, t: number): number =>
  p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

// Le relief prêt à être interrogé : altitude réelle et rugosité en un point (latitude, longitude en degrés).
export interface Relief {
  readonly grid: ReliefGrid;
  heightAt(latDeg: number, lonDeg: number): number; // altitude (m) lissée, négative en mer
  roughnessAt(latDeg: number, lonDeg: number): number; // écart d'altitude (m) entre les cases voisines : plat ≈ 0, montagne ≈ 1 000+
}

export function createRelief(grid: ReliefGrid): Relief {
  const { width, height, metersPerUnit, data } = grid;
  const cellDeg = 360 / width; // taille d'une case en degrés

  // Rugosité : pour chaque case, l'écart entre la plus haute et la plus basse des 9 cases voisines, en unités de « metersPerUnit ».
  const rough = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = clamp(j + dj, 0, height - 1);
        for (let di = -1; di <= 1; di++) {
          const v = data[jj * width + ((i + di + width) % width)]!;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      rough[j * width + i] = (hi - lo) * metersPerUnit;
    }
  }

  // Position fractionnaire dans la grille pour une latitude/longitude.
  const locate = (latDeg: number, lonDeg: number): [number, number] => {
    const row = clamp((90 - latDeg) / cellDeg, 0, height - 1); // 0 au pôle nord
    const col = ((((lonDeg / cellDeg) % width) + width) % width); // la longitude se referme sur elle-même
    return [row, col];
  };

  const heightAt = (latDeg: number, lonDeg: number): number => {
    const [row, col] = locate(latDeg, lonDeg);
    const j = Math.floor(row);
    const i = Math.floor(col);
    const ty = row - j;
    const tx = col - i;
    const line: number[] = []; // les 4 lignes voisines, chacune réduite à un point par interpolation en x
    for (let dj = -1; dj <= 2; dj++) {
      const jj = clamp(j + dj, 0, height - 1);
      const at = (di: number): number => data[jj * width + ((i + di + width) % width)]!;
      line.push(cubic(at(-1), at(0), at(1), at(2), tx));
    }
    return cubic(line[0]!, line[1]!, line[2]!, line[3]!, ty) * metersPerUnit;
  };

  const roughnessAt = (latDeg: number, lonDeg: number): number => {
    const [row, col] = locate(latDeg, lonDeg);
    const j = Math.floor(row);
    const i = Math.floor(col);
    const ty = row - j;
    const tx = col - i;
    const j2 = Math.min(j + 1, height - 1);
    const i2 = (i + 1) % width;
    const top = rough[j * width + i]! * (1 - tx) + rough[j * width + i2]! * tx; // interpolation bilinéaire
    const bottom = rough[j2 * width + i]! * (1 - tx) + rough[j2 * width + i2]! * tx;
    return top * (1 - ty) + bottom * ty;
  };

  return { grid, heightAt, roughnessAt };
}
