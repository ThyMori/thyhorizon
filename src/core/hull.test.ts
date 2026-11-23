import { describe, expect, it } from 'vitest';
import { bottomHeight, deckHeight, halfBeam } from './hull';
import { CRUISER } from './sailing';

describe('forme de la coque', () => {
  it('la largeur ne dépasse jamais la largeur du bateau et se ferme à l\'étrave', () => {
    for (let i = 0; i <= 50; i++) expect(halfBeam(CRUISER, i / 50)).toBeLessThanOrEqual(CRUISER.beam / 2 + 1e-9);
    expect(halfBeam(CRUISER, 1)).toBeCloseTo(0, 6);
    expect(halfBeam(CRUISER, 0.42)).toBeCloseTo(CRUISER.beam / 2, 6); // maître-bau
  });
  it('le tableau arrière est large (pas pointu)', () => {
    expect(halfBeam(CRUISER, 0)).toBeGreaterThan(CRUISER.beam * 0.3);
  });
  it('le pont est toujours au-dessus du fond et au-dessus de l\'eau', () => {
    for (let i = 0; i <= 50; i++) {
      const s = i / 50;
      expect(deckHeight(s)).toBeGreaterThan(0.5);
      expect(bottomHeight(s)).toBeLessThan(0);
      expect(deckHeight(s)).toBeGreaterThan(bottomHeight(s));
    }
  });
  it('le fond reste au-dessus du tirant d\'eau (la quille dépasse)', () => {
    for (let i = 0; i <= 50; i++) expect(-bottomHeight(i / 50)).toBeLessThan(CRUISER.draft);
  });
});
