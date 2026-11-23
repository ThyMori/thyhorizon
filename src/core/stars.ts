// Les étoiles : couleur, éclat et taille d'après le vrai catalogue (magnitude et indice de couleur B-V).
// Logique pure : fabrique les tableaux de nombres que le rendu envoie à la carte graphique.

import { Rgb, clamp, lerpRgb, srgbToLinear } from './math';

// Une étoile du catalogue : ascension droite (°), déclinaison (°), magnitude (plus petit = plus brillant), indice de couleur B-V.
export type StarRow = readonly [number, number, number, number];

// Couleur apparente selon l'indice B-V (bleu ≈ −0,3, blanc ≈ 0, jaune du Soleil ≈ 0,65, orange ≈ 1,2, rouge ≈ 1,8).
// Les teintes sont un peu adoucies : ce sont celles que l'œil perçoit, pas celles d'un corps noir pur.
const COLOR_STOPS: ReadonlyArray<readonly [number, Rgb]> = [
  [-0.3, [0.6, 0.72, 1.0]],
  [0.0, [0.82, 0.88, 1.0]],
  [0.4, [1.0, 0.97, 0.92]],
  [0.65, [1.0, 0.92, 0.78]],
  [1.2, [1.0, 0.78, 0.55]],
  [1.8, [1.0, 0.62, 0.42]],
];

// Couleur d'une étoile en lumière linéaire, d'après son indice B-V.
export function starColor(bv: number): Rgb {
  const b = clamp(bv, COLOR_STOPS[0]![0], COLOR_STOPS[COLOR_STOPS.length - 1]![0]); // indice borné
  let lo = COLOR_STOPS[0]!;
  let hi = COLOR_STOPS[COLOR_STOPS.length - 1]!;
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    if (b >= COLOR_STOPS[i]![0] && b <= COLOR_STOPS[i + 1]![0]) {
      lo = COLOR_STOPS[i]!; // on a trouvé l'intervalle
      hi = COLOR_STOPS[i + 1]!;
      break;
    }
  }
  const t = hi[0] === lo[0] ? 0 : (b - lo[0]) / (hi[0] - lo[0]); // position dans l'intervalle
  const c = lerpRgb(lo[1], hi[1], t); // couleur sRGB interpolée
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]; // en lumière linéaire
}

// Éclat d'une étoile à l'écran (0 à 1) : les plus faibles (magnitude 6) restent très discrètes, Sirius (−1,4) est à 1.
export function starBrightness(mag: number): number {
  const t = clamp((6.3 - mag) / 7.7, 0, 1); // 0 pour les plus faibles, 1 pour les plus brillantes
  return clamp(0.25 + 0.75 * Math.pow(t, 1.2), 0.25, 1);
}

// Taille d'une étoile en pixels (avant la densité de l'écran) : un point fin pour les faibles, un petit disque pour les brillantes.
// Le sprite contient le cœur ET son halo lumineux : il est donc bien plus grand que le point visible au centre.
export function starSize(mag: number): number {
  return 5 + 2.6 * Math.max(0, 4 - mag); // magnitude 4 : 5 px ; Sirius (−1,4) : environ 19 px
}

export const MAX_STAR_MAGNITUDE = 4.0; // on ne garde que les étoiles les plus brillantes (≈ 520 sur 5 044) : un ciel épuré mais lumineux

// Tableaux prêts pour la carte graphique : positions sur une sphère de rayon donné (repère équatorial), taille, éclat et couleur.
export interface StarBuffers {
  positions: Float32Array; // 3 nombres par étoile
  sizes: Float32Array; // 1 nombre par étoile (pixels)
  brightness: Float32Array; // 1 nombre par étoile (0 à 1)
  colors: Float32Array; // 3 nombres par étoile (linéaire)
}

export function buildStarBuffers(allStars: readonly StarRow[], radius: number, maxMagnitude = Infinity): StarBuffers {
  const stars = allStars.filter((s) => s[2] <= maxMagnitude); // seules les étoiles assez brillantes sont gardées
  const n = stars.length; // nombre d'étoiles
  const out: StarBuffers = { positions: new Float32Array(n * 3), sizes: new Float32Array(n), brightness: new Float32Array(n), colors: new Float32Array(n * 3) };
  stars.forEach(([ra, dec, mag, bv], i) => {
    const a = (ra * Math.PI) / 180; // ascension droite en radians
    const d = (dec * Math.PI) / 180; // déclinaison en radians
    out.positions.set([Math.cos(d) * Math.cos(a) * radius, Math.cos(d) * Math.sin(a) * radius, Math.sin(d) * radius], i * 3); // X vers le point vernal, Z vers le pôle nord céleste
    out.sizes[i] = starSize(mag);
    out.brightness[i] = starBrightness(mag);
    out.colors.set(starColor(bv), i * 3);
  });
  return out;
}
