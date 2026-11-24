// Tests du déplacement : directions, vitesse, blocage en eau profonde.
import { describe, expect, it } from 'vitest';
import { CROUCH_EYE_HEIGHT, CROUCH_SPEED, EYE_HEIGHT, RUN_SPEED, WALK_SPEED, flyDelta, isWalkable, smoothTo, stepWalk, keyLookDelta } from './movement';
import { hashSeed } from './noise';
import { createTerrain, findSpawn } from './terrain';
import { loadRealRelief } from './relief.testutil';

const terrain = createTerrain(hashSeed('horizon'), loadRealRelief());
const spawn = findSpawn(terrain);
const idle = { forward: 0, right: 0, run: false };

describe('stepWalk', () => {
  it('ne bouge pas sans entrée', () => {
    expect(stepWalk(terrain, spawn.x, spawn.z, 0, idle, 0.1)).toEqual({ x: spawn.x, z: spawn.z, blocked: false });
  });
  it('avance vers le nord quand yaw = 0 et vers l\'ouest quand yaw = π/2', () => {
    const n = stepWalk(terrain, spawn.x, spawn.z, 0, { ...idle, forward: 1 }, 1);
    expect(n.z).toBeCloseTo(spawn.z - WALK_SPEED, 5);
    expect(n.x).toBeCloseTo(spawn.x, 5);
    const w = stepWalk(terrain, spawn.x, spawn.z, Math.PI / 2, { ...idle, forward: 1 }, 1);
    expect(w.x).toBeCloseTo(spawn.x - WALK_SPEED, 5);
    expect(w.z).toBeCloseTo(spawn.z, 5);
  });
  it('fait un pas de côté à droite (est quand on regarde le nord)', () => {
    const r = stepWalk(terrain, spawn.x, spawn.z, 0, { ...idle, right: 1 }, 1);
    expect(r.x).toBeCloseTo(spawn.x + WALK_SPEED, 5);
  });
  it('court plus vite et ne va pas plus vite en diagonale', () => {
    const run = stepWalk(terrain, spawn.x, spawn.z, 0, { forward: 1, right: 0, run: true }, 1);
    expect(spawn.z - run.z).toBeCloseTo(RUN_SPEED, 5);
    const diag = stepWalk(terrain, spawn.x, spawn.z, 0, { forward: 1, right: 1, run: false }, 1);
    expect(Math.hypot(diag.x - spawn.x, diag.z - spawn.z)).toBeCloseTo(WALK_SPEED, 5);
  });
  it('est arrêté par l\'eau profonde', () => {
    // On avance vers l'ouest depuis le départ jusqu'à être bloqué : on ne doit jamais entrer en eau profonde.
    let x = spawn.x;
    let z = spawn.z;
    let blockedOnce = false;
    for (let i = 0; i < 3000; i++) {
      const r = stepWalk(terrain, x, z, Math.PI / 2, { forward: 1, right: 0, run: true }, 0.1);
      x = r.x;
      z = r.z;
      blockedOnce ||= r.blocked;
      expect(isWalkable(terrain, x, z)).toBe(true);
    }
    expect(blockedOnce).toBe(true); // on a bien fini par buter sur l'océan
  });
});

describe('flyDelta', () => {
  it('monte quand on regarde vers le haut en avançant', () => {
    const [, dy] = flyDelta(0, 0.5, { ...idle, forward: 1, up: 0 }, 1);
    expect(dy).toBeGreaterThan(0);
  });
  it('avance à l\'horizontale quand le regard est horizontal', () => {
    const [dx, dy, dz] = flyDelta(0, 0, { ...idle, forward: 1, up: 0 }, 1);
    expect(dy).toBeCloseTo(0);
    expect(dx).toBeCloseTo(0);
    expect(dz).toBeLessThan(0); // vers le nord
  });
});

describe('smoothTo', () => {
  it('se rapproche de la cible sans la dépasser', () => {
    const v = smoothTo(0, 10, 12, 0.016);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(10);
  });
});

describe('keyLookDelta', () => {
  it('tourne à gauche et à droite en sens opposés, proportionnellement au temps', () => {
    const [l] = keyLookDelta(1, 0, 0, 0, 1, 0.5);
    const [r] = keyLookDelta(0, 1, 0, 0, 1, 0.5);
    expect(l).toBeGreaterThan(0);
    expect(r).toBeCloseTo(-l);
  });
  it('ne bouge pas si rien n\'est pressé ou si deux flèches opposées le sont', () => {
    expect(keyLookDelta(0, 0, 0, 0, 1, 1)).toEqual([0, 0]);
    expect(keyLookDelta(1, 1, 1, 1, 1, 1)).toEqual([0, 0]);
  });
  it('lève la tête avec la flèche haut et suit la sensibilité', () => {
    const [, p1] = keyLookDelta(0, 0, 1, 0, 1, 1);
    const [, p2] = keyLookDelta(0, 0, 1, 0, 2, 1);
    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeCloseTo(2 * p1);
  });
});

describe('accroupi', () => {
  it('on avance plus lentement accroupi, même en courant', () => {
    const terrain = { heightAt: () => 10 } as unknown as Parameters<typeof stepWalk>[0];
    const walk = stepWalk(terrain, 0, 0, 0, { forward: 1, right: 0, run: false }, 1);
    const crouch = stepWalk(terrain, 0, 0, 0, { forward: 1, right: 0, run: true, crouch: true }, 1);
    expect(Math.abs(crouch.z)).toBeCloseTo(CROUCH_SPEED, 5);
    expect(Math.abs(crouch.z)).toBeLessThan(Math.abs(walk.z));
  });
  it('les yeux sont plus bas accroupi mais restent au-dessus du sol', () => {
    expect(CROUCH_EYE_HEIGHT).toBeLessThan(EYE_HEIGHT);
    expect(CROUCH_EYE_HEIGHT).toBeGreaterThan(0.5);
  });
});
