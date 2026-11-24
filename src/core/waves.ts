// Les vagues de l'océan, côté calcul (logique pure). Le même tableau sert au rendu (shader de l'océan)
// et à la physique du bateau : le bateau monte et descend exactement avec la surface qu'on voit.

// Vagues : somme de sinusoïdes dans des directions différentes (houle large + petites rides).
// Chaque vague : direction (dx, dz), nombre d'onde k (rad/m), vitesse w (rad/s), amplitude (m).
export const WAVE_DEFS = [
  { dx: 0.8, dz: 0.6, k: 0.09, w: 0.9, amp: 0.35 }, // houle principale (~70 m)
  { dx: -0.55, dz: 0.83, k: 0.14, w: 1.2, amp: 0.22 },
  { dx: 0.95, dz: -0.31, k: 0.26, w: 1.6, amp: 0.12 },
  { dx: -0.2, dz: -0.98, k: 0.47, w: 2.1, amp: 0.07 },
  { dx: 0.6, dz: -0.8, k: 0.9, w: 2.9, amp: 0.035 },
  { dx: 0.3, dz: 0.95, k: 1.7, w: 3.7, amp: 0.018 }, // petites rides
] as const;
export const LOW_WAVES = 3; // les trois premières déforment la surface ; toutes servent au calcul des reflets

// Hauteur de la surface de l'eau (en m, autour du niveau 0) au point du monde (x, z) à l'instant t (secondes).
// Ici on utilise les coordonnées du monde directement : le calcul se fait sur le processeur, pas sur la carte graphique.
// swell = facteur d'amplitude des vagues larges (1 = mer de base ; voir core/sea.ts).
export function waveHeight(x: number, z: number, t: number, swell = 1): number {
  let h = 0; // hauteur cumulée
  for (let i = 0; i < LOW_WAVES; i++) {
    const d = WAVE_DEFS[i]!; // la vague numéro i
    h += d.amp * swell * Math.sin((x * d.dx + z * d.dz) * d.k + t * d.w); // même formule que le shader (les trois vagues larges)
  }
  return h;
}
