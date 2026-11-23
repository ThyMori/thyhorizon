// Les arbres : où ils poussent (selon le climat, l'altitude, la pente) et leur forme en quelques triangles.
// Logique pure : elle tourne dans le worker et dans les tests. Les arbres sont ajoutés au maillage de chaque tuile.
// Même graine → mêmes arbres, toujours aux mêmes endroits.

import { Rgb, clamp, lerp, smoothstep } from './math';
import { slopeAt } from './terrain';
import type { Terrain } from './terrain';

export type TreeKind = 'conifer' | 'broadleaf' | 'acacia';

// Un arbre placé dans le monde.
export interface Tree {
  x: number; // position dans le monde (m)
  z: number;
  y: number; // altitude du sol au pied
  kind: TreeKind;
  size: number; // facteur de taille (1 = arbre moyen)
  seed: number; // nombre pseudo-aléatoire propre à l'arbre (0 à 1)
}

// Taille d'une case de placement selon le niveau de détail de la tuile (un arbre au plus par case) ; 0 = pas d'arbres.
export const TREE_CELL = [8, 8, 16, 0] as const;

// Nombre pseudo-aléatoire stable (0 à 1) pour deux entiers et un « sel ».
export function hash01(a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Les arbres d'une tuile. Rien sur la plage ni dans l'eau, rien sur les pentes raides, rien au-delà de la limite des arbres (sous la limite des neiges).
export function treesForChunk(terrain: Terrain, cx: number, cz: number, lod: number, chunkSize: number): Tree[] {
  const cell = TREE_CELL[lod] ?? 0;
  if (cell === 0) return [];
  const n = chunkSize / cell; // cases par côté
  const x0 = cx * chunkSize;
  const z0 = cz * chunkSize;
  const sizeBoost = lod >= 2 ? 1.3 : 1; // de loin, des arbres un peu plus gros compensent leur nombre réduit
  const trees: Tree[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gi = cx * n + i; // indice de la case dans la grille du monde (stable d'une tuile à l'autre)
      const gj = cz * n + j;
      const x = x0 + (i + 0.15 + 0.7 * hash01(gi, gj, 1)) * cell;
      const z = z0 + (j + 0.15 + 0.7 * hash01(gi, gj, 2)) * cell;
      const biome = terrain.biomeAt(x, z);
      if (biome.forest < 0.003) continue; // climat sans arbres
      // Densité locale : forêt dense = grandes taches (clairières entre elles) ; savane = arbres isolés partout.
      const patch = 0.5 + 0.5 * terrain.forestNoise(x, z);
      const clumpy = smoothstep(0.35, 0.65, patch + (biome.forest - 0.5) * 0.7);
      const density = lerp(biome.forest, clumpy * 0.95, smoothstep(0.2, 0.4, biome.forest));
      if (hash01(gi, gj, 3) >= density) continue; // pas d'arbre dans cette case
      const y = terrain.heightAt(x, z);
      if (y < 4) continue; // plage et mer
      if (y > biome.snowLine * 0.6) continue; // au-dessus de la limite des arbres
      if (slopeAt(terrain, x, z, 2) > 0.55) continue; // pente trop raide (> 29°)
      const k = hash01(gi, gj, 4); // choix de l'espèce
      const kind: TreeKind = k < biome.acacia ? 'acacia' : hash01(gi, gj, 5) < biome.conifer ? 'conifer' : 'broadleaf';
      const cold = smoothstep(2000, 300, biome.snowLine); // arbres plus petits près des pôles et en altitude
      const size = (0.75 + 0.6 * hash01(gi, gj, 6)) * lerp(1, 0.65, cold) * sizeBoost;
      trees.push({ x, z, y, kind, size, seed: hash01(gi, gj, 7) });
    }
  }
  return trees;
}

// ---------- Formes ----------

