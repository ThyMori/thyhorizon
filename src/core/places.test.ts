// Tests des lieux du menu : coordonnées valides, sur la terre ferme, dans la bonne famille de climat.
import { describe, expect, it } from 'vitest';
import { realClimate } from '../world/climateData';
import { worldToLatLon } from './geo';
import { PLACES, placePosition } from './places';
import { loadRealRelief } from './relief.testutil';
import { createTerrain } from './terrain';

const terrain = createTerrain(12345, loadRealRelief(), realClimate);

describe('lieux', () => {
  it('ont des identifiants uniques et des coordonnées valides', () => {
    expect(new Set(PLACES.map((p) => p.id)).size).toBe(PLACES.length);
    for (const p of PLACES) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lon)).toBeLessThanOrEqual(180);
    }
  });
  it('retombent sur leurs coordonnées après le passage par le monde du jeu', () => {
    for (const p of PLACES) {
      const { x, z } = placePosition(p);
      const back = worldToLatLon(x, z);
      expect(back.lat).toBeCloseTo(p.lat, 4);
      expect(back.lon).toBeCloseTo(p.lon, 4);
    }
  });
  it('sont sur la terre ferme', () => {
    for (const p of PLACES) {
      const { x, z } = placePosition(p);
      expect(terrain.heightAt(x, z), p.name).toBeGreaterThan(2);
    }
  });
  it('ont le climat annoncé', () => {
    for (const p of PLACES) expect(realClimate.classAt(p.lat, p.lon)[0], p.name).toBe(p.family);
  });
  it('couvrent les cinq familles de climat', () => {
    expect(new Set(PLACES.map((p) => p.family)).size).toBe(5);
  });
});
