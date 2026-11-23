// Le vent simulé (logique pure). Il suit les grandes ceintures de vent de la Terre :
// alizés près des tropiques (vers l'ouest), vents d'ouest aux latitudes moyennes, vents d'est près des pôles,
// calme relatif à l'équateur. Par-dessus, des perturbations lentes (les « systèmes météo ») qui varient avec
// la position et l'heure, et des rafales rapides. Même lieu + même instant = même vent.
// Plus tard (1.15), le vent réel d'Open-Meteo pourra remplacer ce vent simulé.

import { clamp, lerp } from './math';
import { Noise2D, hashSeed } from './noise';

// Un vent : vitesse (m/s) et direction D'OÙ il vient (radians, 0 = nord, π/2 = est, sens des aiguilles d'une montre).
export interface Wind {
  speed: number; // vitesse en m/s
  from: number; // direction d'origine, en radians
}

const KNOTS_PER_MS = 1.943844; // 1 m/s = 1,94 nœud
export const msToKnots = (ms: number): number => ms * KNOTS_PER_MS;

// Table : valeur moyenne en fonction de la latitude (en valeur absolue), interpolée linéairement.
function table(points: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= points[0]![0]) return points[0]![1]; // avant le premier point
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i]!; // point suivant
    const [x0, y0] = points[i - 1]!; // point précédent
    if (x <= x1) return lerp(y0, y1, (x - x0) / (x1 - x0)); // entre les deux
  }
  return points[points.length - 1]![1]; // après le dernier point
}

// Vent moyen vers l'est (m/s) selon |latitude| : négatif = vent d'est (alizés), positif = vent d'ouest.
const ZONAL: ReadonlyArray<readonly [number, number]> = [[0, -1.5], [10, -4.5], [20, -5], [30, -0.5], [40, 4.5], [50, 8], [60, 5], [70, -2], [80, -3], [90, -2]];
// Vent moyen vers le nord (m/s) dans l'hémisphère nord (inversé au sud) : négatif = vers l'équateur.
const MERID: ReadonlyArray<readonly [number, number]> = [[0, 0], [15, -2], [30, 0], [45, 1.5], [60, 0.5], [90, 0]];

const noise = new Noise2D(hashSeed('ThyHorizon-vent')); // source de perturbations, toujours la même

// Vent à une latitude/longitude (degrés) et un instant t (secondes de jeu).
export function windAt(latDeg: number, lonDeg: number, t: number): Wind {
  const a = Math.abs(latDeg); // latitude en valeur absolue
  const south = latDeg < 0 ? -1 : 1; // le côté méridien s'inverse dans l'hémisphère sud
  // Vent moyen de la ceinture (composantes est et nord).
  let east = table(ZONAL, a);
  let north = table(MERID, a) * south;
  // Perturbations lentes : changent sur ~4 h et ~1500 km (bruit dépendant du lieu et de l'heure).
  const slow = t / (4 * 3600); // temps lent, en « périodes de 4 h »
  east += 3.2 * noise.noise(lonDeg / 14 + slow, latDeg / 10);
  north += 3.2 * noise.noise(lonDeg / 14 - slow + 41.3, latDeg / 10 + 17.9);
  // Force générale : mélange de calme et de coup de vent (0,7 à 1,35 fois la valeur de base).
  const strength = 1 + 0.3 * noise.noise(lonDeg / 20 + 7.7, latDeg / 15 + slow * 0.6 + 3.1);
  let speed = Math.hypot(east, north) * strength;
  // Rafales : variations rapides de ±14 % (périodes d'environ 12 à 50 s).
  const gust = 0.06 * Math.sin(t * 0.52 + lonDeg * 0.9) + 0.05 * Math.sin(t * 0.19 + latDeg * 1.3) + 0.03 * Math.sin(t * 1.3 + 2);
  speed = clamp(speed * (1 + gust), 0.5, 28);
  // Direction d'origine : à l'opposé du sens où le vent souffle (est, nord).
  const from = Math.atan2(-east, -north); // 0 = nord, π/2 = est
  return { speed, from: (from + 2 * Math.PI) % (2 * Math.PI) };
}

// Vitesse du vent « vers où il souffle » dans le monde : x vers l'est, z vers le sud.
export function windVelocity(w: Wind): { x: number; z: number } {
  return { x: -w.speed * Math.sin(w.from), z: w.speed * Math.cos(w.from) };
}

// Force du vent en échelle de Beaufort (0 à 12) d'après la vitesse en m/s.
export function beaufort(ms: number): number {
  const limits = [0.3, 1.6, 3.4, 5.5, 8, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]; // bornes hautes des forces 0 à 11 (m/s)
  const i = limits.findIndex((l) => ms < l); // première borne dépassée
  return i === -1 ? 12 : i;
}

// Nom de la force en français.
export function beaufortName(force: number): string {
  const names = ['calme', 'très légère brise', 'légère brise', 'petite brise', 'jolie brise', 'bonne brise', 'vent frais', 'grand frais', 'coup de vent', 'fort coup de vent', 'tempête', 'violente tempête', 'ouragan'];
  return names[clamp(Math.round(force), 0, 12)]!;
}
