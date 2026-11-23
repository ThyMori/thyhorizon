// Tests du soleil : bon côté du ciel, bonnes hauteurs, transitions continues.
import { describe, expect, it } from 'vitest';
import { START_LAT, dayOfYear } from './geo';
import { sunState as sunStateAt, wrapHours } from './sun';

const EQUINOX = dayOfYear(3, 21); // équinoxe : jour et nuit égaux
const sunState = (h: number) => sunStateAt(h, START_LAT, EQUINOX); // le soleil de Lannion à l'équinoxe

describe('wrapHours', () => {
  it('ramène dans [0 ; 24[', () => {
    expect(wrapHours(25)).toBeCloseTo(1);
    expect(wrapHours(-1)).toBeCloseTo(23);
    expect(wrapHours(24)).toBe(0);
  });
});

describe('sunState', () => {
  it('culmine à midi, au sud', () => {
    const s = sunState(12);
    expect(Math.abs(s.elevationDeg - (90 - START_LAT))).toBeLessThan(1);
    expect(s.sunDirection[2]).toBeGreaterThan(0); // +z = sud
  });
  it('se lève à l\'est (+x) et se couche à l\'ouest (-x)', () => {
    expect(sunState(8).sunDirection[0]).toBeGreaterThan(0);
    expect(sunState(16).sunDirection[0]).toBeLessThan(0);
    expect(Math.abs(sunState(6).elevationDeg)).toBeLessThan(1); // lever vers 6 h à l'équinoxe
    expect(Math.abs(sunState(18).elevationDeg)).toBeLessThan(1); // coucher vers 18 h
  });
  it('est sous l\'horizon la nuit, avec étoiles et sans lumière solaire', () => {
    const s = sunState(0);
    expect(s.elevationDeg).toBeLessThan(0);
    expect(s.daylight).toBe(0);
    expect(s.sunIntensity).toBe(0);
    expect(s.starsOpacity).toBe(1);
    expect(s.moonIntensity).toBeGreaterThan(0);
  });
  it('donne des vecteurs unitaires et la lune à l\'opposé', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const s = sunState(h);
      expect(Math.hypot(...s.sunDirection)).toBeCloseTo(1, 6);
      expect(s.moonDirection[1]).toBeCloseTo(-s.sunDirection[1], 6);
    }
  });
  it('a un jour qui s\'installe progressivement le matin', () => {
    let prev = sunState(5).daylight;
    for (let h = 5.1; h <= 12; h += 0.1) {
      const d = sunState(h).daylight;
      expect(d).toBeGreaterThanOrEqual(prev - 1e-9); // ne diminue jamais le matin
      prev = d;
    }
    expect(sunState(12).daylight).toBe(1);
  });
  it('change de couleur sans saut brutal sur 24 h', () => {
    let prev = sunState(0);
    for (let h = 0.05; h <= 24; h += 0.05) {
      const s = sunState(h);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(s.skyHorizon[k]! - prev.skyHorizon[k]!)).toBeLessThan(0.06);
        expect(Math.abs(s.skyTop[k]! - prev.skyTop[k]!)).toBeLessThan(0.06);
      }
      expect(Math.abs(s.sunIntensity - prev.sunIntensity)).toBeLessThan(0.3);
      prev = s;
    }
  });
  it('est à l\'heure dorée à 17 h 24 : soleil bas et chaud', () => {
    const s = sunState(17.4);
    expect(s.elevationDeg).toBeGreaterThan(4);
    expect(s.elevationDeg).toBeLessThan(11);
    expect(s.sunColor[2]).toBeLessThan(s.sunColor[0]); // plus de rouge que de bleu
  });
  it('reste cohérent pour toute heure, même hors bornes', () => {
    expect(sunState(-3).hours).toBeCloseTo(21);
    expect(sunState(49).hours).toBeCloseTo(1);
  });
});

describe('saisons', () => {
  it('donne un soleil bas et un jour court en hiver, haut et long en été', () => {
    const winter = sunStateAt(12, START_LAT, dayOfYear(12, 21));
    const summer = sunStateAt(12, START_LAT, dayOfYear(6, 21));
    expect(summer.elevationDeg).toBeGreaterThan(winter.elevationDeg + 40);
    expect(sunStateAt(17, START_LAT, dayOfYear(12, 21)).daylight).toBeLessThan(0.2); // 17 h : déjà le soir en décembre
    expect(sunStateAt(17, START_LAT, dayOfYear(6, 21)).daylight).toBe(1); // 17 h : plein jour en juin
  });
});
