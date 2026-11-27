// Tests des chemins de terre : liaisons entre villes voisines, tracé qui suit le relief, symétrie, déterminisme, peinture du sol et arbres écartés.
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, buildChunk } from './chunk';
import { loadRealCities } from './cities.testutil';
import { hashSeed } from './noise';
import { terrainColor } from './palette';
import { loadRealRelief } from './relief.testutil';
import { DirtSeg, ROAD_HALF, ROAD_RANGE, RoadSystem, distToSeg, routePath } from './roads';
import { createTerrain } from './terrain';
import { VillageSystem } from './villageSystem';
import { isWalkable } from './movement';
import { realClimate } from '../world/climateData';

const terrain = createTerrain(hashSeed('horizon'), loadRealRelief(), realClimate);
const cities = loadRealCities();
const system = new VillageSystem(cities, terrain);
const roads = system.roads;
const idOf = (name: string, country: string): number => {
  for (let i = 0; i < cities.count; i++) if (cities.name(i) === name && cities.country[i] === country) return i;
  throw new Error(`${name} introuvable`);
};
const lannion = idOf('Lannion', 'FR');

describe('liaisons', () => {
  it('Lannion est reliée à au moins une ville voisine, à moins de la portée maximale', () => {
    const n = roads.neighbours(lannion);
    expect(n.length).toBeGreaterThan(0);
    const a = system.anchor(lannion)!;
    for (const j of n) {
      const b = system.anchor(j)!;
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThanOrEqual(ROAD_RANGE);
    }
  });
  it('est symétrique : si i est relié à j, j est relié à i', () => {
    for (const j of roads.neighbours(lannion)) expect(roads.neighbours(j)).toContain(lannion);
  });
  it('aucune ville plus proche des deux extrémités d\'une liaison (pas de détour inutile)', () => {
    const a = system.anchor(lannion)!;
    for (const j of roads.neighbours(lannion)) {
      const b = system.anchor(j)!;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      for (const k of cities.nearby(a.x, a.z, d)) {
        if (k === lannion || k === j) continue;
        const p = system.anchor(k);
        if (!p) continue;
        const closeBoth = Math.hypot(p.x - a.x, p.z - a.z) < d && Math.hypot(p.x - b.x, p.z - b.z) < d;
        expect(closeBoth).toBe(false);
      }
    }
  });
  it('une ville seule en mer n\'a pas de chemin', () => {
    // une ville sans centre à terre n'est reliée à rien
    for (let i = 0; i < cities.count; i += 997) if (!system.anchor(i)) expect(roads.neighbours(i)).toEqual([]);
  });
});

describe('tracé', () => {
  const j = roads.neighbours(lannion)[0]!;
  const a = system.anchor(lannion)!;
  const b = system.anchor(j)!;
  const path = roads.path(lannion, j)!;
  it('part et arrive exactement aux centres des villages, dans les deux sens', () => {
    expect(path).not.toBeNull();
    expect(path[0]).toEqual({ x: a.x, z: a.z });
    expect(path[path.length - 1]).toEqual({ x: b.x, z: b.z });
    expect(roads.path(j, lannion)).toBe(path); // même objet : le chemin est le même dans les deux sens
  });
  it('reste à terre sur toute sa longueur', () => {
    for (let k = 0; k + 1 < path.length; k++) {
      const p = path[k]!;
      const q = path[k + 1]!;
      const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 20));
      for (let s = 0; s <= n; s++) expect(terrain.heightAt(p.x + ((q.x - p.x) * s) / n, p.z + ((q.z - p.z) * s) / n)).toBeGreaterThan(0.5);
    }
  });
  it('n\'est pas démesurément plus long que la ligne droite', () => {
    let len = 0;
    for (let k = 0; k + 1 < path.length; k++) len += Math.hypot(path[k + 1]!.x - path[k]!.x, path[k + 1]!.z - path[k]!.z);
    expect(len).toBeLessThan(1.8 * Math.hypot(b.x - a.x, b.z - a.z));
  });
  it('est déterministe : un autre système donne les mêmes points', () => {
    const other = new VillageSystem(cities, terrain).roads.path(lannion, j)!;
    expect(other).toEqual(path);
  });
  it('contourne l\'eau : une baie entre deux points à terre n\'est jamais traversée', () => {
    // Deux points de part et d'autre de la baie de Lannion : si une route existe, elle ne touche pas l'eau.
    const p = routePath(terrain, { x: a.x - 3000, z: a.z - 3000 }, { x: a.x + 3000, z: a.z + 3000 });
    if (p) for (const q of p) expect(terrain.heightAt(q.x, q.z)).toBeGreaterThan(0);
  });
  it('rien entre deux points à moins de 150 m', () => {
    expect(routePath(terrain, a, { x: a.x + 100, z: a.z })).toBeNull();
  });
});

