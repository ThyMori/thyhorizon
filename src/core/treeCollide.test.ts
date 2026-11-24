// Tests de la collision avec les arbres : on est repoussé, on glisse, on traverse rien, les troncs voisins sont gérés.
import { describe, expect, it } from 'vitest';
import { realClimate } from '../world/climateData';
import { CHUNK_SIZE } from './chunk';
import { latLonToWorld } from './geo';
import { loadRealRelief } from './relief.testutil';
import { createTerrain } from './terrain';
import { PLAYER_RADIUS, TreeObstacles, pushOutOfTrees } from './treeCollide';
import { Tree, treesForChunk, trunkRadius } from './trees';

const tree = (x: number, z: number, kind: Tree['kind'] = 'broadleaf', size = 1): Tree => ({ x, z, y: 10, kind, size, seed: 0.5 });

describe('repousser hors des troncs', () => {
  it('ne touche pas un point libre', () => {
    const r = pushOutOfTrees([tree(0, 0)], 5, 5);
    expect(r).toEqual({ x: 5, z: 5, hit: false });
  });
  it('repousse un point trop proche, jusqu’à la distance minimale', () => {
    const t = tree(0, 0);
    const r = pushOutOfTrees([t], 0.2, 0);
    expect(r.hit).toBe(true);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(trunkRadius(t) + PLAYER_RADIUS, 5);
    expect(r.x).toBeGreaterThan(0); // reste du même côté
  });
  it('au centre exact : sort quand même, sans valeur invalide', () => {
    const r = pushOutOfTrees([tree(0, 0)], 0, 0);
    expect(Number.isFinite(r.x) && Number.isFinite(r.z)).toBe(true);
    expect(Math.hypot(r.x, r.z)).toBeGreaterThan(0.5);
  });
  it('glisse le long du tronc : on avance en biais, on ne s’arrête pas net', () => {
    const t = tree(0, 0);
    let x = 3; // on part à l'est et on vise le centre du tronc, un peu décalé au nord
    let z = 0.3;
    for (let k = 0; k < 40; k++) {
      x -= 0.1;
      const r = pushOutOfTrees([t], x, z);
      x = r.x;
      z = r.z;
    }
    expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(trunkRadius(t) + PLAYER_RADIUS - 1e-6); // jamais dedans
  });
  it('deux troncs rapprochés : on ne finit dans aucun des deux', () => {
    const a = tree(0, 0);
    const b = tree(2.4, 0);
    const r = pushOutOfTrees([a, b], 1.2, 0.05);
    for (const t of [a, b]) expect(Math.hypot(r.x - t.x, r.z - t.z)).toBeGreaterThanOrEqual(trunkRadius(t) + PLAYER_RADIUS - 1e-3);
  });
  it('un gros arbre bloque plus large qu’un petit', () => {
    const small = pushOutOfTrees([tree(0, 0, 'broadleaf', 0.8)], 1.2, 0);
    const big = pushOutOfTrees([tree(0, 0, 'broadleaf', 1.4)], 1.2, 0);
    expect(big.hit).toBe(true);
    expect(small.hit).toBe(false);
  });
});

describe('avec le vrai terrain', () => {
  const terrain = createTerrain(12345, loadRealRelief(), realClimate);
  it('un joueur placé dans un tronc réel en est sorti', () => {
    const p = latLonToWorld(0, 23); // forêt équatoriale
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cz = Math.floor(p.z / CHUNK_SIZE);
    const trees = treesForChunk(terrain, cx, cz, 0, CHUNK_SIZE);
    expect(trees.length).toBeGreaterThan(0);
    const t = trees[0]!;
    const obstacles = new TreeObstacles(terrain);
    const r = obstacles.resolve(t.x + 0.05, t.z);
    expect(r.hit).toBe(true);
    expect(Math.hypot(r.x - t.x, r.z - t.z)).toBeGreaterThanOrEqual(trunkRadius(t) + PLAYER_RADIUS - 1e-3);
  });
  it('un lieu sans arbre ne bloque pas, et le cache ne grossit pas sans fin', () => {
    const obstacles = new TreeObstacles(terrain);
    const r = obstacles.resolve(0, 0); // en mer
    expect(r.hit).toBe(false);
    for (let k = 0; k < 80; k++) obstacles.resolve(k * 200, 0);
    expect((obstacles as unknown as { cache: Map<string, unknown> }).cache.size).toBeLessThanOrEqual(48);
  });
});

describe('pas de découpe de l\'écorce', () => {
  it('le joueur reste plus loin de l\'écorce que le plan de coupe de la caméra', () => {
    expect(PLAYER_RADIUS).toBeGreaterThanOrEqual(0.5); // plan de coupe 0,3 m, pris en diagonale ≈ 0,45 m
  });
});
