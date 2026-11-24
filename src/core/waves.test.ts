import { describe, expect, it } from 'vitest';
import { LOW_WAVES, WAVE_DEFS, waveDir, waveHeight } from './waves';

describe('waveHeight', () => {
  const maxAmp = WAVE_DEFS.slice(0, LOW_WAVES).reduce((s, d) => s + d.amp, 0); // somme des amplitudes
  it('reste dans les amplitudes des vagues larges', () => {
    for (let i = 0; i < 200; i++) {
      const h = waveHeight(i * 37.1 - 3000, i * 11.7 + 500, i * 0.9);
      expect(Math.abs(h)).toBeLessThanOrEqual(maxAmp + 1e-9);
    }
  });
  it('est périodique dans le temps pour une vague seule (fonction continue)', () => {
    expect(waveHeight(10, 20, 3)).toBeCloseTo(waveHeight(10, 20, 3.0001), 3); // pas de saut brutal
  });
  it('est déterministe', () => {
    expect(waveHeight(123.4, -56.7, 8.9)).toBe(waveHeight(123.4, -56.7, 8.9));
  });
});

describe('rotation de la mer (houle réelle)', () => {
  it('turn = 0 ne change rien', () => {
    expect(waveHeight(120, -40, 3, 1, 0)).toBe(waveHeight(120, -40, 3, 1));
  });
  it('tourner la mer de θ équivaut à tourner le point d’observation de −θ', () => {
    const th = 0.7, c = Math.cos(th), s = Math.sin(th);
    const x = 55, z = -23;
    // rotation du point par −θ : x' = x c + z s, z' = −x s + z c
    expect(waveHeight(x, z, 2, 1, th)).toBeCloseTo(waveHeight(x * c + z * s, -x * s + z * c, 2, 1, 0), 9);
  });
  it('la direction tournée garde sa longueur', () => {
    const d = waveDir(2, 1.1);
    expect(Math.hypot(d.dx, d.dz)).toBeCloseTo(Math.hypot(WAVE_DEFS[2].dx, WAVE_DEFS[2].dz), 9);
  });
});
