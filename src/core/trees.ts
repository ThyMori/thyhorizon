// Les arbres : où ils poussent (selon le climat, l'altitude, la pente) et leur forme en quelques triangles.
// Logique pure : elle tourne dans le worker et dans les tests. Les arbres sont ajoutés au maillage de chaque tuile.
// Même graine → mêmes arbres, toujours aux mêmes endroits.

import { Rgb, clamp, lerp, smoothstep } from './math';
import { SEASON_LEAF, seasonCode } from './season';
import { slopeAt } from './terrain';
import type { Terrain } from './terrain';

export type TreeKind = 'conifer' | 'broadleaf' | 'acacia';

// Un arbre placé dans le monde.
export interface Tree {
  x: number; // position dans le monde (m)
  z: number;
  y: number; // altitude du sol au pied
  kind: TreeKind;
  size: number; // facteur de taille (1 = arbre moyen)
  seed: number; // nombre pseudo-aléatoire propre à l'arbre (0 à 1)
}

export const TREE_GROWTH = 1.35; // facteur de taille général des arbres (1.40.1 : ils étaient un peu bas) ; le tronc suit, donc la collision aussi
export const TREE_VERTEX_BUDGET = 40000; // sommets d'arbres maximum par tuile

// Taille d'une case de placement selon le niveau de détail de la tuile (un arbre au plus par case) ; 0 = pas d'arbres.
export const TREE_CELL = [8, 8, 16, 0] as const;

// Nombre pseudo-aléatoire stable (0 à 1) pour deux entiers et un « sel ».
export function hash01(a: number, b: number, salt: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// Les arbres d'une tuile. Rien sur la plage ni dans l'eau, rien sur les pentes raides, rien au-delà de la limite des arbres (sous la limite des neiges).
export function treesForChunk(terrain: Terrain, cx: number, cz: number, lod: number, chunkSize: number, blocked: ((x: number, z: number) => boolean) | null = null): Tree[] {
  const cell = TREE_CELL[lod] ?? 0;
  if (cell === 0) return [];
  const n = chunkSize / cell; // cases par côté
  const x0 = cx * chunkSize;
  const z0 = cz * chunkSize;
  const sizeBoost = lod >= 2 ? 1.3 : 1; // de loin, des arbres un peu plus gros compensent leur nombre réduit
  const trees: Tree[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gi = cx * n + i; // indice de la case dans la grille du monde (stable d'une tuile à l'autre)
      const gj = cz * n + j;
      const x = x0 + (i + 0.15 + 0.7 * hash01(gi, gj, 1)) * cell;
      const z = z0 + (j + 0.15 + 0.7 * hash01(gi, gj, 2)) * cell;
      if (blocked && blocked(x, z)) continue; // village : pas d'arbres dans les rues et les jardins
      const biome = terrain.biomeAt(x, z);
      if (biome.forest < 0.003) continue; // climat sans arbres
      // Densité locale : forêt dense = grandes taches (clairières entre elles) ; savane = arbres isolés partout.
      const patch = 0.5 + 0.5 * terrain.forestNoise(x, z);
      const clumpy = smoothstep(0.35, 0.65, patch + (biome.forest - 0.5) * 0.7);
      const density = lerp(biome.forest, clumpy * 0.95, smoothstep(0.2, 0.4, biome.forest));
      if (hash01(gi, gj, 3) >= density) continue; // pas d'arbre dans cette case
      const y = terrain.heightAt(x, z);
      if (y < 4) continue; // plage et mer
      if (y > biome.snowLine * 0.6) continue; // au-dessus de la limite des arbres
      if (slopeAt(terrain, x, z, 2) > 0.55) continue; // pente trop raide (> 29°)
      const k = hash01(gi, gj, 4); // choix de l'espèce
      const kind: TreeKind = k < biome.acacia ? 'acacia' : hash01(gi, gj, 5) < biome.conifer ? 'conifer' : 'broadleaf';
      const cold = smoothstep(2000, 300, biome.snowLine); // arbres plus petits près des pôles et en altitude
      const size = (0.75 + 0.6 * hash01(gi, gj, 6)) * lerp(1, 0.65, cold) * sizeBoost * TREE_GROWTH;
      trees.push({ x, z, y, kind, size, seed: hash01(gi, gj, 7) });
    }
  }
  return trees;
}

