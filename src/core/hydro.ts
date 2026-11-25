// Hydrographie réaliste (1.33) : rivières et lacs calculés à partir du relief du jeu. Logique pure : ni navigateur, ni réseau.
//
// Principe : sur un quadrillage de « nœuds » (un tous les 128 m, alignés sur le monde entier), chaque nœud s'écoule vers son voisin le plus bas ;
// les cuvettes se remplissent en lacs jusqu'à leur col, puis débordent. On compte combien de nœuds se déversent en chacun : au-delà d'un seuil, c'est une rivière.
// Le calcul se fait par blocs de 8 km entourés d'une marge de 10 km : un bloc voisin retrouve les mêmes rivières près de la jointure.
// Le résultat est ensuite « rastérisé » par petites tuiles de 128 m (une case de 2 m) : de combien le sol est creusé, et à quelle hauteur est l'eau.

import { clamp, smoothstep } from './math';
import { Heap } from './roads';

export const NODE = 128; // écart entre deux nœuds (m)
export const BLOCK_NODES = 64; // nœuds par côté d'un bloc
export const BLOCK_SIZE = NODE * BLOCK_NODES; // côté d'un bloc (8 192 m)
export const HALO_NODES = 80; // marge de calcul autour du bloc (10 km)
export const TILE = 128; // côté d'une tuile raster (m)
export const RES = 2; // taille d'une case raster (m)
export const CELLS = TILE / RES; // cases par côté d'une tuile
export const RW = CELLS + 1; // échantillons par côté (les bords sont partagés avec les tuiles voisines)
const TILES_PER_BLOCK = BLOCK_SIZE / TILE; // tuiles par côté d'un bloc

export const RIVER_MIN_ACC = 64; // une rivière commence quand 64 nœuds (≈ 1 km²) se déversent en un point
const FLOOD_CAP = 5000; // plafond de nœuds noyés par un lac (sécurité)
const MIN_LAKE_CELLS = 24; // un lac a au moins 24 nœuds (≈ 0,4 km²)…
const MIN_LAKE_DEPTH = 5; // …et au moins 5 m de profondeur ; sinon c'est une flaque que l'eau traverse sans la montrer
export const MAX_WALK_DEPTH = 1.2; // au-delà de cette profondeur d'eau, on ne marche plus

// Les 8 voisins d'un nœud et leur distance en nœuds.
const NB: readonly (readonly [number, number, number])[] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

// Largeur, profondeur et creusement d'une rivière selon son débit (nombre de nœuds amont).
export const riverWidth = (acc: number): number => clamp(1.6 + 0.22 * Math.sqrt(acc), 3, 28);
export const riverDepth = (w: number): number => clamp(0.4 + 0.05 * w, 0.5, 1.8);
const carveBelow = (w: number): number => riverDepth(w) + 0.8; // le fond est sous la hauteur du nœud de cette quantité

// Petit bruit stable par nœud : départage les paliers parfaitement plats.
const tie = (i: number, j: number): number => (((Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) >>> 0) % 1000) * 2e-6;

// Un tronçon de rivière : de (x1, z1) à (x2, z2), largeurs, hauteurs du fond aux deux bouts, profondeur d'eau.
interface RiverSeg {
  x1: number; z1: number; x2: number; z2: number;
  w1: number; w2: number;
  b1: number; b2: number;
  depth: number;
}

// Le raster d'une tuile : de combien le sol est modifié, et la hauteur de l'eau (NaN = pas d'eau ni de rive).
export interface HydroTile {
  delta: Float32Array;
  surf: Float32Array;
}

