// L'état de la mer (logique pure) : la hauteur des vagues vient du vent qui souffle depuis assez longtemps
// (« mer du vent ») et de la houle venue de loin (liée aux dépressions). Elle réagit lentement : une rafale ne fait pas
// une grosse mer, mais une journée de coup de vent, oui. Les valeurs servent à la fois au rendu (shader) et à la physique du bateau.

import { clamp, lerp, smoothstep } from './math';

// La mer à un instant.
export interface SeaState {
  swell: number; // facteur appliqué aux vagues larges (celles qui font bouger le bateau) ; 1 = mer de base (≈ 1,2 m creux)
  chop: number; // facteur appliqué aux petites vagues et rides (le « clapot », visible seulement à l'image)
  foam: number; // 0 à 1 : part de crêtes qui moutonnent (moutons, « whitecaps »)
  hs: number; // hauteur significative de la mer (m), pour l'affichage et la physique
}

export const BASE_HS = 1.2; // hauteur significative de la mer « de base » décrite par WAVE_DEFS (3 vagues larges)
export const CALM_SEA: SeaState = { swell: 0.25, chop: 0.3, foam: 0, hs: 0.3 };

// Hauteur significative de la mer du vent (m) pour un vent établi de u m/s (formule de Pierson-Moskowitz : ≈ 0,0213 u²).
export const windSeaHs = (u: number): number => clamp(0.0213 * u * u, 0.08, 7);

// Hauteur de la houle (m) : liée à l'activité des dépressions (front, −1 à 1) et plus forte aux latitudes moyennes et hautes.
export function swellHs(front: number, latDeg: number): number {
  const lat = smoothstep(8, 45, Math.abs(latDeg)); // peu de houle à l'équateur
  return (0.25 + 1.5 * smoothstep(-0.4, 1, front)) * (0.55 + 0.7 * lat);
}

// État de mer « d'équilibre » pour un vent, une activité de dépression et une latitude.
export function seaStateFor(windSpeed: number, front: number, latDeg: number): SeaState {
  const hsW = windSeaHs(windSpeed);
  const hsS = swellHs(front, latDeg);
  const hs = Math.hypot(hsW, hsS); // les deux se composent en énergie
  return {
    swell: clamp(hs / BASE_HS, 0.12, 5),
    chop: clamp(windSpeed / 7, 0.15, 2.2),
    foam: smoothstep(5.5, 14, windSpeed) * 0.9, // les moutons commencent vers force 4 (≈ 6 m/s)
    hs,
  };
}

// Rapproche la mer de sa valeur d'équilibre : elle monte en quelques minutes et retombe un peu plus vite.
export function approachSea(current: SeaState, target: SeaState, dt: number): SeaState {
  const k = (rising: boolean): number => 1 - Math.exp(-dt / (rising ? 150 : 90)); // temps caractéristique en secondes
  const mix = (a: number, b: number): number => lerp(a, b, k(b > a));
  return { swell: mix(current.swell, target.swell), chop: mix(current.chop, target.chop), foam: mix(current.foam, target.foam), hs: mix(current.hs, target.hs) };
}

// Facteurs d'amplitude des six vagues de WAVE_DEFS : 3 larges (houle), 3 petites (clapot).
export const waveScales = (sea: SeaState): number[] => [sea.swell, sea.swell, sea.swell, sea.chop, sea.chop, sea.chop];

// Nom de l'état de mer (échelle de Douglas simplifiée), en français.
export function seaName(hs: number): string {
  if (hs < 0.1) return 'mer d’huile';
  if (hs < 0.5) return 'mer calme';
  if (hs < 1.25) return 'mer belle';
  if (hs < 2.5) return 'mer peu agitée';
  if (hs < 4) return 'mer agitée';
  if (hs < 6) return 'mer forte';
  return 'mer très forte';
}
