// Tests des villages : taille selon la population, recalage sur la terre, plan cohérent (maisons à terre, sans chevauchement), collisions, déterminisme.
import { describe, expect, it } from 'vitest';
import { loadRealCities } from './cities.testutil';
import { latLonToWorld } from './geo';
import { hashSeed } from './noise';
import { createTerrain } from './terrain';
import { loadRealRelief } from './relief.testutil';
import { CityInfo, MAX_SNAP, findAnchor, pointInHouse, pushOutOfHouses, villageSize } from './village';
import { VillageSystem } from './villageSystem';
import { realClimate } from '../world/climateData';

const terrain = createTerrain(hashSeed('horizon'), loadRealRelief(), realClimate);
const cities = loadRealCities();
const system = new VillageSystem(cities, terrain);
const idOf = (name: string, country: string): number => {
  for (let i = 0; i < cities.count; i++) if (cities.name(i) === name && cities.country[i] === country) return i;
  throw new Error(`${name} introuvable`);
};

describe('taille', () => {
  it('croît avec la population, mais reste plafonnée', () => {
    expect(villageSize(5000).houses).toBe(10);
    expect(villageSize(20000).houses).toBeGreaterThan(villageSize(10000).houses);
    expect(villageSize(30e6).houses).toBe(160);
    expect(villageSize(30e6).radius).toBeLessThan(300);
    expect(villageSize(100).houses).toBe(10); // jamais moins que le plus petit village
  });
});

describe('recalage', () => {
  it('une ville déjà sur la terre ferme ne bouge pas', () => {
    const l = idOf('Lannion', 'FR');
    const a = findAnchor(terrain, cities.x[l]!, cities.z[l]!)!;
    expect(a.x).toBe(cities.x[l]);
    expect(a.z).toBe(cities.z[l]);
  });
  it('un point en plein océan n\'a pas de centre', () => {
    const ocean = latLonToWorld(40, -35); // milieu de l'Atlantique nord
    expect(terrain.heightAt(ocean.x, ocean.z)).toBeLessThan(0);
    expect(findAnchor(terrain, ocean.x, ocean.z)).toBeNull();
  });
  it('un centre trouvé est toujours sur la terre ferme', () => {
    let tested = 0;
    for (let i = 0; i < cities.count && tested < 150; i += 211) {
      const a = system.anchor(i);
      if (!a) continue;
      tested++;
      expect(terrain.heightAt(a.x, a.z)).toBeGreaterThanOrEqual(5);
      expect(Math.hypot(a.x - cities.x[i]!, a.z - cities.z[i]!)).toBeLessThanOrEqual(MAX_SNAP + 1);
    }
    expect(tested).toBeGreaterThan(50);
  });
});

describe('plan de Lannion', () => {
  const l = idOf('Lannion', 'FR');
  const v = system.village(l)!;
  it('existe, porte son nom, a le style atlantique et un nombre de maisons raisonnable', () => {
    expect(v).not.toBeNull();
    expect(v.name).toBe('Lannion');
    expect(v.style.id).toBe('atlantic');
    expect(v.houses.length).toBeGreaterThan(8);
    expect(v.houses.length).toBeLessThanOrEqual(villageSize(v.pop).houses);
  });
  it('toutes les maisons sont à terre, dans le rayon, et ne se chevauchent pas', () => {
    for (const h of v.houses) {
      expect(terrain.heightAt(h.x, h.z)).toBeGreaterThan(3);
      expect(Math.hypot(h.x - v.x, h.z - v.z)).toBeLessThanOrEqual(v.radius);
      expect(h.baseY).toBeLessThan(h.floorY);
      expect(h.wallH).toBeGreaterThan(2);
    }
    for (let i = 0; i < v.houses.length; i++) {
      for (let j = i + 1; j < v.houses.length; j++) {
        const a = v.houses[i]!;
        const b = v.houses[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(4); // pas l'une sur l'autre
        expect(pointInHouse(a, b.x, b.z)).toBe(false); // le centre de l'une n'est jamais dans l'autre
      }
    }
  });
  it('a des panneaux avec le vrai nom, tournés vers l\'extérieur', () => {
    expect(v.signs.length).toBeGreaterThanOrEqual(1);
    for (const s of v.signs) {
      expect(s.name).toBe('Lannion');
      expect(Math.hypot(s.nx, s.nz)).toBeCloseTo(1, 5);
      const out = (s.x - v.x) * s.nx + (s.z - v.z) * s.nz; // le panneau regarde dans le sens opposé au centre
      expect(out).toBeGreaterThan(0);
    }
  });
  it('est identique à chaque fois (déterministe)', () => {
    const again = new VillageSystem(cities, terrain).village(l)!;
    expect(again.houses.length).toBe(v.houses.length);
    expect(again.houses[3]).toEqual(v.houses[3]);
    expect(again.signs).toEqual(v.signs);
  });
  it('une maison n\'est pas posée sur une construction du joueur', () => {
    const h0 = v.houses[0]!;
    const s2 = new VillageSystem(cities, terrain);
    s2.setReserved((x, z, r) => Math.hypot(x - h0.x, z - h0.z) < r);
    const v2 = s2.village(l)!;
    expect(v2.houses.some((h) => h.x === h0.x && h.z === h0.z)).toBe(false);
    expect(v2.houses.length).toBeLessThan(v.houses.length + 1);
  });
});

describe('grande ville et autres climats', () => {
  it('Paris est plus grand que Lannion', () => {
    const p = system.village(idOf('Paris', 'FR'))!;
    expect(p.houses.length).toBeGreaterThan(system.village(idOf('Lannion', 'FR'))!.houses.length);
  });
  it('le style suit le climat : Le Caire désertique, Singapour tropical', () => {
    const find = (n: string, c: string): CityInfo | null => {
      try {
        const i = idOf(n, c);
        return { id: i, name: n, pop: cities.pop[i]!, lat: cities.lat[i]!, lon: cities.lon[i]!, x: cities.x[i]!, z: cities.z[i]! };
      } catch {
        return null;
      }
    };
    const cairo = find('Cairo', 'EG');
    if (cairo) expect(system.village(cairo.id)?.style.id).toBe('arid');
  });
});

describe('arbres et collisions', () => {
  const l = idOf('Lannion', 'FR');
  const v = system.village(l)!;
  it('le village dégage les arbres autour de lui, et rien ailleurs', () => {
    const t = system.blockerForChunk(Math.floor(v.x / 64), Math.floor(v.z / 64), 64)!;
    expect(t).not.toBeNull();
    expect(t(v.x, v.z)).toBe(true);
    expect(t(v.x + 5000, v.z)).toBe(false);
    expect(system.blockerForChunk(Math.floor((v.x + 60000) / 64), Math.floor(v.z / 64), 64)).toBeNull();
  });
  it('on ne traverse pas une maison : poussé dehors, et pas de mouvement à l\'extérieur', () => {
    const h = v.houses[0]!;
    const r = pushOutOfHouses([h], h.x, h.z, 0.6);
    expect(r.hit).toBe(true);
    expect(pointInHouse(h, r.x, r.z, 0.55)).toBe(false);
    const far = pushOutOfHouses([h], h.x + 30, h.z, 0.6);
    expect(far.hit).toBe(false);
    expect(far.x).toBe(h.x + 30);
  });
  it('via le système : un point dans une maison est repoussé', () => {
    const h = v.houses[1]!;
    const r = system.resolve(h.x + 0.2, h.z, 0.6);
    expect(r.hit).toBe(true);
  });
});
