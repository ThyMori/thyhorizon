// Tests des arbres : placement selon le climat, règles de terrain, forme.
import { describe, expect, it } from 'vitest';
import { realClimate } from '../world/climateData';
import { CHUNK_SIZE, buildChunk } from './chunk';
import { latLonToWorld } from './geo';
import { loadRealRelief } from './relief.testutil';
import { createTerrain, slopeAt } from './terrain';
import { MeshBuilder, TREE_CELL, Tree, addTree, hash01, treesForChunk } from './trees';

const terrain = createTerrain(12345, loadRealRelief(), realClimate);

// Tous les arbres d'un carré de 6 × 6 tuiles autour d'un lieu réel.
function around(lat: number, lon: number, lod = 0): Tree[] {
  const p = latLonToWorld(lat, lon);
  const c0x = Math.floor(p.x / CHUNK_SIZE) - 3;
  const c0z = Math.floor(p.z / CHUNK_SIZE) - 3;
  const out: Tree[] = [];
  for (let dz = 0; dz < 6; dz++) for (let dx = 0; dx < 6; dx++) out.push(...treesForChunk(terrain, c0x + dx, c0z + dz, lod, CHUNK_SIZE));
  return out;
}

describe('hasard stable', () => {
  it('donne toujours la même valeur et reste entre 0 et 1', () => {
    expect(hash01(3, 4, 5)).toBe(hash01(3, 4, 5));
    for (let i = 0; i < 500; i++) {
      const v = hash01(i, i * 7, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('placement', () => {
  it('est identique d\'un appel à l\'autre', () => {
    expect(treesForChunk(terrain, 4, 4, 0, CHUNK_SIZE)).toEqual(treesForChunk(terrain, 4, 4, 0, CHUNK_SIZE));
  });
  it('ne met pas d\'arbres de très loin (niveau 3)', () => {
    expect(TREE_CELL[3]).toBe(0);
    expect(treesForChunk(terrain, 4, 4, 3, CHUNK_SIZE)).toEqual([]);
  });
  it('remplit la forêt équatoriale, pas le désert, pas la glace', () => {
    const congo = around(0, 23).length;
    expect(congo).toBeGreaterThan(600); // 36 tuiles : forêt dense
    expect(around(23, 12).length).toBeLessThan(40); // Sahara : presque rien
    expect(around(-80, 0).length).toBe(0); // Antarctique
    expect(around(72, -40).length).toBe(0); // Groenland
  });
  it('met des acacias en savane, des conifères en taïga, des feuillus en Bretagne', () => {
    const count = (trees: Tree[], kind: string): number => trees.filter((t) => t.kind === kind).length;
    const savane = around(14, 5); // Sahel : acacias
    expect(savane.length).toBeGreaterThan(0);
    expect(count(savane, 'acacia')).toBeGreaterThan(savane.length * 0.5);
    const taiga = around(62, 100);
    expect(count(taiga, 'conifer')).toBeGreaterThan(taiga.length * 0.6);
    const bretagne = around(48.5, -3.2);
    expect(bretagne.length).toBeGreaterThan(100);
    expect(count(bretagne, 'broadleaf')).toBeGreaterThan(bretagne.length * 0.5);
  });
  it('respecte les règles : hors de l\'eau, pas sur les pentes raides, sous la limite des arbres', () => {
    for (const [lat, lon] of [[48.5, -3.2], [0, 23], [45.9, 7.5]] as const) {
      for (const t of around(lat, lon)) {
        expect(t.y).toBeGreaterThanOrEqual(4);
        expect(slopeAt(terrain, t.x, t.z, 2)).toBeLessThanOrEqual(0.55);
        expect(t.size).toBeGreaterThan(0.3);
        expect(t.size).toBeLessThan(2.5);
      }
    }
  });
  it('compte moins d\'arbres (mais plus gros) à moyenne distance', () => {
    const near = around(0, 23, 0);
    const far = around(0, 23, 2);
    expect(far.length).toBeLessThan(near.length);
    expect(far.length).toBeGreaterThan(0);
  });
});

describe('forme', () => {
  const kinds = ['conifer', 'broadleaf', 'acacia'] as const;
  it('fabrique des triangles valides pour chaque espèce', () => {
    for (const kind of kinds) {
      const b: MeshBuilder = { positions: [], normals: [], colors: [], indices: [] };
      addTree(b, { x: 0, z: 0, y: 10, kind, size: 1, seed: 0.5 }, 5, 7);
      const n = b.positions.length / 3;
      expect(n).toBeGreaterThan(20);
      expect(n).toBeLessThan(80); // quelques dizaines de sommets : léger
      expect(b.normals.length).toBe(b.positions.length);
      expect(b.colors.length).toBe(b.positions.length);
      expect(b.indices.length % 3).toBe(0);
      for (const i of b.indices) expect(i).toBeLessThan(n);
      for (const c of b.colors) expect(c).toBeGreaterThanOrEqual(0);
      for (let v = 0; v < b.positions.length; v += 3) expect(Math.abs(b.positions[v + 1]! - 10)).toBeLessThan(15); // l'arbre reste près de son pied
    }
  });
  it('s\'ajoute aux tuiles sans dépasser les indices 16 bits, même en forêt dense', () => {
    const p = latLonToWorld(0, 23);
    const d = buildChunk(terrain, Math.floor(p.x / CHUNK_SIZE), Math.floor(p.z / CHUNK_SIZE), 0);
    expect(d.positions.length / 3).toBeLessThan(65536);
    expect(d.maxY).toBeGreaterThan(d.minY);
  });
});
