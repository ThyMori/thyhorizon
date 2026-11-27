// Collision avec les rochers (1.40.1) : on ne marche pas à travers un rocher. Logique pure : les rochers sont des cercles.
// Ils viennent du même placement que le dessin (`floraForChunk`, niveau 0) : ce qu'on voit est ce qu'on heurte.

import { CHUNK_SIZE } from './chunk';
import { Plant, floraForChunk } from './flora';
import { PLAYER_RADIUS } from './treeCollide';
import type { Terrain } from './terrain';

const MAX_CACHED = 48; // nombre de tuiles dont on garde les rochers en mémoire

// Un rocher de moins de 40 cm de haut (≈ 0,52 m × taille, donc taille < 0,77) s'enjambe : il ne bloque pas.
export const ROCK_STEP_SIZE = 0.77;
export const blocksPlayer = (p: { size: number }): boolean => p.size >= ROCK_STEP_SIZE;

// Rayon d'un rocher au sol (m) : un peu en dessous du rayon dessiné (0,6 × taille), car la forme est bosselée.
export const rockRadius = (p: { size: number }): number => 0.55 * p.size;

// Repousse un point hors des rochers : le joueur glisse le long du rocher.
export function pushOutOfRocks(rocks: readonly Plant[], x: number, z: number, radius = PLAYER_RADIUS): { x: number; z: number; hit: boolean } {
  let hit = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const r of rocks) {
      const dx = x - r.x;
      const dz = z - r.z;
      const min = rockRadius(r) + radius; // distance minimale entre les centres
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2);
      x = r.x + (d > 1e-6 ? dx / d : 1) * min; // sortie par le plus court chemin (vers l'est si pile au centre)
      z = r.z + (d > 1e-6 ? dz / d : 0) * min;
      hit = true;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z, hit };
}

// Les rochers autour du joueur, avec une mémoire des tuiles déjà calculées.
export class RockObstacles {
  private readonly cache = new Map<string, Plant[]>();

  // `blockerFor` : les endroits dégagés (villages, chemins) où rien ne pousse, pour que la collision suive le dessin.
  constructor(private readonly terrain: Terrain, private readonly blockerFor: ((cx: number, cz: number, size: number) => ((x: number, z: number) => boolean) | null) | null = null) {}

  // Rochers des tuiles voisines du point (x, z).
  private nearby(x: number, z: number): Plant[] {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const out: Plant[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const key = `${cx + dx},${cz + dz}`;
        let list = this.cache.get(key);
        if (!list) {
          const x0 = (cx + dx) * CHUNK_SIZE;
          const z0 = (cz + dz) * CHUNK_SIZE;
          const blocked = this.blockerFor ? this.blockerFor(cx + dx, cz + dz, CHUNK_SIZE) : null;
          list = floraForChunk(this.terrain, cx + dx, cz + dz, 0, CHUNK_SIZE, blocked, this.terrain.hasWaterNear(x0, z0, CHUNK_SIZE)).filter((p) => p.kind === 'rock' && blocksPlayer(p));
          if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string); // on oublie la plus ancienne
          this.cache.set(key, list);
        }
        out.push(...list);
      }
    }
    return out;
  }

  // Corrige une position pour qu'elle ne soit pas dans un rocher.
  resolve(x: number, z: number, radius = PLAYER_RADIUS): { x: number; z: number; hit: boolean } {
    return pushOutOfRocks(this.nearby(x, z), x, z, radius);
  }
}
