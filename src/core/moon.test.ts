// Tests de la Lune : phases connues (nouvelles et pleines lunes réelles), position et mouvement cohérents.
import { describe, expect, it } from 'vitest';
import { START_LAT, START_LON, sunPosition } from './geo';
import { julianDay, moonPhase, moonRiseSet, moonState, phaseName } from './moon';

// Instants réels (UT) connus : nouvelle lune 2024-01-11 11:57, premier quartier 2024-01-18 03:53, pleine lune 2024-01-25 17:54, dernier quartier 2024-02-02 23:18.
const jd = (y: number, m: number, d: number, h: number): number => Date.UTC(y, m - 1, d, h) / 86400000 + 2440587.5;

describe('phases de la Lune (dates réelles)', () => {
  it('nouvelle lune du 11 janvier 2024', () => expect(moonPhase(jd(2024, 1, 11, 12)).illumination).toBeLessThan(0.01));
  it('pleine lune du 25 janvier 2024', () => expect(moonPhase(jd(2024, 1, 25, 18)).illumination).toBeGreaterThan(0.99));
  it('premier quartier du 18 janvier 2024', () => {
    const p = moonPhase(jd(2024, 1, 18, 4));
    expect(Math.abs(p.elongation - 90)).toBeLessThan(4);
    expect(p.name).toBe('premier quartier');
  });
  it('dernier quartier du 2 février 2024', () => expect(Math.abs(moonPhase(jd(2024, 2, 2, 23)).elongation - 270)).toBeLessThan(4));
  it('nouvelle lune du 6 janvier 2000 (18 h 14)', () => expect(moonPhase(jd(2000, 1, 6, 18.2)).illumination).toBeLessThan(0.01));
  it('le cycle dure environ 29,5 jours', () => {
    const a = moonPhase(jd(2024, 1, 11, 12)).elongation; // nouvelle
    const b = moonPhase(jd(2024, 2, 9, 23)).elongation; // la suivante (9 février 2024, 22 h 59)
    const d = Math.abs(((b - a + 540) % 360) - 180);
    expect(d).toBeLessThan(4);
  });
  it('noms des phases', () => {
    expect(phaseName(0)).toBe('nouvelle lune');
    expect(phaseName(180)).toBe('pleine lune');
    expect(phaseName(270)).toBe('dernier quartier');
    expect(phaseName(45)).toBe('premier croissant');
  });
});

describe('position dans le ciel', () => {
  const day = (m: number, d: number): number => Math.round((Date.UTC(2024, m - 1, d) - Date.UTC(2024, 0, 1)) / 86400000) + 1;
  it('la pleine lune d’hiver est haute à minuit et au sud', () => {
    const m = moonState(START_LAT, START_LON, day(1, 25), 0.5 + 0, 2024); // ≈ minuit solaire local, quelques heures après la pleine lune
    expect(m.elevationDeg).toBeGreaterThan(45);
  });
  it('la pleine lune d’été est basse', () => {
    const d = day(6, 22); // pleine lune du 22 juin 2024
    let max = -90;
    for (let h = 0; h < 24; h += 0.25) max = Math.max(max, moonState(START_LAT, START_LON, d, h, 2024).elevationDeg);
    expect(max).toBeLessThan(30);
  });
  it('la nouvelle lune est près du soleil dans le ciel', () => {
    const d = day(1, 11);
    const m = moonState(START_LAT, START_LON, d, 12, 2024);
    const s = sunPosition(START_LAT, d, 12).direction;
    const dot = m.direction[0] * s[0] + m.direction[1] * s[1] + m.direction[2] * s[2];
    expect((Math.acos(Math.min(1, dot)) * 180) / Math.PI).toBeLessThan(8); // quelques degrés au plus (la Lune passe à côté, sans éclipse)
  });
  it('la pleine lune est à l’opposé du soleil', () => {
    const d = day(1, 25);
    const m = moonState(START_LAT, START_LON, d, 18 - START_LON / 15, 2024);
    const s = sunPosition(START_LAT, d, 18 - START_LON / 15).direction;
    const dot = m.direction[0] * s[0] + m.direction[1] * s[1] + m.direction[2] * s[2];
    expect(dot).toBeLessThan(-0.9);
  });
  it('la Lune se lève à l’est et se couche à l’ouest', () => {
    const d = day(1, 18); // premier quartier : visible l'après-midi et le soir
    const rs = moonRiseSet(START_LAT, START_LON, d, 2024);
    expect(rs.rise).not.toBeNull();
    const rise = moonState(START_LAT, START_LON, d, rs.rise! + 0.3, 2024);
    expect(rise.direction[0]).toBeGreaterThan(0); // +x = est
    expect(rise.elevationDeg).toBeGreaterThan(0);
  });
  it('le lever recule d’environ 50 minutes par jour', () => {
    const a = moonRiseSet(START_LAT, START_LON, day(1, 18), 2024).rise!;
    const b = moonRiseSet(START_LAT, START_LON, day(1, 19), 2024).rise!;
    const diff = (((b - a) % 24) + 24) % 24; // en heures
    expect(diff).toBeGreaterThan(0.1); // le retard varie de ~20 à ~90 min selon la déclinaison de la Lune
    expect(diff).toBeLessThan(1.7);
  });
  it('le vecteur direction est unitaire et la hauteur cohérente', () => {
    const m = moonState(-33, 151, 100, 3, 2025);
    expect(Math.hypot(...m.direction)).toBeCloseTo(1, 6);
    expect(m.direction[1]).toBeCloseTo(Math.sin((m.elevationDeg * Math.PI) / 180), 6);
  });
  it('jour julien : 1er janvier 2000 à 12 h UT = 2451545', () => expect(julianDay(2000, 1, 12)).toBeCloseTo(2451545, 6));
});
