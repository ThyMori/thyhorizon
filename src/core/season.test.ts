// Tests des saisons : feuilles, fleurs et herbe selon le jour et la latitude ; codes de sommets ; cohérence avec le maillage des tuiles.
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, buildChunk } from './chunk';
import { floraForChunk } from './flora';
import { hashSeed } from './noise';
import { loadRealRelief } from './relief.testutil';
import { SEASON_FERN, SEASON_FLOWER, SEASON_GRASS, SEASON_LEAF, SEASON_SPREAD, seasonCode, seasonState } from './season';
import { createTerrain, findSpawn } from './terrain';
import { realClimate } from '../world/climateData';

const LANNION = 48.7; // latitude tempérée

describe('seasonState', () => {
  it('plein été : tout est en feuilles et en fleurs, pas de roux', () => {
    const s = seasonState(200, LANNION);
    expect(s.leaf).toBeCloseTo(1, 2);
    expect(s.autumn).toBeCloseTo(0, 2);
    expect(s.bloom).toBeGreaterThan(0.95);
    expect(s.winter).toBe(0);
  });
  it('plein hiver : arbres nus, pas de fleurs, herbe brune', () => {
    const s = seasonState(20, LANNION);
    expect(s.leaf).toBeCloseTo(0, 2);
    expect(s.bloom).toBeCloseTo(0, 2);
    expect(s.fern).toBeCloseTo(0, 2);
    expect(s.dry).toBeGreaterThan(0.5);
    expect(s.winter).toBeGreaterThan(0.9);
  });
  it('à l\'automne les feuilles roussissent avant de tomber (mi-octobre)', () => {
    const s = seasonState(288, LANNION);
    expect(s.autumn).toBeGreaterThan(0.9);
    expect(s.leaf).toBeGreaterThan(0.5);
    expect(s.leaf).toBeLessThan(1);
  });
  it('au printemps les feuilles sortent et sont d\'un vert vif', () => {
    const early = seasonState(100, LANNION);
    const late = seasonState(125, LANNION);
    expect(late.leaf).toBeGreaterThan(early.leaf);
    expect(late.spring).toBeGreaterThan(0.5);
    expect(seasonState(200, LANNION).spring).toBeCloseTo(0, 2);
  });
  it('les feuilles tombent d\'octobre à novembre : décroissance régulière', () => {
    let prev = 1;
    for (let d = 280; d <= 330; d += 5) {
      const l = seasonState(d, LANNION).leaf;
      expect(l).toBeLessThanOrEqual(prev + 1e-9);
      prev = l;
    }
    expect(prev).toBeCloseTo(0, 2);
  });
  it('hémisphère sud : les saisons sont inversées', () => {
    const northWinter = seasonState(20, 45);
    const southSummer = seasonState(20, -45);
    expect(northWinter.leaf).toBeLessThan(0.1);
    expect(southSummer.leaf).toBeGreaterThan(0.9);
    expect(seasonState(200, -45).leaf).toBeLessThan(0.1); // juillet : hiver austral
  });
  it('sous les tropiques, presque pas de saisons : on garde ses feuilles', () => {
    for (const d of [20, 120, 200, 300]) expect(seasonState(d, 2).leaf).toBeGreaterThan(0.95);
    expect(seasonState(20, 2).winter).toBe(0);
  });
  it('toutes les valeurs restent dans 0..1 toute l\'année, à toutes les latitudes', () => {
    for (const lat of [-70, -45, -10, 0, 20, 48.7, 80]) {
      for (let d = 1; d <= 365; d += 4) {
        const s = seasonState(d, lat);
        for (const v of Object.values(s)) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(-1e-9);
          expect(v).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    }
  });
});

describe('codes de sommets', () => {
  it('la classe reste lisible (partie entière) et le tirage va de 0 à 1', () => {
    for (const cls of [1, 2, 3, 4, 5]) {
      for (const r of [0, 0.5, 0.9999, 1, 2]) {
        const c = seasonCode(cls, r);
        expect(Math.floor(c + 0.001)).toBe(cls);
        expect((c - cls) / SEASON_SPREAD).toBeLessThan(1);
        expect((c - cls) / SEASON_SPREAD).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('tuiles', () => {
  const terrain = createTerrain(hashSeed('horizon'), loadRealRelief(), realClimate, false);
  const sp = findSpawn(terrain);
  const cx = Math.floor(sp.x / CHUNK_SIZE);
  const cz = Math.floor(sp.z / CHUNK_SIZE);
  const classes = (arr: Float32Array): Set<number> => new Set(Array.from(arr, (v) => Math.floor(v + 0.001)));
  it('un code de saison par sommet, terrain à 0', () => {
    const d = buildChunk(terrain, cx, cz, 0);
    expect(d.seasons.length).toBe(d.positions.length / 3);
    expect(d.seasons.every(Number.isFinite)).toBe(true);
    const w = 65 * 65; // sommets de la grille du terrain à ce niveau de détail : tous sans saison
    for (let i = 0; i < w; i++) expect(d.seasons[i]).toBe(0);
  });
  it('de près : feuillage, herbe, fleurs ou fougères sont marqués ; de loin, seul le feuillage des arbres', () => {
    const near = classes(buildChunk(terrain, cx, cz, 0).seasons);
    expect(near.has(SEASON_GRASS)).toBe(true);
    expect([...near].some((c) => c === SEASON_FLOWER || c === SEASON_FERN)).toBe(true);
    const far = classes(buildChunk(terrain, cx, cz, 2).seasons);
    expect(far.has(SEASON_GRASS)).toBe(false); // pas de flore de loin
    expect(far.has(SEASON_LEAF) || far.size === 1).toBe(true);
  });
  it('les conifères et les troncs ne changent pas : leurs sommets restent à 0', () => {
    const d = buildChunk(terrain, cx, cz, 0);
    const zero = d.seasons.filter((v) => v === 0).length;
    expect(zero).toBeGreaterThan(65 * 65); // le terrain, plus les troncs, les conifères et les rochers
    expect(floraForChunk(terrain, cx, cz, 0, CHUNK_SIZE).some((p) => p.kind === 'rock')).toBe(true);
  });
});
