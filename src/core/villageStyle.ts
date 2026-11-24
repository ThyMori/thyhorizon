// Le style des maisons d'un village selon le climat réel du lieu (classe de Köppen). Logique pure.
// Les couleurs sont en sRGB (0 à 1). Un village n'utilise qu'un style, avec quelques nuances de murs et de toits.

import type { Rgb } from './math';

export type StyleId = 'atlantic' | 'mediterranean' | 'continental' | 'arid' | 'tropical' | 'polar';
export type RoofKind = 'gable' | 'hip' | 'flat';

export interface VillageStyle {
  id: StyleId;
  walls: Rgb[]; // couleurs possibles des murs
  roofs: Rgb[]; // couleurs possibles des toits
  roof: RoofKind; // forme du toit : deux pentes, quatre pentes, ou plat
  pitch: number; // pente du toit (hauteur du faîte / demi-largeur)
  overhang: number; // débord du toit (m)
  storyHeight: number; // hauteur d'un étage (m)
  maxStories: number; // nombre d'étages au plus (hors centre-ville)
  chimneys: number; // part de maisons avec une cheminée (0 à 1)
  window: Rgb; // couleur des fenêtres
  door: Rgb; // couleur des portes
}

const rgb = (r: number, g: number, b: number): Rgb => [r, g, b];

export const STYLES: Readonly<Record<StyleId, VillageStyle>> = {
  // Bretagne, Atlantique : granit gris et murs blanchis, toits d'ardoise, cheminées de pignon.
  atlantic: {
    id: 'atlantic',
    walls: [rgb(0.6, 0.58, 0.53), rgb(0.54, 0.53, 0.5), rgb(0.86, 0.84, 0.78), rgb(0.7, 0.66, 0.58)],
    roofs: [rgb(0.24, 0.27, 0.32), rgb(0.29, 0.31, 0.35), rgb(0.21, 0.23, 0.27)],
    roof: 'gable',
    pitch: 0.85,
    overhang: 0.25,
    storyHeight: 2.7,
    maxStories: 2,
    chimneys: 0.8,
    window: rgb(0.16, 0.2, 0.26),
    door: rgb(0.2, 0.3, 0.36),
  },
  // Pourtour méditerranéen et climats chauds et humides : murs ocre ou blancs, tuiles rouges, toit peu pentu.
  mediterranean: {
    id: 'mediterranean',
    walls: [rgb(0.9, 0.82, 0.64), rgb(0.93, 0.9, 0.82), rgb(0.82, 0.62, 0.44), rgb(0.88, 0.72, 0.55)],
    roofs: [rgb(0.7, 0.34, 0.21), rgb(0.62, 0.3, 0.2), rgb(0.76, 0.42, 0.26)],
    roof: 'gable',
    pitch: 0.38,
    overhang: 0.45,
    storyHeight: 2.9,
    maxStories: 2,
    chimneys: 0.3,
    window: rgb(0.2, 0.25, 0.3),
    door: rgb(0.32, 0.22, 0.14),
  },
  // Climats froids : maisons en bois peint, toits raides sombres pour la neige.
  continental: {
    id: 'continental',
    walls: [rgb(0.55, 0.24, 0.18), rgb(0.72, 0.56, 0.32), rgb(0.42, 0.3, 0.2), rgb(0.78, 0.72, 0.55)],
    roofs: [rgb(0.26, 0.2, 0.17), rgb(0.33, 0.25, 0.2), rgb(0.22, 0.24, 0.24)],
    roof: 'gable',
    pitch: 1.0,
    overhang: 0.4,
    storyHeight: 2.6,
    maxStories: 2,
    chimneys: 0.9,
    window: rgb(0.88, 0.84, 0.7),
    door: rgb(0.3, 0.18, 0.12),
  },
  // Déserts et steppes : briques de terre, toits plats, petites fenêtres.
  arid: {
    id: 'arid',
    walls: [rgb(0.78, 0.65, 0.48), rgb(0.84, 0.74, 0.58), rgb(0.7, 0.55, 0.4)],
    roofs: [rgb(0.7, 0.58, 0.42), rgb(0.76, 0.64, 0.48)],
    roof: 'flat',
    pitch: 0,
    overhang: 0.15,
    storyHeight: 2.8,
    maxStories: 2,
    chimneys: 0,
    window: rgb(0.2, 0.15, 0.12),
    door: rgb(0.25, 0.4, 0.45),
  },
  // Tropiques : murs pastel, toits de chaume ou de tôle à quatre pentes, débord large.
  tropical: {
    id: 'tropical',
    walls: [rgb(0.86, 0.82, 0.6), rgb(0.62, 0.8, 0.78), rgb(0.9, 0.7, 0.6), rgb(0.85, 0.85, 0.82)],
    roofs: [rgb(0.58, 0.47, 0.24), rgb(0.5, 0.4, 0.2), rgb(0.55, 0.3, 0.25)],
    roof: 'hip',
    pitch: 0.6,
    overhang: 0.7,
    storyHeight: 2.8,
    maxStories: 1,
    chimneys: 0,
    window: rgb(0.2, 0.22, 0.2),
    door: rgb(0.3, 0.2, 0.12),
  },
  // Toundra et glaces : petites maisons de bois sombre, toits raides rouges.
  polar: {
    id: 'polar',
    walls: [rgb(0.32, 0.24, 0.19), rgb(0.5, 0.2, 0.17), rgb(0.7, 0.62, 0.45)],
    roofs: [rgb(0.3, 0.17, 0.14), rgb(0.24, 0.24, 0.26)],
    roof: 'gable',
    pitch: 0.9,
    overhang: 0.3,
    storyHeight: 2.4,
    maxStories: 1,
    chimneys: 1,
    window: rgb(0.9, 0.82, 0.55),
    door: rgb(0.2, 0.15, 0.12),
  },
};

// Le style d'une classe de Köppen. Une classe inconnue donne le style atlantique (celui de Lannion).
export function styleForClass(koppen: string): VillageStyle {
  const c = koppen.charAt(0); // grande famille : A tropical, B sec, C tempéré, D continental froid, E polaire
  if (c === 'A') return STYLES.tropical;
  if (c === 'B') return STYLES.arid;
  if (c === 'E') return STYLES.polar;
  if (c === 'D') return STYLES.continental;
  if (c === 'C') {
    if (koppen.charAt(1) === 'w') return STYLES.tropical; // tempéré à hiver sec (mousson, hautes terres) : style chaud
    if (koppen.charAt(1) === 's' || koppen === 'Cfa') return STYLES.mediterranean; // été sec, ou subtropical humide
    return STYLES.atlantic; // Cfb, Cfc : océanique
  }
  return STYLES.atlantic;
}
