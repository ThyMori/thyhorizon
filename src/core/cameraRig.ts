// La caméra à la première ou à la troisième personne. Logique pure : où se place la caméra par rapport aux yeux du joueur.
// À la première personne la caméra EST les yeux ; à la troisième elle recule derrière l'épaule, sans jamais passer sous le sol.

export type ViewMode = 'first' | 'third';

export const THIRD_DISTANCE = 3.4; // recul de la caméra (m)
export const THIRD_SHOULDER = 0.5; // décalage à droite (m) : le joueur n'est pas pile au centre, on voit mieux devant lui
export const GROUND_MARGIN = 0.35; // la caméra reste au moins à cette hauteur au-dessus du sol (m)

export const toggleView = (m: ViewMode): ViewMode => (m === 'first' ? 'third' : 'first');

// Fondu entre les deux vues : 0 = première personne, 1 = troisième. La caméra glisse au lieu de sauter.
export function nextViewBlend(blend: number, mode: ViewMode, dt: number): number {
  const target = mode === 'third' ? 1 : 0;
  const b = blend + (target - blend) * (1 - Math.exp(-6 * Math.max(dt, 0)));
  return Math.abs(target - b) < 0.002 ? target : b; // on « arrive » vraiment (pas de queue infinie)
}

// Vecteur des yeux vers la caméra : en arrière le long du regard, un peu vers la droite. Même repère que le jeu (yaw 0 = nord = −z).
export function thirdPersonOffset(yaw: number, pitch: number, distance: number, shoulder: number): [number, number, number] {
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp; // direction du regard
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * cp;
  const rx = Math.cos(yaw); // droite du joueur
  const rz = -Math.sin(yaw);
  return [-fx * distance + rx * shoulder, -fy * distance, -fz * distance + rz * shoulder];
}

// Hauteur de la caméra corrigée pour rester au-dessus du sol (et de la mer : niveau 0).
export const clampAboveGround = (y: number, ground: number, margin = GROUND_MARGIN): number => Math.max(y, Math.max(ground, 0) + margin);