// ---------- Formes ----------

// Tableaux en cours de remplissage (partagés avec le terrain de la tuile).
export interface MeshBuilder {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  seasons?: number[]; // code de saison de chaque sommet (voir core/season.ts) ; absent = pas de saisons pour ce maillage
  season?: number; // le code appliqué aux sommets ajoutés maintenant (0 = ne change pas)
}

const TRUNK: Rgb = [0.5, 0.38, 0.26]; // brun d'écorce (assez clair : l'ombre des feuilles le fonce déjà)
const BIRCH: Rgb = [0.8, 0.78, 0.72]; // écorce claire du bouleau
const FOLIAGE: Record<TreeKind, Rgb> = {
  conifer: [0.08, 0.22, 0.12], // vert très sombre
  broadleaf: [0.19, 0.4, 0.13], // vert franc
  acacia: [0.36, 0.42, 0.17], // vert olive
};
const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // sRGB → linéaire
const linear = (c: Rgb, k: number): Rgb => [lin(clamp(c[0] * k, 0, 1)), lin(clamp(c[1] * k, 0, 1)), lin(clamp(c[2] * k, 0, 1))];

// Rayon du pied du tronc (m) selon l'espèce, pour une taille de 1 : sert à la fois au dessin et à la collision (on ne traverse pas un tronc).
export const TRUNK_BASE: Record<TreeKind, number> = { conifer: 0.34, broadleaf: 0.5, acacia: 0.36 };
export const trunkRadius = (t: { kind: TreeKind; size: number }): number => TRUNK_BASE[t.kind] * t.size * 0.9;

// Ajoute un sommet et renvoie son numéro.
function vertex(b: MeshBuilder, p: [number, number, number], nrm: [number, number, number], c: Rgb): number {
  const len = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
  b.positions.push(p[0], p[1], p[2]);
  b.normals.push(nrm[0] / len, nrm[1] / len, nrm[2] / len);
  b.colors.push(c[0], c[1], c[2]);
  if (b.seasons) b.seasons.push(b.season ?? 0); // la saison de ce sommet
  return b.positions.length / 3 - 1;
}

type P3 = [number, number, number];

// Un membre : tronc ou branche en cône tronqué (plus fin en haut) entre deux points, avec des bandes d'écorce plus claires et plus sombres.
function limb(b: MeshBuilder, p0: P3, p1: P3, r0: number, r1: number, sides: number, c0: Rgb, c1: Rgb, seed: number): void {
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const az = p1[2] - p0[2];
  const len = Math.hypot(ax, ay, az) || 1;
  const n: P3 = [ax / len, ay / len, az / len]; // axe du membre
  const h: P3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; // un vecteur qui n'est pas parallèle à l'axe
  let ux = n[1] * h[2] - n[2] * h[1]; // u = axe × h
  let uy = n[2] * h[0] - n[0] * h[2];
  let uz = n[0] * h[1] - n[1] * h[0];
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = n[1] * uz - n[2] * uy; // v = axe × u
  const vy = n[2] * ux - n[0] * uz;
  const vz = n[0] * uy - n[1] * ux;
  const rings: number[][] = [[], []];
  for (let k = 0; k < 2; k++) {
    const p = k === 0 ? p0 : p1;
    const r = k === 0 ? r0 : r1;
    const col = k === 0 ? c0 : c1;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const dx = ux * Math.cos(a) + vx * Math.sin(a);
      const dy = uy * Math.cos(a) + vy * Math.sin(a);
      const dz = uz * Math.cos(a) + vz * Math.sin(a);
      const stripe = 0.8 + 0.4 * hash01(Math.floor(seed * 1e6), s, 21 + k); // bande d'écorce : chaque côté sa nuance
      rings[k]!.push(vertex(b, [p[0] + dx * r, p[1] + dy * r, p[2] + dz * r], [dx + n[0] * 0.25, dy + n[1] * 0.25, dz + n[2] * 0.25], [col[0] * stripe, col[1] * stripe, col[2] * stripe]));
    }
  }
  for (let s = 0; s < sides; s++) {
    const t = (s + 1) % sides;
    b.indices.push(rings[0]![s]!, rings[1]![s]!, rings[0]![t]!, rings[0]![t]!, rings[1]![s]!, rings[1]![t]!);
  }
}

