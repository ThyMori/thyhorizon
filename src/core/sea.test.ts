import { describe, expect, it } from 'vitest';
import { BASE_HS, approachSea, seaName, seaStateFor, swellHs, waveScales, windSeaHs } from './sea';
import { waveHeight } from './waves';

describe('mer', () => {
  it('la mer du vent grandit avec le carré de la vitesse', () => {
    expect(windSeaHs(5)).toBeLessThan(windSeaHs(10));
    expect(windSeaHs(10)).toBeCloseTo(windSeaHs(5) * 4, 0);
    expect(windSeaHs(0)).toBeGreaterThan(0);
    expect(windSeaHs(60)).toBeLessThanOrEqual(7);
  });
  it('à 14 nœuds de vent, la mer est proche de la mer de base', () => {
    const s = seaStateFor(7.2, 0, 45);
    expect(s.hs).toBeGreaterThan(1.1);
    expect(s.hs).toBeLessThan(2.4);
  });
  it('une dépression apporte plus de houle, surtout hors des tropiques', () => {
    expect(swellHs(1, 50)).toBeGreaterThan(swellHs(-0.5, 50) * 2);
    expect(swellHs(0.5, 50)).toBeGreaterThan(swellHs(0.5, 2));
  });
  it('les moutons arrivent avec le vent : aucun en dessous de 5 m/s, beaucoup à 14', () => {
    expect(seaStateFor(4, 0, 45).foam).toBe(0);
    expect(seaStateFor(14, 0, 45).foam).toBeGreaterThan(0.8);
  });
  it('la mer réagit lentement à un coup de vent, puis retombe', () => {
    let s = seaStateFor(3, -0.3, 45);
    const storm = seaStateFor(18, 1, 45);
    const hs0 = s.hs;
    for (let t = 0; t < 30; t++) s = approachSea(s, storm, 1); // 30 s de tempête
    expect(s.hs).toBeGreaterThan(hs0);
    expect(s.hs).toBeLessThan(storm.hs * 0.5); // loin d'avoir atteint l'équilibre
    for (let t = 0; t < 1200; t++) s = approachSea(s, storm, 1); // 20 minutes
    expect(s.hs).toBeGreaterThan(storm.hs * 0.9);
  });
  it('les facteurs de vagues : 3 larges puis 3 petites', () => {
    const s = seaStateFor(10, 0.5, 48);
    const f = waveScales(s);
    expect(f).toHaveLength(6);
    expect(f[0]).toBe(s.swell);
    expect(f[5]).toBe(s.chop);
  });
  it('la hauteur des vagues calculée suit le facteur de houle', () => {
    let calm = 0;
    let rough = 0;
    for (let x = 0; x < 400; x += 3) {
      calm = Math.max(calm, Math.abs(waveHeight(x, 10, 5, 0.4)));
      rough = Math.max(rough, Math.abs(waveHeight(x, 10, 5, 2)));
    }
    expect(rough).toBeGreaterThan(calm * 3);
    expect(waveHeight(12, 34, 5, 1)).toBeCloseTo(waveHeight(12, 34, 5), 12); // sans facteur = facteur 1
  });
  it('la mer de base correspond bien à BASE_HS', () => {
    // hauteur significative = 4 × écart-type ; pour des sinusoïdes d'amplitudes a : 4·√(Σa²/2)
    expect(BASE_HS).toBeCloseTo(4 * Math.sqrt((0.35 ** 2 + 0.22 ** 2 + 0.12 ** 2) / 2), 1);
  });
  it('nomme les états de mer', () => {
    expect(seaName(0.05)).toBe('mer d’huile');
    expect(seaName(1)).toBe('mer belle');
    expect(seaName(5)).toBe('mer forte');
  });
});
