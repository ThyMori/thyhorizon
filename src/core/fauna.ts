// La faune visible (1.42) : oiseaux, papillons, libellules, lapins, cerfs, moutons et vaches.
// Logique pure : aucun état d'animal n'est gardé. Chaque animal est une fonction du TEMPS (sa position, son cap, ses battements d'ailes se
// calculent à partir de son « foyer » et de l'heure) ; les foyers viennent du lieu (climat, forêt, eau, mer, villages) et du hasard stable
// d'une case de 40 m. Donc : même lieu et même heure = mêmes bêtes, et le monde « continue de vivre » sans qu'on ait rien à simuler.
// Qui est dehors dépend de l'heure (oiseaux le jour, cerfs à l'aube et au crépuscule), de la saison (papillons quand il fait doux),
// du temps (la pluie cache les insectes et les oiseaux) et de la neige.

import { clamp, smoothstep } from './math';
import { hash01 } from './trees';

export type Species = 'songbird' | 'gull' | 'raptor' | 'butterfly' | 'dragonfly' | 'rabbit' | 'deer' | 'sheep' | 'cow';
export const ALL_SPECIES: readonly Species[] = ['songbird', 'gull', 'raptor', 'butterfly', 'dragonfly', 'rabbit', 'deer', 'sheep', 'cow'];

export const FAUNA_CELL = 40; // côté d'une case de placement (m)
export const FAUNA_RADIUS = 130; // on ne calcule que les bêtes à moins de cette distance du joueur (m)
export const MAX_PER_SPECIES = 140; // plafond d'instances dessinées par espèce

// Ce que la faune a besoin de savoir du monde (fourni par le jeu à partir du terrain ; simulé dans les tests).
export interface FaunaWorld {
  groundAt(x: number, z: number): number; // altitude du sol (m)
  waterDepthAt(x: number, z: number): number; // profondeur de l'eau douce (0 = sec)
  biomeAt(x: number, z: number): { forest: number; lush: number }; // forêt 0 à 1 ; verdure 0 (désert, glace) à 1 (prairie)
  nearSea(x: number, z: number): boolean; // la mer est proche (quelques centaines de mètres)
  farmNear(x: number, z: number): { x: number; z: number; r: number } | null; // village proche (centre, rayon des maisons)
}

// Ce qui change avec le temps qu'il fait.
export interface FaunaEnv {
  hours: number; // heure solaire
  tempC: number; // température de l'air
  rain: number; // pluie liquide 0 à 1
  snow: number; // neige au sol 0 à 1
}

// Une bête à dessiner maintenant.
export interface Critter {
  species: Species;
  id: number; // identifiant stable
  x: number; // position dans le monde (m)
  y: number;
  z: number;
  yaw: number; // cap : le museau regarde vers (sin yaw, cos yaw)
  scale: number; // taille (1 = taille de référence de l'espèce)
  flap: number; // battement d'ailes, −1 à 1 (0 pour les bêtes au sol)
  moving: number; // 0 = immobile, 1 = court ou vole vite
  tint: [number, number, number]; // nuance (sRGB, 0 à 1) qui multiplie les couleurs du modèle
}

// Un foyer : l'endroit d'où une bête part et revient.
interface Seed {
  id: number;
  species: Species;
  hx: number;
  hz: number;
}

// Rayon d'alerte : en dessous, la bête s'écarte du joueur (m).
export const ALERT: Record<Species, number> = { songbird: 0, gull: 0, raptor: 0, butterfly: 0, dragonfly: 0, rabbit: 13, deer: 38, sheep: 7, cow: 5 };

const rnd = (id: number, k: number): number => hash01(id, k, 211); // petits hasards propres à une bête

// ---------- Qui est dehors ? ----------

const dayness = (h: number): number => smoothstep(5.5, 7.5, h) * (1 - smoothstep(18, 20.5, h)); // 1 en plein jour
const twilight = (h: number): number => Math.max(smoothstep(4.5, 6.5, h) * (1 - smoothstep(8.5, 10, h)), smoothstep(16.5, 18.5, h) * (1 - smoothstep(21, 22.5, h))); // aube et crépuscule