// Tronc légèrement tordu en `segs` tronçons, évasé au pied (racines). Renvoie les points du tronc (centre et rayon) pour y accrocher les branches.
function bentTrunk(b: MeshBuilder, ox: number, oy: number, oz: number, baseR: number, topR: number, height: number, segs: number, bend: number, bark: Rgb, seed: number, sides: number): { p: P3; r: number }[] {
  const pts: { p: P3; r: number }[] = [{ p: [ox, oy - 0.8, oz], r: baseR * 1.3 }]; // le pied s'enfonce dans le sol (jamais de trou) et s'évase
  let x = ox;
  let z = oz;
  for (let k = 1; k <= segs; k++) {
    x += (hash01(Math.floor(seed * 1e6), k, 31) - 0.5) * bend; // chaque tronçon dévie un peu : un tronc n'est jamais droit
    z += (hash01(Math.floor(seed * 1e6), k, 32) - 0.5) * bend;
    pts.push({ p: [x, oy + (height * k) / segs, z], r: lerp(baseR, topR, k / segs) });
  }
  for (let k = 0; k < pts.length - 1; k++) {
    const dark = k === 0 ? 0.82 : 1 - 0.04 * k; // pied sombre et mousseux, puis de plus en plus clair
    limb(b, pts[k]!.p, pts[k + 1]!.p, pts[k]!.r, pts[k + 1]!.r, sides, linear(bark, dark), linear(bark, dark + 0.08), seed + k * 0.11);
  }
  return pts;
}

// Cône à `sides` faces (étage de conifère), bord irrégulier et retombant : les branches basses pendent comme celles d'un vrai sapin.
function skirt(b: MeshBuilder, ox: number, oy: number, oz: number, radius: number, height: number, c: Rgb, shade: number, sides: number, seed: number, ragged: boolean): void {
  const base: number[] = [];
  for (let s = 0; s < sides; s++) {
    const a = (s / sides) * Math.PI * 2 + 0.3 + seed;
    const out = ragged ? (s % 2 === 0 ? 1 : 0.72) * (0.92 + 0.16 * hash01(Math.floor(seed * 1e6), s, 41)) : 1; // pointes de branches irrégulières
    const drop = ragged && s % 2 === 0 ? -0.22 * height * 0.3 : 0; // les pointes retombent
    const col = linear(c, shade * (s % 2 === 0 ? 1.05 : 0.9));
    base.push(vertex(b, [ox + Math.cos(a) * radius * out, oy + drop, oz + Math.sin(a) * radius * out], [Math.cos(a) * height, radius * 0.9, Math.sin(a) * height], col));
  }
  const apex = vertex(b, [ox, oy + height, oz], [0, 1, 0], linear(c, shade * 1.12));
  for (let s = 0; s < sides; s++) b.indices.push(base[s]!, apex, base[(s + 1) % sides]!);
  const center = vertex(b, [ox, oy, oz], [0, -1, 0], linear(c, shade * 0.5)); // dessous sombre : visible d'en bas
  for (let s = 0; s < sides; s++) b.indices.push(base[(s + 1) % sides]!, center, base[s]!);
}

