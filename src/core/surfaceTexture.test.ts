// Tests des réglages de texture procédurale (1.44) : fréquences sans décalage, fondus, cohérence des seuils.
import { describe, expect, it } from 'vitest';
import { GRAIN_PERIOD, ORIGIN_STEP, grainShift, snapOrigin } from './origin';
import { TEXTURE_FADE, TEXTURE_FREQ, TEXTURE_SLOPE, detailFade, shiftIsZero, smoothstep } from './surfaceTexture';

describe('texture des surfaces', () => {
  it('toutes les fréquences sont entières : aucun décalage à envoyer au shader', () => {
    for (const [nom, f] of Object.entries(TEXTURE_FREQ)) {
      expect(shiftIsZero(f, ORIGIN_STEP, GRAIN_PERIOD), nom).toBe(true); // 1 024 × f est un multiple de 512
    }
  });

  it('pour de vraies origines, le décalage du bruit est bien nul avec ces fréquences', () => {
    for (const p of [[0, 0], [3000, -7000], [-123456, 98765], [2e6, -3e6]]) {
      const o = snapOrigin(p[0]!, p[1]!); // origine posée sur la grille, comme dans le jeu
      for (const f of Object.values(TEXTURE_FREQ)) expect(grainShift(o, f)).toEqual([0, 0]); // le motif ne saute pas quand l'origine bouge
    }
  });

  it('une fréquence non entière aurait besoin d\'un décalage (le test sait le voir)', () => {
    expect(shiftIsZero(1.1, ORIGIN_STEP, GRAIN_PERIOD)).toBe(false); // c'est le cas du grain d'origine (1.1 case par mètre)
  });

  it('smoothstep et detailFade se comportent comme dans le shader', () => {
    expect(smoothstep(0, 1, -1)).toBe(0); // avant le début
    expect(smoothstep(0, 1, 2)).toBe(1); // après la fin
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 6); // milieu
    expect(detailFade(10, 40, 5)).toBe(1); // tout près : plein détail
    expect(detailFade(10, 40, 100)).toBe(0); // loin : plus rien
    const a = detailFade(10, 40, 20);
    const b = detailFade(10, 40, 30);
    expect(a).toBeGreaterThan(b); // le détail diminue avec la distance
  });

  it('les fondus et les seuils de pente sont dans le bon ordre', () => {
    expect(TEXTURE_FADE.pebblesNear).toBeLessThan(TEXTURE_FADE.pebblesFar);
    expect(TEXTURE_FADE.furrowNear).toBeLessThan(TEXTURE_FADE.furrowFar);
    expect(TEXTURE_SLOPE.wall).toBeLessThan(TEXTURE_SLOPE.ground);
  });
});
