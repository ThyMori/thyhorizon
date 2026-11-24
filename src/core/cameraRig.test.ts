// Tests de la caméra à la troisième personne.
import { describe, expect, it } from 'vitest';
import { THIRD_DISTANCE, THIRD_SHOULDER, clampAboveGround, nextViewBlend, thirdPersonOffset, toggleView } from './cameraRig';

describe('caméra 3ᵉ personne', () => {
  it('bascule entre les deux vues', () => {
    expect(toggleView('first')).toBe('third');
    expect(toggleView('third')).toBe('first');
  });
  it('regard au nord à plat : la caméra est derrière (au sud, +z) et à droite (est, +x)', () => {
    const [x, y, z] = thirdPersonOffset(0, 0, THIRD_DISTANCE, THIRD_SHOULDER);
    expect(z).toBeCloseTo(THIRD_DISTANCE, 6);
    expect(x).toBeCloseTo(THIRD_SHOULDER, 6);
    expect(y).toBeCloseTo(0, 6);
  });
  it('regard vers l\'est (yaw = −π/2) : la caméra est à l\'ouest ; à droite = sud', () => {
    const [x, , z] = thirdPersonOffset(-Math.PI / 2, 0, 3, 0.5);
    expect(x).toBeCloseTo(-3, 6);
    expect(z).toBeCloseTo(0.5, 6); // la droite d'un joueur qui regarde l'est est le sud (+z)
  });
  it('regard vers le haut : la caméra passe plus bas ; vers le bas : plus haut', () => {
    expect(thirdPersonOffset(0, 0.5, 3, 0)[1]).toBeLessThan(0);
    expect(thirdPersonOffset(0, -0.5, 3, 0)[1]).toBeGreaterThan(0);
  });
  it('la distance de recul est respectée dans toutes les directions', () => {
    for (const [yaw, pitch] of [[0, 0], [1, 0.4], [-2, -0.7], [3, 1.2]] as const) {
      const [x, y, z] = thirdPersonOffset(yaw, pitch, 3.4, 0);
      expect(Math.hypot(x, y, z)).toBeCloseTo(3.4, 6);
    }
  });
  it('le fondu arrive à sa cible sans osciller ni rester bloqué', () => {
    let b = 0;
    for (let k = 0; k < 200; k++) b = nextViewBlend(b, 'third', 0.016);
    expect(b).toBe(1);
    for (let k = 0; k < 200; k++) {
      const nb = nextViewBlend(b, 'first', 0.016);
      expect(nb).toBeLessThanOrEqual(b);
      b = nb;
    }
    expect(b).toBe(0);
    expect(nextViewBlend(0.3, 'third', 0)).toBeCloseTo(0.3, 9);
  });
  it('la caméra ne passe pas sous le sol ni sous la mer', () => {
    expect(clampAboveGround(2, 10)).toBeCloseTo(10.35, 6);
    expect(clampAboveGround(20, 10)).toBe(20);
    expect(clampAboveGround(-3, -50)).toBeCloseTo(0.35, 6); // en mer : niveau 0
  });
});
