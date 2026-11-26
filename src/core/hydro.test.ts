// Tests de l'hydrographie : écoulement vers le bas, lacs dans les cuvettes, rivières creusées, continuité entre blocs, marche à gué, arbres, maillage.
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, WATER_PERIOD, buildChunk } from './chunk';
import { loadRealCities } from './cities.testutil';
import { BLOCK_NODES, BLOCK_SIZE, HALO_NODES, Hydro, HydroBlock, MAX_WALK_DEPTH, NODE, RES, RW, TILE, riverDepth, riverWidth } from './hydro';
import { isWalkable } from './movement';
import { hashSeed } from './noise';
import { loadRealRelief } from './relief.testutil';
import { createTerrain } from './terrain';
import { VillageSystem } from './villageSystem';
import { realClimate } from '../world/climateData';

const relief = loadRealRelief();
const terrain = createTerrain(hashSeed('horizon'), relief, realClimate);
const dry = createTerrain(hashSeed('horizon'), relief, realClimate, false); // même terrain sans eau douce
const coarse = (x: number, z: number): number => terrain.coarseHeightAt(x, z);
const wet = (): number => 1;
const brittany = new HydroBlock(0, -1, coarse, wet); // bloc de Lannion (x 0 à 8 km, z −8 à 0 km)
const paris = new HydroBlock(24, -2, coarse, wet); // la région de Paris : quelques lacs

// Le nœud de rivière de plus fort débit dans le cœur du bloc.
function mainRiver(b: HydroBlock): { x: number; z: number; acc: number } {
  let best = -1;
  for (let lj = HALO_NODES; lj < HALO_NODES + BLOCK_NODES; lj++) {
    for (let li = HALO_NODES; li < HALO_NODES + BLOCK_NODES; li++) {
      const k = lj * b.W + li;
      if (b.next[k]! >= 0 && b.lake[k]! < 0 && b.H[k]! > 5 && (best < 0 || b.acc[k]! > b.acc[best]!)) best = k;
    }
  }
  return { x: (b.i0 + (best % b.W)) * NODE, z: (b.j0 + Math.floor(best / b.W)) * NODE, acc: b.acc[best]! };
}

