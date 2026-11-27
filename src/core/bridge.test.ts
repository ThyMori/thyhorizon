// Tests des ponts de bois (1.36) : détection sur une vallée synthétique, tablier marchable, pas de gué dessous, maillage valide.
import { describe, expect, it } from 'vitest';
import { addBridge } from './bridgeMesh';
import { CHUNK_SIZE } from './chunk';
import { BRIDGE_CLEAR, BRIDGE_HALF_W, BRIDGE_MIN_W, Bridge, Hydro, RoadLine, bridgeDeckAt } from './hydro';
import type { MeshBuilder } from './trees';

// Une vallée en V : le fond court du nord au sud (x ≈ 4096), le terrain descend doucement vers le sud.
const valley = (x: number, z: number): number => 400 + 0.02 * Math.abs(x - 4096) - 0.002 * z;
// Un chemin qui traverse la vallée d'ouest en est, à z = −2000.
const road: RoadLine = { x1: 3000, z1: -2000, x2: 5200, z2: -2000, half: 2.2 };
const provider = (): readonly RoadLine[] => [road];

// Parcourt les tuiles autour du chemin et rassemble les ponts.
function findBridges(h: Hydro): Bridge[] {
  const out: Bridge[] = [];
  for (let x = 3000; x <= 5200; x += 64) for (const b of h.bridgesNear(x, -2000, 64)) if (!out.some((o) => Math.hypot(o.x - b.x, o.z - b.z) < 1)) out.push(b);
  return out;
}

describe('détection des ponts', () => {
  const hy = new Hydro(valley);
  hy.setRoads(provider);
  const bridges = findBridges(hy);

  it('un chemin qui croise une grande rivière reçoit un pont, centré sur la rivière', () => {
    expect(bridges.length).toBe(1);
    const b = bridges[0]!;
    expect(Math.abs(b.x - 4096)).toBeLessThan(140); // sur le fond de la vallée
    expect(b.z).toBeCloseTo(-2000, 3); // sur le chemin
    expect(b.len).toBeGreaterThan(BRIDGE_MIN_W / 2); // il enjambe toute la rivière
  });

  it('le tablier est au-dessus de l\'eau, et on peut y marcher', () => {
    const b = bridges[0]!;
    const surf = hy.surfaceAt(b.x, b.z);
    expect(Number.isNaN(surf)).toBe(false);
    expect(b.midY).toBeCloseTo(surf + BRIDGE_CLEAR, 0);
    expect(hy.deckAt(b.x, b.z)).toBeCloseTo(b.midY, 3);
    expect(hy.deckAt(b.x + b.dx * (b.len - 0.5), b.z + b.dz * (b.len - 0.5))).not.toBeNaN(); // bout de la rampe
  });

  it('hors du tablier, pas de pont', () => {
    const b = bridges[0]!;
    expect(hy.deckAt(b.x, b.z + BRIDGE_HALF_W + 1)).toBeNaN(); // à côté
    expect(hy.deckAt(b.x + b.dx * (b.len + 2), b.z + b.dz * (b.len + 2))).toBeNaN(); // après le bout
  });

  it('les tuiles voisines connaissent le même pont (une seule fois)', () => {
    const b = bridges[0]!;
    const near = hy.bridgesNear(b.x, b.z, 200);
    expect(near.length).toBe(1);
  });

  it('pas de gué sous le pont : le fond reste profond', () => {
    const b = bridges[0]!;
    const depth = hy.surfaceAt(b.x, b.z) - (valley(b.x, b.z) + hy.deltaAt(b.x, b.z));
    expect(depth).toBeGreaterThan(0.5); // un vrai lit, pas remonté à 0,4 m
  });

  it('sans chemin branché, aucun pont', () => {
    const h3 = new Hydro(valley);
    expect(h3.bridgesNear(4096, -2000, 200).length).toBe(0);
  });
});

describe('forme du tablier', () => {
  const b: Bridge = { x: 100, z: 200, dx: 1, dz: 0, len: 20, flat: 15, midY: 10, endY0: 7, endY1: 9, halfW: 2 };
  it('plat au milieu, en rampe vers les bouts', () => {
    expect(bridgeDeckAt(b, 100, 200)).toBe(10);
    expect(bridgeDeckAt(b, 114, 200)).toBe(10);
    expect(bridgeDeckAt(b, 120, 200)).toBeCloseTo(9, 5); // bout +u
    expect(bridgeDeckAt(b, 80, 200)).toBeCloseTo(7, 5); // bout −u
    expect(bridgeDeckAt(b, 117.5, 200)).toBeCloseTo(9.5, 5);
  });
  it('NaN hors de l\'emprise', () => {
    expect(bridgeDeckAt(b, 100, 203)).toBeNaN();
    expect(bridgeDeckAt(b, 125, 200)).toBeNaN();
  });
});

describe('maillage du pont', () => {
  const b: Bridge = { x: 100, z: 100, dx: 1, dz: 0, len: 12, flat: 7, midY: 10, endY0: 8, endY1: 9, halfW: 2 };
  const empty = (): MeshBuilder => ({ positions: [], normals: [], colors: [], indices: [] });
  const bed = (): number => 5; // fond 5 m sous le tablier : des pieux
  it('produit des sommets valides et des indices dans les bornes', () => {
    const m = empty();
    const top = addBridge(m, b, 64, 64, CHUNK_SIZE, bed);
    expect(m.positions.length).toBeGreaterThan(0);
    expect(m.positions.length).toBe(m.normals.length);
    expect(m.positions.length).toBe(m.colors.length);
    expect(m.positions.every(Number.isFinite)).toBe(true);
    expect(m.indices.length % 3).toBe(0);
    const n = m.positions.length / 3;
    expect(m.indices.every((i) => i >= 0 && i < n)).toBe(true);
    expect(top).toBeGreaterThan(10); // les garde-corps dépassent le tablier
  });
  it('positions relatives au coin de la tuile', () => {
    const m = empty();
    addBridge(m, b, 64, 64, CHUNK_SIZE, bed);
    for (let i = 0; i < m.positions.length; i += 3) {
      expect(m.positions[i]!).toBeGreaterThan(-5);
      expect(m.positions[i]!).toBeLessThan(CHUNK_SIZE + 5); // jamais une coordonnée du monde
    }
  });
  it('une tuile qui ne contient pas le pont n\'en dessine rien', () => {
    const m = empty();
    expect(addBridge(m, b, 1000, 1000, CHUNK_SIZE, bed)).toBe(-Infinity);
    expect(m.positions.length).toBe(0);
  });
  it('les normales sont unitaires, celles du dessus regardent vers le haut', () => {
    const m = empty();
    addBridge(m, b, 64, 64, CHUNK_SIZE, bed);
    let up = 0;
    for (let i = 0; i < m.normals.length; i += 3) {
      expect(Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!)).toBeCloseTo(1, 4);
      if (m.normals[i + 1]! > 0.9) up++;
    }
    expect(up).toBeGreaterThan(20);
  });
  it('pas de pieux quand le sol touche presque le tablier', () => {
    const a = empty();
    const c = empty();
    addBridge(a, b, 64, 64, CHUNK_SIZE, () => 5);
    addBridge(c, b, 64, 64, CHUNK_SIZE, () => 9.5);
    expect(c.positions.length).toBeLessThan(a.positions.length);
  });
});
