// Tests du maillage des villages : sommets valides, normales unitaires, indices cohérents, taille raisonnable, quatre pentes et toits plats.
import { describe, expect, it } from 'vitest';
import { loadRealCities } from './cities.testutil';
import { hashSeed } from './noise';
import { loadRealRelief } from './relief.testutil';
import { createTerrain } from './terrain';
import { VillageSystem } from './villageSystem';
import { SIGN_H, SIGN_Y, buildVillageMesh } from './villageMesh';
import { realClimate } from '../world/climateData';

const terrain = createTerrain(hashSeed('horizon'), loadRealRelief(), realClimate);
const cities = loadRealCities();
const system = new VillageSystem(cities, terrain);
const idOf = (name: string, country: string): number => {
  for (let i = 0; i < cities.count; i++) if (cities.name(i) === name && cities.country[i] === country) return i;
  throw new Error(`${name} introuvable`);
};

describe('maillage de village', () => {
  const v = system.village(idOf('Lannion', 'FR'))!;
  const m = buildVillageMesh(v, (x, z) => terrain.heightAt(x, z));
  it('a des sommets, des normales unitaires et des couleurs valides', () => {
    const n = m.positions.length / 3;
    expect(n).toBeGreaterThan(v.houses.length * 20);
    expect(m.normals.length).toBe(m.positions.length);
    expect(m.colors.length).toBe(m.positions.length);
    expect(m.positions.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < n; i++) expect(Math.hypot(m.normals[i * 3]!, m.normals[i * 3 + 1]!, m.normals[i * 3 + 2]!)).toBeCloseTo(1, 4);
    expect(m.colors.every((c) => c >= 0 && c <= 1)).toBe(true);
  });
  it('les indices sont des triangles qui visent des sommets existants', () => {
    expect(m.indices.length % 3).toBe(0);
    const n = m.positions.length / 3;
    expect(m.indices.every((i) => Number.isInteger(i) && i >= 0 && i < n)).toBe(true);
  });
  it('reste léger (même une grande ville)', () => {
    const paris = buildVillageMesh(system.village(idOf('Paris', 'FR'))!, (x, z) => terrain.heightAt(x, z));
    expect(paris.positions.length / 3).toBeLessThan(80000);
  });
  it('les maisons restent proches du centre du village (positions relatives)', () => {
    for (let i = 0; i < m.positions.length; i += 3) expect(Math.hypot(m.positions[i]!, m.positions[i + 2]!)).toBeLessThan(v.radius + 40);
  });
  it('les poteaux de panneaux montent à la hauteur du panneau', () => {
    const sg = v.signs[0]!;
    const g = terrain.heightAt(sg.x, sg.z);
    let max = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      if (Math.hypot(m.positions[i]! - (sg.x - v.x), m.positions[i + 2]! - (sg.z - v.z)) < 0.2) max = Math.max(max, m.positions[i + 1]!);
    }
    expect(max).toBeGreaterThan(g + SIGN_Y + SIGN_H);
  });
  it('les toits plats et à quatre pentes se fabriquent aussi (désert, tropiques)', () => {
    for (const [name, c] of [['Cairo', 'EG'], ['Singapore', 'SG'], ['Manaus', 'BR']] as const) {
      let i = -1;
      try { i = idOf(name, c); } catch { continue; }
      const vv = system.village(i);
      if (!vv) continue;
      const mm = buildVillageMesh(vv, (x, z) => terrain.heightAt(x, z));
      expect(mm.positions.every(Number.isFinite)).toBe(true);
      expect(mm.indices.length).toBeGreaterThan(0);
    }
  });
});
