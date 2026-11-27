// Tests de la température et de la neige (1.40).
import { describe, expect, it } from 'vitest';
import { airTemperature, meanTemperature, snowFraction, stepSnowCover, temperatureText } from './temperature';

const clear = { cloud: 0, front: -0.5 };
const grey = { cloud: 1, front: 0.5 };

describe('température de l\'air', () => {
  it('l\'équateur est plus chaud que les pôles', () => {
    expect(meanTemperature(0)).toBeGreaterThan(meanTemperature(48));
    expect(meanTemperature(48)).toBeGreaterThan(meanTemperature(85));
    expect(meanTemperature(85)).toBeLessThan(-15);
  });
  it('l\'été est plus chaud que l\'hiver, et c\'est l\'inverse au sud', () => {
    const summerN = airTemperature(48, 197, 15, 0, clear);
    const winterN = airTemperature(48, 15, 15, 0, clear);
    expect(summerN).toBeGreaterThan(winterN + 8);
    const summerS = airTemperature(-48, 15, 15, 0, clear);
    expect(summerS).toBeGreaterThan(airTemperature(-48, 197, 15, 0, clear) + 8);
  });
  it('les tropiques changent à peine de saison', () => {
    expect(Math.abs(airTemperature(2, 197, 12, 0, clear) - airTemperature(2, 15, 12, 0, clear))).toBeLessThan(1);
  });
  it('l\'après-midi est plus chaud que la nuit, surtout par ciel dégagé', () => {
    const dayClear = airTemperature(48, 100, 15, 0, clear) - airTemperature(48, 100, 3, 0, clear);
    const dayGrey = airTemperature(48, 100, 15, 0, { cloud: 1, front: -0.5 }) - airTemperature(48, 100, 3, 0, { cloud: 1, front: -0.5 });
    expect(dayClear).toBeGreaterThan(dayGrey);
    expect(dayGrey).toBeGreaterThan(0);
  });
  it('l\'altitude refroidit : −6,5 °C par 1 000 m', () => {
    const low = airTemperature(45, 100, 12, 0, clear);
    expect(low - airTemperature(45, 100, 12, 2000, clear)).toBeCloseTo(13, 5);
    expect(airTemperature(45, 100, 12, -50, clear)).toBeCloseTo(low, 5); // sous le niveau de la mer : pas de réchauffement
  });
  it('une perturbation refroidit un peu', () => {
    expect(airTemperature(48, 100, 12, 0, grey)).toBeLessThan(airTemperature(48, 100, 12, 0, { cloud: 1, front: -0.5 }));
  });
  it('un hiver breton est frais mais rarement glacial, la haute montagne gèle', () => {
    const t = airTemperature(48.7, 15, 12, 50, grey);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(8);
    expect(airTemperature(46, 15, 12, 3000, grey)).toBeLessThan(-8);
  });
  it('toujours un nombre fini', () => {
    for (let lat = -90; lat <= 90; lat += 15) for (let d = 0; d < 365; d += 60) expect(Number.isFinite(airTemperature(lat, d, 7.5, 300, grey))).toBe(true);
  });
});

describe('neige ou pluie', () => {
  it('neige sous zéro, pluie au-dessus de 3 °C, mélange entre les deux', () => {
    expect(snowFraction(-5)).toBe(1);
    expect(snowFraction(0)).toBeGreaterThan(0.8);
    expect(snowFraction(1)).toBeGreaterThan(0.2);
    expect(snowFraction(1)).toBeLessThan(0.8);
    expect(snowFraction(3)).toBe(0);
  });
  it('plus il fait froid, plus c\'est de la neige', () => {
    for (let t = -10; t < 5; t += 0.5) expect(snowFraction(t + 0.5)).toBeLessThanOrEqual(snowFraction(t));
  });
});

describe('neige au sol', () => {
  it('blanchit quand il neige par temps froid, jamais au-delà de 1', () => {
    let c = 0;
    for (let i = 0; i < 20; i++) c = stepSnowCover(c, 30, 1, -3);
    expect(c).toBe(1);
    expect(stepSnowCover(0, 30, 1, -3)).toBeGreaterThan(0.05);
  });
  it('tient par grand froid sans nouvelle chute (presque pas de fonte)', () => {
    let c = 1;
    for (let i = 0; i < 60; i++) c = stepSnowCover(c, 10, 0, -5); // 10 minutes
    expect(c).toBeGreaterThan(0.98);
  });
  it('fond plus vite quand il fait doux', () => {
    let a = 1;
    let b = 1;
    for (let i = 0; i < 20; i++) { a = stepSnowCover(a, 10, 0, 2); b = stepSnowCover(b, 10, 0, 6); }
    expect(b).toBeLessThan(a);
    expect(a).toBeLessThan(1);
  });
  it('disparaît d\'un coup dans un lieu chaud (téléportation)', () => {
    expect(stepSnowCover(1, 0.1, 0, 25)).toBe(0);
  });
  it('ne reste jamais hors de 0..1', () => {
    expect(stepSnowCover(0.5, 1000, 5, -20)).toBe(1);
    expect(stepSnowCover(0, 1000, 0, 8)).toBe(0);
  });
});

describe('texte', () => {
  it('écrit la température en français', () => {
    expect(temperatureText(-3.4)).toBe('−3 °C');
    expect(temperatureText(12.6)).toBe('13 °C');
    expect(temperatureText(-0.2)).toBe('0 °C');
  });
});
