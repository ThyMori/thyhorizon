// Les saisons (1.39) : à partir du jour de l'année et de la latitude, dit où en sont les feuilles, les fleurs et l'herbe.
// Logique pure. Les nombres sortent de 0 à 1 et vont dans le shader du terrain (render/scene.ts), qui cache ou colore les sommets
// marqués par une classe de saison (SEASON_*) : aucun maillage n'est refait quand la saison change.
// Hémisphère sud : l'année est décalée d'une demi-année. Tropiques : presque pas de saisons (les feuillus gardent leurs feuilles).

import { clamp, smoothstep } from './math';

// Classes de sommets (partie entière du nombre porté par chaque sommet ; la partie décimale = tirage propre à la touffe, 0 à 0,95).
export const SEASON_NONE = 0; // sol, troncs, conifères, rochers, ponts : ne changent pas
export const SEASON_LEAF = 1; // feuillage caduc : vert, puis roux, puis tombe
export const SEASON_FLOWER = 2; // fleurs : seulement en saison
export const SEASON_GRASS = 3; // herbe et bruyère : se dessèche
export const SEASON_FERN = 4; // fougères : rousses, puis disparaissent l'hiver
export const SEASON_REED = 5; // roseaux : dorés, secs en hiver
export const SEASON_SPREAD = 0.95; // la partie décimale va de 0 à 0,95 (jamais 1 : la partie entière reste lisible)

// Code d'un sommet : classe + tirage (0 à 1).
export const seasonCode = (cls: number, rnd: number): number => cls + SEASON_SPREAD * clamp(rnd, 0, 0.9999);

// Où en est l'année.
export interface SeasonState {
  leaf: number; // part du feuillage caduc présente : 1 = plein été, 0 = nu (les feuilles tombent touffe par touffe)
  autumn: number; // 0 à 1 : à quel point les feuilles ont roussi
  spring: number; // 0 à 1 : jeunes feuilles d'un vert vif et jaune
  bloom: number; // part des fleurs écloses
  dry: number; // 0 à 1 : herbe sèche, paille, brune
  fern: number; // part des fougères encore dressées
  winter: number; // 0 à 1 : cœur de l'hiver (pour la suite : neige, nuits plus longues)
}

// Monte de 0 à 1 entre a et b.
const ramp = (x: number, a: number, b: number): number => smoothstep(a, b, x);

// L'état des saisons un jour donné (1 à 365) à une latitude donnée (degrés, nord positif).
export function seasonState(day: number, lat: number): SeasonState {
  const s = lat >= 0 ? day : ((day + 182.5 - 1) % 365) + 1; // jour « du nord » : au sud, l'hiver tombe en juillet
  const k = smoothstep(8, 35, Math.abs(lat)); // force des saisons : presque nulle sous les tropiques, entière aux latitudes tempérées
  const warm = 0.5 + 0.5 * Math.cos((2 * Math.PI * (s - 200)) / 365); // chaleur : maximale vers le 19 juillet, minimale vers le 18 janvier
  const winter = smoothstep(0.3, 0.05, warm) * k; // 1 au cœur de l'hiver
  const leafFull = ramp(s, 95, 130) * (1 - ramp(s, 285, 325)); // feuilles : sortent en avril-mai, tombent en octobre-novembre
  const fernFull = ramp(s, 100, 130) * (1 - ramp(s, 290, 320)); // fougères : un peu plus tôt à disparaître
  const bloomFull = ramp(s, 90, 125) * (1 - ramp(s, 250, 290)); // fleurs : d'avril à septembre
  const summerDry = ramp(s, 190, 225) * (1 - ramp(s, 250, 280)); // un peu de paille en plein été
  return {
    leaf: lerp(1, leafFull, k),
    autumn: k * ramp(s, 255, 290) * (1 - ramp(s, 335, 360)),
    spring: k * ramp(s, 95, 125) * (1 - ramp(s, 140, 175)),
    bloom: lerp(0.85, bloomFull, k),
    dry: clamp(k * (0.25 * summerDry + 0.75 * smoothstep(0.55, 0.12, warm)), 0, 1), // paille l'été, brune dès que le temps fraîchit
    fern: lerp(1, fernFull, k),
    winter,
  };
}

// Mélange linéaire (a quand t = 0, b quand t = 1).
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