// Tableaux en cours de remplissage (partagés avec le terrain de la tuile).
export interface MeshBuilder {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

const TRUNK: Rgb = [0.38, 0.29, 0.21];
const FOLIAGE: Record<TreeKind, Rgb> = {
  conifer: [0.09, 0.23, 0.13], // vert très sombre
  broadleaf: [0.2, 0.4, 0.14], // vert franc
  acacia: [0.36, 0.42, 0.17], // vert olive
};
const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // sRGB → linéaire
const linear = (c: Rgb, k: number): Rgb => [lin(clamp(c[0] * k, 0, 1)), lin(clamp(c[1] * k, 0, 1)), lin(clamp(c[2] * k, 0, 1))];

// Ajoute un sommet et renvoie son numéro.
function vertex(b: MeshBuilder, p: [number, number, number], nrm: [number, number, number], c: Rgb): number {
  const len = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
  b.positions.push(p[0], p[1], p[2]);
  b.normals.push(nrm[0] / len, nrm[1] / len, nrm[2] / len);
  b.colors.push(c[0], c[1], c[2]);
  return b.positions.length / 3 - 1;
}

// Tronc : prisme à 6 faces.
function trunk(b: MeshBuilder, ox: number, oy: number, oz: number, radius: number, height: number, c: Rgb): void {
  const ring: number[][] = [[], []];
  for (let s = 0; s < 6; s++) {
    const a = (s * Math.PI) / 3;
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    ring[0]!.push(vertex(b, [ox + nx * radius, oy - 0.8, oz + nz * radius], [nx, 0.2, nz], c)); // pied : 0,8 m sous le sol (jamais de trou)
    ring[1]!.push(vertex(b, [ox + nx * radius * 0.7, oy + height, oz + nz * radius * 0.7], [nx, 0.2, nz], c));
  }
  for (let s = 0; s < 6; s++) {
    const t = (s + 1) % 6;
    b.indices.push(ring[0]![s]!, ring[1]![s]!, ring[0]![t]!, ring[0]![t]!, ring[1]![s]!, ring[1]![t]!);
  }
}

// Cône à 6 faces (étage de conifère) ; la lumière glisse sur sa pente.
function cone(b: MeshBuilder, ox: number, oy: number, oz: number, radius: number, height: number, c: Rgb, shade: number): void {
  const col = linear(c, shade);
  const base: number[] = [];
  for (let s = 0; s < 6; s++) {
    const a = (s * Math.PI) / 3 + 0.3;
    base.push(vertex(b, [ox + Math.cos(a) * radius, oy, oz + Math.sin(a) * radius], [Math.cos(a) * height, radius * 0.9, Math.sin(a) * height], col));
  }
  const apex = vertex(b, [ox, oy + height, oz], [0, 1, 0], col);
  for (let s = 0; s < 6; s++) b.indices.push(base[s]!, apex, base[(s + 1) % 6]!);
  // dessous du cône : visible quand on regarde l'arbre d'en bas (talus) ; on évite les trous
  const center = vertex(b, [ox, oy, oz], [0, -1, 0], linear(c, shade * 0.6));
  for (let s = 0; s < 6; s++) b.indices.push(base[(s + 1) % 6]!, center, base[s]!);
}

// Icosaèdre déformé : une boule de feuillage à 20 faces, étirée (rx, ry, rz) et irrégulière.
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO: [number, number, number][] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const ICO_FACES = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];
function blob(b: MeshBuilder, ox: number, oy: number, oz: number, rx: number, ry: number, rz: number, c: Rgb, seed: number): void {
  const ids: number[] = [];
  ICO.forEach(([x, y, z], k) => {
    const len = Math.hypot(x, y, z);
    const wobble = 0.85 + 0.3 * hash01(Math.floor(seed * 1e6), k, 11); // chaque sommet un peu plus ou moins loin : forme irrégulière
    const px = (x / len) * rx * wobble;
    const py = (y / len) * ry * wobble;
    const pz = (z / len) * rz * wobble;
    const shade = 0.82 + 0.3 * smoothstep(-1, 1, y / len); // dessus plus clair, dessous plus sombre
    ids.push(vertex(b, [ox + px, oy + py, oz + pz], [x / len, y / len + 0.35, z / len], linear(c, shade)));
  });
  for (const f of ICO_FACES) b.indices.push(ids[f]!);
}

// Ajoute un arbre au maillage. (lx, lz) = position relative au coin de la tuile.
export function addTree(b: MeshBuilder, t: Tree, lx: number, lz: number): void {
  const s = t.size;
  const tone = 0.85 + 0.3 * t.seed; // chaque arbre a sa nuance
  const trunkColor = linear(TRUNK, tone);
  const foliage = FOLIAGE[t.kind];
  if (t.kind === 'conifer') {
    trunk(b, lx, t.y, lz, 0.22 * s, 2.2 * s, trunkColor);
    cone(b, lx, t.y + 1.4 * s, lz, 2.3 * s, 4.2 * s, foliage, tone);
    cone(b, lx, t.y + 3.7 * s, lz, 1.8 * s, 3.8 * s, foliage, tone * 1.05);
    cone(b, lx, t.y + 5.9 * s, lz, 1.2 * s, 3.4 * s, foliage, tone * 1.1);
  } else if (t.kind === 'broadleaf') {
    trunk(b, lx, t.y, lz, 0.3 * s, 3.4 * s, trunkColor);
    blob(b, lx, t.y + 5.2 * s, lz, 3.1 * s, 2.7 * s, 3.1 * s, foliage, t.seed);
    blob(b, lx + 1.2 * s, t.y + 4.3 * s, lz - 0.8 * s, 1.9 * s, 1.6 * s, 1.9 * s, foliage, t.seed + 0.37); // seconde boule : cime moins ronde
  } else {
    trunk(b, lx, t.y, lz, 0.2 * s, 4.2 * s, trunkColor);
    blob(b, lx, t.y + 5.0 * s, lz, 3.6 * s, 0.95 * s, 3.6 * s, foliage, t.seed); // cime plate en parasol
  }
}

// Ajoute tous les arbres d'une tuile ; renvoie leur nombre et la hauteur maximale atteinte au-dessus du sol (pour les bornes de la tuile).
export function addTreesForChunk(b: MeshBuilder, terrain: Terrain, cx: number, cz: number, lod: number, chunkSize: number): { count: number; topY: number } {
  const trees = treesForChunk(terrain, cx, cz, lod, chunkSize);
  let topY = -Infinity;
  for (const t of trees) {
    addTree(b, t, t.x - cx * chunkSize, t.z - cz * chunkSize);
    topY = Math.max(topY, t.y + 10 * t.size);
  }
  return { count: trees.length, topY };
}