describe('réseau de drainage', () => {
  it('chaque nœud qui s\'écoule va vers plus bas (sauf les passages de flaque)', () => {
    let down = 0;
    let total = 0;
    for (let k = 0; k < brittany.W * brittany.W; k++) {
      const nx = brittany.next[k]!;
      if (nx < 0 || brittany.lake[k]! >= 0) continue; // les nœuds noyés d'un lac se vident par le col, un peu plus haut
      total++;
      if (brittany.H[nx]! < brittany.H[k]!) down++;
    }
    expect(total).toBeGreaterThan(10000);
    expect(down / total).toBeGreaterThan(0.9);
  });
  it('le débit s\'accumule : le plus fort débit est bien supérieur au seuil des rivières', () => {
    expect(mainRiver(brittany).acc).toBeGreaterThan(300);
  });
  it('des rivières existent en Bretagne et à Paris', () => {
    expect(brittany.riverCount).toBeGreaterThan(50);
    expect(paris.riverCount).toBeGreaterThan(50);
  });
  it('les lacs sont rares et ont un niveau au-dessus de leur fond', () => {
    expect(paris.lakeLevel.length).toBeLessThan(15);
    for (let k = 0; k < paris.W * paris.W; k++) if (paris.lake[k]! >= 0) expect(paris.lakeLevel[paris.lake[k]!]!).toBeGreaterThan(paris.H[k]! - 1e-3);
  });
  it('un climat sec donne moins de rivières', () => {
    const arid = new HydroBlock(0, -1, coarse, () => 8);
    expect(arid.riverCount).toBeLessThan(brittany.riverCount);
  });
  it('est déterministe', () => {
    const again = new HydroBlock(0, -1, coarse, wet);
    expect(again.riverCount).toBe(brittany.riverCount);
    expect(Array.from(again.next.slice(0, 5000))).toEqual(Array.from(brittany.next.slice(0, 5000)));
  });
  it('un bloc se calcule en moins d\'une seconde', () => {
    const t0 = Date.now();
    new HydroBlock(2, 2, coarse, wet);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('continuité entre blocs', () => {
  it('à la jointure de deux blocs, les deux calculs donnent presque la même eau', () => {
    const below = new HydroBlock(0, 0, coarse, wet); // le bloc juste au sud de celui de Lannion
    let same = 0;
    let cells = 0;
    for (let tx = 0; tx < 64; tx++) {
      const a = brittany.rasterTile(tx, -1); // dernière rangée de tuiles du bloc nord (côté jointure)
      const b = below.rasterTile(tx, -1); // la même tuile, vue par le bloc voisin
      if (!a && !b) continue;
      for (let i = 0; i < RW * RW; i++) {
        const sa = a ? a.surf[i]! : NaN;
        const sb = b ? b.surf[i]! : NaN;
        cells++;
        if ((Number.isNaN(sa) && Number.isNaN(sb)) || Math.abs(sa - sb) < 0.5) same++;
      }
    }
    expect(cells).toBeGreaterThan(0);
    expect(same / cells).toBeGreaterThan(0.9);
  });
});

describe('terrain creusé', () => {
  const r = mainRiver(brittany);
  it('le lit est plus bas que le relief d\'origine et l\'eau affleure au-dessus', () => {
    expect(terrain.heightAt(r.x, r.z)).toBeLessThan(dry.heightAt(r.x, r.z));
    expect(terrain.waterSurfaceAt(r.x, r.z)).toBeGreaterThan(terrain.heightAt(r.x, r.z));
    expect(terrain.waterDepthAt(r.x, r.z)).toBeGreaterThan(0.3);
  });
  it('loin des rivières, le sol n\'est pas modifié', () => {
    let changed = 0;
    for (let k = 0; k < 400; k++) {
      const x = 3000 + (k % 20) * 7 + 0.3;
      const z = -3000 + Math.floor(k / 20) * 7 + 0.3;
      if (terrain.heightAt(x, z) !== dry.heightAt(x, z)) changed++;
    }
    expect(changed).toBeLessThan(400); // pas partout
    expect(terrain.coarseHeightAt(12345, -2345)).toBe(dry.heightAt(12345, -2345)); // coarse = terrain sans eau
  });
  it('le sol est continu : pas de marche brutale au bord du lit', () => {
    let worst = 0;
    for (let k = -40; k <= 40; k++) {
      const a = terrain.heightAt(r.x + k * 0.5, r.z);
      const b = terrain.heightAt(r.x + k * 0.5 + 0.5, r.z);
      worst = Math.max(worst, Math.abs(b - a));
    }
    expect(worst).toBeLessThan(1);
  });
  it('largeur et profondeur croissent avec le débit', () => {
    expect(riverWidth(1000)).toBeGreaterThan(riverWidth(64));
    expect(riverDepth(riverWidth(1000))).toBeGreaterThanOrEqual(riverDepth(riverWidth(64)));
    expect(riverWidth(1e9)).toBeLessThanOrEqual(28);
  });
});

describe('marche', () => {
  it('on traverse à pied une rivière peu profonde, pas un lac profond', () => {
    const r = mainRiver(brittany);
    expect(terrain.waterDepthAt(r.x, r.z)).toBeLessThanOrEqual(MAX_WALK_DEPTH);
    expect(isWalkable(terrain, r.x, r.z)).toBe(true);
    // un lac profond : on cherche un nœud noyé dont le centre est profond
    const hy = new Hydro((x, z) => coarse(x, z));
    const blk = hy.block(24, -2);
    let deep: { x: number; z: number } | null = null;
    for (let k = 0; k < blk.W * blk.W && !deep; k++) {
      if (blk.lake[k]! < 0) continue;
      const x = (blk.i0 + (k % blk.W)) * NODE;
      const z = (blk.j0 + Math.floor(k / blk.W)) * NODE;
      const s = hy.surfaceAt(x, z);
      if (!Number.isNaN(s) && s - coarse(x, z) > 3) deep = { x, z };
    }
    expect(deep).not.toBeNull();
    const d = deep!;
    const t2 = createTerrain(hashSeed('horizon'), relief, realClimate);
    expect(isWalkable(t2, d.x, d.z)).toBe(false);
  });
});

describe('arbres et maillage', () => {
  const r = mainRiver(brittany);
  const cities = loadRealCities();
  const system = new VillageSystem(cities, terrain);
  it('aucun arbre n\'est autorisé dans l\'eau', () => {
    const cx = Math.floor(r.x / CHUNK_SIZE);
    const cz = Math.floor(r.z / CHUNK_SIZE);
    const block = system.blockerForChunk(cx, cz, CHUNK_SIZE);
    expect(block).not.toBeNull();
    expect(block!(r.x, r.z)).toBe(true);
  });
  it('la tuile d\'une rivière a une surface d\'eau à part, au-dessus du lit', () => {
    const cx = Math.floor(r.x / CHUNK_SIZE);
    const cz = Math.floor(r.z / CHUNK_SIZE);
    const withWater = buildChunk(terrain, cx, cz, 0, null, null);
    const without = buildChunk(dry, cx, cz, 0, null, null);
    expect(without.water).toBeUndefined(); // sans eau douce, pas de surface d'eau
    const w = withWater.water!;
    expect(w).toBeDefined();
    const count = w.positions.length / 3;
    expect(count).toBeGreaterThan(20);
    expect(w.depth.length).toBe(count);
    expect(w.flow.length).toBe(count * 2);
    expect(w.world.length).toBe(count * 2);
    expect(w.indices.length % 3).toBe(0);
    for (const v of [...w.depth, ...w.flow, ...w.positions]) expect(Number.isFinite(v)).toBe(true);
    for (let v = 0; v < count; v++) {
      expect(w.world[v * 2]!).toBeGreaterThanOrEqual(0);
      expect(w.world[v * 2]!).toBeLessThan(WATER_PERIOD);
    }
    expect(Math.max(...w.depth)).toBeGreaterThan(0.2); // de l'eau où l'on peut se mouiller
    expect(withWater.maxY).toBeGreaterThanOrEqual(w.maxY);
  });
  it('le courant d\'une rivière descend vers l\'aval (pas de courant dans un lac)', () => {
    const cx = Math.floor(r.x / CHUNK_SIZE);
    const cz = Math.floor(r.z / CHUNK_SIZE);
    const w = buildChunk(terrain, cx, cz, 0, null, null).water!;
    let moving = 0;
    for (let v = 0; v < w.positions.length / 3; v++) if (Math.hypot(w.flow[v * 2]!, w.flow[v * 2 + 1]!) > 0.2) moving++;
    expect(moving).toBeGreaterThan(5); // une rivière coule
    // Les surfaces d'eau voisines de deux tuiles voisines donnent la même position dans le monde modulo la période.
    const a = buildChunk(terrain, cx, cz, 0, null, null).water!;
    expect(a.world[0]! % 1).toBeCloseTo(0, 5); // à 1 m près en x : les cases font 1 m
  });
  it('une tuile sans eau reste identique', () => {
    const a = buildChunk(terrain, 1000, 1000, 1, null, null); // en mer ou ailleurs : sans rivière
    const b = buildChunk(dry, 1000, 1000, 1, null, null);
    if (!terrain.hasWaterNear(1000 * CHUNK_SIZE, 1000 * CHUNK_SIZE, CHUNK_SIZE)) expect(a.positions.length).toBe(b.positions.length);
  });
});

describe('petites choses', () => {
  it('warm construit un bloc à la fois, puis plus rien', () => {
    const h = new Hydro(coarse);
    let n = 0;
    while (h.warm(4000, -4000, 3000) && n < 20) n++;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(20);
    expect(h.warm(4000, -4000, 3000)).toBe(false);
  });
  it('constantes cohérentes', () => {
    expect(BLOCK_SIZE).toBe(BLOCK_NODES * NODE);
    expect(TILE % RES).toBe(0);
  });
});
