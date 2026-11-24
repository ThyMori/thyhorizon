// Tests du mixage sonore : les niveaux suivent bien le monde, sans jamais sortir de leurs bornes.
import { describe, expect, it } from 'vitest';
import { SoundInput, shoreProximity, soundMix } from './soundMix';

const BASE: SoundInput = { windSpeed: 4, rain: 0, seaHs: 0.5, onWater: false, shore: 0, boatSpeed: 0, aboard: false, volume: 0.6, active: true };

describe('soundMix', () => {
  it('pas de pluie : silence côté pluie', () => {
    const m = soundMix(BASE);
    expect(m.rain.hiss).toBe(0);
    expect(m.rain.plips).toBe(0);
  });
  it('la pluie, le vent et la mer montent avec leur cause', () => {
    expect(soundMix({ ...BASE, rain: 0.9 }).rain.hiss).toBeGreaterThan(soundMix({ ...BASE, rain: 0.3 }).rain.hiss);
    expect(soundMix({ ...BASE, windSpeed: 14 }).wind.gain).toBeGreaterThan(soundMix({ ...BASE, windSpeed: 4 }).wind.gain);
    expect(soundMix({ ...BASE, windSpeed: 14 }).wind.freq).toBeGreaterThan(soundMix({ ...BASE, windSpeed: 4 }).wind.freq);
    expect(soundMix({ ...BASE, onWater: true, seaHs: 3 }).swell.gain).toBeGreaterThan(soundMix({ ...BASE, onWater: true, seaHs: 0.3 }).swell.gain);
  });
  it('le vent ne disparaît jamais tout à fait (un léger souffle d’air)', () => expect(soundMix({ ...BASE, windSpeed: 0 }).wind.gain).toBeGreaterThan(0));
  it('le déferlement n’existe qu’au rivage', () => {
    expect(soundMix({ ...BASE, shore: 0 }).surf.gain).toBe(0);
    expect(soundMix({ ...BASE, shore: 1 }).surf.gain).toBeGreaterThan(0.05);
  });
  it('à bord seulement : eau le long de la coque et sifflement du gréement', () => {
    expect(soundMix({ ...BASE, boatSpeed: 4 }).hull.gain).toBe(0);
    expect(soundMix({ ...BASE, aboard: true, boatSpeed: 4 }).hull.gain).toBeGreaterThan(0.1);
    expect(soundMix({ ...BASE, aboard: true, windSpeed: 16 }).rig).toBeGreaterThan(0.05);
    expect(soundMix({ ...BASE, aboard: false, windSpeed: 16 }).rig).toBe(0);
  });
  it('le volume 0 coupe tout, le menu baisse le son', () => {
    expect(soundMix({ ...BASE, volume: 0 }).master).toBe(0);
    expect(soundMix({ ...BASE, active: false }).master).toBeLessThan(soundMix(BASE).master);
  });
  it('tous les niveaux restent entre 0 et 1, même avec des valeurs extrêmes', () => {
    const m = soundMix({ windSpeed: 90, rain: 5, seaHs: 40, onWater: true, shore: 3, boatSpeed: 50, aboard: true, volume: 9, active: true });
    for (const v of [m.master, m.wind.gain, m.rig, m.rain.hiss, m.rain.body, m.swell.gain, m.surf.gain, m.hull.gain]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('shoreProximity', () => {
  const coast = (x: number): number => (x < 0 ? -5 : 10); // eau à l'ouest de x = 0, terre à l'est
  it('proche du rivage : proche de 1', () => expect(shoreProximity(coast, 5, 0)).toBeGreaterThan(0.9));
  it('plus on s’éloigne, plus c’est faible', () => {
    expect(shoreProximity(coast, 60, 0)).toBeLessThan(shoreProximity(coast, 15, 0));
    expect(shoreProximity(coast, 60, 0)).toBeGreaterThan(0);
  });
  it('en pleine mer ou en plein pays : 0', () => {
    expect(shoreProximity(coast, 5000, 0)).toBe(0);
    expect(shoreProximity(coast, -5000, 0)).toBe(0);
  });
  it('fonctionne aussi depuis la mer', () => expect(shoreProximity(coast, -10, 0)).toBeGreaterThan(0.8));
});
