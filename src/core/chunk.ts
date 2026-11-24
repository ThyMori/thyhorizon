// Découpage du monde en « tuiles » (chunks) et fabrication de leur maillage 3D.
// Logique pure : elle ne touche ni au navigateur ni à Three.js. Elle tourne donc
// aussi bien dans un worker (calcul en arrière-plan) que dans les tests.

import { terrainColor } from './palette';
import { MeshBuilder, addTreesForChunk } from './trees';
import type { Terrain } from './terrain';

// Côté d'une tuile, en mètres.
export const CHUNK_SIZE = 64;

// Finesse du maillage selon la distance : nombre de cases par côté (64 → 1 m de case, 8 → 8 m de case).
export const LOD_CELLS = [64, 32, 16, 8] as const;

// Choisit le niveau de détail d'une tuile selon sa distance au joueur (exprimée en tuiles).
export function lodForDistance(distChunks: number): number {
  if (distChunks < 2.5) return 0; // tout près : détail maximal
  if (distChunks < 6) return 1;
  if (distChunks < 11) return 2;
  return 3; // très loin : maillage grossier
}

// Clé unique d'une tuile, utilisée dans les tables.
export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

// Le maillage d'une tuile, prêt à être envoyé à la carte graphique.
export interface ChunkData {
  cx: number; // indice de tuile en x
  cz: number; // indice de tuile en z
  lod: number; // niveau de détail utilisé
  positions: Float32Array; // x,y,z de chaque sommet, RELATIFS au coin de la tuile (précision)
  normals: Float32Array; // normale de chaque sommet
  colors: Float32Array; // couleur (linéaire) de chaque sommet
  indices: Uint16Array; // triangles
  minY: number; // altitude minimale (jupes comprises)
  maxY: number; // altitude maximale
}