// Icosaèdre déformé : une touffe de feuillage à 20 faces, étirée (rx, ry, rz), irrégulière, avec des nuances de vert d'un sommet à l'autre.
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO: [number, number, number][] = [
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
];
const ICO_FACES = [
  0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
  3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
];
function blob(b: MeshBuilder, ox: number, oy: number, oz: number, rx: number, ry: number, rz: number, c: Rgb, seed: number): void {
  const ids: number[] = [];
  const sd = Math.floor(seed * 1e6);
  ICO.forEach(([x, y, z], k) => {
    const len = Math.hypot(x, y, z);
    const wobble = 0.78 + 0.44 * hash01(sd, k, 11); // chaque sommet plus ou moins loin : silhouette bosselée, comme un amas de feuilles
    const top = smoothstep(-1, 1, y / len);
    const shade = 0.62 + 0.55 * top + (hash01(sd, k, 12) - 0.5) * 0.18; // dessous sombre et dessus éclairé, avec des nuances de feuille à feuille
    const col = linear([c[0] * (1 + 0.12 * top), c[1] * (1 + 0.05 * top), c[2] * (1 - 0.15 * top)], shade); // le sommet jaunit un peu au soleil
    ids.push(vertex(b, [ox + (x / len) * rx * wobble, oy + (y / len) * ry * wobble, oz + (z / len) * rz * wobble], [x / len, y / len + 0.35, z / len], col));
  });
  for (const f of ICO_FACES) b.indices.push(ids[f]!);
}


// Icosphère subdivisée une fois (42 sommets, 80 faces) : touffes de feuillage plus rondes et plus bosselées que l'icosaèdre simple.
const FINE_V: [number, number, number][] = ICO.map(([x, y, z]) => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
});
const FINE_F: number[] = [];
{
  const mid = new Map<string, number>(); // milieu d'une arête → numéro du nouveau sommet
  const mp = (a: number, b: number): number => {
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    let k = mid.get(key);
    if (k === undefined) {
      const A = FINE_V[a]!;
      const B = FINE_V[b]!;
      const m: [number, number, number] = [A[0] + B[0], A[1] + B[1], A[2] + B[2]];
      const l = Math.hypot(m[0], m[1], m[2]);
      FINE_V.push([m[0] / l, m[1] / l, m[2] / l]); // le milieu est ramené sur la sphère
      k = FINE_V.length - 1;
      mid.set(key, k);
    }
    return k;
  };
  for (let f = 0; f < ICO_FACES.length; f += 3) {
    const a = ICO_FACES[f]!;
    const b = ICO_FACES[f + 1]!;
    const c = ICO_FACES[f + 2]!;
    const ab = mp(a, b);
    const bc = mp(b, c);
    const ca = mp(c, a);
    FINE_F.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca); // une face = quatre petites
  }
}

// Touffe fine (détail 0).
function fineBlob(b: MeshBuilder, ox: number, oy: number, oz: number, rx: number, ry: number, rz: number, c: Rgb, seed: number): void {
  const sd = Math.floor(seed * 1e6);
  const ids = FINE_V.map(([x, y, z], k) => {
    const wobble = 0.74 + 0.5 * hash01(sd, k, 13); // bosses de feuillage plus marquées
    const top = smoothstep(-1, 1, y);
    const shade = 0.6 + 0.58 * top + (hash01(sd, k, 14) - 0.5) * 0.2;
    const col = linear([c[0] * (1 + 0.12 * top), c[1] * (1 + 0.05 * top), c[2] * (1 - 0.15 * top)], shade);
    return vertex(b, [ox + x * rx * wobble, oy + y * ry * wobble, oz + z * rz * wobble], [x, y + 0.35, z], col);
  });
  for (const f of FINE_F) b.indices.push(ids[f]!);
}

// Direction horizontale d'une branche, répartie autour du tronc.
// Couleur d'écorce (sRGB) multipliée par une nuance : bentTrunk la convertit lui-même en linéaire.
const tinted = (c: Rgb, k: number): Rgb => [clamp(c[0] * k, 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k, 0, 1)];

const around = (seed: number, i: number, n: number): number => seed * Math.PI * 2 + (i / n) * Math.PI * 2 + (hash01(Math.floor(seed * 1e6), i, 51) - 0.5) * 0.9;

