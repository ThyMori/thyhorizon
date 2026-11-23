// Tests du relief : l'océan est à l'ouest, les montagnes à l'est, le départ est sur la terre ferme.
import { describe, expect, it } from 'vitest';
import { hashSeed } from './noise';
import { SEA_LEVEL, createTerrain, findSpawn, slopeAt } from './terrain';

const terrain = createTerrain(hashSeed('horizon')); // terrain commun aux tests

describe('terrain', () => {
  it('est déterministe', () => {
    const t2 = createTerrain(hashSeed('horizon'));
    expect(terrain.heightAt(1234.5, -987.6)).toBe(t2.heightAt(1234.5, -987.6));
  });
  it('est sous l\'eau loin à l\'ouest, quel que soit z', () => {
    for (const z of [-50000, -3000, 0, 4000, 90000]) {
      expect(terrain.heightAt(-5000, z)).toBeLessThan(SEA_LEVEL - 20);
    }
  });
  it('monte vers les montagnes à l\'est', () => {
    let max = -Infinity;
    for (let i = 0; i < 400; i++) max = Math.max(max, terrain.heightAt(4000 + i * 7, 500 + i * 3));
    expect(max).toBeGreaterThan(150); // de vraies montagnes
  });
  it('n\'a pas de falaise verticale ni de saut entre deux points voisins', () => {
    for (let i = 0; i < 3000; i++) {
      const x = -300 + i * 2.3; // on balaye de la mer à l'intérieur des terres
      const z = 100 + i * 0.7;
      expect(Math.abs(terrain.heightAt(x + 1, z) - terrain.heightAt(x, z))).toBeLessThan(3);
    }
  });
  it('a une côte qui reste dans des limites raisonnables', () => {
    for (let z = -20000; z <= 20000; z += 137) expect(Math.abs(terrain.coastX(z))).toBeLessThan(400);
  });
  it('donne un point de départ sur la terre, au-dessus de l\'eau et peu pentu', () => {
    const s = findSpawn(terrain);
    expect(terrain.heightAt(s.x, s.z)).toBeGreaterThan(1);
    expect(slopeAt(terrain, s.x, s.z)).toBeLessThan(0.3);
    expect(s.yaw).toBeCloseTo(Math.PI / 2); // face à l'ouest : l'océan
  });
});
