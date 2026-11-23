import { describe, expect, it } from 'vitest';
import { HELM_POS, deckStep, deckSurface, moveOnDeck, nearHelm, walkable } from './deck';
import { LAYOUT } from './hull';
import { CRUISER } from './sailing';

describe('pont', () => {
  it('on peut se tenir au poste de barre et dans le cockpit', () => {
    expect(walkable(CRUISER, HELM_POS.u, HELM_POS.v)).toBe(true);
    expect(walkable(CRUISER, -2, 0.3)).toBe(true);
  });
  it('on ne traverse pas le rouf, ni la roue, ni la coque', () => {
    expect(walkable(CRUISER, 0.5, 0)).toBe(false); // sur le rouf
    expect(walkable(CRUISER, LAYOUT.wheelU, 0)).toBe(false); // dans la roue
    expect(walkable(CRUISER, -1, 5)).toBe(false); // à l'eau
    expect(walkable(CRUISER, 20, 0)).toBe(false); // bien devant l'étrave
  });
  it('les passavants et la plage avant sont praticables', () => {
    expect(walkable(CRUISER, 0.5, 1.25)).toBe(true); // passavant tribord
    expect(walkable(CRUISER, 0.5, -1.25)).toBe(true); // passavant bâbord
    expect(walkable(CRUISER, 3.2, 0)).toBe(true); // plage avant
  });
  it('on glisse le long du rouf au lieu de s’arrêter net', () => {
    expect(walkable(CRUISER, -0.9, 0.6)).toBe(false); // le pas complet entre dans le rouf…
    const p = moveOnDeck(CRUISER, { u: -1.2, v: 0.9 }, 0.3, -0.3);
    expect(p.u).toBe(-1.2); // …on ne garde que le glissement possible (sur v)
    expect(p.v).toBeCloseTo(0.6, 9);
  });
  it('le plancher du cockpit est plus bas que le pont', () => {
    expect(deckSurface(CRUISER, -2, 0)).toBeLessThan(deckSurface(CRUISER, 0.5, 1.25));
  });
  it('la roue se reprend de près seulement', () => {
    expect(nearHelm(HELM_POS)).toBe(true);
    expect(nearHelm({ u: 3, v: 0 })).toBe(false);
  });
  it('le déplacement suit le regard : regard vers l’avant, avancer = aller à l’avant', () => {
    const s = deckStep(0, 1, 0, 0.1);
    expect(s.du).toBeCloseTo(0.1, 6);
    expect(Math.abs(s.dv)).toBeLessThan(1e-9);
  });
  it('regard vers bâbord (yaw +90°), avancer = aller à bâbord', () => {
    const s = deckStep(Math.PI / 2, 1, 0, 0.1);
    expect(s.dv).toBeCloseTo(-0.1, 6); // bâbord = v négatif
    expect(Math.abs(s.du)).toBeLessThan(1e-9);
  });
  it('en diagonale, pas plus vite qu’en ligne droite', () => {
    const s = deckStep(0, 1, 1, 0.1);
    expect(Math.hypot(s.du, s.dv)).toBeCloseTo(0.1, 6);
  });
});
