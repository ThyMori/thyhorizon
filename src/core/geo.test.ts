// Tests de la géographie : dates, déclinaison, position du soleil, lever et coucher.
import { describe, expect, it } from 'vitest';
import { START_LAT, dayOfYear, dayOfYearFromDate, declinationDeg, formatDay, siderealAngleDeg, skyRotation, startHours, sunPosition, sunRightAscensionDeg, sunriseSunset, wrapDay } from './geo';

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

describe('rotation du ciel étoilé', () => {
  type V3 = [number, number, number];
  const apply = (m: number[], v: V3): V3 => [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]];
  const equatorial = (raDeg: number, decDeg: number): V3 => {
    const [a, d] = [(raDeg * Math.PI) / 180, (decDeg * Math.PI) / 180];
    return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
  };
  const elevation = (v: V3): number => (Math.asin(v[1]) * 180) / Math.PI;

  it('est une vraie rotation (orthonormée, déterminant 1)', () => {
    const m = skyRotation(START_LAT, 200, 9.3);
    const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(rows[i]!.reduce((s, v, k) => s + v * rows[j]![k]!, 0)).toBeCloseTo(i === j ? 1 : 0, 9);
    const det = m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    expect(det).toBeCloseTo(1, 9);
  });
  it('place le soleil exactement là où le calcul du soleil le met (même ciel, mêmes jour et heure)', () => {
    for (const [day, h] of [[327, 15.3], [172, 20], [355, 12], [80, 6.5]] as const) {
      const sun = equatorial(sunRightAscensionDeg(day), declinationDeg(day));
      const viaSky = apply(skyRotation(START_LAT, day, h), sun);
      const direct = sunPosition(START_LAT, day, h).direction;
      for (let k = 0; k < 3; k++) expect(viaSky[k]!).toBeCloseTo(direct[k]!, 6);
    }
  });
  it('garde l\'étoile Polaire à une hauteur égale à la latitude, au nord, à toute heure', () => {
    for (const h of [0, 5, 12, 19]) {
      const polaris = apply(skyRotation(START_LAT, 327, h), equatorial(37.95, 89.26));
      expect(Math.abs(elevation(polaris) - START_LAT)).toBeLessThan(1.5);
      expect(polaris[2]).toBeLessThan(0); // z < 0 : au nord
    }
  });
  it('fait culminer Sirius au sud à 90° − latitude + déclinaison quand l\'angle sidéral égale son ascension droite', () => {
    // on cherche l'heure solaire où l'angle sidéral vaut l'ascension droite de Sirius (101,29°)
    const day = 327;
    const h = 12 + (((101.287 - sunRightAscensionDeg(day)) % 360) + 360) % 360 / 15;
    const sirius = apply(skyRotation(START_LAT, day, h % 24), equatorial(101.287, -16.716));
    expect(elevation(sirius)).toBeCloseTo(90 - START_LAT - 16.716, 1);
    expect(sirius[2]).toBeGreaterThan(0); // au sud
    expect(Math.abs(sirius[0])).toBeLessThan(0.02); // exactement sur le méridien
  });
  it('tourne en un jour sidéral : 15° par heure environ, et le ciel avance de ~1° par jour', () => {
    expect(siderealAngleDeg(100, 13) - siderealAngleDeg(100, 12)).toBeCloseTo(15, 6);
    const drift = (siderealAngleDeg(101, 12) - siderealAngleDeg(100, 12) + 360) % 360;
    expect(drift).toBeGreaterThan(0.9);
    expect(drift).toBeLessThan(1.1);
  });
});