export class HydroBlock {
  readonly H: Float32Array; // altitude de chaque nœud de la fenêtre
  readonly next: Int32Array; // nœud vers lequel il s'écoule (−1 = sort de la fenêtre ou arrive à la mer)
  readonly acc: Float32Array; // nombre de nœuds qui se déversent ici (lui compris)
  readonly lake: Int32Array; // numéro du lac (−1 = aucun)
  readonly lakeLevel: number[] = []; // niveau de l'eau de chaque lac
  readonly W: number; // nœuds par côté de la fenêtre
  readonly i0: number; // indice du premier nœud de la fenêtre, en x
  readonly j0: number;
  private readonly segsByTile = new Map<number, RiverSeg[]>(); // tronçons qui touchent chaque tuile du bloc
  readonly wet: Uint8Array; // tuiles du bloc qui contiennent de l'eau (rivière ou lac), 64 × 64
  riverCount = 0; // nombre de nœuds de rivière dans le bloc (pour les tests)

  constructor(readonly bx: number, readonly bz: number, private readonly coarse: (x: number, z: number) => number, private readonly threshold: (x: number, z: number) => number) {
    this.W = BLOCK_NODES + 2 * HALO_NODES;
    this.i0 = bx * BLOCK_NODES - HALO_NODES;
    this.j0 = bz * BLOCK_NODES - HALO_NODES;
    const N = this.W * this.W;
    this.H = new Float32Array(N);
    this.next = new Int32Array(N).fill(-1);
    this.acc = new Float32Array(N).fill(1);
    this.lake = new Int32Array(N).fill(-1);
    this.wet = new Uint8Array(TILES_PER_BLOCK * TILES_PER_BLOCK);
    this.compute();
    this.markLakes();
  }

  // Indice d'un nœud (i, j du monde) dans la fenêtre, ou −1 s'il est dehors.
  idx(i: number, j: number): number {
    const li = i - this.i0;
    const lj = j - this.j0;
    return li < 0 || lj < 0 || li >= this.W || lj >= this.W ? -1 : lj * this.W + li;
  }

  private nodeX(k: number): number {
    return (this.i0 + (k % this.W)) * NODE;
  }
  private nodeZ(k: number): number {
    return (this.j0 + Math.floor(k / this.W)) * NODE;
  }

