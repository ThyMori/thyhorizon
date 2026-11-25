// Les couleurs du sol : sable, herbe, bruyère, roche, fond marin.
// Le rendu est « pictural » : pas de textures, des couleurs douces dans les sommets du maillage.

import type { Biome } from './climate';
import { Rgb, clamp, lerpRgb, smoothstep, srgbToLinear } from './math';

// Couleurs de base, écrites en sRGB (comme on les perçoit à l'écran).
const SAND: Rgb = [0.76, 0.68, 0.5]; // sable sec
const WET_SAND: Rgb = [0.48, 0.44, 0.34]; // sable mouillé
const GRASS_DARK: Rgb = [0.27, 0.41, 0.16]; // herbe sombre
const GRASS_LIGHT: Rgb = [0.47, 0.58, 0.26]; // herbe claire
const HEATH: Rgb = [0.5, 0.42, 0.27]; // lande de moyenne montagne
const ROCK: Rgb = [0.52, 0.5, 0.47]; // roche
const SNOW: Rgb = [0.93, 0.94, 0.96]; // neige des hautes montagnes
const SEABED_SHALLOW: Rgb = [0.5, 0.49, 0.4]; // fond peu profond (l'eau le teintera)
const SEABED_DEEP: Rgb = [0.03, 0.1, 0.14]; // fond profond, sombre et bleuté

// Biome par défaut (climat océanique : les verts d'origine du jeu), utilisé quand on n'en précise pas.
const DEFAULT_BIOME: Biome = { grassDark: GRASS_DARK, grassLight: GRASS_LIGHT, snowLine: 2450, forest: 0.55, conifer: 0.1, acacia: 0 };

// Terre battue des chemins et des rues de village (sRGB).
const DIRT: Rgb = [0.47, 0.37, 0.25];

// Couleur d'un chemin de terre, en lumière linéaire : la terre, nuancée par le bruit, légèrement teintée par le sol d'à côté (`ground`, déjà linéaire).
export function dirtColor(variation: number, ground: Rgb): Rgb {
  const k = 1 + 0.1 * variation; // nuance : ±10 %
  const r = srgbToLinear(clamp(DIRT[0] * k, 0, 1));
  const g = srgbToLinear(clamp(DIRT[1] * k, 0, 1));
  const b = srgbToLinear(clamp(DIRT[2] * k, 0, 1));
  return [r * 0.8 + ground[0] * 0.2, g * 0.8 + ground[1] * 0.2, b * 0.8 + ground[2] * 0.2]; // 80 % terre, 20 % sol voisin
}

// Eau douce (sRGB) : claire et verte sur les hauts-fonds, sombre et bleutée en profondeur.
const WATER_SHALLOW: Rgb = [0.34, 0.48, 0.44];
const WATER_DEEP: Rgb = [0.1, 0.25, 0.33];

// Couleur de l'eau d'une rivière ou d'un lac selon sa profondeur (m), en lumière linéaire.
export function waterColor(depth: number): Rgb {
  const c = lerpRgb(WATER_SHALLOW, WATER_DEEP, smoothstep(0.1, 5, depth));
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}

// Couleur du sol en LUMIÈRE LINÉAIRE (le format attendu par les sommets du maillage Three.js).
// h = altitude, ny = composante verticale de la normale (1 = plat), variation = bruit -1..1, biome = climat d'ici.
export function terrainColor(h: number, ny: number, variation: number, biome: Biome = DEFAULT_BIOME): Rgb {
  let c: Rgb; // couleur en sRGB, convertie à la fin

  if (h < 0) {
    // Fond marin : du sable clair près de la côte au bleu sombre en profondeur.
    c = lerpRgb(SEABED_SHALLOW, SEABED_DEEP, smoothstep(0, 25, -h));
  } else {
    // Les seuils d'altitude (lande, roche) sont réglés pour un climat océanique (neige vers 2 450 m) :
    // ils s'étirent ou se resserrent avec la limite des neiges du climat (hautes dans les tropiques, basses près des pôles).
    const snow = biome.snowLine; // altitude de la neige ici
    const f = clamp(snow / 2450, 0.35, 2.2); // facteur d'échelle des seuils
    // Végétation basse : deux tons du climat mélangés par le bruit.
    const grass = lerpRgb(biome.grassDark, biome.grassLight, clamp(0.5 + 0.5 * variation, 0, 1));
    // Plus haut, la végétation laisse place à la lande, puis à la roche.
    const heathT = smoothstep(450 * f, 900 * f, h + variation * 60 * f); // lande selon l'altitude (bord irrégulier)
    const slopeRock = smoothstep(0.16, 0.36, 1 - ny); // roche sur les pentes raides
    const altitudeRock = smoothstep(1000 * f, 1500 * f, h + variation * 80 * f); // roche en altitude
    const rockT = Math.max(slopeRock, altitudeRock); // la roche l'emporte dès que l'un des deux s'applique
    c = lerpRgb(grass, HEATH, heathT); // végétation → lande
    c = lerpRgb(c, ROCK, rockT); // → roche
    const snowT = smoothstep(0.9 * snow, 1.1 * snow + 30, h + variation * 150 * f); // neige au-dessus de la limite (bord irrégulier ; glace partout si limite = 0)
    c = lerpRgb(c, SNOW, snowT * (0.35 + 0.65 * ny)); // → neige (moins sur les parois raides)
    // Plage : sable mouillé tout près de l'eau, sable sec ensuite (pas de plage sur la glace).
    const sand = lerpRgb(WET_SAND, SAND, smoothstep(0.3, 1.6, h)); // sable mouillé → sec
    const beachT = (1 - smoothstep(1.4, 3.4, h)) * smoothstep(100, 600, snow); // 1 sur la plage, 0 sur l'herbe ou la glace
    c = lerpRgb(c, sand, beachT); // plage
  }

  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])]; // conversion en linéaire
}
