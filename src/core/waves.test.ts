import { describe, expect, it } from 'vitest';
import { LOW_WAVES, WAVE_DEFS, waveHeight } from './waves';

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