// Ajoute un arbre au maillage. (lx, lz) = position relative au coin de la tuile. detail 0 = arbre complet (près), 1 = simplifié (loin).
export function addTree(b: MeshBuilder, t: Tree, lx: number, lz: number, detail = 0): void {
  const s = t.size;
  const tone = 0.85 + 0.3 * t.seed; // chaque arbre a sa nuance
  const birch = t.kind === 'broadleaf' && t.seed > 0.82; // quelques feuillus ont l'écorce claire du bouleau
  const bark = birch ? BIRCH : TRUNK;
  const foliage: Rgb = birch ? [0.3, 0.46, 0.14] : FOLIAGE[t.kind];
  const sides = detail === 0 ? 8 : 6;
  const y = t.y;
  const barkTone = birch ? 1 : tone;
  if (t.kind === 'conifer') {
    const pts = bentTrunk(b, lx, y, lz, TRUNK_BASE.conifer * s, 0.15 * s, 2.6 * s, detail === 0 ? 2 : 1, 0.2 * s, tinted(bark, barkTone), t.seed, sides);
    void pts;
    const tiers = detail === 0 ? 6 : 4;
    for (let i = 0; i < tiers; i++) {
      const f = i / (tiers - 1); // 0 = étage du bas, 1 = pointe
      const lean = (hash01(Math.floor(t.seed * 1e6), i, 61) - 0.5) * 0.5 * s; // chaque étage un peu décalé : le sapin n'est pas un cône parfait
      const leanZ = (hash01(Math.floor(t.seed * 1e6), i, 62) - 0.5) * 0.5 * s;
      skirt(b, lx + lean, y + (1.3 + f * (detail === 0 ? 8 : 7.4)) * s, lz + leanZ, lerp(2.6, 0.7, f) * s, lerp(2.7, 2.0, f) * s, foliage, tone * (i % 2 === 0 ? 1 : 0.9), detail === 0 ? 8 : 6, t.seed + i * 0.07, detail === 0);
    }
  } else if (t.kind === 'broadleaf') {
    const H = 3.6 * s;
    const pts = bentTrunk(b, lx, y, lz, TRUNK_BASE.broadleaf * s, 0.26 * s, H, detail === 0 ? 3 : 1, 0.5 * s, tinted(bark, barkTone), t.seed, sides);
    const top = pts[pts.length - 1]!.p;
    if (detail === 0) {
      const nb = 3; // trois grosses branches partent du haut du tronc
      for (let i = 0; i < nb; i++) {
        const from = pts[2 + (i % 2)]!; // accrochées au deuxième ou au troisième tronçon
        const a = around(t.seed, i, nb);
        const len = (1.9 + 0.8 * hash01(Math.floor(t.seed * 1e6), i, 71)) * s;
        const end: P3 = [from.p[0] + Math.cos(a) * len, from.p[1] + (0.9 + 0.5 * hash01(Math.floor(t.seed * 1e6), i, 72)) * s * 1.3, from.p[2] + Math.sin(a) * len];
        limb(b, from.p, end, from.r * 0.55, from.r * 0.2, 5, linear(bark, barkTone * 0.95), linear(bark, barkTone), t.seed + i * 0.3);
        const bs = (1.9 + 0.7 * hash01(Math.floor(t.seed * 1e6), i, 73)) * s; // touffe au bout de la branche
        b.season = seasonCode(SEASON_LEAF, hash01(Math.floor(t.seed * 1e6), 10 + i, 56)); // chaque touffe de feuilles tombe à son heure
        fineBlob(b, end[0], end[1] + 0.7 * s, end[2], bs, bs * 0.8, bs, foliage, t.seed + i * 0.137);
        b.season = 0; // le reste de l'arbre ne change pas
      }
      b.season = seasonCode(SEASON_LEAF, hash01(Math.floor(t.seed * 1e6), 1, 56)); // chaque touffe de feuilles tombe à son heure
      fineBlob(b, top[0], top[1] + 1.7 * s, top[2], 2.8 * s, 2.3 * s, 2.8 * s, foliage, t.seed + 0.5); // grosse touffe centrale
      b.season = 0; // le reste de l'arbre ne change pas
      b.season = seasonCode(SEASON_LEAF, hash01(Math.floor(t.seed * 1e6), 2, 56)); // chaque touffe de feuilles tombe à son heure
      fineBlob(b, top[0] + Math.cos(t.seed * 9) * 1.6 * s, top[1] + 0.7 * s, top[2] + Math.sin(t.seed * 9) * 1.6 * s, 2.1 * s, 1.6 * s, 2.1 * s, foliage, t.seed + 0.77); // touffe basse : le feuillage descend vers le tronc
      b.season = 0; // le reste de l'arbre ne change pas
      b.season = seasonCode(SEASON_LEAF, hash01(Math.floor(t.seed * 1e6), 3, 56)); // chaque touffe de feuilles tombe à son heure
      fineBlob(b, top[0] + Math.cos(t.seed * 9 + 3.4) * 1.7 * s, top[1] + 2.4 * s, top[2] + Math.sin(t.seed * 9 + 3.4) * 1.7 * s, 1.7 * s, 1.4 * s, 1.7 * s, foliage, t.seed + 0.91); // touffe haute décalée : cime irrégulière
      b.season = 0; // le reste de l'arbre ne change pas
    } else {
      b.season = seasonCode(SEASON_LEAF, hash01(Math.floor(t.seed * 1e6), 4, 56)); // chaque touffe de feuilles tombe à son heure
      blob(b, top[0], top[1] + 1.8 * s, top[2], 3.1 * s, 2.7 * s, 3.1 * s, foliage, t.seed);
      b.season = 0; // le reste de l'arbre ne change pas
      b.season = seasonCode(SEASON_LEAF, hash01(Math.floor(t.seed * 1e6), 5, 56)); // chaque touffe de feuilles tombe à son heure
      blob(b, top[0] + 1.2 * s, top[1] + 0.9 * s, top[2] - 0.8 * s, 1.9 * s, 1.6 * s, 1.9 * s, foliage, t.seed + 0.37);
      b.season = 0; // le reste de l'arbre ne change pas
    }
    b.season = 0; // le reste ne change pas avec les saisons
  } else {
    const H = 3.8 * s;
    const pts = bentTrunk(b, lx, y, lz, TRUNK_BASE.acacia * s, 0.2 * s, H, detail === 0 ? 2 : 1, 0.9 * s, tinted(bark, barkTone), t.seed, sides);
    const top = pts[pts.length - 1]!.p;
    if (detail === 0) {
      const nb = 3; // l'acacia se divise en fourche, branches ouvertes vers l'extérieur
      for (let i = 0; i < nb; i++) {
        const a = around(t.seed, i, nb);
        const len = (2.2 + 0.8 * hash01(Math.floor(t.seed * 1e6), i, 81)) * s;
        const end: P3 = [top[0] + Math.cos(a) * len, top[1] + 1.1 * s, top[2] + Math.sin(a) * len];
        limb(b, [top[0], top[1] - 0.6 * s, top[2]], end, 0.16 * s, 0.07 * s, 5, linear(bark, barkTone), linear(bark, barkTone * 1.05), t.seed + i * 0.2);
        fineBlob(b, end[0], end[1] + 0.35 * s, end[2], 2.3 * s, 0.75 * s, 2.3 * s, foliage, t.seed + i * 0.19); // touffe plate en étage
      }
      fineBlob(b, top[0], top[1] + 1.2 * s, top[2], 2.7 * s, 0.85 * s, 2.7 * s, foliage, t.seed + 0.6);
    } else {
      blob(b, top[0], top[1] + 1.0 * s, top[2], 3.6 * s, 0.95 * s, 3.6 * s, foliage, t.seed);
    }
  }
}

// Ajoute tous les arbres d'une tuile ; renvoie leur nombre et la hauteur maximale atteinte au-dessus du sol (pour les bornes de la tuile).
export function addTreesForChunk(b: MeshBuilder, terrain: Terrain, cx: number, cz: number, lod: number, chunkSize: number, blocked: ((x: number, z: number) => boolean) | null = null): { count: number; topY: number } {
  const trees = treesForChunk(terrain, cx, cz, lod, chunkSize, blocked);
  let topY = -Infinity;
  for (const t of trees) {
    if (b.positions.length / 3 > TREE_VERTEX_BUDGET) break; // garde-fou : les indices sont sur 16 bits, jamais plus de ~40 000 sommets d'arbres par tuile
    addTree(b, t, t.x - cx * chunkSize, t.z - cz * chunkSize, lod === 0 ? 0 : 1); // arbre complet de près, simplifié de loin
    topY = Math.max(topY, t.y + 12 * t.size);
  }
  return { count: trees.length, topY };
}
