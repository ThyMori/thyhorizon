// Tests de la variété des arbres (1.41) : tailles et formes différentes, arbres morts, souches, troncs tombés.
import { describe, expect, it } from 'vitest';
import { realClimate } from '../world/climateData';
import { CHUNK_SIZE } from './chunk';
import { latLonToWorld } from './geo';
import { loadRealRelief } from './relief.testutil';
import { createTerrain } from './terrain';
import { pushOutOfTrees } from './treeCollide';
import { MeshBuilder, Tree, TreeKind, addTree, treesForChunk, trunkRadius } from './trees';

const terrain = createTerrain(12345, loadRealRelief(), realClimate, false);
const empty = (): MeshBuilder => ({ positions: [], normals: [], colors: [], indices: [] });

// Les arbres d'une zone de 8 × 8 tuiles autour d'un lieu réel.
function forest(lat: number, lon: number): Tree[] {
  const p = latLonToWorld(lat, lon);
  const out: Tree[] = [];
  for (let dz = 0; dz < 8; dz++) for (let dx = 0; dx < 8; dx++) out.push(...treesForChunk(terrain, Math.floor(p.x / CHUNK_SIZE) - 4 + dx, Math.floor(p.z / CHUNK_SIZE) - 4 + dz, 0, CHUNK_SIZE));
  return out;
}

describe('sorts des arbres', () => {
  const trees = [...forest(48.5, 3.5), ...forest(46.5, 7.5), ...forest(60, 20)];
  it('il y a de tout : vivants, morts sur pied, souches, troncs tombés', () => {
    expect(trees.length).toBeGreaterThan(500);
    const count = (f: string | undefined): number => trees.filter((t) => t.form === f).length;
    expect(count(undefined)).toBeGreaterThan(trees.length * 0.85); // la grande majorité est vivante
    expect(count('dead')).toBeGreaterThan(0);
    expect(count('stump')).toBeGreaterThan(0);
    expect(count('fallen')).toBeGreaterThan(0);
    expect(count('dead') + count('stump') + count('fallen')).toBeLessThan(trees.length * 0.15);
  });
  it('les tailles sont variées : jeunes pousses et vieux arbres', () => {
    const sizes = trees.map((t) => t.size).sort((a, b) => a - b);
    expect(sizes[Math.floor(sizes.length * 0.03)]!).toBeLessThan(sizes[Math.floor(sizes.length * 0.5)]! * 0.7); // quelques petits
    expect(sizes[Math.floor(sizes.length * 0.99)]!).toBeGreaterThan(sizes[Math.floor(sizes.length * 0.5)]! * 1.15); // quelques grands
  });
  it('toujours les mêmes arbres au même endroit', () => {
    expect(JSON.stringify(forest(48.5, 3.5))).toBe(JSON.stringify(forest(48.5, 3.5)));
  });
  it('un tronc tombé ne bloque pas, une souche et un arbre mort bloquent', () => {
    const base = { x: 10, z: 10, y: 0, kind: 'broadleaf' as TreeKind, size: 1.2, seed: 0.4 };
    const fallen: Tree = { ...base, form: 'fallen' };
    expect(trunkRadius(fallen)).toBe(0);
    expect(pushOutOfTrees([fallen], 10.1, 10).hit).toBe(false);
    expect(pushOutOfTrees([{ ...base, form: 'stump' }], 10.1, 10).hit).toBe(true);
    expect(pushOutOfTrees([{ ...base, form: 'dead' }], 10.1, 10).hit).toBe(true);
  });
});

describe('maillage de chaque forme', () => {
  for (const kind of ['conifer', 'broadleaf', 'acacia'] as TreeKind[]) {
    for (const form of [undefined, 'dead', 'stump', 'fallen'] as const) {
      for (const detail of [0, 1]) {
        it(`${kind} ${form ?? 'vivant'} (détail ${detail}) : sommets valides, indices dans les bornes`, () => {
          for (const seed of [0.05, 0.31, 0.62, 0.9]) {
            const m = empty();
            addTree(m, { x: 0, z: 0, y: 5, kind, size: 1.4, seed, ...(form ? { form } : {}) }, 30, 30, detail);
            expect(m.positions.length).toBeGreaterThan(0);
            expect(m.positions.length).toBe(m.normals.length);
            expect(m.positions.every(Number.isFinite)).toBe(true);
            expect(m.indices.length % 3).toBe(0);
            expect(m.indices.every((i) => i >= 0 && i < m.positions.length / 3)).toBe(true);
          }
        });
      }
    }
  }
  it('deux arbres de même espèce n\'ont pas la même hauteur', () => {
    const top = (seed: number): number => {
      const m = empty();
      addTree(m, { x: 0, z: 0, y: 0, kind: 'conifer', size: 1.5, seed }, 0, 0, 0);
      let h = 0;
      for (let i = 1; i < m.positions.length; i += 3) h = Math.max(h, m.positions[i]!);
      return h;
    };
    const hs = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map(top);
    expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(2);
  });
  it('un arbre mort est plus léger qu\'un arbre vivant (pas de feuillage)', () => {
    const a = empty();
    const d = empty();
    addTree(a, { x: 0, z: 0, y: 0, kind: 'broadleaf', size: 1.4, seed: 0.3 }, 0, 0, 0);
    addTree(d, { x: 0, z: 0, y: 0, kind: 'broadleaf', size: 1.4, seed: 0.3, form: 'dead' }, 0, 0, 0);
    expect(d.positions.length).toBeLessThan(a.positions.length);
  });
});
