import { describe, expect, it } from 'vitest';
import { sunState } from './sun';
import { CLEAR_WEATHER, applyWeatherToSky, blendWeather, climateProfile, fogFactor, summerness, weatherAt, weatherText, weatherWind } from './weather';

// Moyenne d'une grandeur météo sur 200 jours, un instant par jour à midi.
const average = (cls: string, lat: number, lon: number, dayStart: number, pick: (w: ReturnType<typeof weatherAt>) => number): number => {
  let sum = 0;
  const n = 120;
  for (let i = 0; i < n; i++) sum += pick(weatherAt(lat, lon, cls, dayStart + (i % 20), i * 11 + 5, 12)); // 20 jours de saison, temps qui avance
  return sum / n;
};

describe('météo', () => {
  it('est déterministe', () => {
    expect(weatherAt(48.7, -3.5, 'Cfb', 200, 4000, 8)).toEqual(weatherAt(48.7, -3.5, 'Cfb', 200, 4000, 8));
  });
  it('reste dans ses bornes', () => {
    for (let i = 0; i < 500; i++) {
      const w = weatherAt(-60 + i * 0.25, (i * 37) % 360 - 180, ['Af', 'BWh', 'Cfb', 'Dfc', 'EF'][i % 5]!, 1 + ((i * 13) % 365), i * 7.3, (i * 5) % 24);
      for (const v of [w.cloud, w.rain, w.fog]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(w.windScale).toBeGreaterThanOrEqual(0.6);
      expect(w.windScale).toBeLessThanOrEqual(2);
      expect(Number.isFinite(w.pressure)).toBe(true);
    }
  });
  it('évolue doucement dans le temps (pas de saut en une minute)', () => {
    for (let t = 0; t < 300; t += 7) {
      const a = weatherAt(48.7, -3.5, 'Cfb', 100, t, 10);
      const b = weatherAt(48.7, -3.5, 'Cfb', 100, t + 1 / 60, 10);
      expect(Math.abs(a.cloud - b.cloud)).toBeLessThan(0.02);
    }
  });
  it('change vraiment au fil des jours (beau, puis nuageux, puis pluie)', () => {
    const clouds: number[] = [];
    for (let d = 0; d < 40; d++) clouds.push(weatherAt(48.7, -3.5, 'Cfb', 300, d * 24, 12).cloud);
    expect(Math.max(...clouds) - Math.min(...clouds)).toBeGreaterThan(0.5);
  });
  it('le désert est bien plus sec que le climat océanique', () => {
    const desert = average('BWh', 25, 10, 100, (w) => w.rain);
    const ocean = average('Cfb', 48.7, -3.5, 100, (w) => w.rain);
    expect(desert).toBeLessThan(ocean * 0.4);
  });
  it('un climat méditerranéen est plus sec l’été que l’hiver (hémisphère nord)', () => {
    expect(summerness(40, 196)).toBeGreaterThan(0.9);
    const summer = average('Csa', 40, 15, 180, (w) => w.rain);
    const winter = average('Csa', 40, 15, 10, (w) => w.rain);
    expect(summer).toBeLessThan(winter);
  });
  it('les saisons s’inversent dans l’hémisphère sud', () => {
    expect(summerness(-30, 196)).toBeLessThan(-0.9);
    expect(summerness(-30, 15)).toBeGreaterThan(0.9);
  });
  it('la savane est plus humide à la saison des pluies', () => {
    expect(climateProfile('Aw', 10, 196).wet).toBeGreaterThan(climateProfile('Aw', 10, 15).wet);
    expect(climateProfile('Aw', -10, 15).wet).toBeGreaterThan(climateProfile('Aw', -10, 196).wet);
  });
  it('un climat inconnu donne un profil valide', () => {
    const p = climateProfile('', 0, 1);
    expect(p.wet).toBeGreaterThan(0);
  });
  it('le vent est renforcé dans une perturbation et affaibli sous un anticyclone', () => {
    expect(weatherWind({ speed: 5, from: 1 }, { ...CLEAR_WEATHER, windScale: 1.8 }).speed).toBeCloseTo(9);
    expect(weatherWind({ speed: 5, from: 1 }, { ...CLEAR_WEATHER, windScale: 0.7 }).from).toBe(1);
    expect(weatherWind({ speed: 100, from: 0 }, { ...CLEAR_WEATHER, windScale: 2 }).speed).toBeLessThanOrEqual(32);
  });
  it('un ciel couvert est plus gris, plus sombre, sans soleil ni étoiles', () => {
    const noon = sunState(12, 48.7, 200);
    const grey = applyWeatherToSky(noon, { ...CLEAR_WEATHER, cloud: 1, rain: 0.4 });
    expect(grey.sunIntensity).toBeLessThan(noon.sunIntensity * 0.25);
    expect(grey.sunVisibility).toBe(0);
    const sat = (c: readonly number[]): number => Math.max(...c) - Math.min(...c);
    expect(sat(grey.skyTop)).toBeLessThan(sat(noon.skyTop) * 0.5); // moins saturé
    const night = sunState(0, 48.7, 200);
    expect(applyWeatherToSky(night, { ...CLEAR_WEATHER, cloud: 0.9 }).starsOpacity).toBe(0);
  });
  it('un ciel clair reste inchangé', () => {
    const noon = sunState(12, 48.7, 200);
    const same = applyWeatherToSky(noon, { ...CLEAR_WEATHER, cloud: 0, rain: 0, fog: 0 });
    expect(same.sunIntensity).toBeCloseTo(noon.sunIntensity, 5);
    expect(same.skyTop[0]).toBeCloseTo(noon.skyTop[0], 5);
  });
  it('mélange doux entre deux météos', () => {
    const w = blendWeather({ ...CLEAR_WEATHER, cloud: 0 }, { ...CLEAR_WEATHER, cloud: 1 }, 0.25);
    expect(w.cloud).toBeCloseTo(0.25);
  });
  it('la brume épaissit le brouillard visuel', () => {
    expect(fogFactor(CLEAR_WEATHER)).toBeLessThan(1.2);
    expect(fogFactor({ ...CLEAR_WEATHER, fog: 1 })).toBeGreaterThan(5);
  });
  it('décrit le temps en français', () => {
    expect(weatherText({ ...CLEAR_WEATHER, cloud: 0.05 })).toBe('ciel dégagé');
    expect(weatherText({ ...CLEAR_WEATHER, cloud: 0.95, rain: 0.5 })).toBe('ciel couvert · pluie');
    expect(weatherText({ ...CLEAR_WEATHER, cloud: 0.3, fog: 0.8 })).toContain('brouillard');
  });
});
