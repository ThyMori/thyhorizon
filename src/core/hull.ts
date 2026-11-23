// La forme de la coque (logique pure) : largeur, hauteur du pont et profondeur du fond le long du bateau.
// Le rendu (render/boat.ts) s'en sert pour construire la coque 3D. s va de 0 (arrière) à 1 (étrave).

import { clamp } from './math';
import type { BoatSpec } from './sailing';

// Demi-largeur de la coque en s : large au milieu, tronquée à l'arrière (tableau arrière), fine à l'étrave.
export function halfBeam(spec: BoatSpec, s: number): number {
  const t = clamp(s, 0, 1);
  const half = spec.beam / 2; // demi-largeur maximale
  if (t <= 0.42) return half * (0.72 + 0.28 * Math.sin((t / 0.42) * (Math.PI / 2))); // de l'arrière jusqu'au maître-bau
  return half * Math.pow(Math.max(0, Math.cos(((t - 0.42) / 0.58) * (Math.PI / 2))), 0.8); // puis l'étrave qui s'affine jusqu'à 0
}

// Hauteur du pont au-dessus de la flottaison (m) : un peu plus haut à l'étrave (le « tonture »).
export const deckHeight = (s: number): number => 0.85 + 0.25 * clamp(s, 0, 1) ** 2;

// Hauteur du fond de coque (négative : sous la flottaison). Plus profonde au milieu, qui remonte vers l'étrave et l'arrière.
export function bottomHeight(s: number): number {
  const t = clamp(s, 0, 1);
  return -(0.2 + 0.35 * Math.sin(Math.PI * Math.pow(t, 0.85))); // −0,2 aux extrémités, jusqu'à −0,55 au milieu
}

// ---------- Plan du bateau (en mètres ; u = avant/arrière depuis le milieu, + vers l'avant ; v = tribord) ----------
// Ces nombres servent au rendu maintenant, et serviront aux collisions (marcher sur le pont) et à la cabine ensuite.
export const LAYOUT = {
  cockpit: { u0: -4.05, u1: -1.0, half: 0.66, floor: 0.42 }, // cockpit creusé : arrière, avant, demi-largeur, hauteur du plancher au-dessus de l'eau
  cabin: { u0: -1.0, u1: 2.4, halfBack: 0.95, halfFront: 0.62, height: 0.5 }, // rouf : il rétrécit vers l'avant
  mastU: 1.1, // position du mât
  mastHeight: 11.2, // hauteur du mât au-dessus du rouf
  boomHeight: 1.05, // hauteur de la bôme au-dessus du pied de mât
  boomLength: 3.6, // longueur de la bôme
  wheelU: -3.05, // position de la barre à roue
  stemRake: 0.55, // de combien le bas de l'étrave est en retrait du haut (étrave inclinée)
} as const;

// Position relative s (0 arrière → 1 étrave) d'une position u.
export const stationOf = (spec: BoatSpec, u: number): number => clamp((u + spec.length / 2) / spec.length, 0, 1);

// Demi-largeur du rouf à la position u (m).
export function cabinHalfWidth(u: number): number {
  const c = LAYOUT.cabin;
  const t = clamp((u - c.u0) / (c.u1 - c.u0), 0, 1); // 0 à l'arrière du rouf, 1 à l'avant
  return c.halfBack + (c.halfFront - c.halfBack) * t;
}

// Hauteur du dessus du rouf à la position u (m au-dessus de l'eau) : il descend un peu vers l'avant.
export function roofHeight(spec: BoatSpec, u: number): number {
  const c = LAYOUT.cabin;
  const t = clamp((u - c.u0) / (c.u1 - c.u0), 0, 1);
  return deckHeight(stationOf(spec, u)) - 0.02 + c.height - 0.14 * t;
}

// Décalage vers l'arrière (m, ≤ 0) d'un point de coque : plus le point est bas et proche de l'étrave, plus il recule.
// fy = hauteur relative du point sur la section (0 fond, 1 pont).
export function rakeShift(s: number, fy: number): number {
  const bow = clamp((s - 0.55) / 0.45, 0, 1); // 0 avant les 55 % de la coque, 1 à l'étrave
  return -LAYOUT.stemRake * bow * bow * Math.pow(1 - clamp(fy, 0, 1), 1.4);
}
