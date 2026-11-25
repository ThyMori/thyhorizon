// Tests de la mise en forme des textes de l'interface.
import { describe, expect, it } from 'vitest';
import { formatCoords, formatCount, formatDistance, formatHours } from './format';

describe('formatCoords', () => {
  it('écrit latitude et longitude avec leurs points cardinaux', () => {
    expect(formatCoords(48.73, -3.46)).toBe('48,73° N, 3,46° O');
    expect(formatCoords(48.73, -3.46, 4)).toBe('48,7300° N, 3,4600° O'); // plus de précision quand on zoome
    expect(formatCoords(-33.9, 151.2)).toBe('33,90° S, 151,20° E');
  });
});

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