// Fabrique le maillage de la tuile (cx, cz) au niveau de détail donné.
export function buildChunk(terrain: Terrain, cx: number, cz: number, lod: number, blocked: ((x: number, z: number) => boolean) | null = null): ChunkData {
  const n = LOD_CELLS[lod] ?? LOD_CELLS[LOD_CELLS.length - 1]!; // cases par côté
  const cell = CHUNK_SIZE / n; // taille d'une case en mètres
  const x0 = cx * CHUNK_SIZE; // coin ouest de la tuile dans le monde
  const z0 = cz * CHUNK_SIZE; // coin nord de la tuile dans le monde
  const w = n + 1; // sommets par côté
  const ew = n + 3; // sommets par côté de la grille étendue (1 de marge de chaque côté, pour les normales)

  // 1) Altitudes sur la grille étendue : chaque point du monde n'est calculé qu'une fois.
  const heights = new Float32Array(ew * ew);
  for (let j = 0; j < ew; j++) {
    for (let i = 0; i < ew; i++) {
      heights[j * ew + i] = terrain.heightAt(x0 + (i - 1) * cell, z0 + (j - 1) * cell);
    }
  }

  // 2) Allocation : la grille + 4 « jupes » (bandes verticales qui cachent les fissures entre niveaux de détail).
  const vertexCount = w * w + 4 * w;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const skirt = 6 + cell * 2; // profondeur des jupes en mètres
  let minY = Infinity; // plus bas point
  let maxY = -Infinity; // plus haut point

  // 3) Sommets de la grille : position, normale (par différences centrales) et couleur.
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      const v = j * w + i; // numéro du sommet
      const h = heights[(j + 1) * ew + (i + 1)]!; // altitude au sommet
      const hL = heights[(j + 1) * ew + i]!; // voisin ouest
      const hR = heights[(j + 1) * ew + (i + 2)]!; // voisin est
      const hN = heights[j * ew + (i + 1)]!; // voisin nord
      const hS = heights[(j + 2) * ew + (i + 1)]!; // voisin sud
      const dhdx = (hR - hL) / (2 * cell); // pente vers l'est
      const dhdz = (hS - hN) / (2 * cell); // pente vers le sud
      const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz); // 1/longueur du vecteur (-dhdx, 1, -dhdz)
      const ny = inv; // composante verticale de la normale unitaire
      positions.set([i * cell, h, j * cell], v * 3); // position locale
      normals.set([-dhdx * inv, ny, -dhdz * inv], v * 3); // normale unitaire
      const c = terrainColor(h, ny, terrain.colorNoise(x0 + i * cell, z0 + j * cell), terrain.biomeAt(x0 + i * cell, z0 + j * cell)); // couleur du sol ici (selon le climat)
      colors.set(c, v * 3);
      if (h < minY) minY = h; // met à jour les bornes d'altitude
      if (h > maxY) maxY = h;
    }
  }

  // 4) Jupes : on copie chaque sommet de bord, abaissé de « skirt » mètres.
  const edges: number[][] = [[], [], [], []]; // numéros des sommets de bord : nord, sud, ouest, est
  for (let k = 0; k < w; k++) {
    edges[0]!.push(k); // nord : j = 0
    edges[1]!.push(n * w + k); // sud : j = n
    edges[2]!.push(k * w); // ouest : i = 0
    edges[3]!.push(k * w + n); // est : i = n
  }
  const skirtIndex: number[][] = [[], [], [], []]; // numéros des nouveaux sommets de jupe
  let next = w * w; // prochain numéro de sommet libre
  for (let e = 0; e < 4; e++) {
    for (const src of edges[e]!) {
      positions.set([positions[src * 3]!, positions[src * 3 + 1]! - skirt, positions[src * 3 + 2]!], next * 3); // même x,z, plus bas
      normals.set([normals[src * 3]!, normals[src * 3 + 1]!, normals[src * 3 + 2]!], next * 3); // même normale
      colors.set([colors[src * 3]!, colors[src * 3 + 1]!, colors[src * 3 + 2]!], next * 3); // même couleur
      skirtIndex[e]!.push(next); // on mémorise le numéro
      next++;
    }
  }
  minY -= skirt; // les jupes descendent plus bas : on les inclut dans les bornes

  // 5) Triangles : 2 par case de la grille, puis 2 par segment de jupe.
  const indices = new Uint16Array(n * n * 6 + 4 * n * 6);
  let t = 0; // curseur d'écriture dans les indices
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * w + i; // coin nord-ouest de la case
      const b = a + 1; // coin nord-est
      const c = a + w; // coin sud-ouest
      const d = c + 1; // coin sud-est
      indices[t++] = a; indices[t++] = c; indices[t++] = b; // premier triangle (face vers le haut)
      indices[t++] = b; indices[t++] = c; indices[t++] = d; // second triangle
    }
  }
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < n; k++) {
      const e0 = edges[e]![k]!; // sommet de bord k
      const e1 = edges[e]![k + 1]!; // sommet de bord k+1
      const s0 = skirtIndex[e]![k]!; // sommet de jupe correspondant à k
      const s1 = skirtIndex[e]![k + 1]!; // sommet de jupe correspondant à k+1
      indices[t++] = e0; indices[t++] = s0; indices[t++] = e1; // triangle 1 de la jupe
      indices[t++] = e1; indices[t++] = s0; indices[t++] = s1; // triangle 2 de la jupe
    }
  }

  // 6) Arbres : ajoutés à la suite du terrain, dans les mêmes tableaux (une seule tuile, un seul objet 3D).
  const trees: MeshBuilder = { positions: [], normals: [], colors: [], indices: [] };
  const added = addTreesForChunk(trees, terrain, cx, cz, lod, CHUNK_SIZE, blocked);
  if (added.count === 0) return { cx, cz, lod, positions, normals, colors, indices, minY, maxY };
  const base = positions.length / 3; // numéro du premier sommet d'arbre
  const allPositions = new Float32Array(positions.length + trees.positions.length);
  allPositions.set(positions);
  allPositions.set(trees.positions, positions.length);
  const allNormals = new Float32Array(normals.length + trees.normals.length);
  allNormals.set(normals);
  allNormals.set(trees.normals, normals.length);
  const allColors = new Float32Array(colors.length + trees.colors.length);
  allColors.set(colors);
  allColors.set(trees.colors, colors.length);
  const allIndices = new Uint16Array(indices.length + trees.indices.length);
  allIndices.set(indices);
  for (let k = 0; k < trees.indices.length; k++) allIndices[indices.length + k] = trees.indices[k]! + base;
  return { cx, cz, lod, positions: allPositions, normals: allNormals, colors: allColors, indices: allIndices, minY, maxY: Math.max(maxY, added.topY) };
}
