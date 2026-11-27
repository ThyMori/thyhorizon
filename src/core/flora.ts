// La flore au sol (1.38) : herbes, fleurs, fougères, bruyère, buissons, roseaux et rochers.
// Logique pure : elle tourne dans le worker et dans les tests. Même graine → mêmes plantes, toujours aux mêmes endroits.
// Les plantes sont ajoutées au maillage de la tuile (comme les arbres), seulement de près (niveau de détail 0).

import type { Biome } from './climate';
import { Rgb, clamp, lerpRgb, smoothstep, srgbToLinear } from './math';
import { slopeAt } from './terrain';
import type { Terrain } from './terrain';
import { MeshBuilder, hash01 } from './trees';

export type FloraKind = 'tuft' | 'flower' | 'fern' | 'heather' | 'bush' | 'rock' | 'reed';

// Une plante placée dans le monde.
export interface Plant {
  x: number; // position dans le monde (m)
  z: number;
  y: number; // altitude du sol au pied
  kind: FloraKind;
  size: number; // facteur de taille (1 = moyenne)
  seed: number; // nombre pseudo-aléatoire propre à la plante (0 à 1)
  color: Rgb; // couleur principale en sRGB (herbe, pétales, roche…)
}

export const FLORA_CELLS = 32; // cases de placement par côté d'une tuile de 64 m (une case = 2 m, au plus une plante par case)
export const FLORA_VERTEX_BUDGET = 22000; // sommets de flore au maximum par tuile
export const MESH_VERTEX_LIMIT = 65000; // les indices sont sur 16 bits : jamais plus de sommets que ça dans une tuile

// Couleurs des fleurs (sRGB) : blanc, jaune, violet, rouge coquelicot, bleu.
const PETALS: readonly Rgb[] = [
  [0.93, 0.92, 0.86], [0.95, 0.8, 0.2], [0.6, 0.42, 0.75], [0.85, 0.22, 0.17], [0.4, 0.55, 0.85],
];
const HEATHER: Rgb = [0.55, 0.3, 0.55]; // violet de la bruyère
const ROCK: Rgb = [0.5, 0.48, 0.45]; // gris de la roche
const REED: Rgb = [0.5, 0.55, 0.27]; // vert-jaune des roseaux

// À quel point l'herbe est verte ici (0 = désert ou glace, 1 = prairie) d'après la couleur du sol du climat.
const lushness = (b: Biome): number => smoothstep(0.04, 0.15, b.grassLight[1] - (b.grassLight[0] + b.grassLight[2]) / 2);

