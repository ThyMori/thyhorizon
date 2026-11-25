// Chemins de terre entre les vraies villes voisines (1.32). Logique pure : ni navigateur, ni réseau.
// Le réseau est déterministe : deux villes sont reliées si aucune troisième ville n'est plus proche des deux
// (graphe de voisinage relatif : des liaisons courtes, jamais de croisement inutile). Chaque liaison suit le relief
// (recherche A* : pentes douces, jamais dans l'eau), puis est lissée.

import { Cities } from './cities';
import { clamp } from './math';
import type { Terrain } from './terrain';

export const ROAD_HALF = 2.2; // demi-largeur d'un chemin (m)
export const ROAD_RANGE = 35000; // longueur maximale d'une liaison (m)
export const ROAD_TREE_MARGIN = 1.8; // les arbres s'écartent à ROAD_HALF + cette marge du milieu du chemin
const MIN_LINK = 150; // deux villes plus proches que ça se touchent déjà : pas de chemin
const MIN_LAND = 3; // altitude minimale d'un point du chemin (sinon c'est l'eau ou la plage inondable)
const MAX_LAND = 2300; // altitude maximale (au-dessus : neige et glace)
const MAX_EXPAND = 60000; // plafond de nœuds explorés par la recherche (sécurité)

// Un tronçon de sol en terre (chemin ou rue de village), avec sa demi-largeur.
export interface DirtSeg {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  half: number;
}

export interface Pt {
  x: number;
  z: number;
}

// Distance du point (x, z) au tronçon.
export function distToSeg(s: DirtSeg, x: number, z: number): number {
  const dx = s.x2 - s.x1;
  const dz = s.z2 - s.z1;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? clamp(((x - s.x1) * dx + (z - s.z1) * dz) / l2, 0, 1) : 0; // position la plus proche sur le tronçon
  return Math.hypot(x - (s.x1 + dx * t), z - (s.z1 + dz * t));
}

// Distance du point (x, z) au segment a-b (points simples).
function distToLine(a: Pt, b: Pt, x: number, z: number): number {
  return distToSeg({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, half: 0 }, x, z);
}

// Largeur du couloir autour de la ligne droite dans lequel un chemin peut serpenter.
const corridor = (len: number): number => Math.min(2500, 0.3 * len + 300);

// Tas binaire minimal (file de priorité) pour la recherche A*.
export class Heap {
  private readonly f: number[] = [];
  private readonly k: number[] = [];
  get size(): number {
    return this.f.length;
  }
  push(f: number, k: number): void {
    let i = this.f.length;
    this.f.push(f);
    this.k.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p]! <= f) break;
      this.f[i] = this.f[p]!;
      this.k[i] = this.k[p]!;
      i = p;
    }
    this.f[i] = f;
    this.k[i] = k;
  }
  pop(): number {
    const top = this.k[0]!;
    const lf = this.f.pop()!;
    const lk = this.k.pop()!;
    const n = this.f.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && this.f[c + 1]! < this.f[c]!) c++;
        if (this.f[c]! >= lf) break;
        this.f[i] = this.f[c]!;
        this.k[i] = this.k[c]!;
        i = c;
      }
      this.f[i] = lf;
      this.k[i] = lk;
    }
    return top;
  }
}

// Le point est-il praticable ?
const passable = (h: number): boolean => h >= MIN_LAND && h <= MAX_LAND;

// Le segment p-q est-il entièrement praticable et pas trop raide ? (échantillonné tous les 15 m)
function lineOk(t: Terrain, p: Pt, q: Pt): boolean {
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  const n = Math.max(1, Math.ceil(len / 15));
  let prev = t.coarseHeightAt(p.x, p.z);
  for (let i = 1; i <= n; i++) {
    const h = t.coarseHeightAt(p.x + ((q.x - p.x) * i) / n, p.z + ((q.z - p.z) * i) / n);
    if (!passable(h) || Math.abs(h - prev) / (len / n) > 0.22) return false;
    prev = h;
  }
  return true;
}

// Coupe les détours inutiles : de chaque point, on saute au point le plus loin (≤ 600 m) qu'on voit en ligne droite.
function pull(t: Terrain, pts: Pt[]): Pt[] {
  const out: Pt[] = [pts[0]!];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    for (let k = pts.length - 1; k > i + 1; k--) {
      if (Math.hypot(pts[k]!.x - pts[i]!.x, pts[k]!.z - pts[i]!.z) <= 600 && lineOk(t, pts[i]!, pts[k]!)) {
        j = k;
        break;
      }
    }
    out.push(pts[j]!);
    i = j;
  }
  return out;
}

// Arrondit les angles (coupe de coins de Chaikin), en gardant les deux extrémités.
function chaikin(pts: Pt[], rounds: number): Pt[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    if (p.length < 3) return p;
    const q: Pt[] = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      q.push({ x: 0.75 * a.x + 0.25 * b.x, z: 0.75 * a.z + 0.25 * b.z }, { x: 0.25 * a.x + 0.75 * b.x, z: 0.25 * a.z + 0.75 * b.z });
    }
    q.push(p[p.length - 1]!);
    p = q;
  }
  return p;
}

