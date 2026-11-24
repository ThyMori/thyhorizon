// Tests des gouttes sur l'écran : apparition, vie, disparition, limites.
import { describe, expect, it } from 'vitest';
import { LensDrop, MAX_DROPS, dropAlpha, dropRate, dropScale, stepDrops } from './lensDrops';
import { mulberry32 } from './noise';

describe('gouttes sur la lunette', () => {
  it('pas de goutte sans pluie', () => {
    expect(dropRate(0)).toBe(0);
    const drops: LensDrop[] = [];
    const rnd = mulberry32(1);
    let c = 0;
    for (let i = 0; i < 600; i++) c = stepDrops(drops, 1 / 60, 0, c, rnd);
    expect(drops.length).toBe(0);
  });
  it('plus la pluie est forte, plus il y a de gouttes', () => {
    expect(dropRate(1)).toBeGreaterThan(dropRate(0.3));
    expect(dropRate(0.3)).toBeGreaterThan(0);
  });
  it('une goutte vit puis disparaît ; le nombre reste borné', () => {
    const drops: LensDrop[] = [];
    const rnd = mulberry32(7);
    let c = 0;
    let max = 0;
    for (let i = 0; i < 60 * 30; i++) {
      c = stepDrops(drops, 1 / 60, 1, c, rnd); // 30 s de forte pluie
      max = Math.max(max, drops.length);
    }
    expect(max).toBeLessThanOrEqual(MAX_DROPS);
    expect(max).toBeGreaterThan(3);
    for (let i = 0; i < 60 * 5; i++) c = stepDrops(drops, 1 / 60, 0, c, rnd); // la pluie s'arrête : tout disparaît en quelques secondes
    expect(drops.length).toBe(0);
  });
  it('les gouttes restent dans l’écran à leur apparition', () => {
    const drops: LensDrop[] = [];
    const rnd = mulberry32(3);
    stepDrops(drops, 0.25, 1, 5, rnd);
    for (const d of drops) {
      expect(d.x).toBeGreaterThan(0);
      expect(d.x).toBeLessThan(1);
      expect(d.y).toBeGreaterThan(0);
      expect(d.y).toBeLessThan(1);
    }
  });
  it('opacité : monte vite, s’efface à la fin, jamais hors de 0 à 1', () => {
    expect(dropAlpha(0, 1)).toBe(0);
    expect(dropAlpha(0.05, 1)).toBeCloseTo(1, 5);
    expect(dropAlpha(0.99, 1)).toBeLessThan(0.05);
    expect(dropAlpha(1, 1)).toBe(0);
    for (let t = 0; t < 1.2; t += 0.05) {
      const a = dropAlpha(t, 1);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
    }
  });
  it('le ploc : la goutte s’étale en un instant puis reste stable', () => {
    expect(dropScale(0)).toBeCloseTo(0.55, 5);
    expect(dropScale(0.06)).toBeGreaterThan(dropScale(0.01));
    expect(dropScale(0.5)).toBe(1);
  });
  it('les grosses gouttes glissent vers le bas', () => {
    const d: LensDrop = { x: 0.5, y: 0.3, r: 0.015, age: 0, life: 1.5, slide: 0.05, seed: 0 };
    const drops = [d];
    stepDrops(drops, 0.5, 0, 0, mulberry32(1));
    expect(d.y).toBeGreaterThan(0.3);
  });
});
