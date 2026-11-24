// Tests des styles de village : chaque climat connu a un style cohérent.
import { describe, expect, it } from 'vitest';
import { BIOMES } from './climate';
import { STYLES, styleForClass } from './villageStyle';

describe('styles de village', () => {
  it('Lannion (Cfb) : style atlantique, toit pentu', () => {
    const s = styleForClass('Cfb');
    expect(s.id).toBe('atlantic');
    expect(s.roof).toBe('gable');
    expect(s.pitch).toBeGreaterThan(0.6);
  });
  it('quelques régions typiques', () => {
    expect(styleForClass('Csa').id).toBe('mediterranean');
    expect(styleForClass('Cfa').id).toBe('mediterranean');
    expect(styleForClass('Dfc').id).toBe('continental');
    expect(styleForClass('BWh').id).toBe('arid');
    expect(styleForClass('BWh').roof).toBe('flat');
    expect(styleForClass('Af').id).toBe('tropical');
    expect(styleForClass('Cwa').id).toBe('tropical');
    expect(styleForClass('ET').id).toBe('polar');
    expect(styleForClass('EF').id).toBe('polar');
  });
  it('une classe inconnue retombe sur le style atlantique', () => {
    expect(styleForClass('Zz').id).toBe('atlantic');
    expect(styleForClass('').id).toBe('atlantic');
  });
  it('toutes les classes du jeu ont un style complet et des couleurs valides', () => {
    for (const k of Object.keys(BIOMES)) {
      const s = styleForClass(k);
      expect(STYLES[s.id]).toBe(s);
      expect(s.walls.length).toBeGreaterThan(1);
      expect(s.roofs.length).toBeGreaterThan(0);
      for (const c of [...s.walls, ...s.roofs, s.window, s.door]) for (const v of c) expect(v >= 0 && v <= 1).toBe(true);
      expect(s.storyHeight).toBeGreaterThan(2);
      expect(s.maxStories).toBeGreaterThanOrEqual(1);
      if (s.roof !== 'flat') expect(s.pitch).toBeGreaterThan(0.2);
    }
  });
});
