// Le climat du monde : la classification réelle de Köppen-Geiger (grille de 0,5° ≈ 55 km), traduite en « biome » :
// couleurs de l'herbe, altitude de la neige. Logique pure : le fichier est produit par scripts/build-climate.mjs.
// Les biomes sont mélangés en douceur entre cases voisines (pas de frontière nette tous les 55 km).

import { Rgb, clamp } from './math';

// Le fichier de données (src/data/climate.json) : la grille complète compressée en séries [classe, longueur, classe, longueur, …].
export interface ClimateFile {
  width: number; // colonnes (longitude −180° → 180°)
  height: number; // lignes (latitude 90° → −90°)
  classes: string[]; // noms des classes de Köppen ; le numéro d'une classe est sa place dans cette liste
  rle: number[]; // séries
}

// Ce qu'on retient d'un climat pour dessiner le sol.
export interface Biome {
  grassDark: Rgb; // ton sombre de la végétation basse (sRGB)
  grassLight: Rgb; // ton clair
  snowLine: number; // altitude (m) à partir de laquelle la neige tient ; 0 = glace partout
  forest: number; // densité des arbres : 0 = aucun, 1 = forêt dense
  conifer: number; // part de conifères parmi les arbres (0 à 1)
  acacia: number; // part d'acacias (arbres à cime plate, de savane) parmi les arbres (0 à 1) ; le reste = feuillus
}

const rgb = (r: number, g: number, b: number): Rgb => [r, g, b];
const b = (dark: Rgb, light: Rgb, snowLine: number, forest = 0, conifer = 0, acacia = 0): Biome => ({ grassDark: dark, grassLight: light, snowLine, forest, conifer, acacia });

// Un biome par classe de Köppen. Première lettre : A tropical, B sec, C tempéré, D continental froid, E polaire.
export const BIOMES: Readonly<Record<string, Biome>> = {
  Af: b(rgb(0.12, 0.33, 0.12), rgb(0.22, 0.45, 0.17), 5000, 0.95, 0, 0), // forêt équatoriale : vert profond
  Am: b(rgb(0.15, 0.35, 0.13), rgb(0.28, 0.48, 0.18), 5000, 0.85, 0, 0), // mousson
  Aw: b(rgb(0.45, 0.45, 0.2), rgb(0.63, 0.58, 0.3), 5000, 0.12, 0, 0.85), // savane : herbe dorée
  As: b(rgb(0.45, 0.45, 0.2), rgb(0.63, 0.58, 0.3), 5000, 0.12, 0, 0.8),
  BWh: b(rgb(0.72, 0.58, 0.38), rgb(0.82, 0.7, 0.48), 5200, 0.004, 0, 0.5), // désert chaud : sable ocre
  BWk: b(rgb(0.6, 0.52, 0.4), rgb(0.72, 0.64, 0.5), 4000, 0.01, 0.2, 0), // désert froid : terre et gravier
  BSh: b(rgb(0.58, 0.52, 0.28), rgb(0.74, 0.68, 0.4), 5000, 0.06, 0, 0.7), // steppe chaude
  BSk: b(rgb(0.52, 0.5, 0.3), rgb(0.68, 0.64, 0.4), 3800, 0.06, 0.3, 0), // steppe froide
  Csa: b(rgb(0.38, 0.4, 0.2), rgb(0.58, 0.55, 0.3), 3200, 0.35, 0.25, 0), // méditerranéen : olive et ocre
  Csb: b(rgb(0.38, 0.4, 0.2), rgb(0.58, 0.55, 0.3), 3000, 0.35, 0.25, 0),
  Csc: b(rgb(0.35, 0.4, 0.22), rgb(0.5, 0.52, 0.3), 2400, 0.4, 0.6, 0),
  Cwa: b(rgb(0.3, 0.42, 0.16), rgb(0.5, 0.58, 0.26), 4200, 0.6, 0, 0.05), // subtropical d'altitude
  Cwb: b(rgb(0.3, 0.42, 0.16), rgb(0.5, 0.58, 0.26), 3500, 0.55, 0.1, 0),
  Cwc: b(rgb(0.3, 0.42, 0.16), rgb(0.5, 0.58, 0.26), 3000, 0.5, 0.3, 0),
  Cfa: b(rgb(0.25, 0.4, 0.15), rgb(0.45, 0.57, 0.25), 3200, 0.6, 0.05, 0), // tempéré humide chaud
  Cfb: b(rgb(0.27, 0.41, 0.16), rgb(0.47, 0.58, 0.26), 2450, 0.55, 0.1, 0), // océanique (Bretagne) : les verts d'origine du jeu
  Cfc: b(rgb(0.27, 0.38, 0.2), rgb(0.42, 0.5, 0.28), 1800, 0.35, 0.5, 0), // océanique froid
  Dsa: b(rgb(0.24, 0.38, 0.16), rgb(0.42, 0.54, 0.24), 2600, 0.6, 0.35, 0), // continental
  Dsb: b(rgb(0.24, 0.38, 0.16), rgb(0.42, 0.54, 0.24), 2600, 0.6, 0.35, 0),
  Dwa: b(rgb(0.24, 0.38, 0.16), rgb(0.42, 0.54, 0.24), 2600, 0.6, 0.35, 0),
  Dwb: b(rgb(0.24, 0.38, 0.16), rgb(0.42, 0.54, 0.24), 2600, 0.6, 0.35, 0),
  Dfa: b(rgb(0.24, 0.38, 0.16), rgb(0.42, 0.54, 0.24), 2600, 0.6, 0.35, 0),
  Dfb: b(rgb(0.24, 0.38, 0.16), rgb(0.42, 0.54, 0.24), 2600, 0.6, 0.35, 0),
  Dsc: b(rgb(0.2, 0.32, 0.17), rgb(0.34, 0.44, 0.24), 1800, 0.75, 0.9, 0), // taïga : vert gris sombre
  Dwc: b(rgb(0.2, 0.32, 0.17), rgb(0.34, 0.44, 0.24), 1800, 0.75, 0.9, 0),
  Dfc: b(rgb(0.2, 0.32, 0.17), rgb(0.34, 0.44, 0.24), 1800, 0.75, 0.9, 0),
  Dsd: b(rgb(0.22, 0.3, 0.2), rgb(0.34, 0.4, 0.28), 1200, 0.5, 0.95, 0), // taïga très froide
  Dwd: b(rgb(0.22, 0.3, 0.2), rgb(0.34, 0.4, 0.28), 1200, 0.5, 0.95, 0),
  Dfd: b(rgb(0.22, 0.3, 0.2), rgb(0.34, 0.4, 0.28), 1200, 0.5, 0.95, 0),
  ET: b(rgb(0.38, 0.38, 0.27), rgb(0.52, 0.5, 0.36), 700, 0.03, 0.6, 0), // toundra : brun-gris, neige tôt
  EF: b(rgb(0.82, 0.86, 0.9), rgb(0.92, 0.94, 0.97), 0, 0, 0, 0), // calotte glaciaire : blanc bleuté partout
};

