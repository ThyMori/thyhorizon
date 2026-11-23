// Bruit pseudo-aléatoire "lisse" : la base de tout le relief du monde.
// Même graine → même monde, toujours. Aucune dépendance au navigateur.

import { lerp } from './math';

// Générateur de nombres pseudo-aléatoires déterministe (mulberry32) : renvoie une fonction qui donne un nombre dans [0 ; 1[ à chaque appel.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0; // force un entier 32 bits non signé
  return () => {
    a = (a + 0x6d2b79f5) >>> 0; // fait avancer l'état interne
    let t = a; // copie de travail
    t = Math.imul(t ^ (t >>> 15), t | 1); // brasse les bits (1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); // brasse les bits (2)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // ramène à [0 ; 1[
  };
}

// Transforme un texte (ex. "horizon") en un nombre entier stable : sert de graine.
export function hashSeed(text: string): number {
  let h = 2166136261; // valeur de départ de l'algorithme FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i); // mélange le caractère courant
    h = Math.imul(h, 16777619); // multiplie par le nombre premier FNV
  }
  return h >>> 0; // entier non signé
}

// Courbe d'adoucissement de Perlin : 6t^5 - 15t^4 + 10t^3.
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

// Les 8 directions de gradient (diagonales normalisées pour garder une amplitude régulière).
const D = Math.SQRT1_2; // 1/racine(2)
const GRADIENTS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], // 4 directions cardinales
  [D, D], [-D, D], [D, -D], [-D, -D], // 4 diagonales
];

// Bruit de Perlin en 2D, déterminé par une graine.
export class Noise2D {
  private readonly perm = new Uint8Array(512); // table de permutation doublée (évite les dépassements)

  constructor(seed: number) {
    const rand = mulberry32(seed); // source d'aléa déterministe
    const p = new Uint8Array(256); // table de base 0..255
    for (let i = 0; i < 256; i++) p[i] = i; // on la remplit dans l'ordre
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1)); // indice tiré au hasard
      const tmp = p[i]!; // on échange p[i] et p[j] (mélange de Fisher-Yates)
      p[i] = p[j]!;
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!; // on double la table
  }

  // Valeur du bruit au point (x, y), approximativement entre -1 et 1.
  noise(x: number, y: number): number {
    const xi = Math.floor(x); // case entière en x
    const yi = Math.floor(y); // case entière en y
    const xf = x - xi; // position dans la case (0..1) en x
    const yf = y - yi; // position dans la case (0..1) en y
    const X = xi & 255; // indice de case, ramené à 0..255
    const Y = yi & 255;
    const u = fade(xf); // adoucissement en x
    const v = fade(yf); // adoucissement en y
    const p = this.perm; // raccourci
    const aa = p[(p[X]! + Y) & 511]!; // hachage du coin (0,0)
    const ab = p[(p[X]! + Y + 1) & 511]!; // coin (0,1)
    const ba = p[(p[(X + 1) & 255]! + Y) & 511]!; // coin (1,0)
    const bb = p[(p[(X + 1) & 255]! + Y + 1) & 511]!; // coin (1,1)
    const g = (h: number, dx: number, dy: number): number => {
      const gr = GRADIENTS[h & 7]!; // gradient choisi par le hachage
      return gr[0] * dx + gr[1] * dy; // produit scalaire avec le vecteur vers le coin
    };
    const x1 = lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u); // mélange du bord bas
    const x2 = lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u); // mélange du bord haut
    return lerp(x1, x2, v) * Math.SQRT2; // mélange final, remis à l'échelle ~[-1 ; 1]
  }
}

// Bruit fractal : on additionne plusieurs couches de bruit de plus en plus fines. Résultat dans ~[-1 ; 1].
export function fbm(
  noise: Noise2D, // le bruit de base
  x: number,
  y: number,
  octaves: number, // nombre de couches
  lacunarity = 2, // facteur de finesse entre deux couches
  gain = 0.5, // facteur d'amplitude entre deux couches
): number {
  let sum = 0; // somme des couches
  let amp = 1; // amplitude de la couche courante
  let freq = 1; // fréquence de la couche courante
  let norm = 0; // somme des amplitudes, pour normaliser
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise.noise(x * freq, y * freq); // ajoute la couche
    norm += amp; // cumule l'amplitude
    amp *= gain; // la couche suivante pèse moins
    freq *= lacunarity; // et est plus fine
  }
  return sum / norm; // normalise pour rester dans ~[-1 ; 1]
}