  private compute(): void {
    const { W, H, next, acc, lake } = this;
    const N = W * W;
    // 1) Altitude de chaque nœud (avec un minuscule bruit pour départager les plats).
    for (let k = 0; k < N; k++) {
      const li = k % W;
      const lj = (k - li) / W;
      H[k] = this.coarse((this.i0 + li) * NODE, (this.j0 + lj) * NODE) + tie(this.i0 + li, this.j0 + lj);
    }
    // 2) Chaque nœud à terre s'écoule vers son voisin le plus bas ; sans voisin plus bas, c'est le fond d'une cuvette.
    const pits: number[] = [];
    for (let lj = 1; lj < W - 1; lj++) {
      for (let li = 1; li < W - 1; li++) {
        const k = lj * W + li;
        if (H[k]! <= 0) continue; // la mer : l'eau y arrive et s'arrête
        let best = -1;
        let bestSlope = 0;
        for (const [di, dj, d] of NB) {
          const m = k + dj * W + di;
          const slope = (H[k]! - H[m]!) / d;
          if (slope > bestSlope) {
            bestSlope = slope;
            best = m;
          }
        }
        if (best >= 0) next[k] = best;
        else pits.push(k);
      }
    }
    // 3) Les cuvettes, de la plus basse à la plus haute : on les remplit jusqu'au col.
    pits.sort((a, b) => H[a]! - H[b]! || a - b);
    const done = new Uint8Array(N); // nœuds déjà réglés par une cuvette précédente
    const stamp = new Int32Array(N); // numéro du remplissage qui a vu ce nœud
    const parent = new Int32Array(N);
    let floodId = 0;
    for (const p of pits) {
      if (done[p]) continue;
      const id = ++floodId;
      const heap = new Heap();
      const popped: number[] = [];
      heap.push(H[p]!, p);
      stamp[p] = id;
      parent[p] = -1;
      let level = H[p]!;
      let outlet = -1;
      let down = -1; // le voisin plus bas par lequel l'eau repart
      while (heap.size > 0 && popped.length < FLOOD_CAP) {
        const c = heap.pop();
        popped.push(c);
        const hc = H[c]!;
        if (hc > level) level = hc;
        const ci = c % W;
        const cj = (c - ci) / W;
        if (c !== p) {
          if (ci === 0 || cj === 0 || ci === W - 1 || cj === W - 1) { // le bord de la fenêtre : l'eau sort
            outlet = c;
            down = -1;
            break;
          }
          let m1 = -1; // le voisin le plus bas, hors du remplissage
          for (const [di, dj] of NB) {
            const m = c + dj * W + di;
            if (stamp[m] === id) continue;
            if (H[m]! < hc || done[m] || lake[m]! >= 0) {
              if (m1 < 0 || H[m]! < H[m1]!) m1 = m;
            }
          }
          if (m1 >= 0) {
            outlet = c;
            down = m1;
            break;
          }
        }
        const li = c % W;
        const lj = (c - li) / W;
        if (li === 0 || lj === 0 || li === W - 1 || lj === W - 1) continue; // on ne dépasse pas la fenêtre
        for (const [di, dj] of NB) {
          const m = c + dj * W + di;
          if (stamp[m] === id) continue;
          stamp[m] = id;
          parent[m] = c;
          heap.push(H[m]!, m);
        }
      }
      for (const c of popped) done[c] = 1;
      const cells = popped.filter((c) => c !== outlet);
      const depth = level - H[p]!;
      if (cells.length >= MIN_LAKE_CELLS && depth >= MIN_LAKE_DEPTH) {
        // Un vrai lac : tout ce qui est noyé s'écoule vers le col, d'où l'eau repart.
        const lid = this.lakeLevel.length;
        this.lakeLevel.push(level);
        for (const c of cells) {
          lake[c] = lid;
          next[c] = outlet >= 0 ? outlet : -1;
        }
        if (outlet >= 0) next[outlet] = down;
      } else if (outlet >= 0) {
        // Une flaque : l'eau la traverse en suivant le chemin du fond de la cuvette jusqu'au col.
        for (const c of popped) next[c] = parent[c]!;
        let c = outlet;
        let prev = down;
        while (c >= 0) {
          const pc = parent[c]!;
          next[c] = prev;
          prev = c;
          c = pc;
        }
      } else {
        for (const c of popped) next[c] = -1; // cuvette sans sortie dans la fenêtre : l'eau s'y perd
      }
    }
    // 4) Débit : chaque nœud verse son débit dans le suivant (ordre topologique ; les rares boucles sont coupées).
    const indeg = new Int32Array(N);
    for (let k = 0; k < N; k++) if (next[k]! >= 0) indeg[next[k]!]!++;
    const queue: number[] = [];
    for (let k = 0; k < N; k++) if (indeg[k] === 0) queue.push(k);
    let seen = 0;
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q]!;
      seen++;
      const nx = next[k]!;
      if (nx >= 0) {
        acc[nx] = acc[nx]! + acc[k]!;
        if (--indeg[nx]! === 0) queue.push(nx);
      }
    }
    if (seen < N) for (let k = 0; k < N; k++) if (indeg[k]! > 0) next[k] = -1; // boucle : on la coupe
    // 5) Les rivières : les nœuds du bloc (et un peu autour) dont le débit dépasse le seuil du climat.
    const m0 = HALO_NODES - 4; // les tronçons qui touchent le bloc partent de nœuds à 4 nœuds au plus de lui
    for (let lj = m0; lj < W - m0; lj++) {
      for (let li = m0; li < W - m0; li++) {
        const k = lj * W + li;
        const nx = next[k]!;
        if (nx < 0 || lake[k]! >= 0 || H[k]! <= 0.3 || acc[k]! < RIVER_MIN_ACC) continue;
        const x = (this.i0 + li) * NODE;
        const z = (this.j0 + lj) * NODE;
        if (acc[k]! < RIVER_MIN_ACC * this.threshold(x, z)) continue; // climat sec : il faut un bassin plus grand
        this.addSegment(k, nx);
      }
    }
  }

  // Ajoute le tronçon du nœud k vers son suivant nx, et note les tuiles qu'il touche.
  private addSegment(k: number, nx: number): void {
    const { H, acc, lake } = this;
    const w1 = riverWidth(acc[k]!);
    const w2 = acc[nx]! >= RIVER_MIN_ACC && lake[nx]! < 0 && H[nx]! > 0 ? riverWidth(acc[nx]!) : w1; // à l'arrivée dans un lac ou la mer, la largeur ne change plus
    const b2 = H[nx]! <= 0 ? -0.5 : H[nx]! - carveBelow(w2); // le fond descend sous le niveau de la mer à l'embouchure
    const b1 = H[k]! - carveBelow(w1); // (dans une flaque traversée, le fond peut remonter un peu : on ne bâtit jamais de digue)
    const seg: RiverSeg = { x1: this.nodeX(k), z1: this.nodeZ(k), x2: this.nodeX(nx), z2: this.nodeZ(nx), w1, w2, b1, b2, depth: riverDepth(Math.max(w1, w2)) };
    this.riverCount++;
    const margin = Math.max(w1, w2) / 2 + 2 + 0.5 * Math.max(w1, w2) + 2;
    const tx0 = Math.floor((Math.min(seg.x1, seg.x2) - margin) / TILE);
    const tx1 = Math.floor((Math.max(seg.x1, seg.x2) + margin) / TILE);
    const tz0 = Math.floor((Math.min(seg.z1, seg.z2) - margin) / TILE);
    const tz1 = Math.floor((Math.max(seg.z1, seg.z2) + margin) / TILE);
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = tz * 1048576 + tx;
        let list = this.segsByTile.get(key);
        if (!list) this.segsByTile.set(key, (list = []));
        list.push(seg);
        const lx = tx - this.bx * TILES_PER_BLOCK;
        const lz = tz - this.bz * TILES_PER_BLOCK;
        if (lx >= 0 && lz >= 0 && lx < TILES_PER_BLOCK && lz < TILES_PER_BLOCK) this.wet[lz * TILES_PER_BLOCK + lx] = 1;
      }
    }
  }

  // Les tuiles du bloc qui contiennent un lac : on les marque (appelé une fois, après le calcul).
  markLakes(): void {
    const { W, lake } = this;
    for (let k = 0; k < W * W; k++) {
      if (lake[k]! < 0) continue;
      const x = this.nodeX(k);
      const z = this.nodeZ(k);
      const m = NODE + 2; // un nœud « noyé » couvre ±1 nœud autour de lui
      for (let tz = Math.floor((z - m) / TILE); tz <= Math.floor((z + m) / TILE); tz++) {
        for (let tx = Math.floor((x - m) / TILE); tx <= Math.floor((x + m) / TILE); tx++) {
          const lx = tx - this.bx * TILES_PER_BLOCK;
          const lz = tz - this.bz * TILES_PER_BLOCK;
          if (lx >= 0 && lz >= 0 && lx < TILES_PER_BLOCK && lz < TILES_PER_BLOCK) this.wet[lz * TILES_PER_BLOCK + lx] = 1;
        }
      }
    }
  }

  // Le raster de la tuile (tx, tz) : null si elle ne contient pas d'eau.
  rasterTile(tx: number, tz: number): HydroTile | null {
    const lx = tx - this.bx * TILES_PER_BLOCK;
    const lz = tz - this.bz * TILES_PER_BLOCK;
    const inside = lx >= 0 && lz >= 0 && lx < TILES_PER_BLOCK && lz < TILES_PER_BLOCK;
    if (inside && !this.wet[lz * TILES_PER_BLOCK + lx]) return null;
    const segs = this.segsByTile.get(tz * 1048576 + tx) ?? [];
    const x0 = tx * TILE;
    const z0 = tz * TILE;
    const base = new Float32Array(RW * RW);
    for (let b = 0; b < RW; b++) for (let a = 0; a < RW; a++) base[b * RW + a] = this.coarse(x0 + a * RES, z0 + b * RES);
    const delta = new Float32Array(RW * RW);
    const surf = new Float32Array(RW * RW).fill(NaN);
    let any = false;
    // Lacs : une case est sous l'eau si elle est près d'un nœud noyé et plus basse que le niveau du lac.
    for (let b = 0; b < RW; b++) {
      for (let a = 0; a < RW; a++) {
        const ni = Math.round((x0 + a * RES) / NODE);
        const nj = Math.round((z0 + b * RES) / NODE);
        let lid = -1;
        for (let dj = -1; dj <= 1 && lid < 0; dj++) {
          for (let di = -1; di <= 1; di++) {
            const k = this.idx(ni + di, nj + dj);
            if (k >= 0 && this.lake[k]! >= 0) {
              lid = this.lake[k]!;
              break;
            }
          }
        }
        if (lid >= 0 && base[b * RW + a]! < this.lakeLevel[lid]! - 0.02) {
          surf[b * RW + a] = this.lakeLevel[lid]!;
          any = true;
        }
      }
    }
    // Rivières : creuse le lit et fixe la hauteur de l'eau.
    const bestK = new Float32Array(RW * RW);
    for (const s of segs) {
      const dx = s.x2 - s.x1;
      const dz = s.z2 - s.z1;
      const l2 = dx * dx + dz * dz;
      const wmax = Math.max(s.w1, s.w2);
      const reach = wmax / 2 + 2 + 0.5 * wmax; // jusqu'où le lit influence le sol
      const a0 = Math.max(0, Math.floor((Math.min(s.x1, s.x2) - reach - x0) / RES));
      const a1 = Math.min(RW - 1, Math.ceil((Math.max(s.x1, s.x2) + reach - x0) / RES));
      const b0 = Math.max(0, Math.floor((Math.min(s.z1, s.z2) - reach - z0) / RES));
      const b1 = Math.min(RW - 1, Math.ceil((Math.max(s.z1, s.z2) + reach - z0) / RES));
      for (let b = b0; b <= b1; b++) {
        for (let a = a0; a <= a1; a++) {
          const x = x0 + a * RES;
          const z = z0 + b * RES;
          const t = l2 > 0 ? clamp(((x - s.x1) * dx + (z - s.z1) * dz) / l2, 0, 1) : 0;
          const d = Math.hypot(x - (s.x1 + dx * t), z - (s.z1 + dz * t));
          const w = s.w1 + (s.w2 - s.w1) * t;
          const bank = 2 + 0.5 * w;
          if (d >= w / 2 + bank) continue;
          const k = 1 - smoothstep(w / 2, w / 2 + bank, d); // 1 dans le lit, 0 au bout de la rive
          const i = b * RW + a;
          if (k <= bestK[i]!) continue;
          bestK[i] = k;
          const bed = s.b1 + (s.b2 - s.b1) * t;
          delta[i] = k * (bed - base[i]!);
          surf[i] = bed + s.depth;
          any = true;
        }
      }
    }
    return any ? { delta, surf } : null;
  }
}