describe('segments et sol', () => {
  it('segmentsNear trouve des tronçons le long du chemin et aucun en pleine mer', () => {
    const j = roads.neighbours(lannion)[0]!;
    const mid = roads.path(lannion, j)![Math.floor(roads.path(lannion, j)!.length / 2)]!;
    const near = roads.segmentsNear(mid.x, mid.z, 30);
    expect(near.length).toBeGreaterThan(0);
    expect(near.some((s) => distToSeg(s, mid.x, mid.z) < 1)).toBe(true);
    expect(roads.segmentsNear(-2e6, -2e6, 500)).toEqual([]);
  });
  it('un tronçon a la demi-largeur d\'un chemin', () => {
    const a = system.anchor(lannion)!;
    for (const s of roads.segmentsNear(a.x, a.z, 500)) expect(s.half).toBe(ROAD_HALF);
  });
  it('la terre est peinte sur le chemin et pas ailleurs ; les arbres s\'écartent', () => {
    const j = roads.neighbours(lannion)[0]!;
    const path = roads.path(lannion, j)!;
    // On choisit un point du chemin à mi-parcours et la tuile qui le contient.
    const mid = path[Math.floor(path.length / 2)]!;
    const cx = Math.floor(mid.x / CHUNK_SIZE);
    const cz = Math.floor(mid.z / CHUNK_SIZE);
    const dirt = system.dirtForChunk(cx, cz, CHUNK_SIZE);
    expect(dirt.length).toBeGreaterThan(0);
    const withRoad = buildChunk(terrain, cx, cz, 0, null, dirt);
    const without = buildChunk(terrain, cx, cz, 0, null, null);
    let changed = 0; // sommets de terrain dont la couleur a changé
    const w = 65;
    for (let v = 0; v < w * w; v++) {
      const diff = Math.abs(withRoad.colors[v * 3]! - without.colors[v * 3]!) + Math.abs(withRoad.colors[v * 3 + 1]! - without.colors[v * 3 + 1]!);
      const wx = cx * CHUNK_SIZE + (v % w);
      const wz = cz * CHUNK_SIZE + Math.floor(v / w);
      const onRoad = dirt.some((s) => distToSeg(s, wx, wz) < ROAD_HALF * 0.5 && s.half === ROAD_HALF);
      if (diff > 1e-6) changed++;
      if (onRoad && terrain.heightAt(wx, wz) > 1.5) expect(diff).toBeGreaterThan(1e-4); // sur l'axe du chemin : la couleur est bien celle de la terre
      if (dirt.every((s) => distToSeg(s, wx, wz) > s.half * 2 + 3)) expect(diff).toBe(0); // loin de tout chemin : rien ne bouge
    }
    expect(changed).toBeGreaterThan(5);
    const block = system.blockerForChunk(cx, cz, CHUNK_SIZE)!;
    expect(block).not.toBeNull();
    const on = dirt.find((s) => s.half === ROAD_HALF)!;
    expect(block((on.x1 + on.x2) / 2, (on.z1 + on.z2) / 2)).toBe(true); // pas d'arbre sur le chemin
  });
  it('les rues d\'un village sont en terre', () => {
    const v = system.village(lannion)!;
    expect(v.streets.length).toBeGreaterThan(0);
    const cx = Math.floor(v.x / CHUNK_SIZE);
    const cz = Math.floor(v.z / CHUNK_SIZE);
    const dirt = system.dirtForChunk(cx, cz, CHUNK_SIZE);
    expect(dirt.some((s) => s.half !== ROAD_HALF)).toBe(true);
    const plain = buildChunk(terrain, cx, cz, 0, null, null);
    const painted = buildChunk(terrain, cx, cz, 0, null, dirt);
    let diff = 0;
    for (let k = 0; k < 65 * 65 * 3; k++) diff += Math.abs(painted.colors[k]! - plain.colors[k]!);
    expect(diff).toBeGreaterThan(0.05);
  });
  it('terrainColor reste utilisable seul (sans chemin, rien ne change)', () => {
    const c = terrainColor(10, 1, 0);
    expect(c.every((x) => x >= 0 && x <= 1)).toBe(true);
    const a = buildChunk(terrain, 0, 0, 1, null, null);
    const b = buildChunk(terrain, 0, 0, 1, null, [] as DirtSeg[]);
    expect(Array.from(b.colors)).toEqual(Array.from(a.colors));
  });
});