// Les plantes d'une tuile. Rien dans les villages et sur les chemins (`blocked`), rien sur la plage ni dans l'eau (sauf des roseaux sur la rive).
export function floraForChunk(terrain: Terrain, cx: number, cz: number, lod: number, chunkSize: number, blocked: ((x: number, z: number) => boolean) | null = null, hasWater = false): Plant[] {
  if (lod !== 0) return []; // la flore ne se voit que de près
  const n = FLORA_CELLS; // cases par côté
  const cell = chunkSize / n; // taille d'une case (m)
  const x0 = cx * chunkSize; // coin ouest de la tuile
  const z0 = cz * chunkSize; // coin nord de la tuile
  const plants: Plant[] = []; // résultat
  const biomes = new Map<number, Biome>(); // le climat est lu une fois par bloc de 6 × 6 cases (12 m), pas à chaque case
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gi = cx * n + i; // indice de la case dans la grille du monde (stable d'une tuile à l'autre)
      const gj = cz * n + j;
      const x = x0 + (i + 0.15 + 0.7 * hash01(gi, gj, 21)) * cell; // position au hasard dans la case
      const z = z0 + (j + 0.15 + 0.7 * hash01(gi, gj, 22)) * cell;
      const roll = hash01(gi, gj, 23); // le tirage qui décide de ce qui pousse ici
      if (roll > 0.9) continue; // une case sur dix reste vide (sol nu)
      if (blocked && blocked(x, z)) continue; // village, chemin : rien ne pousse
      const bk = Math.floor(i / 6) * 8 + Math.floor(j / 6); // clé du bloc de cases
      let biome = biomes.get(bk);
      if (!biome) {
        biome = terrain.biomeAt(x, z);
        biomes.set(bk, biome);
      }
      const y = terrain.heightAt(x, z); // altitude du sol
      if (y < 3 || y > biome.snowLine * 0.9) continue; // plage, mer, ou neige et glace
      const wd = hasWater ? terrain.waterDepthAt(x, z) : 0; // profondeur de l'eau douce ici
      if (wd > 0.25) continue; // dans l'eau
      const surf = hasWater ? terrain.waterSurfaceAt(x, z) : NaN; // hauteur de l'eau (NaN = ni eau ni rive)
      const bank = hasWater && !Number.isNaN(surf); // sur la rive ou dans l'eau peu profonde
      const lush = lushness(biome); // 0 désert, 1 prairie
      const patch = 0.5 + 0.5 * terrain.forestNoise(x, z); // grandes taches : sous-bois ou clairière
      const shade = clamp(biome.forest * (0.35 + 0.9 * patch), 0, 1); // à quel point on est sous les arbres
      const grass = lerpRgb(biome.grassDark, biome.grassLight, clamp(0.5 + 0.5 * terrain.colorNoise(x, z), 0, 1)); // couleur de l'herbe d'ici
      const tone = 0.8 + 0.4 * hash01(gi, gj, 24); // nuance propre à la plante
      const tinted: Rgb = [clamp(grass[0] * tone, 0, 1), clamp(grass[1] * tone, 0, 1), clamp(grass[2] * tone, 0, 1)];
      const base = { x, z, y, size: 0.75 + 0.5 * hash01(gi, gj, 25), seed: hash01(gi, gj, 26) }; // ce que toute plante a en commun
      // Rive : des roseaux serrés au bord de l'eau (et rien d'autre dans l'eau peu profonde).
      if (bank) {
        if (roll < 0.6 && lush > 0.1) plants.push({ ...base, kind: 'reed', size: 0.9 + 0.7 * hash01(gi, gj, 27), color: REED });
        continue;
      }
      // Les types se partagent le tirage `roll` (0 à 0,75) selon des probabilités qui dépendent du lieu.
      const flowerPatch = hash01(Math.floor(gi / 8), Math.floor(gj / 8), 28) < 0.3 ? 1 : 0.12; // quelques prairies fleuries, ailleurs presque rien
      const heath = lush > 0.3 && y > 350 * clamp(biome.snowLine / 2450, 0.35, 2.2) ? 0.2 : 0; // lande : bruyère
      const pRock = 0.012 + 0.05 * smoothstep(300, 1500, y); // des rochers partout, plus en altitude
      const pBush = 0.045 * lush * (1 - Math.abs(shade - 0.45) * 1.4); // buissons : surtout en lisière
      const pFern = 0.14 * lush * shade * shade; // fougères sous les arbres
      const pFlower = 0.1 * lush * lush * (1 - shade) * flowerPatch; // fleurs en clairière
      const pHeather = heath;
      const grassPatch = 0.3 + 1.4 * hash01(Math.floor(gi / 7), Math.floor(gj / 7), 34); // des plaques d'herbe haute et d'autres plus rases
      const pTuft = 0.4 * lush * (1 - 0.4 * shade) * grassPatch; // touffes d'herbe
      let acc = pRock; // total cumulé
      let kind: FloraKind | null = null;
      if (roll < acc) kind = 'rock';
      else if (roll < (acc += pHeather)) kind = 'heather';
      else if (roll < (acc += pBush)) kind = 'bush';
      else if (roll < (acc += pFern)) kind = 'fern';
      else if (roll < (acc += pFlower)) kind = 'flower';
      else if (roll < (acc += pTuft)) kind = 'tuft';
      if (!kind) continue; // rien ne pousse dans cette case
      if (kind === 'rock' && slopeAt(terrain, x, z, 2) < 0.12 && hash01(gi, gj, 29) < 0.5) continue; // moins de rochers en terrain plat
      if (kind !== 'rock' && kind !== 'tuft' && slopeAt(terrain, x, z, 2) > 0.6) continue; // pas de buissons ni de fleurs sur les parois raides
      if (kind === 'rock') plants.push({ ...base, kind, size: 0.6 + 1.1 * hash01(gi, gj, 30) * hash01(gi, gj, 31), color: ROCK });
      else if (kind === 'heather') plants.push({ ...base, kind, color: HEATHER });
      else if (kind === 'flower') plants.push({ ...base, kind, color: PETALS[Math.floor(hash01(Math.floor(gi / 8), Math.floor(gj / 8), 32) * PETALS.length) % PETALS.length]! }); // une couleur par prairie
      else if (kind === 'bush') plants.push({ ...base, kind, size: 0.7 + 0.9 * hash01(gi, gj, 33), color: [tinted[0] * 0.75, tinted[1] * 0.8, tinted[2] * 0.7] });
      else {
        plants.push({ ...base, kind, color: tinted });
        if (kind === 'tuft' && hash01(gi, gj, 35) < 0.7) { // une seconde touffe voisine : l'herbe est plus fournie
          const x2 = x + (hash01(gi, gj, 36) - 0.5) * 1.4;
          const z2 = z + (hash01(gi, gj, 37) - 0.5) * 1.4;
          const inTile = x2 >= x0 && x2 < x0 + chunkSize && z2 >= z0 && z2 < z0 + chunkSize; // reste dans la tuile
          if (inTile && !(blocked && blocked(x2, z2)) && !(hasWater && terrain.waterDepthAt(x2, z2) > 0.05)) plants.push({ ...base, kind, x: x2, z: z2, y: terrain.heightAt(x2, z2), size: base.size * 0.8, seed: hash01(gi, gj, 38), color: tinted });
        }
      }
    }
  }
  return plants;
}