// Tout le réseau hydrographique, à la demande : blocs de drainage et tuiles raster en cache.
export class Hydro {
  private readonly blocks = new Map<string, HydroBlock>();
  private readonly tiles = new Map<number, HydroTile | null>();
  private lastTile: HydroTile | null = null;
  private lastTx = Number.NaN;
  private lastTz = Number.NaN;
  stats = { blocks: 0, tiles: 0 }; // pour les tests et le debug

  constructor(private readonly coarse: (x: number, z: number) => number, private readonly threshold: (x: number, z: number) => number = () => 1) {}

  // Le bloc de drainage (bx, bz), calculé la première fois.
  block(bx: number, bz: number): HydroBlock {
    const key = `${bx},${bz}`;
    let b = this.blocks.get(key);
    if (!b) {
      if (this.blocks.size >= 12) {
        const oldest = this.blocks.keys().next().value as string; // on oublie le plus ancien (et ses tuiles : elles se refont au besoin)
        this.blocks.delete(oldest);
        this.tiles.clear();
        this.lastTile = null;
        this.lastTx = Number.NaN;
      }
      b = new HydroBlock(bx, bz, this.coarse, this.threshold);
      this.blocks.set(key, b);
      this.stats.blocks++;
    }
    return b;
  }

  // La tuile raster (tx, tz), ou null s'il n'y a pas d'eau.
  tile(tx: number, tz: number): HydroTile | null {
    if (tx === this.lastTx && tz === this.lastTz) return this.lastTile;
    const key = (tx + 4000000) * 8000000 + (tz + 4000000);
    let t = this.tiles.get(key);
    if (t === undefined) {
      const blk = this.block(Math.floor(tx / TILES_PER_BLOCK), Math.floor(tz / TILES_PER_BLOCK));
      t = blk.rasterTile(tx, tz);
      if (this.tiles.size > 1500) this.tiles.clear();
      this.tiles.set(key, t);
      if (t) this.stats.tiles++;
    }
    this.lastTx = tx;
    this.lastTz = tz;
    this.lastTile = t;
    return t;
  }

