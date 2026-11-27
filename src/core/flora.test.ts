// Tests de la flore au sol : placement déterministe selon le lieu, rien dans l'eau ni sur les chemins, maillage valide et borné.
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, buildChunk } from './chunk';
import { FLORA_CELLS, FLORA_VERTEX_BUDGET, Plant, addFloraForChunk, addPlant, floraForChunk } from './flora';
import { hashSeed } from './noise';
import { loadRealRelief } from './relief.testutil';
import { createTerrain, findSpawn } from './terrain';
import type { MeshBuilder } from './trees';
import { realClimate } from '../world/climateData';

const terrain = createTerrain(hashSeed('horizon'), loadRealRelief(), realClimate, false); // sans eau douce : plus rapide
const spawn = findSpawn(terrain);
const cx = Math.floor(spawn.x / CHUNK_SIZE);
const cz = Math.floor(spawn.z / CHUNK_SIZE);
const empty = (): MeshBuilder => ({ positions: [], normals: [], colors: [], indices: [] });

describe('placement', () => {
  const plants = floraForChunk(terrain, cx, cz, 0, CHUNK_SIZE);
  it('une tuile de prairie a de la flore, de plusieurs sortes', () => {
    expect(plants.length).toBeGreaterThan(100);
    expect(new Set(plants.map((p) => p.kind)).size).toBeGreaterThanOrEqual(2);
  });
  it('au plus une plante par case', () => {
    expect(plants.length).toBeLessThanOrEqual(FLORA_CELLS * FLORA_CELLS);
  });
  it('déterministe : deux appels donnent la même flore', () => {
    expect(floraForChunk(terrain, cx, cz, 0, CHUNK_SIZE)).toEqual(plants);
  });
  it('seulement de près : rien aux niveaux de détail 1 et plus', () => {
    expect(floraForChunk(terrain, cx, cz, 1, CHUNK_SIZE)).toEqual([]);
    expect(floraForChunk(terrain, cx, cz, 3, CHUNK_SIZE)).toEqual([]);
  });
  it('chaque plante est dans sa tuile, sur la terre ferme, à la hauteur du sol', () => {
    for (const p of plants) {
      expect(p.x).toBeGreaterThanOrEqual(cx * CHUNK_SIZE);
      expect(p.x).toBeLessThan((cx + 1) * CHUNK_SIZE);
      expect(p.z).toBeGreaterThanOrEqual(cz * CHUNK_SIZE);
      expect(p.z).toBeLessThan((cz + 1) * CHUNK_SIZE);
      expect(p.y).toBeGreaterThanOrEqual(3);
      expect(p.y).toBeCloseTo(terrain.heightAt(p.x, p.z), 3);
    }
  });
  it('rien dans les zones interdites (villages, chemins)', () => {
    const cut = (x: number): boolean => x < (cx + 0.5) * CHUNK_SIZE; // moitié ouest interdite
    const half = floraForChunk(terrain, cx, cz, 0, CHUNK_SIZE, cut);
    expect(half.length).toBeGreaterThan(0);
    expect(half.every((p) => p.x >= (cx + 0.5) * CHUNK_SIZE)).toBe(true);
  });
  it('un désert reste presque nu : des rochers, ni fleurs ni fougères', () => {
    const desert = { grassDark: [0.6, 0.5, 0.35] as [number, number, number], grassLight: [0.72, 0.62, 0.42] as [number, number, number], snowLine: 6000, forest: 0, conifer: 0, acacia: 0 };
    const dry = { ...terrain, biomeAt: () => desert };
    const dp = floraForChunk(dry, cx, cz, 0, CHUNK_SIZE);
    expect(dp.some((p) => p.kind === 'rock')).toBe(true); // des rochers
    expect(dp.some((p) => p.kind === 'flower' || p.kind === 'fern')).toBe(false);
    expect(dp.length).toBeLessThan(plants.length / 10); // très peu de plantes (quelques touffes sèches);
  });
  it('au-dessus de la neige, rien', () => {
    const ice = { grassDark: [0.9, 0.9, 0.9] as [number, number, number], grassLight: [0.95, 0.95, 0.95] as [number, number, number], snowLine: 1, forest: 0, conifer: 0, acacia: 0 };
    expect(floraForChunk({ ...terrain, biomeAt: () => ice }, cx, cz, 0, CHUNK_SIZE)).toEqual([]);
  });
  it('de l\'eau douce : des roseaux sur la rive, rien dans l\'eau profonde', () => {
    const wet = { ...terrain, waterDepthAt: (x: number) => (x < (cx + 0.3) * CHUNK_SIZE ? 1 : 0), waterSurfaceAt: (x: number) => (x < (cx + 0.5) * CHUNK_SIZE ? 5 : NaN) };
    const wp = floraForChunk(wet, cx, cz, 0, CHUNK_SIZE, null, true);
    expect(wp.some((p) => p.kind === 'reed')).toBe(true);
    expect(wp.every((p) => p.x >= (cx + 0.3) * CHUNK_SIZE)).toBe(true); // jamais dans l'eau profonde
  });
});

