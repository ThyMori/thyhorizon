// Collision avec les arbres : on ne traverse pas un tronc. Logique pure : les troncs sont des cercles, le joueur en est un aussi.
// Les arbres viennent du même placement que le dessin (niveau de détail 0 et 1 : même cases de 8 m), donc ce qu'on voit est ce qu'on heurte.

import { CHUNK_SIZE } from './chunk';
import type { Terrain } from './terrain';
import { Tree, treesForChunk, trunkRadius } from './trees';

export const PLAYER_RADIUS = 0.35; // « épaisseur » du joueur (m)
const MAX_CACHED = 48; // nombre de tuiles dont on garde les arbres en mémoire

// Repousse un point hors des troncs : renvoie la position corrigée (le joueur glisse le long du tronc au lieu de s'y coller).
export function pushOutOfTrees(trees: readonly Tree[], x: number, z: number, radius = PLAYER_RADIUS): { x: number; z: number; hit: boolean } {
  let hit = false;
  for (let pass = 0; pass < 3; pass++) {
    // plusieurs passages : deux troncs voisins peuvent se repousser mutuellement
    let moved = false;
    for (const t of trees) {
      const dx = x - t.x;
      const dz = z - t.z;
      const min = trunkRadius(t) + radius; // distance minimale entre les centres
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      const nx = d > 1e-6 ? dx / d : 1; // direction pour sortir du tronc (si exactement au centre, vers l'est)
      const nz = d > 1e-6 ? dz / d : 0;
      x = t.x + nx * min;
      z = t.z + nz * min;
      hit = true;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z, hit };
}

// Les arbres autour du joueur, avec une mémoire des tuiles déjà calculées (le calcul d'une tuile coûte un peu, pas question de le refaire à chaque image).
export class TreeObstacles {
  private readonly cache = new Map<string, Tree[]>();

  constructor(private readonly terrain: Terrain) {}

  // Arbres des tuiles voisines du point (x, z).
  private nearby(x: number, z: number): Tree[] {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const out: Tree[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        // trois par trois : un tronc près du bord d'une tuile est vu depuis la tuile voisine
        const key = `${cx + dx},${cz + dz}`;
        let list = this.cache.get(key);
        if (!list) {
          list = treesForChunk(this.terrain, cx + dx, cz + dz, 0, CHUNK_SIZE);
          if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string); // on oublie la plus ancienne
          this.cache.set(key, list);
        }
        out.push(...list);
      }
    }
    return out;
  }

  // Corrige une position pour qu'elle ne soit pas dans un tronc.
  resolve(x: number, z: number, radius = PLAYER_RADIUS): { x: number; z: number; hit: boolean } {
    return pushOutOfTrees(this.nearby(x, z), x, z, radius);
  }
}
