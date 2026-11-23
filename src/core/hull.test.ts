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

import { LAYOUT, cabinHalfWidth, rakeShift, roofHeight, stationOf } from './hull';

describe('plan du bateau', () => {
  it('le rouf et le cockpit restent à l\'intérieur de la coque, avec un passavant', () => {
    const c = LAYOUT.cabin;
    for (let i = 0; i <= 20; i++) {
      const u = c.u0 + ((c.u1 - c.u0) * i) / 20;
      expect(halfBeam(CRUISER, stationOf(CRUISER, u)) - cabinHalfWidth(u)).toBeGreaterThan(0.3); // 30 cm au moins pour passer sur le côté
    }
    for (const u of [LAYOUT.cockpit.u0, LAYOUT.cockpit.u1]) expect(halfBeam(CRUISER, stationOf(CRUISER, u)) - LAYOUT.cockpit.half).toBeGreaterThan(0.3);
  });
  it('le barreur est dans le cockpit, devant la roue', () => {
    expect(CRUISER.eyeU).toBeGreaterThan(LAYOUT.cockpit.u0);
    expect(CRUISER.eyeU).toBeLessThan(LAYOUT.wheelU); // les yeux sont derrière la roue
    expect(LAYOUT.wheelU - CRUISER.eyeU).toBeGreaterThan(0.55); // au-delà du plan proche de la caméra
  });
  it('le plancher du cockpit est sous le pont et au-dessus de l\'eau', () => {
    expect(LAYOUT.cockpit.floor).toBeGreaterThan(0.2);
    expect(LAYOUT.cockpit.floor).toBeLessThan(deckHeight(stationOf(CRUISER, LAYOUT.cockpit.u0)) - 0.2);
  });
  it('le rouf est au-dessus du pont et descend vers l\'avant', () => {
    expect(roofHeight(CRUISER, LAYOUT.cabin.u0)).toBeGreaterThan(deckHeight(stationOf(CRUISER, LAYOUT.cabin.u0)));
    expect(roofHeight(CRUISER, LAYOUT.cabin.u1)).toBeLessThan(roofHeight(CRUISER, LAYOUT.cabin.u0) + 0.1);
  });
  it('l\'étrave est inclinée : le bas recule, le pont non, l\'arrière non', () => {
    expect(rakeShift(1, 0)).toBeLessThan(-0.3);
    expect(rakeShift(1, 1)).toBeCloseTo(0, 9);
    expect(rakeShift(0.3, 0)).toBeCloseTo(0, 9);
  });
});
