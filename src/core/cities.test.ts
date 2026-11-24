// Tests de la lecture des villes : fichier réel (Lannion, Paris, distances) et fichier fabriqué à la main.
import { describe, expect, it } from 'vitest';
import { parseCities } from './cities';
import { loadRealCities } from './cities.testutil';

// Fabrique un petit fichier cities.bin (mêmes règles que scripts/build-cities.mjs).
function tiny(list: { name: string; lat: number; lon: number; pop: number; country: string }[]): Uint8Array {
  const names = list.map((p) => new TextEncoder().encode(p.name));
  const out = new Uint8Array(8 + list.length * 18 + names.reduce((s, n) => s + n.length + 1, 0));
  const v = new DataView(out.buffer);
  out.set([84, 72, 80, 76], 0); // « THPL »
  v.setUint32(4, list.length, true);
  let nameOff = 0;
  let namePos = 8 + list.length * 18;
  list.forEach((p, i) => {
    const o = 8 + i * 18;
    v.setInt32(o, Math.round(p.lat * 1e4), true);
    v.setInt32(o + 4, Math.round(p.lon * 1e4), true);
    v.setUint32(o + 8, p.pop, true);
    out[o + 12] = p.country.charCodeAt(0);
    out[o + 13] = p.country.charCodeAt(1);
    v.setUint32(o + 14, nameOff, true);
    out.set(names[i]!, namePos);
    namePos += names[i]!.length + 1;
    nameOff += names[i]!.length + 1;
  });
  return out;
}

describe('lecture du fichier', () => {
  it('relit noms (accents compris), populations, pays et positions', () => {
    const p = parseCities(tiny([{ name: 'Plérin', lat: 48.5333, lon: -2.7667, pop: 14000, country: 'FR' }, { name: 'Zürich', lat: 47.37, lon: 8.54, pop: 400000, country: 'CH' }]));
    expect(p.count).toBe(2);
    expect(p.name(0)).toBe('Plérin');
    expect(p.name(1)).toBe('Zürich');
    expect(p.pop[1]).toBe(400000);
    expect(p.country[0]).toBe('FR');
    expect(p.lat[0]).toBeCloseTo(48.5333, 3);
    expect(p.lon[1]).toBeCloseTo(8.54, 3);
  });
  it('refuse un fichier abîmé', () => {
    expect(() => parseCities(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => parseCities(new Uint8Array([84, 72, 80, 76, 255, 255, 255, 0]))).toThrow(); // annonce trop de villes
  });
  it('nearby trouve les villes proches seulement', () => {
    const p = parseCities(tiny([{ name: 'A', lat: 48.73, lon: -3.46, pop: 9000, country: 'FR' }, { name: 'B', lat: 48.8, lon: -3.46, pop: 9000, country: 'FR' }, { name: 'C', lat: 10, lon: 10, pop: 9000, country: 'XX' }]));
    expect(p.nearby(p.x[0]!, p.z[0]!, 1000).map((i) => p.name(i))).toEqual(['A']);
    expect(p.nearby(p.x[0]!, p.z[0]!, 9000).map((i) => p.name(i)).sort()).toEqual(['A', 'B']);
    expect(p.nearby(1e6, 1e6, 1000)).toEqual([]);
  });
});

describe('vraies villes du monde', () => {
  const places = loadRealCities();
  const find = (name: string, country: string): number => {
    for (let i = 0; i < places.count; i++) if (places.name(i) === name && places.country[i] === country) return i;
    return -1;
  };
  it('contient des dizaines de milliers de villes, toutes ≥ 5 000 habitants', () => {
    expect(places.count).toBeGreaterThan(40000);
    expect(places.pop.every((n) => n >= 5000)).toBe(true);
  });
  it('Lannion est à côté du départ du jeu', () => {
    const i = find('Lannion', 'FR');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(places.x[i]!, places.z[i]!)).toBeLessThan(2000);
  });
  it('Paris est à environ 425 km de Lannion à vol d\'oiseau (480 km par la route), à l\'est', () => {
    const l = find('Lannion', 'FR');
    const p = find('Paris', 'FR');
    expect(p).toBeGreaterThanOrEqual(0);
    expect(places.pop[p]!).toBeGreaterThan(2000000);
    const d = Math.hypot(places.x[p]! - places.x[l]!, places.z[p]! - places.z[l]!);
    expect(d).toBeGreaterThan(410000);
    expect(d).toBeLessThan(440000);
    expect(places.x[p]! - places.x[l]!).toBeGreaterThan(0); // Paris est à l'est
    expect(Math.abs(places.z[p]! - places.z[l]!)).toBeLessThan(20000); // presque à la même latitude (Paris est 13 km plus au nord)
  });
  it('des villes bretonnes alentour', () => {
    const near = places.nearby(0, 0, 40000).map((i) => places.name(i));
    expect(near.length).toBeGreaterThan(3);
    expect(near).toContain('Lannion');
  });
});