// Le biome par défaut (le climat océanique de Lannion) : repli si une classe est inconnue.
const FALLBACK: Biome = BIOMES.Cfb!;

// Nombre de valeurs numériques d'un biome (2 couleurs × 3 canaux + altitude de la neige).
const PARAMS = 10;
const toParams = (m: Biome): number[] => [...m.grassDark, ...m.grassLight, m.snowLine, m.forest, m.conifer, m.acacia];

// Le climat prêt à être interrogé.
export interface Climate {
  classAt(latDeg: number, lonDeg: number): string; // classe de Köppen de la case la plus proche
  biomeAt(latDeg: number, lonDeg: number): Biome; // biome mélangé entre les 4 cases voisines
}

// Décode le fichier : grille de numéros de classe, une case par valeur.
export function decodeClimate(file: ClimateFile): Uint8Array {
  const grid = new Uint8Array(file.width * file.height);
  let k = 0; // position d'écriture
  for (let r = 0; r + 1 < file.rle.length; r += 2) {
    grid.fill(file.rle[r]!, k, k + file.rle[r + 1]!); // une série de cases identiques
    k += file.rle[r + 1]!;
  }
  if (k !== grid.length) throw new Error('données de climat incomplètes');
  return grid;
}

// Fabrique le climat à partir du fichier de données.
export function createClimate(file: ClimateFile): Climate {
  const { width, height, classes } = file;
  const grid = decodeClimate(file);
  const params = classes.map((name) => toParams(BIOMES[name] ?? FALLBACK)); // paramètres de chaque classe, calculés une fois
  const out: number[] = new Array(PARAMS).fill(0); // tableau de travail (évite de réallouer)
  const wrapCol = (i: number): number => ((i % width) + width) % width; // la longitude se referme sur elle-même
  const row = (j: number): number => clamp(j, 0, height - 1); // pas de bouclage en latitude

  const classAt = (lat: number, lon: number): string => {
    const i = wrapCol(Math.floor((lon + 180) / (360 / width))); // colonne
    const j = row(Math.floor((90 - lat) / (180 / height))); // ligne
    return classes[grid[j * width + i]!]!;
  };

  const biomeAt = (lat: number, lon: number): Biome => {
    const fx = (lon + 180) / (360 / width) - 0.5; // position en cases, centrée sur les centres de cases
    const fy = (90 - lat) / (180 / height) - 0.5;
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const tx = fx - i0; // part de la case de droite
    const ty = fy - j0; // part de la case du bas
    out.fill(0);
    for (const [dj, di, w] of [
      [0, 0, (1 - tx) * (1 - ty)],
      [0, 1, tx * (1 - ty)],
      [1, 0, (1 - tx) * ty],
      [1, 1, tx * ty],
    ] as const) {
      if (w === 0) continue; // case sans influence
      const p = params[grid[row(j0 + dj) * width + wrapCol(i0 + di)]!]!; // paramètres de cette case
      for (let k = 0; k < PARAMS; k++) out[k]! += p[k]! * w; // somme pondérée
    }
    return { grassDark: [out[0]!, out[1]!, out[2]!], grassLight: [out[3]!, out[4]!, out[5]!], snowLine: out[6]!, forest: out[7]!, conifer: out[8]!, acacia: out[9]! };
  };

  return { classAt, biomeAt };
}

// Un climat uniforme (tests, ou monde sans données) : partout la même classe.
export function uniformClimate(className = 'Cfb'): Climate {
  const biome = BIOMES[className] ?? FALLBACK;
  return { classAt: () => className, biomeAt: () => biome };
}