// ---------- Formes ----------

type P3 = [number, number, number];

// Couleur sRGB → lumière linéaire (le format des sommets).
const lin = (c: Rgb, k = 1): Rgb => [srgbToLinear(clamp(c[0] * k, 0, 1)), srgbToLinear(clamp(c[1] * k, 0, 1)), srgbToLinear(clamp(c[2] * k, 0, 1))];

// Ajoute un sommet.
function vert(b: MeshBuilder, p: P3, n: P3, c: Rgb): void {
  b.positions.push(p[0], p[1], p[2]);
  b.normals.push(n[0], n[1], n[2]);
  b.colors.push(c[0], c[1], c[2]);
}

// Un triangle visible des deux côtés, éclairé comme s'il regardait vers le haut (l'herbe se fond dans le sol).
function leaf(b: MeshBuilder, a: P3, c: P3, d: P3, ca: Rgb, cc: Rgb, cd: Rgb): void {
  const up: P3 = [0, 1, 0]; // normale vers le haut
  const base = b.positions.length / 3; // numéro du premier sommet
  vert(b, a, up, ca);
  vert(b, c, up, cc);
  vert(b, d, up, cd);
  vert(b, a, up, ca); // la face arrière : mêmes points, sens inverse
  vert(b, d, up, cd);
  vert(b, c, up, cc);
  b.indices.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);
}

// Une lame d'herbe : une fine pyramide à 3 faces (4 sommets seulement), base large de `w` m, pointe penchée à `lean` m de côté.
// Vue de n'importe où, on voit ses faces extérieures : pas besoin de la dessiner des deux côtés (7 fois moins de sommets qu'un triangle double face).
function blade(b: MeshBuilder, x: number, y: number, z: number, angle: number, lean: number, h: number, w: number, col: Rgb, dry = 0.35): void {
  const ca = Math.cos(angle), sa = Math.sin(angle); // orientation de la lame
  const p0: P3 = [x - ca * w / 2, y - 0.03, z - sa * w / 2]; // base : côté gauche
  const p1: P3 = [x + ca * w / 2, y - 0.03, z + sa * w / 2]; // base : côté droit
  const p2: P3 = [x + sa * w * 0.45, y - 0.03, z - ca * w * 0.45]; // base : point arrière (donne du volume)
  const tip: P3 = [x - sa * lean, y + h, z + ca * lean]; // la pointe penche d'un côté
  const inner: P3 = [x, y + h * 0.3, z]; // un point à l'intérieur : sert à orienter les faces vers l'extérieur
  const tipCol = lerpRgb(col, [0.8, 0.74, 0.4], dry); // la pointe jaunit : l'herbe se détache du sol vert
  const cb = lin(col, 0.55); // base sombre
  const ct = lin(tipCol, 1.25); // pointe claire
  const up: P3 = [0, 1, 0]; // éclairage vers le haut : l'herbe se fond dans le sol
  const base = b.positions.length / 3;
  vert(b, p0, up, cb); vert(b, p1, up, cb); vert(b, p2, up, cb); vert(b, tip, up, ct);
  for (const [u, v] of [[0, 1], [1, 2], [2, 0]] as const) {
    const pu = [p0, p1, p2][u]!, pv = [p0, p1, p2][v]!;
    const nx = (pv[1] - pu[1]) * (tip[2] - pu[2]) - (pv[2] - pu[2]) * (tip[1] - pu[1]); // normale de la face (u, v, pointe)
    const ny = (pv[2] - pu[2]) * (tip[0] - pu[0]) - (pv[0] - pu[0]) * (tip[2] - pu[2]);
    const nz = (pv[0] - pu[0]) * (tip[1] - pu[1]) - (pv[1] - pu[1]) * (tip[0] - pu[0]);
    const out = nx * ((pu[0] + pv[0] + tip[0]) / 3 - inner[0]) + ny * ((pu[1] + pv[1] + tip[1]) / 3 - inner[1]) + nz * ((pu[2] + pv[2] + tip[2]) / 3 - inner[2]) > 0; // la normale sort-elle ?
    if (out) b.indices.push(base + u, base + v, base + 3);
    else b.indices.push(base + v, base + u, base + 3);
  }
}

