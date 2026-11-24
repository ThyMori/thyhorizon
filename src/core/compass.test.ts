// Tests de la boussole : cap, inertie, chemin le plus court, noms des directions.
import { describe, expect, it } from 'vitest';
import { bearingFromYaw, cardinal16, compassText, headingDegrees, newCompass, stepCompass, wrapPi } from './compass';

const DEG = Math.PI / 180;

describe('cap', () => {
  it('le yaw du jeu donne le bon cap : nord, ouest, sud, est', () => {
    expect(headingDegrees(bearingFromYaw(0))).toBe(0); // yaw 0 regarde le nord
    expect(headingDegrees(bearingFromYaw(Math.PI / 2))).toBe(270); // yaw π/2 regarde l'ouest
    expect(headingDegrees(bearingFromYaw(Math.PI))).toBe(180);
    expect(headingDegrees(bearingFromYaw(-Math.PI / 2))).toBe(90); // yaw négatif : l'est
  });
  it('noms des directions', () => {
    expect(cardinal16(0)).toBe('N');
    expect(cardinal16(90 * DEG)).toBe('E');
    expect(cardinal16(180 * DEG)).toBe('S');
    expect(cardinal16(270 * DEG)).toBe('O');
    expect(cardinal16(45 * DEG)).toBe('NE');
    expect(cardinal16(359 * DEG)).toBe('N');
    expect(cardinal16(-10 * DEG)).toBe('N');
  });
  it('texte : direction et degrés sur trois chiffres', () => {
    expect(compassText(47 * DEG)).toBe('NE · 047°');
    expect(compassText(0)).toBe('N · 000°');
  });
});

describe('rose', () => {
  it('au départ, le nord est à l\'opposé du cap', () => {
    expect(newCompass(90 * DEG).card).toBeCloseTo(-90 * DEG, 6); // face à l'est, le nord est à gauche
  });
  it('se cale sur le nord après quelques secondes', () => {
    let s = newCompass(0);
    for (let k = 0; k < 400; k++) s = stepCompass(s, 120 * DEG, 0.01); // on se tourne d'un coup vers 120°
    expect(Math.abs(wrapPi(s.card - -120 * DEG))).toBeLessThan(0.5 * DEG);
    expect(Math.abs(s.vel)).toBeLessThan(0.01);
  });
  it('dépasse un peu sa position (rose dans un liquide) mais pas trop', () => {
    let s = newCompass(0);
    let overshoot = 0;
    for (let k = 0; k < 300; k++) {
      s = stepCompass(s, 90 * DEG, 0.01);
      overshoot = Math.max(overshoot, Math.abs(wrapPi(s.card - -90 * DEG)));
    }
    // elle part de 0 et vise −90° : on mesure surtout qu'elle ne s'emballe pas
    expect(overshoot).toBeLessThan(95 * DEG);
    let s2 = newCompass(0);
    let past = 0;
    for (let k = 0; k < 300; k++) {
      s2 = stepCompass(s2, 90 * DEG, 0.01);
      past = Math.max(past, -90 * DEG - s2.card); // dépassement de la cible (vers les angles plus négatifs)
    }
    expect(past).toBeGreaterThan(0); // elle dépasse un peu
    expect(past).toBeLessThan(20 * DEG); // mais moins de 20° sur 90°
  });
  it('prend le chemin le plus court en passant par le nord', () => {
    let s = newCompass(359 * DEG);
    s = stepCompass(s, 1 * DEG, 0.05);
    expect(Math.abs(s.card)).toBeLessThan(5 * DEG); // 2° d'écart seulement, pas un tour de 358°
  });
  it('reste stable avec un énorme pas de temps ou un dt nul/négatif', () => {
    let s = newCompass(0);
    s = stepCompass(s, 1, 100);
    expect(Number.isFinite(s.card) && Number.isFinite(s.vel)).toBe(true);
    const t = stepCompass(s, 1, 0);
    expect(t).toEqual(s);
    expect(stepCompass(s, 1, -5)).toEqual(s);
  });
  it('les secousses déplacent un peu la rose', () => {
    let a = newCompass(0);
    let b = newCompass(0);
    for (let k = 0; k < 300; k++) {
      a = stepCompass(a, 0, 0.01, 0);
      b = stepCompass(b, 0, 0.01, 0.05);
    }
    expect(Math.abs(b.card - a.card)).toBeGreaterThan(0.03);
  });
});
