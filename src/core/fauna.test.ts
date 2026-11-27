// Tests de la faune (1.42) : lieux, heures, saisons, fuite, déterminisme, valeurs valides.
import { describe, expect, it } from 'vitest';
import { ALERT, ALL_SPECIES, FAUNA_CELL, FAUNA_RADIUS, Fauna, FaunaEnv, FaunaWorld, MAX_PER_SPECIES, Species, activity, critterAt, seedsForCell } from './fauna';

// Un monde de pacotille : plaine verte, une forêt à l'est, un lac au sud, la mer à l'ouest, un village au nord.
const world: FaunaWorld = {
  groundAt: (x) => (x < -2000 ? -5 : 20 + 0.001 * x),
  waterDepthAt: (x, z) => (z > 3000 && z < 3200 && x > -1000 && x < 1000 ? 1.5 : 0),
  biomeAt: (x) => (x > 2000 ? { forest: 0.9, lush: 0.9 } : { forest: 0.05, lush: 0.8 }),
  nearSea: (x) => x < -1500,
  farmNear: (x, z) => (Math.hypot(x, z + 4000) < 700 ? { x: 0, z: -4000, r: 60 } : null),
};
const noon: FaunaEnv = { hours: 12.5, tempC: 22, rain: 0, snow: 0 };
const night: FaunaEnv = { ...noon, hours: 2 };
const dusk: FaunaEnv = { ...noon, hours: 18 };

// Toutes les bêtes dehors autour d'un point, à un instant.
const around = (x: number, z: number, e: FaunaEnv, t = 100): ReturnType<Fauna['around']> => new Fauna(world).around(x, z, e, t);
const count = (list: { species: Species }[], s: Species): number => list.filter((c) => c.species === s).length;

describe('lieux de vie', () => {
  it('la plaine a des oiseaux, des papillons et des lapins ; pas de cerfs', () => {
    let songs = 0, butter = 0, rabbits = 0, deer = 0;
    for (let k = 0; k < 6; k++) {
      const l = around(k * 280, 600, noon); // reste dans la plaine (x < 2 000)
      songs += count(l, 'songbird'); butter += count(l, 'butterfly'); rabbits += count(l, 'rabbit'); deer += count(l, 'deer');
    }
    expect(songs).toBeGreaterThan(0);
    expect(butter).toBeGreaterThan(0);
    expect(rabbits).toBeGreaterThan(0);
    expect(deer).toBe(0);
  });
  it('la forêt a des cerfs (à l\'aube ou au crépuscule)', () => {
    let deer = 0;
    for (let k = 0; k < 6; k++) deer += count(around(3000 + k * 500, 0, dusk), 'deer');
    expect(deer).toBeGreaterThan(0);
  });
  it('les mouettes sont près de la mer, pas en pleine plaine', () => {
    let coast = 0, inland = 0;
    for (let k = 0; k < 6; k++) { coast += count(around(-1800 - k * 40, k * 300, noon), 'gull'); inland += count(around(5000, k * 300, noon), 'gull'); }
    expect(coast).toBeGreaterThan(0);
    expect(inland).toBe(0);
  });
  it('les libellules vivent près de l\'eau seulement', () => {
    let lake = 0, dry = 0;
    for (let k = 0; k < 5; k++) { lake += count(around(-800 + k * 400, 3100, noon), 'dragonfly'); dry += count(around(-800 + k * 400, 1000, noon), 'dragonfly'); }
    expect(lake).toBeGreaterThan(0);
    expect(dry).toBe(0);
  });
  it('le bétail pâture autour du village, pas ailleurs', () => {
    let near = 0, far = 0;
    for (let k = 0; k < 8; k++) { const l = around(-300 + k * 90, -3800 - 150, noon); near += count(l, 'sheep') + count(l, 'cow'); const f = around(-300 + k * 90, 800, noon); far += count(f, 'sheep') + count(f, 'cow'); }
    expect(near).toBeGreaterThan(0);
    expect(far).toBe(0);
  });
  it('rien en pleine mer', () => {
    expect(seedsForCell({ ...world, groundAt: () => -20 }, 5, 5)).toEqual([]);
  });
});

describe('heures, saisons, météo', () => {
  it('la nuit : ni oiseaux chanteurs, ni papillons, ni mouettes', () => {
    for (const s of ['songbird', 'butterfly', 'dragonfly', 'gull', 'raptor'] as Species[]) expect(activity(s, night)).toBe(0);
  });
  it('les cerfs et les lapins sortent surtout à l\'aube et au crépuscule', () => {
    expect(activity('deer', dusk)).toBeGreaterThan(activity('deer', noon));
    expect(activity('rabbit', dusk)).toBeGreaterThan(activity('rabbit', noon));
    expect(activity('deer', night)).toBeGreaterThan(0); // pas totalement absents la nuit
  });
  it('les papillons ont besoin de douceur, pas de pluie, pas de neige', () => {
    expect(activity('butterfly', { ...noon, tempC: 5 })).toBe(0);
    expect(activity('butterfly', { ...noon, rain: 0.4 })).toBe(0);
    expect(activity('butterfly', { ...noon, snow: 1 })).toBe(0);
    expect(activity('butterfly', noon)).toBeGreaterThan(0.9);
  });
  it('sous la pluie forte, plus d\'oiseaux chanteurs', () => {
    expect(activity('songbird', { ...noon, rain: 0.9 })).toBe(0);
    expect(activity('songbird', noon)).toBeGreaterThan(0.9);
  });
  it('le bétail est toujours là', () => {
    expect(activity('cow', night)).toBe(1);
    expect(activity('sheep', { ...noon, rain: 1 })).toBe(1);
  });
  it('plus d\'animaux de jour que de nuit', () => {
    let day = 0, dark = 0;
    for (let k = 0; k < 6; k++) { day += around(k * 500, 600, noon).length; dark += around(k * 500, 600, night).length; }
    expect(day).toBeGreaterThan(dark);
  });
});