// Un solide irrégulier (icosaèdre déformé) : buisson ou rocher. Les faces sont plates, éclairées selon leur inclinaison.
const PHI = (1 + Math.sqrt(5)) / 2; // nombre d'or (pour l'icosaèdre)
const ICO_V: readonly P3[] = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]];
const ICO_F: readonly (readonly [number, number, number])[] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
function lump(b: MeshBuilder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, col: Rgb, seed: number, jitter: number): void {
  const k = Math.hypot(1, PHI); // normalise les sommets de l'icosaèdre à 1
  const pts: P3[] = ICO_V.map((v, i) => {
    const j = 1 + jitter * (hash01(Math.floor(seed * 1e6), i, 91) - 0.5); // chaque sommet un peu déplacé
    return [cx + (v[0] / k) * rx * j, cy + (v[1] / k) * ry * j, cz + (v[2] / k) * rz * j];
  });
  for (const f of ICO_F) {
    const p0 = pts[f[0]]!, p1 = pts[f[1]]!, p2 = pts[f[2]]!;
    let nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]); // normale par produit vectoriel
    let ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
    let nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const mx = (p0[0] + p1[0] + p2[0]) / 3 - cx; // du centre vers la face
    const my = (p0[1] + p1[1] + p2[1]) / 3 - cy;
    const mz = (p0[2] + p1[2] + p2[2]) / 3 - cz;
    const flip = nx * mx + ny * my + nz * mz < 0; // la normale rentre : on retourne la face
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const c = lin(col, 0.8 + 0.3 * Math.max(0, ny)); // le dessus est plus clair
    const base = b.positions.length / 3;
    const order: P3[] = flip ? [p0, p2, p1] : [p0, p1, p2];
    for (const p of order) vert(b, p, [nx, ny, nz], c);
    b.indices.push(base, base + 1, base + 2);
  }
}

// Une petite tête de fleur : octaèdre posé sur une tige.
function flowerHead(b: MeshBuilder, x: number, y: number, z: number, r: number, col: Rgb): void {
  const top: P3 = [x, y + r, z], bot: P3 = [x, y - r * 0.6, z];
  const ring: P3[] = [[x + r, y, z], [x, y, z + r], [x - r, y, z], [x, y, z - r]];
  for (let i = 0; i < 4; i++) {
    const a = ring[i]!, c = ring[(i + 1) % 4]!;
    leaf(b, top, a, c, lin(col, 1.05), lin(col, 0.95), lin(col, 0.95)); // dessus
    leaf(b, bot, c, a, lin(col, 0.7), lin(col, 0.7), lin(col, 0.7)); // dessous
  }
}

