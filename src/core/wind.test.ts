import { describe, expect, it } from 'vitest';
import { START_LAT, START_LON } from './geo';
import { beaufort, beaufortName, msToKnots, windAt, windVelocity } from './wind';

const deg = (r: number): number => (r * 180) / Math.PI; // radians → degrés

describe('windAt', () => {
  it('est déterministe', () => {
    expect(windAt(48, -3, 1234)).toEqual(windAt(48, -3, 1234));
  });
  it('reste dans des limites raisonnables et une direction 0..2π', () => {
    for (let i = 0; i < 400; i++) {
      const w = windAt(-80 + (i * 7.3) % 160, -180 + (i * 13.1) % 360, i * 977);
      expect(w.speed).toBeGreaterThanOrEqual(0.5);
      expect(w.speed).toBeLessThanOrEqual(28);
      expect(w.from).toBeGreaterThanOrEqual(0);
      expect(w.from).toBeLessThan(2 * Math.PI);
    }
  });
  it('souffle d\'ouest aux latitudes moyennes (Manche) — en moyenne', () => {
    let east = 0; // composante moyenne vers l'est
    for (let i = 0; i < 200; i++) east += windVelocity(windAt(START_LAT, START_LON, i * 3000)).x;
    expect(east / 200).toBeGreaterThan(1); // les vents d'ouest poussent vers l'est
  });
  it('souffle d\'est dans les alizés (15° N et 15° S)', () => {
    for (const lat of [15, -15]) {
      let east = 0;
      for (let i = 0; i < 200; i++) east += windVelocity(windAt(lat, -40, i * 3000)).x;
      expect(east / 200).toBeLessThan(-1);
    }
  });
  it('alizés du nord-est au nord, du sud-est au sud (vent qui vient vers l\'équateur)', () => {
    let nVel = 0;
    let sVel = 0;
    for (let i = 0; i < 200; i++) {
      nVel += windVelocity(windAt(15, -40, i * 3000)).z; // z > 0 = vers le sud
      sVel += windVelocity(windAt(-15, -40, i * 3000)).z;
    }
    expect(nVel).toBeGreaterThan(0); // vers le sud (équateur) dans l'hémisphère nord
    expect(sVel).toBeLessThan(0); // vers le nord (équateur) dans l'hémisphère sud
  });
  it('varie peu d\'un instant à l\'autre (continuité) mais change sur plusieurs heures', () => {
    const a = windAt(48, -3, 0);
    const b = windAt(48, -3, 1);
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(0.8); // pas de saut en 1 s
    let maxDiff = 0;
    for (let h = 1; h < 24; h++) maxDiff = Math.max(maxDiff, Math.abs(windAt(48, -3, h * 3600).speed - a.speed));
    expect(maxDiff).toBeGreaterThan(0.5); // la météo évolue dans la journée
  });
  it('donne une direction cohérente avec la vitesse vectorielle', () => {
    const w = windAt(48, -3, 500);
    const v = windVelocity(w);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(w.speed, 6);
    // Le vent vient de la direction « from » : il souffle donc dans le sens opposé.
    expect(deg(Math.atan2(-v.x, v.z) + 2 * Math.PI) % 360).toBeCloseTo(deg(w.from) % 360, 4);
  });
});

describe('Beaufort et nœuds', () => {
  it('convertit les nœuds', () => {
    expect(msToKnots(1)).toBeCloseTo(1.944, 2);
  });
  it('classe la force du vent', () => {
    expect(beaufort(0)).toBe(0);
    expect(beaufort(4)).toBe(3);
    expect(beaufort(9)).toBe(5);
    expect(beaufort(40)).toBe(12);
    expect(beaufortName(4)).toBe('jolie brise');
  });
});