  // De combien le sol est modifié en (x, z) (négatif = creusé).
  deltaAt(x: number, z: number): number {
    const tx = Math.floor(x / TILE);
    const tz = Math.floor(z / TILE);
    const t = this.tile(tx, tz);
    if (!t) return 0;
    const fx = (x - tx * TILE) / RES;
    const fz = (z - tz * TILE) / RES;
    const a = Math.min(Math.floor(fx), CELLS - 1);
    const b = Math.min(Math.floor(fz), CELLS - 1);
    const u = fx - a;
    const v = fz - b;
    const d = t.delta;
    const i = b * RW + a;
    return (d[i]! * (1 - u) + d[i + 1]! * u) * (1 - v) + (d[i + RW]! * (1 - u) + d[i + RW + 1]! * u) * v; // interpolation entre les 4 cases
  }

  // Hauteur de l'eau en (x, z) (NaN = pas d'eau ni de rive).
  surfaceAt(x: number, z: number): number {
    const tx = Math.floor(x / TILE);
    const tz = Math.floor(z / TILE);
    const t = this.tile(tx, tz);
    if (!t) return NaN;
    const a = Math.min(Math.round((x - tx * TILE) / RES), CELLS);
    const b = Math.min(Math.round((z - tz * TILE) / RES), CELLS);
    return t.surf[b * RW + a]!;
  }

