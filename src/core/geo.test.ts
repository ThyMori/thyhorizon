// Tests de la géographie : dates, déclinaison, position du soleil, lever et coucher.
import { describe, expect, it } from 'vitest';
import { START_LAT, dayOfYear, dayOfYearFromDate, declinationDeg, formatDay, startHours, sunPosition, sunriseSunset, wrapDay } from './geo';

describe('calendrier', () => {
  it('numérote les jours de l\'année', () => {
    expect(dayOfYear(1, 1)).toBe(1);
    expect(dayOfYear(12, 31)).toBe(365);
    expect(dayOfYear(11, 23)).toBe(327);
    expect(dayOfYear(2, 29)).toBe(59); // le 29 février compte comme le 28
    expect(dayOfYearFromDate(new Date(2026, 5, 21))).toBe(172);
  });
  it('boucle sur l\'année', () => {
    expect(wrapDay(366)).toBe(1);
    expect(wrapDay(0)).toBe(365);
    expect(wrapDay(100)).toBe(100);
  });
  it('écrit la date en français', () => {
    expect(formatDay(327)).toBe('23 nov.');
    expect(formatDay(1)).toBe('1 janv.');
    expect(formatDay(365)).toBe('31 déc.');
  });
});

describe('déclinaison', () => {
  it('vaut ±23,4° aux solstices et ~0° aux équinoxes', () => {
    expect(declinationDeg(dayOfYear(6, 21))).toBeCloseTo(23.4, 0);
    expect(declinationDeg(dayOfYear(12, 21))).toBeCloseTo(-23.4, 0);
    expect(Math.abs(declinationDeg(dayOfYear(3, 21)))).toBeLessThan(1);
  });
});

describe('position du soleil à Lannion', () => {
  const eq = dayOfYear(3, 21); // équinoxe
  const summer = dayOfYear(6, 21); // solstice d'été
  const winter = dayOfYear(12, 21); // solstice d'hiver
  it('culmine à 90° − latitude à l\'équinoxe, plein sud', () => {
    const s = sunPosition(START_LAT, eq, 12);
    expect(Math.abs(s.elevationDeg - (90 - START_LAT))).toBeLessThan(1); // à un degré près (formule simplifiée)
    expect(s.direction[2]).toBeGreaterThan(0); // +z = sud
  });
  it('est beaucoup plus haut en été qu\'en hiver (≈ 64,7° contre ≈ 17,8°)', () => {
    expect(sunPosition(START_LAT, summer, 12).elevationDeg).toBeCloseTo(64.7, 0);
    expect(sunPosition(START_LAT, winter, 12).elevationDeg).toBeCloseTo(17.8, 0);
  });
  it('se lève à l\'est le matin, se couche à l\'ouest le soir', () => {
    expect(sunPosition(START_LAT, eq, 8).direction[0]).toBeGreaterThan(0);
    expect(sunPosition(START_LAT, eq, 16).direction[0]).toBeLessThan(0);
  });
  it('se couche au nord-ouest en été et au sud-ouest en hiver', () => {
    const s = sunriseSunset(START_LAT, summer)!.sunset;
    expect(sunPosition(START_LAT, summer, s).direction[2]).toBeLessThan(0); // composante nord (z < 0)
    const w = sunriseSunset(START_LAT, winter)!.sunset;
    expect(sunPosition(START_LAT, winter, w).direction[2]).toBeGreaterThan(0); // composante sud
  });
  it('donne toujours un vecteur unitaire', () => {
    for (let h = 0; h < 24; h += 1.5) expect(Math.hypot(...sunPosition(START_LAT, 200, h).direction)).toBeCloseTo(1, 9);
  });
});

describe('lever et coucher', () => {
  it('donnent environ 8 h 15 de jour à Lannion au solstice d\'hiver et 16 h 20 en été', () => {
    const w = sunriseSunset(START_LAT, dayOfYear(12, 21))!;
    expect(w.sunset - w.sunrise).toBeCloseTo(8.3, 0);
    const s = sunriseSunset(START_LAT, dayOfYear(6, 21))!;
    expect(s.sunset - s.sunrise).toBeCloseTo(16.1, 0);
  });
  it('donnent 12 h de jour partout à l\'équinoxe', () => {
    const e = sunriseSunset(START_LAT, dayOfYear(3, 21))!;
    expect(e.sunset - e.sunrise).toBeCloseTo(12, 0);
  });
  it('signalent le jour polaire et la nuit polaire', () => {
    expect(sunriseSunset(80, dayOfYear(6, 21))).toBeNull();
    expect(sunriseSunset(80, dayOfYear(12, 21))).toBeNull();
    expect(sunriseSunset(0, 100)).not.toBeNull();
  });
  it('fait partir la partie une heure avant le coucher', () => {
    const d = dayOfYear(11, 23);
    expect(startHours(START_LAT, d)).toBeCloseTo(sunriseSunset(START_LAT, d)!.sunset - 1, 9);
    expect(startHours(80, dayOfYear(6, 21))).toBe(17.5);
  });
});
