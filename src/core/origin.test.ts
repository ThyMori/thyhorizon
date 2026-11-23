// Tests de l'origine flottante : déplacement par grands pas, et raccord exact du grain du sol et des vagues.
import { describe, expect, it } from 'vitest';
import { GRAIN_FREQUENCIES, GRAIN_PERIOD, ORIGIN_LIMIT, ORIGIN_STEP, NO_ORIGIN, grainShift, snapOrigin, updateOrigin, wavePhase } from './origin';

describe('origine', () => {
  it('se pose sur une grille de 1 024 m, sans -0', () => {
    expect(snapOrigin(0, 0)).toEqual({ x: 0, z: 0 });
    expect(Object.is(snapOrigin(-3, -3).x, 0)).toBe(true);
    expect(snapOrigin(1500, -1600)).toEqual({ x: 1024, z: -2048 });
    expect(ORIGIN_STEP % 64).toBe(0); // alignée sur les tuiles
  });
  it('ne bouge pas tant que le joueur reste près, puis saute d\'un coup', () => {
    const o = snapOrigin(0, 0);
    expect(updateOrigin(o, ORIGIN_LIMIT, -ORIGIN_LIMIT)).toBe(o); // le même objet : rien n'a changé
    const next = updateOrigin(o, ORIGIN_LIMIT + 1, 0);
    expect(next).not.toBe(o);
    expect(next.x).toBe(2048);
    // une fois déplacée, le joueur est de nouveau près de l'origine (≤ 512 m)
    expect(Math.abs(ORIGIN_LIMIT + 1 - next.x)).toBeLessThanOrEqual(ORIGIN_STEP / 2);
  });
  it('suit le joueur sur toute la planète sans jamais s\'en éloigner de plus de 1 536 m', () => {
    let o = NO_ORIGIN;
    let x = 0;
    let z = 0;
    for (let i = 0; i < 200000; i++) {
      x += 250.7; // 250 m par pas (plus vite que le vol rapide)
      z -= 91.3;
      o = updateOrigin(o, x, z);
      expect(Math.abs(x - o.x)).toBeLessThanOrEqual(ORIGIN_LIMIT + 1e-6);
      expect(Math.abs(z - o.z)).toBeLessThanOrEqual(ORIGIN_LIMIT + 1e-6);
    }
    expect(o.x).toBeGreaterThan(4e7); // plus de 40 000 km parcourus en x : tour de la Terre
  });
});

describe('raccord du grain du sol', () => {
  // On compare la position de la case de bruit : (local + décalage) doit égaler (monde × fréquence) modulo la période.
  const modP = (v: number): number => ((v % GRAIN_PERIOD) + GRAIN_PERIOD) % GRAIN_PERIOD;
  it('retrouve exactement la même case de bruit, près comme très loin', () => {
    for (const origin of [snapOrigin(0, 0), snapOrigin(3e6, -2e6), snapOrigin(-2.2e7, 1.9e7)]) {
      for (const f of GRAIN_FREQUENCIES) {
        const [sx, sz] = grainShift(origin, f);
        for (const [lx, lz] of [[0, 0], [1234.5, -987.6], [-1500, 1500]] as const) {
          const worldX = origin.x + lx;
          const worldZ = origin.z + lz;
          expect(modP(lx * f + sx)).toBeCloseTo(modP(worldX * f), 5);
          expect(modP(lz * f + sz)).toBeCloseTo(modP(worldZ * f), 5);
        }
        expect(sx).toBeGreaterThanOrEqual(0);
        expect(sx).toBeLessThan(GRAIN_PERIOD);
      }
    }
  });
});

describe('raccord des vagues', () => {
  it('retrouve exactement la même hauteur de vague, près comme très loin', () => {
    const waves = [[0.8, 0.6, 0.09], [-0.55, 0.83, 0.14], [0.95, -0.31, 0.26], [-0.2, -0.98, 0.47], [0.6, -0.8, 0.9], [0.3, 0.95, 1.7]] as const;
    for (const origin of [snapOrigin(0, 0), snapOrigin(3e6, -2e6), snapOrigin(-2.2e7, 1.9e7)]) {
      for (const [dx, dz, k] of waves) {
        for (const [lx, lz] of [[0, 0], [321.7, -45.2], [-1200, 800]] as const) {
          const world = Math.sin(((origin.x + lx) * dx + (origin.z + lz) * dz) * k);
          const local = Math.sin((lx * dx + lz * dz) * k + wavePhase(origin, dx, dz, k));
          expect(local).toBeCloseTo(world, 6);
        }
      }
    }
  });
  it('donne un déphasage entre 0 et 2π', () => {
    const p = wavePhase(snapOrigin(-2.2e7, 1.9e7), 0.8, 0.6, 0.09);
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(2 * Math.PI);
  });
});