describe('performance', () => {
  it('une zone dense (Londres) calcule ses liaisons en un temps raisonnable', () => {
    const l = idOf('London', 'GB');
    const t0 = Date.now();
    const sys = new VillageSystem(cities, terrain);
    const a = sys.anchor(l)!;
    const segs = sys.roads.segmentsNear(a.x, a.z, 100);
    expect(Date.now() - t0).toBeLessThan(15000);
    expect(segs.length).toBeGreaterThan(0);
  });
});

describe('RoadSystem', () => {
  it('est constructible seul avec une fonction de centres', () => {
    const r = new RoadSystem(cities, terrain, (i) => system.anchor(i));
    expect(r.neighbours(lannion)).toEqual(roads.neighbours(lannion));
  });
});

describe('gués', () => {
  // Un terrain frais SANS chemins branchés : les rivières sont telles quelles.
  const plain = createTerrain(hashSeed('horizon'), loadRealRelief(), realClimate);
  const withFords = createTerrain(hashSeed('horizon'), loadRealRelief(), realClimate);
  const sys = new VillageSystem(cities, withFords); // branche les chemins : les gués sont aménagés
  it('partout sur les chemins de Lannion, l\'eau est franchissable (gué de 0,5 m au plus) ; sans gué, elle ne l\'est pas toujours', () => {
    const l = idOf('Lannion', 'FR');
    let wetPlain = 0; // points d'eau profonde sur les chemins, sans gué
    let wetFord = 0; // les mêmes avec gués
    let samples = 0;
    for (const j of sys.roads.neighbours(l)) {
      const path = sys.roads.path(l, j)!;
      for (let k = 0; k + 1 < path.length; k++) {
        const p = path[k]!;
        const q = path[k + 1]!;
        const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 3));
        for (let s = 0; s < n; s++) {
          const x = p.x + ((q.x - p.x) * s) / n;
          const z = p.z + ((q.z - p.z) * s) / n;
          samples++;
          if (plain.waterDepthAt(x, z) > 0.5) wetPlain++;
          if (withFords.waterDepthAt(x, z) > 0.5) wetFord++;
          expect(isWalkable(withFords, x, z)).toBe(true);
        }
      }
    }
    expect(samples).toBeGreaterThan(1000);
    expect(wetPlain).toBeGreaterThan(0); // il y a bien des traversées d'eau profonde à aménager
    expect(wetFord).toBe(0); // et plus aucune une fois les gués faits
  });
  it('autour de Lannion les rivières sont petites : des gués, pas de pont', () => {
    const l = idOf('Lannion', 'FR');
    for (const j of sys.roads.neighbours(l)) {
      const path = sys.roads.path(l, j)!;
      for (let k = 0; k < path.length; k += 3) expect(withFords.bridgesNear(path[k]!.x, path[k]!.z, 60).length).toBe(0);
    }
  });
  it('loin des chemins, les rivières ne changent pas', () => {
    const r = withFords.coarseHeightAt(0, 0); // (appel quelconque pour amorcer)
    expect(Number.isFinite(r)).toBe(true);
    let same = 0;
    let total = 0;
    for (let k = 0; k < 300; k++) {
      const x = 3000 + (k % 20) * 40;
      const z = -3000 + Math.floor(k / 20) * 40;
      if (sys.roads.segmentsNear(x, z, 40).length > 0) continue; // près d'un chemin : on saute
      total++;
      if (plain.heightAt(x, z) === withFords.heightAt(x, z)) same++;
    }
    expect(same).toBe(total);
  });
});
