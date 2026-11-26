// Le relief du monde : la vraie Terre en grandes lignes, un détail inventé par-dessus.
//
// Repère du monde (en mètres, depuis Lannion) : +x = est, −x = ouest, +z = sud, −z = nord, +y = haut. Niveau de la mer : y = 0.
// Chaque point du monde correspond à une vraie latitude et longitude (geo.ts). Le relief réel (océans, côtes, massifs : grille de ~18 km,
// relief.ts) donne la forme générale ; le terrain y ajoute des collines, des bosses et des détails de plus en plus fins, plus ou moins
// marqués selon la « rugosité » réelle du lieu (plat en Beauce, tourmenté dans les Alpes). Même graine → même détail, toujours.

import { worldToLatLon } from './geo';
import { clamp, smoothstep } from './math';
import { Noise2D, fbm } from './noise';
import { Biome, Climate, uniformClimate } from './climate';
import { Hydro, RoadProvider } from './hydro';
import type { Relief } from './relief';

// Niveau de la mer.
export const SEA_LEVEL = 0;

// Un terrain : des fonctions qui répondent à « quelle altitude ici ? ».
export interface Terrain {
  readonly seed: number; // graine utilisée
  heightAt(x: number, z: number): number; // altitude du sol en (x, z), en mètres (lits des rivières creusés)
  coarseHeightAt(x: number, z: number): number; // altitude SANS les rivières : plus rapide, pour les calculs sur de grandes zones (chemins, carte, recalage des villes)
  waterSurfaceAt(x: number, z: number): number; // hauteur de l'eau d'une rivière ou d'un lac en (x, z) (NaN = ni eau ni rive)
  waterDepthAt(x: number, z: number): number; // profondeur de l'eau douce ici (0 = à sec)
  hasWaterNear(x0: number, z0: number, size: number): boolean; // y a-t-il de l'eau douce dans ce carré ? (rapide)
  setRoads(roads: RoadProvider): void; // branche les chemins de terre : là où ils traversent l'eau, un gué est aménagé (fond remonté)
  warmWater(x: number, z: number, r: number): boolean; // prépare à l'avance les calculs d'eau près d'ici (un bloc à la fois) ; true s'il a travaillé
  realHeightAt(x: number, z: number): number; // altitude réelle lissée (sans détail inventé), en mètres
  colorNoise(x: number, z: number): number; // variation douce (-1..1) pour les couleurs du sol
  forestNoise(x: number, z: number): number; // grandes taches (-1..1) : où les forêts se regroupent, où s'ouvrent les clairières
  biomeAt(x: number, z: number): Biome; // climat d'ici : couleurs de la végétation, altitude de la neige
  climateClassAt(x: number, z: number): string; // classe de Köppen d'ici (ex. « Cfb » à Lannion) : sert au style des villages
}

// Position de départ du joueur.
export interface Spawn {
  x: number;
  z: number;
  yaw: number; // direction du regard (radians, 0 = nord, π/2 = ouest)
  pitch: number; // inclinaison du regard (radians)
}

// La grille réelle est floue (cases de ~18 km) : près de la mer, les pentes sont trop douces pour faire une vraie côte.
// On les redresse : sous 60 m d'altitude (ou de profondeur), l'altitude passe par une racine carrée, ce qui crée plages et falaises.
const SHORE_RANGE = 60;
const sharpenShore = (h: number): number => {
  const a = Math.abs(h);
  return a >= SHORE_RANGE ? h : Math.sign(h) * SHORE_RANGE * Math.sqrt(a / SHORE_RANGE);
};

