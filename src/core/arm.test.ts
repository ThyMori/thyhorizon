// Tests du bras à deux os : longueurs respectées, portée limitée, coude du bon côté.
import { describe, expect, it } from 'vitest';
import { V3, twoBoneIK } from './arm';

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const U = 0.3;
const F = 0.27;

describe('bras à deux os', () => {
  it('garde la longueur de chaque os quand la cible est atteignable', () => {
    const shoulder: V3 = [0, 1.4, 0];
    for (const target of [[0.1, 1.2, -0.4], [-0.2, 1.0, -0.3], [0.25, 1.35, -0.2], [0, 1.1, -0.35]] as V3[]) {
      const r = twoBoneIK(shoulder, target, U, F, [0.3, -1, 0.2]);
      expect(dist(shoulder, r.elbow)).toBeCloseTo(U, 5);
      expect(dist(r.elbow, r.wrist)).toBeCloseTo(F, 5);
      expect(dist(r.wrist, target)).toBeLessThan(1e-9); // le poignet arrive sur la cible
    }
  });
  it('tend le bras vers une cible trop loin, sans l\'étirer', () => {
    const r = twoBoneIK([0, 0, 0], [0, 0, -3], U, F, [0, -1, 0]);
    expect(dist([0, 0, 0], r.wrist)).toBeLessThan(U + F);
    expect(r.wrist[2]).toBeLessThan(-0.5);
    expect(Math.abs(r.wrist[0]) + Math.abs(r.wrist[1])).toBeLessThan(1e-6); // reste sur la bonne direction
    expect(r.reach).toBeCloseTo(1, 2);
  });
  it('le coude plie du côté du pôle (vers le bas ici)', () => {
    const r = twoBoneIK([0, 1.4, 0], [0, 1.4, -0.4], U, F, [0, -1, 0]);
    expect(r.elbow[1]).toBeLessThan(1.4 - 0.05);
    const up = twoBoneIK([0, 1.4, 0], [0, 1.4, -0.4], U, F, [0, 1, 0]);
    expect(up.elbow[1]).toBeGreaterThan(1.4 + 0.05);
  });
  it('cible sur l\'épaule ou pôle aligné : pas de valeur invalide', () => {
    for (const [t, pole] of [[[0, 0, 0], [0, -1, 0]], [[0, 0, -0.4], [0, 0, -1]], [[0, -0.4, 0], [0, -1, 0]]] as [V3, V3][]) {
      const r = twoBoneIK([0, 0, 0], t, U, F, pole);
      for (const v of [...r.elbow, ...r.wrist]) expect(Number.isFinite(v)).toBe(true);
      expect(dist([0, 0, 0], r.elbow)).toBeCloseTo(U, 4);
    }
  });
});
