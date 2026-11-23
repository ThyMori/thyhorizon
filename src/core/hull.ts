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