describe('maillage', () => {
  it('chaque sorte de plante donne des sommets valides, dans les bornes, avec des normales unitaires', () => {
    for (const kind of ['tuft', 'flower', 'fern', 'heather', 'bush', 'rock', 'reed'] as const) {
      const p: Plant = { x: 10, z: 10, y: 5, kind, size: 1, seed: 0.37, color: [0.4, 0.5, 0.2] };
      const m = empty();
      addPlant(m, p, 10, 10);
      const n = m.positions.length / 3;
      expect(n, kind).toBeGreaterThan(0);
      expect(n, kind).toBeLessThan(200); // sous le garde-fou de addFloraForChunk
      expect(m.positions.every(Number.isFinite), kind).toBe(true);
      expect(m.colors.every((c) => c >= 0 && c <= 1), kind).toBe(true);
      expect(m.indices.every((i) => i >= 0 && i < n), kind).toBe(true);
      expect(m.indices.length % 3, kind).toBe(0);
      for (let i = 0; i < m.normals.length; i += 3) expect(Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!)).toBeCloseTo(1, 4);
    }
  });
  it('une plante reste près de son pied (pas de coordonnée du monde)', () => {
    const m = empty();
    addPlant(m, { x: 500, z: 500, y: 20, kind: 'reed', size: 1.5, seed: 0.9, color: [0.5, 0.55, 0.27] }, 12, 30);
    for (let i = 0; i < m.positions.length; i += 3) {
      expect(Math.abs(m.positions[i]! - 12)).toBeLessThan(3);
      expect(Math.abs(m.positions[i + 2]! - 30)).toBeLessThan(3);
    }
  });
  it('le total de la tuile respecte le budget et la limite de 16 bits', () => {
    const m = empty();
    const r = addFloraForChunk(m, terrain, cx, cz, 0, CHUNK_SIZE, null, false, 60000);
    expect(r.count).toBeGreaterThan(0);
    expect(m.positions.length / 3).toBeLessThanOrEqual(FLORA_VERTEX_BUDGET);
    const small = empty();
    addFloraForChunk(small, terrain, cx, cz, 0, CHUNK_SIZE, null, false, 1000); // place limitée : la flore s'arrête
    expect(small.positions.length / 3).toBeLessThanOrEqual(1000);
  });
  it('une tuile complète de près a plus de sommets qu\'au loin, et reste sous 65 000', () => {
    const near = buildChunk(terrain, cx, cz, 0);
    const far = buildChunk(terrain, cx, cz, 1);
    expect(near.positions.length).toBeGreaterThan(far.positions.length);
    expect(near.positions.length / 3).toBeLessThan(65536);
    expect(near.indices.every((i) => i < near.positions.length / 3)).toBe(true);
  });
});
