// Tests des commandes tactiles : joystick, regard, côté de l'écran.
import { describe, expect, it } from 'vitest';
import { JOYSTICK_RADIUS, isLeftSide, joystick, touchLookDelta } from './touch';

describe('joystick', () => {
  it('ne bouge pas dans la zone morte', () => {
    const j = joystick(3, -3);
    expect(j.forward).toBe(0);
    expect(j.right).toBe(0);
  });
  it('avance quand le doigt monte et recule quand il descend', () => {
    expect(joystick(0, -40).forward).toBeGreaterThan(0);
    expect(joystick(0, 40).forward).toBeLessThan(0);
  });
  it('va à droite quand le doigt va à droite', () => {
    const j = joystick(40, 0);
    expect(j.right).toBeGreaterThan(0);
    expect(j.forward).toBeCloseTo(0);
  });
  it('plafonne à 1 et ramène le bouton dans le cercle', () => {
    const j = joystick(500, 0);
    expect(j.right).toBeCloseTo(1);
    expect(Math.hypot(j.knobX, j.knobY)).toBeCloseTo(JOYSTICK_RADIUS);
    expect(j.full).toBe(true);
  });
  it('augmente progressivement avec la course', () => {
    expect(joystick(0, -40).forward).toBeGreaterThan(joystick(0, -20).forward);
  });
  it('ne court pas quand il n\'est pas poussé à fond', () => {
    expect(joystick(0, -30).full).toBe(false);
  });
  it('garde une intention de longueur 1 au maximum en diagonale', () => {
    const j = joystick(300, -300);
    expect(Math.hypot(j.forward, j.right)).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('touchLookDelta', () => {
  it('tourne dans le même sens que la souris', () => {
    expect(touchLookDelta(10, 0, 1)[0]).toBeLessThan(0); // doigt à droite : cap diminue (tourne à droite)
    expect(touchLookDelta(0, -10, 1)[1]).toBeGreaterThan(0); // doigt en haut : regarde en haut
  });
  it('suit la sensibilité', () => {
    expect(touchLookDelta(10, 0, 2)[0]).toBeCloseTo(2 * touchLookDelta(10, 0, 1)[0]);
  });
});

describe('isLeftSide', () => {
  it('sépare l\'écran en deux moitiés', () => {
    expect(isLeftSide(100, 400)).toBe(true);
    expect(isLeftSide(300, 400)).toBe(false);
  });
});
