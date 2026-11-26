// Découpage du monde en « tuiles » (chunks) et fabrication de leur maillage 3D.
// Logique pure : elle ne touche ni au navigateur ni à Three.js. Elle tourne donc
// aussi bien dans un worker (calcul en arrière-plan) que dans les tests.

import { lerpRgb, clamp, smoothstep } from './math';
import { dirtColor, terrainColor } from './palette';
import { DirtSeg, distToSeg } from './roads';
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
  water?: WaterMesh; // la surface de l'eau douce (rivières, lacs), absente s'il n'y en a pas : maillage à part, animé par un shader
}

// La surface de l'eau douce d'une tuile : maillage à part (matériau animé et transparent).
export interface WaterMesh {
  positions: Float32Array; // x,y,z de chaque sommet, relatifs au coin de la tuile
  indices: Uint16Array; // triangles
  depth: Float32Array; // profondeur de l'eau à chaque sommet (m, 0 sur la rive)
  flow: Float32Array; // courant à chaque sommet : (x, z) en m/s, (0, 0) dans un lac
  world: Float32Array; // position dans le monde (x, z) modulo WATER_PERIOD : pour que les rides se raccordent d'une tuile à l'autre
  minY: number; // eau la plus basse
  maxY: number; // eau la plus haute
}

export const WATER_PERIOD = 4096; // les rides se répètent tous les 4 096 m (un nombre entier de fois pour chaque ride)


// Fabrique la surface de l'eau douce (rivières, lacs) de la tuile : des carrés plats au niveau de l'eau, partout où le sol est plus bas qu'elle.
// Les sommets sont partagés entre carrés voisins. Renvoie null s'il n'y a pas d'eau.
function buildWater(terrain: Terrain, heights: Float32Array, ew: number, w: number, n: number, cell: number, x0: number, z0: number): WaterMesh | null {
  const ws = new Float32Array(w * w); // hauteur de l'eau à chaque sommet (NaN = pas d'eau)
  const hs = new Float32Array(w * w); // altitude du sol à chaque sommet
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      ws[j * w + i] = terrain.waterSurfaceAt(x0 + i * cell, z0 + j * cell);
      hs[j * w + i] = heights[(j + 1) * ew + (i + 1)]!;
    }
  }
  const vid = new Int32Array(w * w).fill(-1); // numéro du sommet d'eau créé pour ce coin (−1 = pas encore)
  const pos: number[] = [];
  const depth: number[] = [];
  const flow: number[] = [];
  const world: number[] = [];
  const idx: number[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  // Pente de la surface de l'eau en un sommet (différence centrée sur 2 cases, ou d'un seul côté au bord ; 0 si pas de mesure).
  const slope = (i: number, j: number, di: number, dj: number): number => {
    const a = i - 2 * di >= 0 && j - 2 * dj >= 0 ? ws[(j - 2 * dj) * w + (i - 2 * di)]! : NaN;
    const b = i + 2 * di < w && j + 2 * dj < w ? ws[(j + 2 * dj) * w + (i + 2 * di)]! : NaN;
    const c = ws[j * w + i]!;
    if (!Number.isNaN(a) && !Number.isNaN(b)) return (b - a) / (4 * cell);
    if (!Number.isNaN(b)) return (b - c) / (2 * cell);
    if (!Number.isNaN(a)) return (c - a) / (2 * cell);
    return 0;
  };
  const vertex = (i: number, j: number, y: number): number => {
    const k = j * w + i;
    if (vid[k]! >= 0) return vid[k]!; // déjà créé par un carré voisin
    const id = pos.length / 3;
    pos.push(i * cell, y, j * cell);
    depth.push(Math.max(0, y - hs[k]!));
    // Le courant descend la pente de la surface : vitesse de 0,3 à 2 m/s selon la pente ; nul dans un lac (surface plate).
    const gx = slope(i, j, 1, 0);
    const gz = slope(i, j, 0, 1);
    const g = Math.hypot(gx, gz);
    const speed = g > 1e-4 ? clamp(0.3 + g * 50, 0.3, 2) : 0;
    flow.push(g > 1e-4 ? (-gx / g) * speed : 0, g > 1e-4 ? (-gz / g) * speed : 0);
    world.push((((x0 + i * cell) % WATER_PERIOD) + WATER_PERIOD) % WATER_PERIOD, (((z0 + j * cell) % WATER_PERIOD) + WATER_PERIOD) % WATER_PERIOD);
    vid[k] = id;
    if (y < lo) lo = y;
    if (y > hi) hi = y;
    return id;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const ks = [j * w + i, j * w + i + 1, (j + 1) * w + i, (j + 1) * w + i + 1]; // nord-ouest, nord-est, sud-ouest, sud-est
      let wet = false;
      let sum = 0;
      let count = 0;
      for (const k of ks) {
        const s = ws[k]!;
        if (Number.isNaN(s)) continue;
        sum += s;
        count++;
        if (s > hs[k]! + 0.03) wet = true; // l'eau affleure au-dessus du sol en ce coin
      }
      if (!wet) continue;
      const mean = sum / count; // niveau moyen du carré, pour les coins sans mesure
      const ids = ks.map((k, c) => vertex(i + (c % 2), j + (c >> 1), Number.isNaN(ws[k]!) ? mean : ws[k]!));
      idx.push(ids[0]!, ids[2]!, ids[1]!, ids[1]!, ids[2]!, ids[3]!); // deux triangles, face vers le haut (comme le terrain)
    }
  }
  if (idx.length === 0) return null;
  return { positions: new Float32Array(pos), indices: new Uint16Array(idx), depth: new Float32Array(depth), flow: new Float32Array(flow), world: new Float32Array(world), minY: lo, maxY: hi };
}

