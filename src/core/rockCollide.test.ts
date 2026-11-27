// Tests de la collision avec les rochers (1.40.1).
import { describe, expect, it } from 'vitest';
import { realClimate } from '../world/climateData';
import { CHUNK_SIZE } from './chunk';
import { Plant, floraForChunk } from './flora';
import { loadRealRelief } from './relief.testutil';
import { ROCK_STEP_SIZE, RockObstacles, blocksPlayer, pushOutOfRocks, rockRadius } from './rockCollide';
import { createTerrain, findSpawn } from './terrain';
import { hashSeed } from './noise';
import { PLAYER_RADIUS } from './treeCollide';

const rock = (x: number, z: number, size: number): Plant => ({ x, z, y: 0, size, seed: 0.3, kind: 'rock', color: [0.5, 0.5, 0.5] });

describe('repousser hors des rochers', () => {
  it('un point loin d\'un rocher ne bouge pas', () => {
    const r = pushOutOfRocks([rock(0, 0, 1)], 5, 5);
    expect(r).toEqual({ x: 5, z: 5, hit: false });
  });
  it('un point dans un rocher est poussé au bord (rayon du rocher + rayon du joueur)', () => {
    const p = rock(10, 10, 1.5);
    const r = pushOutOfRocks([p], 10.2, 10);
    expect(r.hit).toBe(true);
    expect(Math.hypot(r.x - 10, r.z - 10)).toBeCloseTo(rockRadius(p) + PLAYER_RADIUS, 5);
  });
  it('au centre exact : sortie vers l\'est, valeurs finies', () => {
    const r = pushOutOfRocks([rock(0, 0, 1)], 0, 0);
    expect(Number.isFinite(r.x) && Number.isFinite(r.z)).toBe(true);
    expect(r.x).toBeGreaterThan(0);
  });
  it('plus gros = plus large', () => {
    expect(rockRadius({ size: 2 })).toBeGreaterThan(rockRadius({ size: 1 }));
  });
});

describe('rochers du monde', () => {
  const terrain = createTerrain(hashSeed('horizon'), loadRealRelief(), realClimate, false); // sans eau douce : plus rapide
  it('un rocher du dessin bloque vraiment le joueur', () => {
    const p = findSpawn(terrain); // le point de départ du jeu
    const cx = Math.floor(p.x / CHUNK_SIZE);
    const cz = Math.floor(p.z / CHUNK_SIZE);
    const rocks: Plant[] = [];
    for (let k = 0; k < 100; k++) rocks.push(...floraForChunk(terrain, cx + (k % 10), cz + Math.floor(k / 10), 0, CHUNK_SIZE, null, false).filter((q) => q.kind === 'rock')); // les rochers dessinés dans 100 tuiles
    expect(rocks.length).toBeGreaterThan(0);
    expect(rocks.some((q) => q.size < ROCK_STEP_SIZE)).toBe(true); // il y a aussi des petits rochers
    const small = rocks.find((q) => q.size < ROCK_STEP_SIZE)!;
    expect(new RockObstacles(terrain).resolve(small.x + 0.05, small.z).hit).toBe(false); // un petit rocher s'enjambe
    const obs = new RockObstacles(terrain);
    const r = rocks.find((q) => blocksPlayer(q))!; // un rocher assez haut pour bloquer
    const out = obs.resolve(r.x + 0.1, r.z); // on se met presque au centre du rocher
    expect(out.hit).toBe(true);
    expect(Math.hypot(out.x - r.x, out.z - r.z)).toBeGreaterThanOrEqual(rockRadius(r) + PLAYER_RADIUS - 0.5); // repoussé au bord (un voisin a pu le décaler un peu)
  });
});

describe('seuil de hauteur', () => {
  it('moins de 40 cm : franchissable ; plus : bloque', () => {
    expect(blocksPlayer({ size: 0.6 })).toBe(false);
    expect(blocksPlayer({ size: 0.76 })).toBe(false);
    expect(blocksPlayer({ size: 0.8 })).toBe(true);
    expect(blocksPlayer({ size: 1.5 })).toBe(true);
  });
});
