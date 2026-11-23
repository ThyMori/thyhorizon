// Petites fonctions mathématiques réutilisées partout (logique pure, sans DOM ni rendu).

// Une couleur rouge/vert/bleu, chaque composante entre 0 et 1.
export type Rgb = [number, number, number];

// Borne une valeur entre un minimum et un maximum.
export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v)); // on prend le plus petit entre max et (le plus grand entre min et v)

// Interpolation linéaire : t=0 donne a, t=1 donne b.
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Transition douce : 0 avant e0, 1 après e1, courbe en S entre les deux.
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1); // position relative entre e0 et e1, bornée
  return t * t * (3 - 2 * t); // polynôme d'Hermite qui adoucit le début et la fin
}

// Interpolation linéaire entre deux couleurs.
export const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  lerp(a[0], b[0], t), // rouge
  lerp(a[1], b[1], t), // vert
  lerp(a[2], b[2], t), // bleu
];

// Convertit une composante sRGB (celle qu'on perçoit) en lumière linéaire (celle que calcule la carte graphique).
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); // formule officielle sRGB
}

// Longueur d'un vecteur 3D.
export const length3 = (x: number, y: number, z: number): number => Math.hypot(x, y, z);