describe('mouvement', () => {
  const l = around(600, 600, noon, 500);
  it('déterministe : mêmes lieu et heure, mêmes bêtes', () => {
    expect(JSON.stringify(around(600, 600, noon, 500))).toBe(JSON.stringify(l));
  });
  it('toutes les valeurs sont valides', () => {
    expect(l.length).toBeGreaterThan(0);
    for (const c of l) {
      for (const v of [c.x, c.y, c.z, c.yaw, c.scale, c.flap, c.moving, ...c.tint]) expect(Number.isFinite(v)).toBe(true);
      expect(c.scale).toBeGreaterThan(0.3);
      expect(c.flap).toBeGreaterThanOrEqual(-1);
      expect(c.flap).toBeLessThanOrEqual(1);
    }
  });
  it('les oiseaux volent au-dessus du sol, les bêtes marchent dessus', () => {
    let flyers = 0, walkers = 0;
    for (let k = 0; k < 6; k++) for (const c of around(k * 500, 900, noon, 321)) {
      const g = world.groundAt(c.x, c.z);
      if (c.species === 'songbird' || c.species === 'gull' || c.species === 'raptor') { expect(c.y).toBeGreaterThan(g + 2); flyers++; }
      if (c.species === 'rabbit' || c.species === 'deer') { expect(c.y).toBeGreaterThanOrEqual(g); expect(c.y).toBeLessThan(g + 0.5); walkers++; }
    }
    expect(flyers).toBeGreaterThan(0);
    expect(walkers).toBeGreaterThan(0);
  });
  it('les bêtes bougent avec le temps', () => {
    const a = around(600, 600, noon, 100);
    const b = around(600, 600, noon, 130);
    const ba = new Map(b.map((c) => [c.id, c]));
    let moved = 0;
    for (const c of a) { const o = ba.get(c.id); if (o && Math.hypot(o.x - c.x, o.z - c.z) > 0.5) moved++; }
    expect(moved).toBeGreaterThan(0);
  });
  it('mouvement continu : pas de téléportation entre deux images', () => {
    const f = new Fauna(world);
    for (let t = 100; t < 130; t += 0.05) {
      const a = f.around(600, 600, noon, t);
      const b = f.around(600, 600, noon, t + 0.05);
      const bm = new Map(b.map((c) => [c.id, c]));
      for (const c of a) { const o = bm.get(c.id); if (o && c.species !== 'rabbit' && c.species !== 'deer') expect(Math.hypot(o.x - c.x, o.z - c.z)).toBeLessThan(2); }
      if (t > 102) break; // quelques secondes suffisent
    }
  });
  it('la fuite : une bête ne laisse pas le joueur s\'approcher en dessous de son rayon d\'alerte', () => {
    let tested = 0;
    for (let cx = 10; cx < 40 && tested < 5; cx++) {
      for (const s of seedsForCell(world, cx, 15)) {
        if (s.species !== 'rabbit' && s.species !== 'deer') continue;
        const e: FaunaEnv = { ...noon, hours: 18 };
        let c = null;
        for (let k = 0; k < 40 && !c; k++) c = critterAt(s, world, e, s.hx + 0.3, s.hz, 50 + k * 17);
        if (!c) continue;
        const d = Math.hypot(c.x - (s.hx + 0.3), c.z - s.hz);
        expect(d).toBeGreaterThanOrEqual(ALERT[s.species] - 1e-6);
        expect(c.moving).toBe(1);
        tested++;
      }
    }
    expect(tested).toBeGreaterThan(0);
  });
  it('rien dans l\'eau profonde', () => {
    const wet: FaunaWorld = { ...world, waterDepthAt: () => 2 };
    for (const s of seedsForCell(world, 12, 12)) if (s.species === 'rabbit' || s.species === 'deer') expect(critterAt(s, wet, noon, 1e5, 1e5, 10)).toBeNull();
  });
});

describe('limites', () => {
  it('au plus MAX_PER_SPECIES par espèce, tout est dans le rayon', () => {
    const l = around(0, 600, noon, 7);
    for (const s of ALL_SPECIES) expect(count(l, s)).toBeLessThanOrEqual(MAX_PER_SPECIES);
    for (const c of l) expect(Math.hypot(c.x, c.z - 600)).toBeLessThan(FAUNA_RADIUS + 60);
  });
  it('les identifiants sont uniques', () => {
    const l = around(0, 600, noon, 7);
    expect(new Set(l.map((c) => c.id)).size).toBe(l.length);
  });
  it('la case garde la même liste de foyers à chaque appel', () => {
    expect(seedsForCell(world, 3, 4)).toEqual(seedsForCell(world, 3, 4));
    expect(FAUNA_CELL).toBe(40);
  });
});
