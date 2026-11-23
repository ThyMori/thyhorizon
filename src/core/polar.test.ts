// Tests du maillage polaire : tous les triangles doivent regarder vers le haut, sinon l'océan serait invisible.
import { describe, expect, it } from 'vitest';
import { buildPolarGrid } from './polar';

describe('buildPolarGrid', () => {
  const rings = 20;
  const segments = 32;
  const g = buildPolarGrid(rings, segments, 0.004);

  it('a le bon nombre de sommets et de triangles', () => {
    expect(g.positions.length).toBe((1 + rings * segments) * 3);
    expect(g.indices.length).toBe((segments + (rings - 1) * segments * 2) * 3);
  });
  it('oriente tous les triangles vers le haut (+y)', () => {
    for (let t = 0; t < g.indices.length; t += 3) {
      const [a, b, c] = [g.indices[t]!, g.indices[t + 1]!, g.indices[t + 2]!];
      const p = (i: number) => [g.positions[i * 3]!, g.positions[i * 3 + 1]!, g.positions[i * 3 + 2]!] as const;
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]; // arête a→b
      const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]; // arête a→c
      const ny = u[2]! * v[0]! - u[0]! * v[2]!; // composante y du produit vectoriel
      expect(ny).toBeGreaterThan(0);
    }
  });
  it('s\'arrête au rayon 1 et reste dans le plan y = 0', () => {
    let maxR = 0;
    for (let v = 0; v < g.positions.length; v += 3) {
      expect(g.positions[v + 1]).toBe(0);
      maxR = Math.max(maxR, Math.hypot(g.positions[v]!, g.positions[v + 2]!));
    }
    expect(maxR).toBeCloseTo(1, 5);
  });
  it('n\'utilise que des indices valides', () => {
    const max = 1 + rings * segments;
    for (const i of g.indices) expect(i).toBeLessThan(max);
  });
});
