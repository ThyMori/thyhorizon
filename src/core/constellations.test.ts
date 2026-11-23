// Tests des constellations : données réelles et tableaux pour la carte graphique.
import { describe, expect, it } from 'vitest';
import data from '../data/constellations.json';
import { Segment, buildLineBuffers, seedOf } from './constellations';

const segments = data.segments as unknown as Segment[];

describe('données', () => {
  it('contiennent les traits des 89 constellations (plus de 600)', () => {
    expect(segments.length).toBeGreaterThan(600);
  });
  it('ont des coordonnées valides', () => {
    for (const s of segments) {
      expect(s.every(Number.isFinite)).toBe(true);
      expect(s[0]).toBeGreaterThanOrEqual(0);
      expect(s[0]).toBeLessThan(360);
      expect(Math.abs(s[1])).toBeLessThanOrEqual(90);
    }
  });
  it('dessinent la Grande Ourse près du pôle nord céleste', () => {
    expect(segments.some((s) => s[1] > 50 && s[3] > 50 && s[0] > 150 && s[0] < 215)).toBe(true);
  });
});

describe('tableaux pour la carte graphique', () => {
  it('placent les deux extrémités de chaque trait sur la sphère', () => {
    const b = buildLineBuffers(segments, 2500);
    expect(b.positions.length).toBe(segments.length * 6);
    for (let i = 0; i < 20; i++) {
      expect(Math.hypot(b.positions[i * 6]!, b.positions[i * 6 + 1]!, b.positions[i * 6 + 2]!)).toBeCloseTo(2500, 1);
      expect(Math.hypot(b.positions[i * 6 + 3]!, b.positions[i * 6 + 4]!, b.positions[i * 6 + 5]!)).toBeCloseTo(2500, 1);
    }
  });
  it('donnent la même graine aux deux extrémités d\'un trait, et des graines variées entre traits', () => {
    const b = buildLineBuffers(segments, 2500);
    expect(b.seeds[0]).toBe(b.seeds[1]);
    expect(new Set(Array.from(b.seeds.slice(0, 200))).size).toBeGreaterThan(50);
    expect(seedOf(3)).toBe(seedOf(3));
  });
});