// Part des bêtes d'une espèce qui sont dehors (0 à 1) : chaque bête a son propre tirage, elle sort quand l'activité le dépasse.
export function activity(species: Species, e: FaunaEnv): number {
  const day = dayness(e.hours);
  const dry = clamp(1 - e.rain * 3, 0, 1); // la moindre pluie rentre les insectes
  const mild = smoothstep(-2, 12, e.tempC);
  switch (species) {
    case 'songbird': return day * (1 - clamp(e.rain * 1.6, 0, 1)) * (0.25 + 0.75 * mild);
    case 'gull': return day * 0.9 * (1 - clamp(e.rain - 0.5, 0, 1));
    case 'raptor': return day * (1 - e.rain) * smoothstep(2, 14, e.tempC);
    case 'butterfly': return smoothstep(8.5, 10.5, e.hours) * (1 - smoothstep(17, 19, e.hours)) * smoothstep(12, 18, e.tempC) * dry * (1 - e.snow);
    case 'dragonfly': return smoothstep(9, 11, e.hours) * (1 - smoothstep(17.5, 19.5, e.hours)) * smoothstep(15, 21, e.tempC) * dry * (1 - e.snow);
    case 'rabbit': return clamp(0.2 + 0.8 * twilight(e.hours) + 0.3 * day, 0, 1) * (1 - 0.5 * e.rain) * (1 - 0.5 * e.snow);
    case 'deer': return clamp(0.15 + 0.85 * twilight(e.hours) + 0.25 * day, 0, 1) * (1 - 0.3 * e.rain);
    case 'sheep': case 'cow': return 1; // le bétail est toujours dans son pré (il dort la nuit : voir `calm`)
  }
}

// ---------- Les foyers d'une case ----------

// Décide, une fois pour toutes, quelles espèces vivent dans la case (cx, cz) : dépend du lieu, jamais de l'heure.
export function seedsForCell(w: FaunaWorld, cx: number, cz: number): Seed[] {
  const x0 = cx * FAUNA_CELL;
  const z0 = cz * FAUNA_CELL;
  const mx = x0 + FAUNA_CELL / 2;
  const mz = z0 + FAUNA_CELL / 2;
  const gy = w.groundAt(mx, mz);
  const out: Seed[] = [];
  if (gy < 0.5) return out; // en pleine mer : rien (les mouettes se tiennent près de la côte)
  const b = w.biomeAt(mx, mz);
  const wet = [[0, 0], [14, 0], [-14, 0], [0, 14], [0, -14]].some(([dx, dz]) => w.waterDepthAt(mx + dx!, mz + dz!) > 0.2); // un ruisseau ou un lac dans la case
  const farm = w.farmNear(mx, mz);
  const sea = w.nearSea(mx, mz) && gy < 60;
  // Ajoute `n` bêtes d'une espèce autour d'un foyer commun (une compagnie).
  const add = (species: Species, salt: number, p: number, nMin: number, nMax: number, spread: number): void => {
    if (hash01(cx, cz, salt) >= p) return;
    const n = nMin + Math.floor(hash01(cx, cz, salt + 1) * (nMax - nMin + 1));
    const hx = x0 + (0.1 + 0.8 * hash01(cx, cz, salt + 2)) * FAUNA_CELL; // foyer de la compagnie
    const hz = z0 + (0.1 + 0.8 * hash01(cx, cz, salt + 3)) * FAUNA_CELL;
    const base = Math.floor(hash01(cx, cz, salt + 4) * 1e8) * 4; // identifiants stables (jamais deux fois le même)
    for (let k = 0; k < n; k++) out.push({ id: base + k, species, hx: hx + (hash01(base + k, 1, 7) - 0.5) * spread, hz: hz + (hash01(base + k, 2, 7) - 0.5) * spread });
  };
  add('songbird', 310, 0.04 + 0.34 * clamp(b.forest * 1.4 + b.lush * 0.3, 0, 1), 3, 6, 6);
  if (sea) add('gull', 320, 0.15, 2, 4, 10);
  if (wet && gy < 800) add('gull', 321, 0.06, 1, 2, 6);
  if (b.lush < 0.7 || gy > 300) add('raptor', 330, 0.03, 1, 1, 0);
  if (b.lush > 0.3 && b.forest < 0.7) add('butterfly', 340, 0.28 * b.lush, 1, 3, 8);
  if (wet) add('dragonfly', 350, 0.55, 1, 3, 5);
  if (b.lush > 0.25) add('rabbit', 360, 0.12 * clamp(b.lush * 1.3, 0, 1), 1, 3, 4);
  if (b.forest > 0.25) add('deer', 370, 0.07 * clamp(b.forest * 1.5, 0, 1), 1, 4, 6);
  if (farm) {
    const d = Math.hypot(mx - farm.x, mz - farm.z);
    if (d > farm.r + 15 && d < farm.r + 420 && !wet) { // pâturages autour du village, pas dans l'eau
      if (hash01(cx, cz, 380) < 0.6) add('sheep', 381, 0.45, 3, 7, 12);
      else add('cow', 390, 0.4, 2, 5, 14);
    }
  }
  return out;
}

