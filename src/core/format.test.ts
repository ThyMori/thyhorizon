// Tests de la mise en forme des textes de l'interface.
import { describe, expect, it } from 'vitest';
import { formatCount, formatDistance, formatHours } from './format';

describe('formatHours', () => {
  it('écrit l\'heure en français', () => {
    expect(formatHours(17.4)).toBe('17 h 24');
    expect(formatHours(0)).toBe('0 h 00');
    expect(formatHours(6.5)).toBe('6 h 30');
  });
  it('boucle à minuit et gère les valeurs hors bornes', () => {
    expect(formatHours(23.999)).toBe('0 h 00'); // arrondi à la minute : minuit
    expect(formatHours(25)).toBe('1 h 00');
    expect(formatHours(-1)).toBe('23 h 00');
  });
});

describe('formatDistance', () => {
  it('passe des mètres aux kilomètres', () => {
    expect(formatDistance(14)).toBe('896 m');
    expect(formatDistance(20)).toBe('1,3 km');
  });
});

describe('formatCount', () => {
  it('sépare les milliers', () => {
    expect(formatCount(1234567)).toBe('1 234 567');
    expect(formatCount(999)).toBe('999');
  });
});