// Fabrique le maillage de la tuile (cx, cz) au niveau de détail donné.
export function buildChunk(terrain: Terrain, cx: number, cz: number, lod: number, blocked: ((x: number, z: number) => boolean) | null = null, dirt: readonly DirtSeg[] | null = null): ChunkData {
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
  const reach = 6 + cell * 1.5; // marge : un tronçon plus loin que ça de la tuile ne la touche pas
  const near = (dirt ?? []).filter((s) => Math.min(s.x1, s.x2) - reach < x0 + CHUNK_SIZE && Math.max(s.x1, s.x2) + reach > x0 && Math.min(s.z1, s.z2) - reach < z0 + CHUNK_SIZE && Math.max(s.z1, s.z2) + reach > z0); // tronçons qui touchent cette tuile
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
      const wx = x0 + i * cell; // position de ce sommet dans le monde
      const wz = z0 + j * cell;
      const noise = terrain.colorNoise(wx, wz);
      let c = terrainColor(h, ny, noise, terrain.biomeAt(wx, wz)); // couleur du sol ici (selon le climat)
      if (near.length > 0 && h > 0.3) {
        // Chemins et rues en terre : on mélange la couleur de la terre selon la distance au tronçon le plus proche.
        let t = 0; // 1 = en plein chemin
        for (const s of near) {
          const w = Math.max(s.half, cell * 0.8); // à grande distance, le chemin reste visible (un peu élargi)
          const d = distToSeg(s, wx, wz);
          if (d > w * 1.25) continue; // hors du chemin
          const k = (1 - smoothstep(w * 0.7, w * 1.25, d)) * clamp(s.half / w, 0.35, 1); // plus fin quand la case est grosse
          if (k > t) t = k;
        }
        if (t > 0) c = lerpRgb(c, dirtColor(noise, c), t * smoothstep(0.3, 1.2, h)); // pas de terre dans l'eau
      }
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
  const water = terrain.hasWaterNear(x0, z0, CHUNK_SIZE) ? buildWater(terrain, heights, ew, w, n, cell, x0, z0) ?? undefined : undefined; // l'eau douce : maillage à part
  const added = addTreesForChunk(trees, terrain, cx, cz, lod, CHUNK_SIZE, blocked);
  if (trees.positions.length === 0) return { cx, cz, lod, positions, normals, colors, indices, minY, maxY: water ? Math.max(maxY, water.maxY) : maxY, water };
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
  return { cx, cz, lod, positions: allPositions, normals: allNormals, colors: allColors, indices: allIndices, minY, maxY: Math.max(maxY, added.topY, water ? water.maxY : -Infinity), water };
}