// ---------- Le mouvement d'une bête ----------

const TAU = Math.PI * 2;
const NO_TINT: [number, number, number] = [1, 1, 1];

// Nuances de couleur propres à chaque bête (sRGB, multiplient les couleurs du modèle).
function tintFor(s: Species, id: number): [number, number, number] {
  const v = 0.85 + 0.3 * rnd(id, 90);
  switch (s) {
    case 'butterfly': return ([[1, 0.62, 0.15], [1, 0.9, 0.3], [0.95, 0.95, 0.95], [0.4, 0.6, 1], [1, 0.45, 0.5]] as [number, number, number][])[Math.floor(rnd(id, 91) * 5) % 5]!;
    case 'dragonfly': return rnd(id, 91) < 0.5 ? [0.2, 0.55, 0.9] : [0.2, 0.8, 0.5];
    case 'songbird': return [v, v, v];
    case 'sheep': return [v, v * 0.97, v * 0.92];
    default: return [v, v, v];
  }
}

// La bête `seed` à l'instant `t` (secondes), ou null si elle est rentrée, trop loin ou dans l'eau.
export function critterAt(seed: Seed, w: FaunaWorld, e: FaunaEnv, px: number, pz: number, t: number): Critter | null {
  const id = seed.id;
  if (rnd(id, 0) >= activity(seed.species, e)) return null; // pas dehors à cette heure
  const phi = rnd(id, 1) * TAU;
  const sp = seed.species;
  let x = seed.hx;
  let z = seed.hz;
  let y = 0;
  let yaw = 0;
  let flap = 0;
  let moving = 0;
  let scale = 0.85 + 0.3 * rnd(id, 2);
  let bob = 0;
  const flying = sp === 'songbird' || sp === 'gull' || sp === 'raptor' || sp === 'butterfly' || sp === 'dragonfly';
  if (sp === 'songbird' || sp === 'gull' || sp === 'raptor') {
    // Vol en cercles (les petits oiseaux zigzaguent en plus), avec des temps de plané.
    const R = sp === 'songbird' ? 5 + 10 * rnd(id, 3) : sp === 'gull' ? 25 + 35 * rnd(id, 3) : 40 + 50 * rnd(id, 3);
    const om = (sp === 'songbird' ? 0.45 + 0.5 * rnd(id, 4) : sp === 'gull' ? 0.1 + 0.12 * rnd(id, 4) : 0.06 + 0.04 * rnd(id, 4)) * (rnd(id, 5) < 0.5 ? 1 : -1);
    const a = om * t + phi;
    const zig = sp === 'songbird' ? 1.5 : 0;
    x = seed.hx + R * Math.cos(a) + zig * Math.cos(3.1 * t + phi);
    z = seed.hz + R * Math.sin(a) + zig * Math.sin(2.7 * t + phi);
    const vx = -R * om * Math.sin(a) - zig * 3.1 * Math.sin(3.1 * t + phi);
    const vz = R * om * Math.cos(a) + zig * 2.7 * Math.cos(2.7 * t + phi);
    yaw = Math.atan2(vx, vz);
    const h = sp === 'songbird' ? 4 + 6 * rnd(id, 6) : sp === 'gull' ? 10 + 18 * rnd(id, 6) : 45 + 35 * rnd(id, 6);
    y = w.groundAt(x, z) + h + (sp === 'songbird' ? 1.2 * Math.sin(2.3 * t + phi) : 2 * Math.sin(0.4 * t + phi));
    const burst = sp === 'songbird' ? 0.5 + 0.5 * Math.sin(0.9 * t + phi * 3) : sp === 'gull' ? 0.35 + 0.35 * Math.sin(0.5 * t + phi) : 0.1; // plané ou battements
    flap = Math.sin((sp === 'songbird' ? 32 : sp === 'gull' ? 7 : 2) * t + phi) * clamp(burst, 0.1, 1);
    moving = 1;
    scale = sp === 'songbird' ? 0.8 + 0.4 * rnd(id, 2) : sp === 'gull' ? 1 + 0.2 * rnd(id, 2) : 1.6 + 0.4 * rnd(id, 2);
  } else if (sp === 'butterfly' || sp === 'dragonfly') {
    // Vol erratique : somme de deux oscillations autour du foyer. La libellule file par à-coups près de l'eau.
    const A = sp === 'butterfly' ? 3 + 3 * rnd(id, 3) : 3 + 2 * rnd(id, 3);
    const f1 = (sp === 'butterfly' ? 0.35 : 0.8) * (0.8 + 0.5 * rnd(id, 4));
    const f2 = (sp === 'butterfly' ? 0.55 : 1.3) * (0.8 + 0.5 * rnd(id, 5));
    x = seed.hx + A * Math.sin(f1 * t + phi) + 0.8 * Math.sin(2.7 * f2 * t + phi * 2);
    z = seed.hz + A * Math.sin(f2 * t + phi * 1.7) + 0.8 * Math.cos(2.3 * f1 * t + phi);
    const vx = A * f1 * Math.cos(f1 * t + phi) + 0.8 * 2.7 * f2 * Math.cos(2.7 * f2 * t + phi * 2);
    const vz = A * f2 * Math.cos(f2 * t + phi * 1.7) - 0.8 * 2.3 * f1 * Math.sin(2.3 * f1 * t + phi);
    yaw = Math.atan2(vx, vz);
    y = w.groundAt(x, z) + w.waterDepthAt(x, z) + (sp === 'butterfly' ? 0.6 + 0.7 * (0.5 + 0.5 * Math.sin(1.3 * t + phi)) : 0.7 + 0.4 * Math.sin(1.1 * t + phi));
    flap = Math.sin((sp === 'butterfly' ? 22 : 55) * t + phi);
    moving = 1;
    scale = sp === 'butterfly' ? 0.9 + 0.5 * rnd(id, 2) : 1;
  } else {
    // Bêtes au sol : elles flânent lentement autour de leur foyer (le bétail fait la sieste la nuit), et s'écartent quand on approche.
    const calm = sp === 'sheep' || sp === 'cow' ? 0.25 + 0.75 * dayness(e.hours) : 1; // la nuit, le bétail s'étend moins loin (l'amplitude varie, jamais la fréquence : pas de saut)
    const A = (sp === 'rabbit' ? 3 : sp === 'deer' ? 11 : 8) * calm;
    const f1 = (sp === 'rabbit' ? 0.18 : sp === 'deer' ? 0.05 : 0.045) * (0.7 + 0.6 * rnd(id, 4)); // fréquences lentes : ≈ 0,3 m/s pour un mouton
    const f2 = (sp === 'rabbit' ? 0.14 : sp === 'deer' ? 0.04 : 0.038) * (0.7 + 0.6 * rnd(id, 5));
    x = seed.hx + A * Math.sin(f1 * t + phi);
    z = seed.hz + A * Math.cos(f2 * t + phi * 1.3);
    const vx = A * f1 * Math.cos(f1 * t + phi);
    const vz = -A * f2 * Math.sin(f2 * t + phi * 1.3);
    const speed = Math.hypot(vx, vz);
    yaw = speed > 1e-4 ? Math.atan2(vx, vz) : phi;
    moving = clamp(speed / (sp === 'rabbit' ? 0.5 : 0.3), 0, 0.5); // marche tranquille
    // Fuite : si le joueur est trop près, la bête reste au bord de son cercle d'alerte, face opposée.
    const R = ALERT[sp];
    const dx = x - px;
    const dz = z - pz;
    const d = Math.hypot(dx, dz);
    if (d < R) {
      const nx = d > 1e-6 ? dx / d : 1;
      const nz = d > 1e-6 ? dz / d : 0;
      const fx = px + nx * R;
      const fz = pz + nz * R;
      if (w.waterDepthAt(fx, fz) < 0.4) { // pas de fuite dans l'eau profonde
        x = fx;
        z = fz;
        yaw = Math.atan2(nx, nz);
        moving = 1;
      }
    }
    y = w.groundAt(x, z);
    if (w.waterDepthAt(x, z) > 0.4) return null; // pas dans l'eau
    if (moving > 0.55) bob = (sp === 'rabbit' ? 0.2 : 0.12) * Math.abs(Math.sin(t * (sp === 'rabbit' ? 9 : 7) + phi)); // bonds de course
    else if (sp === 'rabbit' && moving > 0.05) bob = 0.07 * Math.abs(Math.sin(t * 5 + phi)); // petits sauts de marche
    scale = sp === 'deer' ? 0.9 + 0.2 * rnd(id, 2) : sp === 'cow' ? 0.95 + 0.15 * rnd(id, 2) : sp === 'sheep' ? 0.9 + 0.2 * rnd(id, 2) : 0.9 + 0.25 * rnd(id, 2);
  }
  if (!flying && !Number.isFinite(y)) return null;
  return { species: sp, id, x, y: y + bob, z, yaw, scale, flap, moving, tint: sp === 'rabbit' || sp === 'deer' || sp === 'cow' || flying || sp === 'sheep' ? tintFor(sp, id) : NO_TINT };
}