// Fabrique un terrain à partir d'une graine et du relief réel.
export function createTerrain(seed: number, relief: Relief, climate: Climate = uniformClimate(), withWater = true): Terrain {
  const hillNoise = new Noise2D(seed + 23); // grandes collines
  const midNoise = new Noise2D(seed + 29); // collines moyennes
  const smallNoise = new Noise2D(seed + 37); // bosses
  const fineNoise = new Noise2D(seed + 51); // petites irrégularités
  const ridgeNoise = new Noise2D(seed + 59); // crêtes des montagnes
  const coastNoise = new Noise2D(seed + 11); // forme des côtes
  const colorN = new Noise2D(seed + 67); // variations de couleur
  const forestN = new Noise2D(seed + 71); // forêts et clairières

  // Altitude réelle lissée, redressée près de la mer.
  const base = (x: number, z: number): number => {
    const { lat, lon } = worldToLatLon(x, z);
    return sharpenShore(relief.heightAt(lat, lon));
  };

  const coarseHeightAt = (x: number, z: number): number => {
    const { lat, lon } = worldToLatLon(x, z);
    const real = relief.heightAt(lat, lon); // altitude réelle (m)
    const shaped = sharpenShore(real); // redressée près de la mer
    const rough = relief.roughnessAt(lat, lon); // rugosité réelle (m) autour d'ici

    // Côtes : de petites ondulations déplacent la ligne de rivage (caps et baies), seulement près de l'eau.
    const nearShore = 1 - smoothstep(30, 120, Math.abs(shaped));
    const wobble = (12 * fbm(coastNoise, x / 2500, z / 2500, 3) + 4 * fbm(coastNoise, x / 400, z / 400, 2)) * nearShore;

    if (shaped < 0) {
      // Mer : dunes sous l'eau, de plus en plus marquées en s'éloignant de la côte.
      const ripple = 1.2 * fbm(smallNoise, x / 60, z / 60, 2) * smoothstep(0, 40, -shaped);
      return shaped + wobble + ripple;
    }

    // Terre : l'amplitude du détail suit la rugosité réelle. Chaque couche est plus fine et plus faible que la précédente.
    const amp = clamp(8 + 0.3 * rough, 8, 420);
    const land = smoothstep(0, 40, shaped); // pas de relief inventé sur la plage
    let detail =
      amp * (0.5 * fbm(hillNoise, x / 5000, z / 5000, 3) + 0.22 * fbm(midNoise, x / 900, z / 900, 3) + 0.07 * fbm(smallNoise, x / 150, z / 150, 2)) +
      Math.min(amp * 0.02, 2) * fbm(fineNoise, x / 25, z / 25, 2); // bosses de quelques mètres
    // Montagnes : des crêtes plus nettes là où le relief réel est haut.
    const mountains = smoothstep(600, 1800, real);
    if (mountains > 0) detail += mountains * rough * 0.25 * (1 - Math.abs(fbm(ridgeNoise, x / 1800, z / 1800, 3)) - 0.5);
    return shaped + wobble + detail * land;
  };

  const realHeightAt = (x: number, z: number): number => base(x, z);

  // Eau douce : rivières et lacs calculés sur ce relief. Un climat sec demande un bassin plus grand pour qu'une rivière apparaisse.
  const hydro = withWater
    ? new Hydro(coarseHeightAt, (x, z) => {
        const { lat, lon } = worldToLatLon(x, z);
        const c = climate.classAt(lat, lon);
        return c.startsWith('B') ? 8 : c.startsWith('E') ? 2 : 1; // désert : 8 fois plus ; polaire : 2 fois plus
      })
    : null;
  const heightAt = hydro ? (x: number, z: number): number => coarseHeightAt(x, z) + hydro.deltaAt(x, z) : coarseHeightAt;
  const waterSurfaceAt = (x: number, z: number): number => (hydro ? hydro.surfaceAt(x, z) : NaN);
  const waterDepthAt = (x: number, z: number): number => {
    const s = waterSurfaceAt(x, z);
    return Number.isNaN(s) ? 0 : Math.max(0, s - heightAt(x, z));
  };

  const colorNoise = (x: number, z: number): number =>
    fbm(colorN, x * 0.045, z * 0.045, 3) * 0.7 + fbm(colorN, x * 0.5, z * 0.5, 1) * 0.3; // taches larges + grain fin

  const biomeAt = (x: number, z: number): Biome => {
    const { lat, lon } = worldToLatLon(x, z);
    return climate.biomeAt(lat, lon); // le climat réel de la Terre à cet endroit
  };

  const climateClassAt = (x: number, z: number): string => {
    const { lat, lon } = worldToLatLon(x, z);
    return climate.classAt(lat, lon); // la classe de Köppen réelle ici
  };

  const forestNoise = (x: number, z: number): number => fbm(forestN, x / 380, z / 380, 3); // taches de quelques centaines de mètres

  return {
    seed, heightAt, coarseHeightAt, waterSurfaceAt, waterDepthAt, realHeightAt, colorNoise, forestNoise, biomeAt, climateClassAt,
    hasWaterNear: (x0, z0, size) => (hydro ? hydro.hasWater(x0, z0, size) : false),
    warmWater: (x, z, r) => (hydro ? hydro.warm(x, z, r) : false),
    setRoads: (roads) => hydro?.setRoads(roads),
  };
}

// Trouve un point de départ agréable : sur la terre ferme, juste derrière la plage, face à la mer.
// Depuis Lannion on marche vers le nord jusqu'à la première eau, puis on se place à quelques dizaines de mètres en retrait.
export function findSpawn(terrain: Terrain): Spawn {
  const step = 25; // pas de recherche, en mètres
  const limit = 80000; // on cherche sur 80 km au plus
  let z = 0;
  if (terrain.heightAt(0, 0) < 1) {
    // Départ déjà dans l'eau (cas improbable) : on cherche la terre vers le sud.
    while (z < limit && terrain.heightAt(0, z) < 3) z += step;
    return { x: 0, z: z + 100, yaw: 0, pitch: 0.04 };
  }
  while (z > -limit && terrain.heightAt(0, z) > -1) z -= step; // vers le nord (−z) jusqu'à la mer
  let best = z + 120; // 120 m en retrait de l'eau
  for (let k = 0; k < 40 && (terrain.heightAt(0, best) < 2.5 || slopeAt(terrain, 0, best) > 0.3); k++) best += step; // un peu plus loin si c'est trop pentu ou trop bas
  return { x: 0, z: best, yaw: 0, pitch: 0.04 }; // on regarde vers le nord, la mer
}

// Pente du terrain (0 = plat, 1 = 45°) estimée autour d'un point.
export function slopeAt(terrain: Terrain, x: number, z: number, step = 1): number {
  const dx = (terrain.heightAt(x + step, z) - terrain.heightAt(x - step, z)) / (2 * step); // pente en x
  const dz = (terrain.heightAt(x, z + step) - terrain.heightAt(x, z - step)) / (2 * step); // pente en z
  return clamp(Math.hypot(dx, dz), 0, 10); // norme de la pente
}
