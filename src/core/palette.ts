// Les couleurs du sol : sable, herbe, bruyère, roche, fond marin.
// Le rendu est « pictural » : pas de textures, des couleurs douces dans les sommets du maillage.

import { Rgb, clamp, lerpRgb, smoothstep, srgbToLinear } from './math';

// Couleurs de base, écrites en sRGB (comme on les perçoit à l'écran).
const SAND: Rgb = [0.76, 0.68, 0.5]; // sable sec
const WET_SAND: Rgb = [0.48, 0.44, 0.34]; // sable mouillé
const GRASS_DARK: Rgb = [0.27, 0.41, 0.16]; // herbe sombre
const GRASS_LIGHT: Rgb = [0.47, 0.58, 0.26]; // herbe claire
const HEATH: Rgb = [0.5, 0.42, 0.27]; // lande de moyenne montagne
const ROCK: Rgb = [0.52, 0.5, 0.47]; // roche
const SEABED_SHALLOW: Rgb = [0.5, 0.49, 0.4]; // fond peu profond (l'eau le teintera)
const SEABED_DEEP: Rgb = [0.03, 0.1, 0.14]; // fond profond, sombre et bleuté

// Couleur du sol en LUMIÈRE LINÉAIRE (le format attendu par les sommets du maillage Three.js).
// h = altitude, ny = composante verticale de la normale (1 = plat), variation = bruit -1..1.
export function terrainColor(h: number, ny: number, variation: number): Rgb {
  let c: Rgb; // couleur en sRGB, convertie à la fin

  if (h < 0) {
    // Fond marin : du sable clair près de la côte au bleu sombre en profondeur.
    c = lerpRgb(SEABED_SHALLOW, SEABED_DEEP, smoothstep(0, 25, -h));
  } else {
    // Herbe : deux tons mélangés par le bruit.
    const grass = lerpRgb(GRASS_DARK, GRASS_LIGHT, clamp(0.5 + 0.5 * variation, 0, 1));
    // Plus haut, l'herbe laisse place à la lande, puis à la roche.
    const heathT = smoothstep(120, 260, h + variation * 25); // lande selon l'altitude (bord irrégulier)
    const slopeRock = smoothstep(0.16, 0.36, 1 - ny); // roche sur les pentes raides
    const altitudeRock = smoothstep(280, 420, h + variation * 30); // roche en altitude
    const rockT = Math.max(slopeRock, altitudeRock); // la roche l'emporte dès que l'un des deux s'applique
    c = lerpRgb(grass, HEATH, heathT); // herbe → lande
    c = lerpRgb(c, ROCK, rockT); // → roche
    // Plage : sable mouillé tout près de l'eau, sable sec ensuite.
    const sand = lerpRgb(WET_SAND, SAND, smoothstep(0.3, 1.6, h)); // sable mouillé → sec
    const beachT = 1 - smoothstep(1.4, 3.4, h); // 1 sur la plage, 0 sur l'herbe
    c = lerpRgb(c, sand, beachT); // plage
  }

  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]; // conversion en linéaire
}
