// Tests des bruits de l'eau douce : repérage de l'eau autour du joueur, niveaux selon distance, courant et pluie.
import { describe, expect, it } from 'vitest';
import { soundMix } from './soundMix';
import { NO_WATER, SILENT_WATER, WATER_HEARING, waterAround, waterMix } from './waterSound';

// Un ruisseau synthétique : bande d'eau large de 4 m le long de l'axe z (|x| < 2), surface qui descend de `slope` par mètre vers le sud.
const stream = (slope: number) => ({
  depth: (x: number): number => (Math.abs(x) < 2 ? 0.5 : 0),
  surf: (x: number, z: number): number => (Math.abs(x) < 4 ? 100 - slope * z : NaN),
});
const around = (slope: number, x: number): ReturnType<typeof waterAround> => {
  const s = stream(slope);
  return waterAround((px) => s.depth(px), s.surf, x, 0);
};

describe('waterAround', () => {
  it('aucune eau alentour : rien', () => {
    expect(waterAround(() => 0, () => NaN, 0, 0)).toEqual(NO_WATER);
  });
  it('dans l\'eau : distance 0', () => {
    expect(around(0.01, 0).dist).toBe(0);
  });
  it('à 10 m du bord, la distance est de l\'ordre de 8 à 10 m', () => {
    const d = around(0.01, 11).dist;
    expect(d).toBeGreaterThanOrEqual(8);
    expect(d).toBeLessThanOrEqual(16);
  });
  it('mesure la pente de la surface', () => {
    expect(around(0.02, 0).slope).toBeCloseTo(0.02, 3);
    expect(around(0, 0).slope).toBeCloseTo(0, 5);
  });
  it('au-delà de la portée d\'écoute, rien', () => {
    expect(Number.isFinite(around(0.01, WATER_HEARING + 20).dist)).toBe(false);
  });
});

describe('waterMix', () => {
  it('silence sans eau', () => {
    expect(waterMix(NO_WATER)).toEqual(SILENT_WATER);
  });
  it('eau vive : babille et gronde, ne clapote presque pas', () => {
    const m = waterMix({ dist: 0, slope: 0.03, size: 0.6 });
    expect(m.babble.gain).toBeGreaterThan(0.1);
    expect(m.rush).toBeGreaterThan(0.05);
    expect(m.lap).toBeLessThan(0.01);
  });
  it('lac (eau calme) : clapote, ne babille pas', () => {
    const m = waterMix({ dist: 0, slope: 0, size: 1 });
    expect(m.lap).toBeGreaterThan(0.05);
    expect(m.babble.gain).toBe(0);
    expect(m.rush).toBe(0);
  });
  it('le son baisse avec la distance et s\'éteint à la portée', () => {
    const g = (d: number): number => waterMix({ dist: d, slope: 0.03, size: 0.5 }).babble.gain;
    expect(g(0)).toBeGreaterThan(g(10));
    expect(g(10)).toBeGreaterThan(g(30));
    expect(g(WATER_HEARING)).toBe(0);
  });
  it('un torrent est plus aigu qu\'un ruisseau paresseux', () => {
    expect(waterMix({ dist: 0, slope: 0.03, size: 0.3 }).babble.freq).toBeGreaterThan(waterMix({ dist: 0, slope: 0.001, size: 0.3 }).babble.freq);
  });
  it('une grosse rivière gronde plus qu\'un fin ruisseau', () => {
    expect(waterMix({ dist: 0, slope: 0.02, size: 1 }).rush).toBeGreaterThan(waterMix({ dist: 0, slope: 0.02, size: 0.05 }).rush);
  });
  it('la pluie couvre un peu, valeurs toujours finies et dans 0..1', () => {
    const dry = waterMix({ dist: 2, slope: 0.02, size: 0.5 }, 0);
    const wet = waterMix({ dist: 2, slope: 0.02, size: 0.5 }, 1);
    expect(wet.babble.gain).toBeLessThan(dry.babble.gain);
    for (const v of [dry.babble.gain, dry.rush, dry.lap, wet.rush]) expect(v >= 0 && v <= 1).toBe(true);
  });
});

describe('dans le mixage général', () => {
  const base = { windSpeed: 2, rain: 0, seaHs: 0.2, onWater: false, shore: 0, boatSpeed: 0, aboard: false, volume: 0.8, active: true };
  it('sans eau fournie, silence ; avec, le mixage la transmet', () => {
    expect(soundMix(base).water).toEqual(SILENT_WATER);
    const w = waterMix({ dist: 0, slope: 0.03, size: 0.5 });
    expect(soundMix({ ...base, water: w }).water).toEqual(w);
  });
});