  // Y a-t-il de l'eau quelque part dans le carré (x0, z0, côté size) ? (rapide : ne calcule que le bloc)
  hasWater(x0: number, z0: number, size: number): boolean {
    for (let tz = Math.floor(z0 / TILE); tz <= Math.floor((z0 + size) / TILE); tz++) {
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + size) / TILE); tx++) {
        const bx = Math.floor(tx / TILES_PER_BLOCK);
        const bz = Math.floor(tz / TILES_PER_BLOCK);
        const blk = this.block(bx, bz);
        if (blk.wet[(tz - bz * TILES_PER_BLOCK) * TILES_PER_BLOCK + (tx - bx * TILES_PER_BLOCK)]) return true;
      }
    }
    return false;
  }

  // Prépare à l'avance les blocs proches de (x, z) (rayon r) : en construit au plus un, et dit s'il en a construit un.
  warm(x: number, z: number, r: number): boolean {
    for (let bz = Math.floor((z - r) / BLOCK_SIZE); bz <= Math.floor((z + r) / BLOCK_SIZE); bz++) {
      for (let bx = Math.floor((x - r) / BLOCK_SIZE); bx <= Math.floor((x + r) / BLOCK_SIZE); bx++) {
        if (!this.blocks.has(`${bx},${bz}`)) {
          this.block(bx, bz);
          return true;
        }
      }
    }
    return false;
  }
}
