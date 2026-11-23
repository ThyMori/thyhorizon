// Le soleil, la lune et les couleurs du ciel selon l'heure.
// Logique pure : à partir d'une heure (0 à 24) on obtient tout ce qu'il faut pour éclairer la scène.
// La position du soleil vient de la vraie astronomie (core/geo.ts) : elle dépend de la latitude, du jour de l'année
// et de l'heure solaire locale (midi = soleil plein sud). Il se lève donc à l'est, se couche à l'ouest, et la saison
// change sa hauteur et la durée du jour.

import { skyRotation, sunPosition } from './geo';
import { Rgb, clamp, lerp, lerpRgb, smoothstep } from './math';

// Tout ce qui dépend de l'heure. Les couleurs sont en sRGB (perceptuel).
export interface SunState {
  hours: number; // heure du jour, 0 ≤ h < 24
  elevationDeg: number; // hauteur du soleil au-dessus de l'horizon, en degrés (négatif = sous l'horizon)
  sunDirection: [number, number, number]; // vecteur unitaire vers le soleil
  moonDirection: [number, number, number]; // vecteur unitaire vers la lune (opposée au soleil)
  daylight: number; // 0 = nuit noire, 1 = plein jour
  skyTop: Rgb; // couleur du zénith
  skyHorizon: Rgb; // couleur de l'horizon (sert aussi pour la brume)
  sunColor: Rgb; // couleur de la lumière du soleil
  sunIntensity: number; // intensité de la lumière du soleil
  ambientIntensity: number; // intensité de la lumière ambiante (ciel)
  moonIntensity: number; // intensité de la lumière de la lune
  starsOpacity: number; // visibilité des étoiles (0 à 1)
  sunVisibility: number; // 0 = disque solaire caché, 1 = visible
  starRotation: number[]; // rotation du ciel étoilé : matrice 3×3 (ligne par ligne), du repère équatorial vers celui du jeu
}

// Un point de repère de couleurs, à une hauteur de soleil donnée.
interface Stop {
  elev: number; // hauteur du soleil en degrés
  top: Rgb; // zénith
  horizon: Rgb; // horizon
  sun: Rgb; // couleur du soleil
  sunI: number; // intensité du soleil
  ambI: number; // intensité ambiante
}

// Repères du plus bas au plus haut : la nuit, le crépuscule, l'heure dorée, le plein jour.
const STOPS: readonly Stop[] = [
  { elev: -90, top: [0.01, 0.015, 0.04], horizon: [0.03, 0.04, 0.09], sun: [1, 0.55, 0.3], sunI: 0, ambI: 0.3 },
  { elev: -12, top: [0.02, 0.03, 0.09], horizon: [0.06, 0.07, 0.16], sun: [1, 0.5, 0.25], sunI: 0, ambI: 0.32 },
  { elev: -5, top: [0.09, 0.12, 0.3], horizon: [0.45, 0.32, 0.4], sun: [1, 0.45, 0.2], sunI: 0, ambI: 0.5 },
  { elev: 0, top: [0.2, 0.28, 0.52], horizon: [0.95, 0.55, 0.36], sun: [1, 0.5, 0.2], sunI: 0.9, ambI: 0.8 },
  { elev: 4, top: [0.27, 0.4, 0.68], horizon: [0.98, 0.7, 0.45], sun: [1, 0.62, 0.32], sunI: 2.4, ambI: 1 },
  { elev: 12, top: [0.28, 0.46, 0.8], horizon: [0.8, 0.8, 0.82], sun: [1, 0.82, 0.62], sunI: 3, ambI: 1.15 },
  { elev: 35, top: [0.23, 0.46, 0.86], horizon: [0.7, 0.82, 0.95], sun: [1, 0.95, 0.88], sunI: 3.3, ambI: 1.25 },
  { elev: 90, top: [0.2, 0.44, 0.88], horizon: [0.68, 0.8, 0.95], sun: [1, 0.96, 0.9], sunI: 3.5, ambI: 1.3 },
];

// Ramène une heure dans [0 ; 24[.
export const wrapHours = (h: number): number => ((h % 24) + 24) % 24;

// Calcule tout l'état du ciel pour une heure solaire, une latitude (degrés) et un jour de l'année (1 à 365).
export function sunState(hoursIn: number, latDeg: number, day: number): SunState {
  const hours = wrapHours(hoursIn); // heure normalisée
  const { elevationDeg, direction: sunDirection } = sunPosition(latDeg, day, hours); // vraie position du soleil
  const moonDirection: [number, number, number] = [-sunDirection[0], -sunDirection[1], -sunDirection[2]]; // la lune est opposée

  // Interpolation entre les deux repères qui encadrent la hauteur du soleil.
  let lo = STOPS[0]!; // repère inférieur
  let hi = STOPS[STOPS.length - 1]!; // repère supérieur
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i]!;
    const b = STOPS[i + 1]!;
    if (elevationDeg >= a.elev && elevationDeg <= b.elev) {
      lo = a; // on a trouvé l'intervalle
      hi = b;
      break;
    }
  }
  const t = hi.elev === lo.elev ? 0 : clamp((elevationDeg - lo.elev) / (hi.elev - lo.elev), 0, 1); // position dans l'intervalle

  return {
    hours,
    elevationDeg,
    sunDirection,
    moonDirection,
    daylight: smoothstep(-6, 8, elevationDeg), // le jour s'installe entre -6° et 8°
    skyTop: lerpRgb(lo.top, hi.top, t),
    skyHorizon: lerpRgb(lo.horizon, hi.horizon, t),
    sunColor: lerpRgb(lo.sun, hi.sun, t),
    sunIntensity: lerp(lo.sunI, hi.sunI, t),
    ambientIntensity: lerp(lo.ambI, hi.ambI, t),
    moonIntensity: 0.5 * (1 - smoothstep(-6, 0, elevationDeg)), // la lune n'éclaire que quand le soleil est couché
    starsOpacity: 1 - smoothstep(-12, -3, elevationDeg), // les étoiles apparaissent après le crépuscule
    sunVisibility: smoothstep(-2, 2, elevationDeg), // le disque solaire disparaît sous l'horizon
    starRotation: skyRotation(latDeg, day, hours), // le ciel étoilé tourne avec l'heure, la saison et la latitude
  };
}
