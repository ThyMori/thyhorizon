// Tests de la voix des animaux (1.43).
import { describe, expect, it } from 'vitest';
import type { Critter, Species } from './fauna';
import { HEARING, SILENT_VOICES, VOICED, faunaVoices } from './faunaSound';

const me = { x: 0, z: 0, y: 1.7, yaw: 0 }; // regarde vers le nord (−z)
const critter = (species: Species, x: number, z: number, extra: Partial<Critter> = {}): Critter => ({ species, id: 1, x, y: 1, z, yaw: 0, scale: 1, flap: 0, moving: 0, tint: [1, 1, 1], ...extra });

describe('qui s\'entend', () => {
  it('rien du tout sans bêtes', () => {
    const v = faunaVoices([], me, 0, 0);
    for (const sp of VOICED) expect(v[sp].rate).toBe(0);
    expect(SILENT_VOICES.cow.sources).toEqual([]);
  });
  it('une vache proche se fait entendre, une vache trop loin non', () => {
    expect(faunaVoices([critter('cow', 0, -30)], me, 0, 0).cow.rate).toBeGreaterThan(0);
    expect(faunaVoices([critter('cow', 0, -HEARING.cow - 5)], me, 0, 0).cow.rate).toBe(0);
  });
  it('plus la bête est près, plus elle crie souvent et fort', () => {
    const near = faunaVoices([critter('sheep', 0, -10)], me, 0, 0).sheep;
    const far = faunaVoices([critter('sheep', 0, -70)], me, 0, 0).sheep;
    expect(near.rate).toBeGreaterThan(far.rate);
    expect(near.sources[0]!.gain).toBeGreaterThan(far.sources[0]!.gain);
  });
  it('papillons et libellules sont muets', () => {
    const v = faunaVoices([critter('butterfly', 0, -2), critter('dragonfly', 1, -2)], me, 0, 0);
    for (const sp of VOICED) expect(v[sp].rate).toBe(0);
  });
  it('un cerf calme ne dit presque rien, un cerf qui fuit aboie', () => {
    const calm = faunaVoices([critter('deer', 0, -30)], me, 0, 0).deer.rate;
    const run = faunaVoices([critter('deer', 0, -30, { moving: 1 })], me, 0, 0).deer.rate;
    expect(run).toBeGreaterThan(calm * 5);
  });
  it('un lapin qui détale tambourine, un lapin tranquille est silencieux', () => {
    expect(faunaVoices([critter('rabbit', 0, -8)], me, 0, 0).rabbit.rate).toBe(0);
    expect(faunaVoices([critter('rabbit', 0, -8, { moving: 1 })], me, 0, 0).rabbit.rate).toBeGreaterThan(0.3);
  });
});

describe('de quel côté', () => {
  it('une bête à droite pousse le son à droite, à gauche à gauche', () => {
    expect(faunaVoices([critter('sheep', 30, 0)], me, 0, 0).sheep.sources[0]!.pan).toBeGreaterThan(0.5); // est = à droite quand on regarde le nord
    expect(faunaVoices([critter('sheep', -30, 0)], me, 0, 0).sheep.sources[0]!.pan).toBeLessThan(-0.5);
  });
  it('si on se tourne, le côté change (yaw : tourné vers la gauche = vers l\'ouest)', () => {
    const west = { ...me, yaw: Math.PI / 2 }; // regarde l'ouest : le nord est à sa droite
    expect(faunaVoices([critter('sheep', 0, -30)], west, 0, 0).sheep.sources[0]!.pan).toBeGreaterThan(0.5);
  });
  it('devant ou derrière : au centre', () => {
    expect(Math.abs(faunaVoices([critter('sheep', 0, -30)], me, 0, 0).sheep.sources[0]!.pan)).toBeLessThan(0.05);
  });
  it('tout près, le son est centré (pas de saut d\'un côté à l\'autre)', () => {
    expect(Math.abs(faunaVoices([critter('sheep', 1, 0)], me, 0, 0).sheep.sources[0]!.pan)).toBeLessThan(0.3);
  });
});

describe('vent et pluie', () => {
  it('le vent fort et la pluie couvrent les voix', () => {
    const calm = faunaVoices([critter('songbird', 0, -20)], me, 0, 0).songbird.rate;
    expect(faunaVoices([critter('songbird', 0, -20)], me, 15, 0).songbird.rate).toBeLessThan(calm * 0.5);
    expect(faunaVoices([critter('songbird', 0, -20)], me, 0, 1).songbird.rate).toBeLessThan(calm * 0.5);
  });
  it('au plus 4 sources par espèce, les plus proches d\'abord', () => {
    const many = Array.from({ length: 10 }, (_, i) => critter('sheep', 0, -10 - i * 5, { id: i }));
    const s = faunaVoices(many, me, 0, 0).sheep.sources;
    expect(s.length).toBe(4);
    expect(s[0]!.weight).toBeGreaterThanOrEqual(s[3]!.weight);
  });
  it('toutes les valeurs sont finies', () => {
    const v = faunaVoices([critter('gull', 0, 0), critter('cow', 0.001, 0)], me, 3, 0.2); // une bête exactement sur le joueur
    for (const sp of VOICED) { expect(Number.isFinite(v[sp].rate)).toBe(true); for (const s of v[sp].sources) { expect(Number.isFinite(s.pan)).toBe(true); expect(Number.isFinite(s.gain)).toBe(true); } }
  });
});
