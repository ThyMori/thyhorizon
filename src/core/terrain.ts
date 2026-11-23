// Le relief du monde : une côte basque imaginaire, infinie.
//
// Repère du monde (en mètres) :
//   +x = est, -x = ouest, +z = sud, -z = nord, +y = haut. Le niveau de la mer est à y = 0.
//   L'océan s'étend à l'infini vers l'ouest (x négatif). La côte longe l'axe nord-sud.
//   En allant vers l'est, on monte : plage, collines vertes, puis montagnes.
// Tout est calculé à partir d'une graine : même graine, même monde.

import { clamp, smoothstep } from './math';
import { Noise2D, fbm } from './noise';

// Niveau de la mer.
export const SEA_LEVEL = 0;

// Un terrain : des fonctions qui répondent à « quelle altitude ici ? ».
export interface Terrain {
  readonly seed: number; // graine utilisée
  heightAt(x: number, z: number): number; // altitude du sol en (x, z), en mètres
  coastX(z: number): number; // position de la côte (x) pour un z donné
  colorNoise(x: number, z: number): number; // variation douce (-1..1) pour les couleurs du sol
}

// Position de départ du joueur.
export interface Spawn {
  x: number;
  z: number;
  yaw: number; // direction du regard (radians, 0 = nord, π/2 = ouest)
  pitch: number; // inclinaison du regard (radians)
}

// Fabrique un terrain à partir d'une graine.
export function createTerrain(seed: number): Terrain {
  const coastNoise = new Noise2D(seed + 11); // forme de la côte
  const hillNoise = new Noise2D(seed + 23); // collines
  const ridgeNoise = new Noise2D(seed + 37); // crêtes des montagnes
  const detailNoise = new Noise2D(seed + 51); // petits reliefs
  const colorN = new Noise2D(seed + 67); // variations de couleur

  // Où passe la côte (x) pour un z donné : des caps et des baies à deux échelles.
  const coastX = (z: number): number =>
    260 * fbm(coastNoise, z * 0.0011, 0.37, 3) + // grandes baies (centaines de mètres)
    70 * fbm(coastNoise, z * 0.006, 9.1, 2); // petits caps

  const heightAt = (x: number, z: number): number => {
    const d = x - coastX(z); // distance vers l'intérieur des terres (négatif = en mer)

    if (d <= 0) {
      // Fond marin : pente douce qui s'approfondit jusqu'à environ -60 m.
      const base = -60 * (1 - Math.exp(d / 400)); // 0 à la côte, tend vers -60 au large
      const ripple = 1.4 * fbm(detailNoise, x * 0.02, z * 0.02, 2) * smoothstep(0, 60, -d); // dunes sous l'eau
      return base + ripple;
    }

    // Terre : on additionne plage, collines et montagnes, chacune avec son "masque" selon la distance à la côte.
    const beach = 2.2 * smoothstep(0, 90, d); // plage qui monte à ~2 m
    const hillMask = smoothstep(60, 500, d); // les collines apparaissent après la plage
    const hills = fbm(hillNoise, x * 0.0035, z * 0.0035, 4) * 0.5 + 0.5; // 0..1
    const mountainMask = smoothstep(450, 1700, d); // les montagnes montent à partir de ~500 m dans les terres
    const massif = fbm(ridgeNoise, x * 0.0008, z * 0.0008, 3) * 0.5 + 0.5; // 0..1, relief ample et doux (pas de crêtes en lame)
    const ridged = Math.pow(clamp(massif * 1.15 - 0.05, 0, 1), 2.2); // creuse les vallées, arrondit les sommets
    const detailMask = smoothstep(30, 200, d); // pas de bosses sur la plage
    const detail =
      (fbm(detailNoise, x * 0.03, z * 0.03, 3) * 1.2 + // bosses de quelques mètres
        fbm(detailNoise, x * 0.12, z * 0.12, 2) * 0.25) * // petites irrégularités
      detailMask;
    return beach + hillMask * hills * 45 + mountainMask * (ridged * 460 + hills * 50) + detail;
  };

  const colorNoise = (x: number, z: number): number =>
    fbm(colorN, x * 0.045, z * 0.045, 3) * 0.7 + fbm(colorN, x * 0.5, z * 0.5, 1) * 0.3; // taches larges + grain fin

  return { seed, heightAt, coastX, colorNoise };
}

// Trouve un point de départ agréable : sur la plage, face à l'océan.
export function findSpawn(terrain: Terrain): Spawn {
  const z = 0; // on commence à z = 0
  const x = terrain.coastX(z) + 160; // 160 m à l'intérieur des terres : sur l'herbe, au-dessus de la plage
  return { x, z, yaw: Math.PI / 2, pitch: 0.04 }; // on regarde vers l'ouest (l'océan), un peu vers le ciel
}

// Pente du terrain (0 = plat, 1 = 45°) estimée autour d'un point.
export function slopeAt(terrain: Terrain, x: number, z: number, step = 1): number {
  const dx = (terrain.heightAt(x + step, z) - terrain.heightAt(x - step, z)) / (2 * step); // pente en x
  const dz = (terrain.heightAt(x, z + step) - terrain.heightAt(x, z - step)) / (2 * step); // pente en z
  return clamp(Math.hypot(dx, dz), 0, 10); // norme de la pente
}
