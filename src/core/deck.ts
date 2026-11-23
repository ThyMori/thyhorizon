// Marcher sur le pont du voilier (logique pure). Les positions sont dans le repère du bateau :
// u = avant/arrière depuis le milieu (+ vers l'avant), v = tribord (+ à droite). Mètres.
// Le plan vient de LAYOUT (core/hull.ts) : cockpit creusé, rouf infranchissable, deux passavants, plage avant.

import { LAYOUT, cabinHalfWidth, deckHeight, halfBeam, stationOf } from './hull';
import type { BoatSpec } from './sailing';

export const WALK_EYE = 1.65; // hauteur des yeux au-dessus de la surface où l'on se tient (m)
export const WALK_SPEED = 1.5; // vitesse de marche à bord (m/s) : prudente, ça bouge
const EDGE_MARGIN = 0.18; // on reste en deçà des filières (m)
const CABIN_MARGIN = 0.08; // marge autour du rouf
const WHEEL = { u: LAYOUT.wheelU, v: 0, r: 0.32 }; // le piédestal de la roue bloque le passage

export interface DeckPos {
  u: number;
  v: number;
}

// Position des yeux du barreur (derrière la roue, debout dans le cockpit) et zone d'où l'on peut reprendre la barre.
export const HELM_POS: DeckPos = { u: LAYOUT.wheelU - 0.7, v: 0 };
export const HELM_REACH = 1.0;

// Peut-on se tenir ici ?
export function walkable(spec: BoatSpec, u: number, v: number): boolean {
  const L = spec.length;
  if (u < -L / 2 + 0.45 || u > L / 2 - 0.9) return false; // tableau arrière et pulpit d'étrave
  if (Math.abs(v) > halfBeam(spec, stationOf(spec, u)) - EDGE_MARGIN) return false; // au-delà des filières : l'eau
  const c = LAYOUT.cabin;
  if (u > c.u0 - CABIN_MARGIN && u < c.u1 + CABIN_MARGIN && Math.abs(v) < cabinHalfWidth(u) + CABIN_MARGIN) return false; // le rouf
  if (Math.hypot(u - WHEEL.u, v - WHEEL.v) < WHEEL.r) return false; // la roue
  return true;
}

// Déplace de (du, dv) en glissant le long des obstacles : si le pas complet est bloqué, on essaie chaque axe.
export function moveOnDeck(spec: BoatSpec, p: DeckPos, du: number, dv: number): DeckPos {
  if (walkable(spec, p.u + du, p.v + dv)) return { u: p.u + du, v: p.v + dv };
  if (walkable(spec, p.u + du, p.v)) return { u: p.u + du, v: p.v };
  if (walkable(spec, p.u, p.v + dv)) return { u: p.u, v: p.v + dv };
  return { u: p.u, v: p.v };
}

// Hauteur du sol sous les pieds (m au-dessus de la flottaison) : plancher du cockpit, sinon pont.
export function deckSurface(spec: BoatSpec, u: number, v: number): number {
  const k = LAYOUT.cockpit;
  if (u > k.u0 && u < k.u1 && Math.abs(v) < k.half) return k.floor;
  return deckHeight(stationOf(spec, u));
}

// Le joueur est-il assez près de la roue pour la reprendre ?
export const nearHelm = (p: DeckPos): boolean => Math.hypot(p.u - HELM_POS.u, p.v - HELM_POS.v) < HELM_REACH;

// Convertit le regard (angle relatif au bateau, rad ; 0 = vers l'avant, + = vers bâbord comme le yaw) et une intention
// (avancer, aller à droite : de −1 à 1) en déplacement dans le repère du bateau.
export function deckStep(relYaw: number, forward: number, right: number, dist: number): { du: number; dv: number } {
  // l'avant du regard vaut (cos θ, −sin θ) en (avant, tribord) ; la droite du regard vaut (sin θ, cos θ)
  const du = forward * Math.cos(relYaw) + right * Math.sin(relYaw);
  const dv = -forward * Math.sin(relYaw) + right * Math.cos(relYaw);
  const n = Math.hypot(du, dv);
  if (n < 1e-6) return { du: 0, dv: 0 };
  const k = dist / Math.max(1, n); // on ne dépasse jamais « dist » (pas de diagonale plus rapide)
  return { du: du * k, dv: dv * k };
}
