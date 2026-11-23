// Tests des tuiles : maillage cohérent, raccords entre voisines, limites des tableaux.
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, LOD_CELLS, buildChunk, chunkKey, lodForDistance } from './chunk';
import { hashSeed } from './noise';
import { createTerrain } from './terrain';
import { loadRealRelief } from './relief.testutil';

const terrain = createTerrain(hashSeed('horizon'), loadRealRelief());

describe('lodForDistance', () => {
  it('donne un détail décroissant avec la distance', () => {
    expect(lodForDistance(0)).toBe(0);
    expect(lodForDistance(3)).toBe(1);
    expect(lodForDistance(8)).toBe(2);
    expect(lodForDistance(15)).toBe(3);
  });
});

describe('buildChunk', () => {
  it('a des tailles de tableaux cohérentes et tient dans des indices 16 bits', () => {
    for (let lod = 0; lod < LOD_CELLS.length; lod++) {
      const n = LOD_CELLS[lod]!;
      const d = buildChunk(terrain, 5, 3, lod);
      const vertexCount = (n + 1) * (n + 1) + 4 * (n + 1); // grille + jupes
      expect(d.positions.length).toBe(vertexCount * 3);
      expect(d.normals.length).toBe(vertexCount * 3);
      expect(d.colors.length).toBe(vertexCount * 3);
      expect(d.indices.length).toBe(n * n * 6 + 4 * n * 6);
      expect(vertexCount).toBeLessThan(65536); // sinon Uint16Array déborde
      for (const i of d.indices) expect(i).toBeLessThan(vertexCount); // aucun indice hors limites
    }
  });
  it('produit des normales unitaires tournées vers le haut et des couleurs valides', () => {
    const d = buildChunk(terrain, 20, -4, 1);
    for (let v = 0; v < d.normals.length; v += 3) {
      expect(Math.hypot(d.normals[v]!, d.normals[v + 1]!, d.normals[v + 2]!)).toBeCloseTo(1, 4);
      expect(d.normals[v + 1]!).toBeGreaterThan(0);
    }
    for (const c of d.colors) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
  it('raccorde exactement deux tuiles voisines de même détail', () => {
    const lod = 1;
    const n = LOD_CELLS[lod]!;
    const w = n + 1;
    const a = buildChunk(terrain, 7, 2, lod); // tuile de gauche
    const b = buildChunk(terrain, 8, 2, lod); // tuile de droite
    for (let j = 0; j < w; j++) {
      const hA = a.positions[(j * w + n) * 3 + 1]!; // bord est de a
      const hB = b.positions[(j * w + 0) * 3 + 1]!; // bord ouest de b
      expect(hA).toBeCloseTo(hB, 4); // même altitude au même point du monde
    }
  });
  it('place les sommets dans la tuile (coordonnées locales)', () => {
    const d = buildChunk(terrain, -3, 9, 0);
    const n = LOD_CELLS[0]!;
    const w = n + 1;
    for (let k = 0; k < w * w; k++) {
      expect(d.positions[k * 3]!).toBeGreaterThanOrEqual(0);
      expect(d.positions[k * 3]!).toBeLessThanOrEqual(CHUNK_SIZE);
    }
    expect(d.minY).toBeLessThanOrEqual(d.maxY);
  });
  it('fabrique une clé de tuile lisible', () => {
    expect(chunkKey(-2, 5)).toBe('-2,5');
  });
});
