// Tests du relief : le vrai relief de la Terre à Lannion (mer au nord), le détail inventé, le point de départ.
import { describe, expect, it } from 'vitest';
import { METERS_PER_DEGREE, latLonToWorld } from './geo';
import { hashSeed } from './noise';
import { loadRealRelief } from './relief.testutil';
import { SEA_LEVEL, createTerrain, findSpawn, slopeAt } from './terrain';

const relief = loadRealRelief();
const terrain = createTerrain(hashSeed('horizon'), relief); // terrain commun aux tests

describe('terrain', () => {
  it('est déterministe', () => {
    const t2 = createTerrain(hashSeed('horizon'), relief);
    expect(terrain.heightAt(1234.5, -987.6)).toBe(t2.heightAt(1234.5, -987.6));
  });
  it('change de détail avec la graine mais pas de forme générale', () => {
    const other = createTerrain(hashSeed('autre'), relief);
    expect(other.heightAt(5000, 3000)).not.toBe(terrain.heightAt(5000, 3000));
    expect(Math.abs(other.realHeightAt(5000, 3000) - terrain.realHeightAt(5000, 3000))).toBeLessThan(1e-9); // la vraie Terre ne change pas
  });
  it('a la mer au nord de Lannion et la terre au sud', () => {
    expect(terrain.heightAt(0, 0)).toBeGreaterThan(20); // Lannion est dans les terres
    expect(terrain.heightAt(0, -30000)).toBeLessThan(SEA_LEVEL - 20); // la Manche, 30 km au nord
    expect(terrain.heightAt(0, 30000)).toBeGreaterThan(SEA_LEVEL + 20); // la Bretagne intérieure, 30 km au sud
  });
  it('a l\'Atlantique à l\'ouest de la Bretagne et la Manche au nord-est des Côtes-d\'Armor', () => {
    const atlantic = latLonToWorld(47.0, -8.0); // golfe de Gascogne
    expect(terrain.heightAt(atlantic.x, atlantic.z)).toBeLessThan(-20);
    const paris = latLonToWorld(48.86, 2.35);
    expect(terrain.heightAt(paris.x, paris.z)).toBeGreaterThan(0); // Paris est à l'intérieur des terres
  });
  it('a de hautes montagnes dans les Alpes et au Tibet', () => {
    const alps = latLonToWorld(45.9, 7.0); // massif du Mont-Blanc
    const tibet = latLonToWorld(28.5, 86.0); // Himalaya
    let maxAlps = -Infinity;
    let maxTibet = -Infinity;
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 40; j++) {
        maxAlps = Math.max(maxAlps, terrain.coarseHeightAt(alps.x + (i - 20) * 3000, alps.z + (j - 20) * 3000));
        maxTibet = Math.max(maxTibet, terrain.coarseHeightAt(tibet.x + (i - 20) * 3000, tibet.z + (j - 20) * 3000));
      }
    }
    expect(maxAlps).toBeGreaterThan(2000);
    expect(maxTibet).toBeGreaterThan(4000);
  });
  it('est plus accidenté dans les montagnes qu\'en plaine', () => {
    const roughness = (x: number, z: number): number => {
      let sum = 0;
      for (let i = 0; i < 200; i++) sum += Math.abs(terrain.heightAt(x + (i + 1) * 100, z) - terrain.heightAt(x + i * 100, z)); // variation sur 20 km
      return sum;
    };
    const plain = latLonToWorld(48.0, 2.0); // Beauce
    const alps = latLonToWorld(45.9, 7.0);
    expect(roughness(alps.x, alps.z)).toBeGreaterThan(2 * roughness(plain.x, plain.z));
  });
  it('n\'a pas de falaise verticale ni de saut entre deux points voisins', () => {
    for (let i = 0; i < 3000; i++) {
      const x = -4000 + i * 2.3;
      const z = -11500 + i * 0.7; // on traverse la côte au nord de Lannion
      expect(Math.abs(terrain.heightAt(x + 1, z) - terrain.heightAt(x, z))).toBeLessThan(3);
    }
  });
  it('ne dépasse jamais les limites de la grille (fond marin plafonné à −200 m)', () => {
    for (const [x, z] of [[-3e6, 0], [0, -4e6], [2e6, 3e6], [-1e7, 1e7]] as const) {
      const h = terrain.heightAt(x, z);
      expect(Number.isFinite(h)).toBe(true);
      expect(h).toBeGreaterThan(-260);
      expect(h).toBeLessThan(7500);
    }
  });
  it('traverse sans problème la ligne de changement de date et les pôles', () => {
    for (const lat of [89.9, 0, -89.9]) {
      for (const lon of [179.9, -179.9, 0]) {
        const p = latLonToWorld(lat, lon);
        expect(Number.isFinite(terrain.heightAt(p.x, p.z))).toBe(true);
      }
    }
  });
  it('donne un point de départ à terre, au bord de la mer, face au nord', () => {
    const s = findSpawn(terrain);
    expect(terrain.heightAt(s.x, s.z)).toBeGreaterThan(1);
    expect(slopeAt(terrain, s.x, s.z)).toBeLessThan(0.3);
    expect(s.yaw).toBeCloseTo(0); // face au nord : la mer
    expect(Math.abs(s.z)).toBeLessThan(20 * 1000); // à moins de 20 km de Lannion
    expect(terrain.heightAt(s.x, s.z - 400)).toBeLessThan(SEA_LEVEL + 2); // la mer est juste devant (moins de 400 m)
    expect(METERS_PER_DEGREE).toBeGreaterThan(0);
  });
});
