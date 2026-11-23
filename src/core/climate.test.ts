// Tests du climat : données réelles (Köppen-Geiger), mélange entre cases, couleurs du sol.
import { describe, expect, it } from 'vitest';
import { BIOMES, createClimate, decodeClimate, uniformClimate } from './climate';
import type { ClimateFile } from './climate';
import { terrainColor } from './palette';
import { realClimate } from '../world/climateData';
import data from '../data/climate.json';

const file = data as unknown as ClimateFile;

describe('données réelles', () => {
  it('couvrent toute la grille', () => {
    expect(decodeClimate(file).length).toBe(720 * 360);
  });
  it('ont un biome pour chaque classe', () => {
    for (const name of file.classes) expect(BIOMES[name], name).toBeDefined();
  });
  it('donnent le bon climat à des lieux connus', () => {
    expect(realClimate.classAt(48.73, -3.46)).toBe('Cfb'); // Lannion : océanique
    expect(realClimate.classAt(23, 12)).toBe('BWh'); // Sahara
    expect(realClimate.classAt(-3, -60)).toBe('Af'); // Amazonie
    expect(realClimate.classAt(-80, 0)).toBe('EF'); // Antarctique
    expect(realClimate.classAt(62, 100)).toMatch(/^D/); // Sibérie
    expect(realClimate.classAt(33, 88)).toMatch(/^E/); // plateau tibétain
  });
  it('donnent un climat même en pleine mer (la côte la plus proche)', () => {
    expect(BIOMES[realClimate.classAt(40, -35)]).toBeDefined(); // milieu de l'Atlantique
  });
  it('se referment sur la ligne de changement de date et ne plantent pas aux pôles', () => {
    expect(realClimate.classAt(0, 179.9)).toBeDefined();
    expect(realClimate.classAt(0, -179.9)).toBeDefined();
    for (const lat of [90, -90]) for (const lon of [-180, 0, 180, 540]) {
      const b = realClimate.biomeAt(lat, lon);
      expect(Number.isFinite(b.snowLine)).toBe(true);
    }
  });
});

describe('mélange entre cases', () => {
  it('passe en douceur d\'un biome à l\'autre', () => {
    // Traversée de l'Afrique de l'ouest du sud au nord (forêt → savane → Sahel → désert) : pas de saut brutal entre deux points voisins.
    let prev = realClimate.biomeAt(0, 10).grassLight;
    for (let lat = 0.05; lat <= 30; lat += 0.05) {
      const cur = realClimate.biomeAt(lat, 10).grassLight;
      expect(Math.abs(cur[0] - prev[0]) + Math.abs(cur[1] - prev[1]) + Math.abs(cur[2] - prev[2])).toBeLessThan(0.12);
      prev = cur;
    }
  });
  it('reproduit exactement le biome au centre d\'une case', () => {
    const c = createClimate({ width: 4, height: 2, classes: ['Af', 'EF'], rle: [0, 4, 1, 4] });
    expect(c.biomeAt(45, -135).snowLine).toBeCloseTo(BIOMES.Af!.snowLine, 5);
  });
});

describe('couleurs du sol selon le climat', () => {
  const brightness = (c: readonly number[]): number => c[0]! + c[1]! + c[2]!;
  it('le désert est plus clair et plus rouge que la forêt équatoriale', () => {
    const desert = terrainColor(300, 1, 0, BIOMES.BWh);
    const forest = terrainColor(300, 1, 0, BIOMES.Af);
    expect(brightness(desert)).toBeGreaterThan(brightness(forest));
    expect(desert[0]).toBeGreaterThan(desert[2]);
    expect(forest[1]).toBeGreaterThan(forest[0]);
  });
  it('la neige commence bien plus bas près des pôles que sous les tropiques', () => {
    const tundra = terrainColor(1200, 1, 0, BIOMES.ET);
    const tropics = terrainColor(1200, 1, 0, BIOMES.Af);
    expect(brightness(tundra)).toBeGreaterThan(brightness(tropics));
  });
  it('la glace est blanche même au niveau de la mer, sans plage', () => {
    const ice = terrainColor(2, 1, 0, BIOMES.EF);
    expect(Math.min(...ice)).toBeGreaterThan(0.5);
  });
  it('sans biome précisé, garde les couleurs d\'origine (océanique)', () => {
    expect(terrainColor(100, 1, 0)).toEqual(terrainColor(100, 1, 0, BIOMES.Cfb));
  });
  it('le climat uniforme répond partout pareil', () => {
    const u = uniformClimate('BWh');
    expect(u.classAt(10, 10)).toBe('BWh');
    expect(u.biomeAt(-40, 100)).toBe(BIOMES.BWh);
  });
});