// Trouve un chemin de a à b qui suit le relief. null si aucune liaison praticable.
export function routePath(t: Terrain, a: Pt, b: Pt): Pt[] | null {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < MIN_LINK) return null;
  const step = clamp(len / 120, 40, 120); // taille d'une case de la recherche (m)
  const width = corridor(len);
  const OFF = 4000; // décalage pour fabriquer une clé entière unique par case
  const M = 2 * OFF + 1;
  const keyOf = (i: number, j: number): number => (i + OFF) * M + (j + OFF);
  const gi = Math.round((b.x - a.x) / step); // case d'arrivée
  const gj = Math.round((b.z - a.z) / step);
  const goal = keyOf(gi, gj);
  const heights = new Map<number, number>();
  const hAt = (i: number, j: number): number => {
    const k = keyOf(i, j);
    let h = heights.get(k);
    if (h === undefined) {
      h = t.coarseHeightAt(a.x + i * step, a.z + j * step); // sans les rivières (plus rapide) : les chemins les traversent à gué
      heights.set(k, h);
    }
    return h;
  };
  const cost = new Map<number, number>([[keyOf(0, 0), 0]]);
  const from = new Map<number, number>();
  const heap = new Heap();
  const heuristic = (i: number, j: number): number => Math.hypot(gi - i, gj - j) * step;
  heap.push(heuristic(0, 0), keyOf(0, 0));
  const done = new Set<number>();
  let expanded = 0;
  while (heap.size > 0 && expanded < MAX_EXPAND) {
    const k = heap.pop();
    if (done.has(k)) continue;
    done.add(k);
    expanded++;
    if (k === goal) break;
    const i = Math.floor(k / M) - OFF;
    const j = (k % M) - OFF;
    const g = cost.get(k)!;
    const h0 = hAt(i, j);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        if (di === 0 && dj === 0) continue;
        const ni = i + di;
        const nj = j + dj;
        const nk = keyOf(ni, nj);
        if (done.has(nk)) continue;
        const isGoal = nk === goal;
        if (!isGoal && distToLine(a, b, a.x + ni * step, a.z + nj * step) > width) continue; // hors du couloir
        const h1 = hAt(ni, nj);
        if (!isGoal && !passable(h1)) continue; // eau ou très haut
        const l = step * (di !== 0 && dj !== 0 ? Math.SQRT2 : 1);
        const slope = Math.abs(h1 - h0) / l;
        const ng = g + l * (1 + (slope / 0.1) ** 2 + (h1 < 8 ? 0.4 : 0)); // pentes pénalisées, bord de mer un peu évité
        if (ng < (cost.get(nk) ?? Infinity)) {
          cost.set(nk, ng);
          from.set(nk, k);
          heap.push(ng + heuristic(ni, nj), nk);
        }
      }
    }
  }
  if (!done.has(goal)) return null; // aucun passage
  const pts: Pt[] = [];
  for (let k: number | undefined = goal; k !== undefined; k = from.get(k)) {
    const i = Math.floor(k / M) - OFF;
    const j = (k % M) - OFF;
    pts.push({ x: a.x + i * step, z: a.z + j * step });
  }
  pts.reverse();
  pts[0] = { x: a.x, z: a.z }; // les extrémités sont exactement les centres des villages
  pts[pts.length - 1] = { x: b.x, z: b.z };
  return chaikin(pull(t, pts), 2);
}

export class RoadSystem {
  private readonly links = new Map<number, number[]>(); // voisins de chaque ville
  private readonly paths = new Map<string, Pt[] | null>(); // chemins déjà calculés

  constructor(private readonly cities: Cities, private readonly terrain: Terrain, private readonly anchor: (i: number) => Pt | null) {}

  // Les villes reliées à la ville i (voisinage relatif : aucune ville k plus proche des deux).
  neighbours(i: number): number[] {
    const cached = this.links.get(i);
    if (cached) return cached;
    const a = this.anchor(i);
    const out: number[] = [];
    if (a) {
      const cand: { j: number; p: Pt; d: number }[] = [];
      for (const j of this.cities.nearby(a.x, a.z, ROAD_RANGE)) {
        if (j === i) continue;
        const p = this.anchor(j);
        if (!p) continue;
        const d = Math.hypot(p.x - a.x, p.z - a.z);
        if (d <= ROAD_RANGE && d >= MIN_LINK) cand.push({ j, p, d });
      }
      cand.sort((u, v) => u.d - v.d || u.j - v.j);
      for (const c of cand) {
        const blocked = cand.some((k) => k !== c && k.d < c.d && Math.hypot(k.p.x - c.p.x, k.p.z - c.p.z) < c.d); // une ville plus proche des deux
        if (!blocked) out.push(c.j);
      }
    }
    this.links.set(i, out);
    return out;
  }

  // Le chemin entre les villes i et j (le même dans les deux sens), ou null.
  path(i: number, j: number): Pt[] | null {
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const key = `${lo}-${hi}`;
    if (this.paths.has(key)) return this.paths.get(key)!;
    const a = this.anchor(lo);
    const b = this.anchor(hi);
    const p = a && b ? routePath(this.terrain, a, b) : null;
    this.paths.set(key, p);
    return p;
  }

  // Tous les tronçons de chemin qui touchent le disque (x, z, r).
  segmentsNear(x: number, z: number, r: number): DirtSeg[] {
    const out: DirtSeg[] = [];
    for (const i of this.cities.nearby(x, z, r + ROAD_RANGE)) {
      const a = this.anchor(i);
      if (!a) continue;
      for (const j of this.neighbours(i)) {
        if (j < i) continue; // chaque liaison une seule fois
        const b = this.anchor(j)!;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (distToLine(a, b, x, z) > r + corridor(len)) continue; // trop loin
        const p = this.path(i, j);
        if (!p) continue;
        for (let k = 0; k + 1 < p.length; k++) {
          const s: DirtSeg = { x1: p[k]!.x, z1: p[k]!.z, x2: p[k + 1]!.x, z2: p[k + 1]!.z, half: ROAD_HALF };
          if (distToSeg(s, x, z) <= r) out.push(s);
        }
      }
    }
    return out;
  }
}