// Dessine une plante dans le maillage de la tuile (positions relatives au coin de la tuile : lx, lz).
export function addPlant(b: MeshBuilder, p: Plant, lx: number, lz: number): void {
  const y = p.y - 0.05; // un peu enfoncée dans le sol : pas de plante qui flotte sur une bosse
  const s = p.size;
  const ang = p.seed * Math.PI * 2; // orientation de la plante
  const sd = Math.floor(p.seed * 1e6); // graine entière pour les tirages
  if (p.kind === 'tuft') {
    for (let i = 0; i < 5; i++) { // cinq lames qui partent en éventail
      const a = ang + i * 1.3;
      blade(b, lx + Math.cos(a) * 0.12, y, lz + Math.sin(a) * 0.12, a, (0.2 + 0.2 * hash01(sd, i, 41)) * s, (0.35 + 0.5 * hash01(sd, i, 42)) * s, 0.15 * s, p.color);
    }
  } else if (p.kind === 'heather') {
    for (let i = 0; i < 3; i++) { // trois brins courts, violets au bout
      const a = ang + i * 2.1;
      blade(b, lx + Math.cos(a) * 0.07, y, lz + Math.sin(a) * 0.07, a, 0.1 * s, (0.25 + 0.15 * hash01(sd, i, 43)) * s, 0.1 * s, p.color);
    }
  } else if (p.kind === 'flower') {
    const h = (0.35 + 0.25 * hash01(sd, 1, 44)) * s; // hauteur de la tige
    blade(b, lx, y, lz, ang, 0.03, h, 0.03, [0.3, 0.5, 0.2]); // tige verte, fine
    blade(b, lx + 0.1, y, lz, ang + 1.5, 0.08, h * 0.45, 0.08, [0.3, 0.5, 0.2]); // une feuille
    flowerHead(b, lx, y + h, lz, 0.06 * s, p.color);
  } else if (p.kind === 'fern') {
    for (let i = 0; i < 6; i++) { // six frondes arquées autour du pied
      const a = ang + (i / 6) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx; // direction de la fronde et son travers
      const w = 0.09 * s; // demi-largeur au milieu
      const base: P3 = [lx, y, lz];
      const mid: P3 = [lx + dx * 0.35 * s, y + 0.38 * s, lz + dz * 0.35 * s];
      const tip: P3 = [lx + dx * 0.75 * s, y + 0.3 * s, lz + dz * 0.75 * s];
      const dark = lin(p.color, 0.8);
      const light = lin(p.color, 1.1);
      leaf(b, base, [mid[0] - px * w, mid[1], mid[2] - pz * w], [mid[0] + px * w, mid[1], mid[2] + pz * w], dark, light, light);
      leaf(b, [mid[0] - px * w, mid[1], mid[2] - pz * w], [mid[0] + px * w, mid[1], mid[2] + pz * w], tip, light, light, light);
    }
  } else if (p.kind === 'bush') {
    lump(b, lx, y + 0.45 * s, lz, 0.75 * s, 0.6 * s, 0.75 * s, p.color, p.seed, 0.45); // un gros buisson rond
    lump(b, lx + 0.5 * s, y + 0.3 * s, lz - 0.3 * s, 0.45 * s, 0.38 * s, 0.45 * s, p.color, p.seed + 0.3, 0.45); // une seconde touffe collée
  } else if (p.kind === 'rock') {
    lump(b, lx, y + 0.2 * s, lz, 0.6 * s, 0.32 * s, 0.5 * s, p.color, p.seed, 0.6); // un rocher aplati, bosselé
  } else {
    for (let i = 0; i < 3; i++) { // roseaux : trois grandes lames droites
      const a = ang + i * 2.1;
      blade(b, lx + Math.cos(a) * 0.06, y, lz + Math.sin(a) * 0.06, a, 0.12 * s, (1.1 + 0.6 * hash01(sd, i, 45)) * s, 0.07, p.color);
    }
  }
}

// Ajoute toute la flore d'une tuile dans `b` ; renvoie le nombre de plantes dessinées et la hauteur maximale atteinte au-dessus du sol.
// `vertexRoom` : nombre de sommets qu'il reste avant la limite de 16 bits (la flore s'arrête avant, jamais l'inverse).
export function addFloraForChunk(b: MeshBuilder, terrain: Terrain, cx: number, cz: number, lod: number, chunkSize: number, blocked: ((x: number, z: number) => boolean) | null, hasWater: boolean, vertexRoom: number): { count: number; topY: number } {
  const plants = floraForChunk(terrain, cx, cz, lod, chunkSize, blocked, hasWater);
  const start = b.positions.length / 3; // sommets déjà présents
  const cap = Math.min(FLORA_VERTEX_BUDGET, vertexRoom); // plafond de la flore
  let topY = -Infinity;
  let count = 0;
  for (const p of plants) {
    if (b.positions.length / 3 - start > cap - 200) break; // garde-fou : une plante ajoute 200 sommets au plus
    addPlant(b, p, p.x - cx * chunkSize, p.z - cz * chunkSize);
    count++;
    topY = Math.max(topY, p.y + 2.2 * p.size); // les roseaux sont les plus hauts
  }
  return { count, topY };
}