// ---------- Le système : toutes les bêtes autour du joueur ----------

const MAX_CACHED_CELLS = 400;

export class Fauna {
  private readonly cache = new Map<string, Seed[]>();

  constructor(private readonly world: FaunaWorld) {}

  // Les foyers d'une case, gardés en mémoire (le calcul touche le terrain, on ne le refait pas à chaque image).
  private cell(cx: number, cz: number): Seed[] {
    const key = `${cx},${cz}`;
    let s = this.cache.get(key);
    if (!s) {
      s = seedsForCell(this.world, cx, cz);
      if (this.cache.size >= MAX_CACHED_CELLS) this.cache.delete(this.cache.keys().next().value as string);
      this.cache.set(key, s);
    }
    return s;
  }

  // Toutes les bêtes dehors à moins de FAUNA_RADIUS du joueur, à l'instant t (secondes). Au plus MAX_PER_SPECIES par espèce.
  around(px: number, pz: number, e: FaunaEnv, t: number): Critter[] {
    const out: Critter[] = [];
    const counts = new Map<Species, number>();
    const r = Math.ceil((FAUNA_RADIUS + 30) / FAUNA_CELL);
    const pcx = Math.floor(px / FAUNA_CELL);
    const pcz = Math.floor(pz / FAUNA_CELL);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const s of this.cell(pcx + dx, pcz + dz)) {
          if (Math.hypot(s.hx - px, s.hz - pz) > FAUNA_RADIUS + 20) continue; // trop loin (les vols en cercle débordent un peu)
          const n = counts.get(s.species) ?? 0;
          if (n >= MAX_PER_SPECIES) continue;
          const c = critterAt(s, this.world, e, px, pz, t);
          if (!c) continue;
          if (Math.hypot(c.x - px, c.z - pz) > FAUNA_RADIUS + 40) continue;
          counts.set(s.species, n + 1);
          out.push(c);
        }
      }
    }
    return out;
  }
}
