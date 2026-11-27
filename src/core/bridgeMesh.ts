// Le maillage d'un pont de bois (1.36) : planches du tablier, deux garde-corps avec leurs poteaux, pieux dans l'eau.
// Logique pure : on remplit un MeshBuilder (positions relatives au coin de la tuile, couleurs en lumière linéaire).
// Chaque morceau n'est dessiné que dans la tuile qui contient son centre : un pont à cheval sur deux tuiles est complet, sans doublon.

import { Bridge, bridgeDeckAt } from './hydro';
import { srgbToLinear } from './math';
import type { MeshBuilder } from './trees';

type P3 = [number, number, number];
type Rgb = [number, number, number];

const PLANK: Rgb = [0.46, 0.33, 0.2]; // brun des planches (sRGB)
const RAIL: Rgb = [0.4, 0.29, 0.18]; // garde-corps
const PILE: Rgb = [0.26, 0.19, 0.12]; // pieux, plus sombres (mouillés)
const THICK = 0.2; // épaisseur du tablier (m)
const RAIL_H = 1.0; // hauteur des garde-corps au-dessus du tablier
const POST_STEP = 2; // un poteau tous les 2 m
const PILE_STEP = 6; // une paire de pieux tous les 6 m au-dessus de l'eau

// Couleur sRGB → linéaire, avec un facteur de clarté.
const lin = (c: Rgb, k: number): Rgb => [srgbToLinear(Math.min(1, c[0] * k)), srgbToLinear(Math.min(1, c[1] * k)), srgbToLinear(Math.min(1, c[2] * k))];

// Petit hasard stable (0..1) à partir d'un entier : nuance chaque planche.
const hash = (n: number): number => (((Math.imul(n | 0, 2654435761) >>> 0) % 1000) / 1000);

// Ajoute un quadrilatère à normale plane, orienté pour regarder à l'opposé de `centre` (le centre du solide).
function quad(b: MeshBuilder, p: [P3, P3, P3, P3], centre: P3, c: Rgb): void {
  const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
  const vx = p[3][0] - p[0][0], vy = p[3][1] - p[0][1], vz = p[3][2] - p[0][2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; // normale par produit vectoriel
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return; // face dégénérée : rien à dessiner
  nx /= len; ny /= len; nz /= len;
  const fx = (p[0][0] + p[2][0]) / 2 - centre[0], fy = (p[0][1] + p[2][1]) / 2 - centre[1], fz = (p[0][2] + p[2][2]) / 2 - centre[2];
  const flip = nx * fx + ny * fy + nz * fz < 0; // la normale pointe vers l'intérieur : on retourne
  if (flip) { nx = -nx; ny = -ny; nz = -nz; }
  const base = b.positions.length / 3;
  for (const q of p) {
    b.positions.push(q[0], q[1], q[2]);
    b.normals.push(nx, ny, nz);
    b.colors.push(c[0], c[1], c[2]);
  }
  if (flip) b.indices.push(base, base + 3, base + 2, base, base + 2, base + 1);
  else b.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// Un solide à 8 coins : bas (0..3) puis haut (4..7), chaque groupe tourne autour du dessus. Six faces.
function solid(b: MeshBuilder, k: P3[], top: Rgb, side: Rgb): void {
  const centre: P3 = [0, 0, 0];
  for (const q of k) { centre[0] += q[0] / 8; centre[1] += q[1] / 8; centre[2] += q[2] / 8; }
  quad(b, [k[4]!, k[5]!, k[6]!, k[7]!], centre, top); // dessus
  quad(b, [k[0]!, k[1]!, k[2]!, k[3]!], centre, side); // dessous
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(b, [k[i]!, k[j]!, k[j + 4]!, k[i + 4]!], centre, side); // les quatre côtés
  }
}

// Ajoute le pont dans `b` (positions relatives au coin (x0, z0) de la tuile de côté `size`) ; renvoie l'altitude du point le plus haut ajouté (−Infinity si rien).
// `bed(x, z)` donne le sol sous le pont (pour les pieux).
export function addBridge(b: MeshBuilder, br: Bridge, x0: number, z0: number, size: number, bed: (x: number, z: number) => number): number {
  let top = -Infinity;
  const px = -br.dz; // direction « en travers » (perpendiculaire au chemin)
  const pz = br.dx;
  const inside = (x: number, z: number): boolean => x >= x0 && x < x0 + size && z >= z0 && z < z0 + size;
  // Point du pont : u le long, v en travers, y absolu → coordonnées de la tuile.
  const at = (u: number, v: number, y: number): P3 => [br.x + br.dx * u + px * v - x0, y, br.z + br.dz * u + pz * v - z0];
  const deck = (u: number): number => bridgeDeckAt(br, br.x + br.dx * u, br.z + br.dz * u) || 0; // hauteur du tablier à l'abscisse u (axe)
  const hw = br.halfW;
  const n = Math.max(1, Math.ceil(2 * br.len)); // une planche par mètre
  const step = (2 * br.len) / n;
  // 1) Le tablier : une dalle inclinée par planche.
  for (let i = 0; i < n; i++) {
    const u0 = -br.len + i * step;
    const u1 = u0 + step;
    const um = (u0 + u1) / 2;
    if (!inside(br.x + br.dx * um, br.z + br.dz * um)) continue;
    const y0 = deck(u0 + 1e-3);
    const y1 = deck(u1 - 1e-3);
    const k = 0.9 + 0.2 * hash(i * 7 + 3); // nuance de la planche
    const gap = 0.03; // petit joint entre planches
    const k8: P3[] = [
      at(u0, -hw, y0 - THICK), at(u1 - gap, -hw, y1 - THICK), at(u1 - gap, hw, y1 - THICK), at(u0, hw, y0 - THICK),
      at(u0, -hw, y0), at(u1 - gap, -hw, y1), at(u1 - gap, hw, y1), at(u0, hw, y0),
    ];
    solid(b, k8, lin(PLANK, k), lin(PLANK, k * 0.7));
    top = Math.max(top, y0, y1);
  }
  // 2) Garde-corps : une lisse haute par mètre, et un poteau tous les 2 m.
  for (const s of [-1, 1]) {
    const v = s * (hw - 0.12);
    for (let i = 0; i < n; i++) {
      const u0 = -br.len + i * step;
      const u1 = u0 + step;
      const um = (u0 + u1) / 2;
      if (!inside(br.x + br.dx * um, br.z + br.dz * um)) continue;
      const y0 = deck(u0 + 1e-3) + RAIL_H;
      const y1 = deck(u1 - 1e-3) + RAIL_H;
      const r = 0.06; // demi-section de la lisse
      const k8: P3[] = [
        at(u0, v - r, y0 - 0.1), at(u1, v - r, y1 - 0.1), at(u1, v + r, y1 - 0.1), at(u0, v + r, y0 - 0.1),
        at(u0, v - r, y0 + 0.06), at(u1, v - r, y1 + 0.06), at(u1, v + r, y1 + 0.06), at(u0, v + r, y0 + 0.06),
      ];
      solid(b, k8, lin(RAIL, 1.05), lin(RAIL, 0.8));
      top = Math.max(top, y0 + 0.06, y1 + 0.06);
    }
    for (let u = -br.len; u <= br.len + 1e-6; u += POST_STEP) {
      if (!inside(br.x + br.dx * u, br.z + br.dz * u)) continue;
      const y = deck(Math.min(Math.max(u, -br.len + 1e-3), br.len - 1e-3));
      const r = 0.07;
      const k8: P3[] = [
        at(u - r, v - r, y), at(u + r, v - r, y), at(u + r, v + r, y), at(u - r, v + r, y),
        at(u - r, v - r, y + RAIL_H), at(u + r, v - r, y + RAIL_H), at(u + r, v + r, y + RAIL_H), at(u - r, v + r, y + RAIL_H),
      ];
      solid(b, k8, lin(RAIL, 0.9), lin(RAIL, 0.75));
    }
  }
  // 3) Pieux : des paires de pieds de bois qui descendent au fond, là où le tablier est bien au-dessus du sol.
  for (let u = -br.len + PILE_STEP / 2; u <= br.len; u += PILE_STEP) {
    if (!inside(br.x + br.dx * u, br.z + br.dz * u)) continue;
    const y = deck(Math.min(Math.max(u, -br.len + 1e-3), br.len - 1e-3));
    for (const s of [-1, 1]) {
      const v = s * (hw - 0.35);
      const gx = br.x + br.dx * u + px * v;
      const gz = br.z + br.dz * u + pz * v;
      const ground = bed(gx, gz);
      if (ground > y - 0.8) continue; // sol trop près du tablier : pas besoin de pieu
      const r = 0.18;
      const yb = ground - 0.4;
      const yt = y - THICK;
      const k8: P3[] = [
        at(u - r, v - r, yb), at(u + r, v - r, yb), at(u + r, v + r, yb), at(u - r, v + r, yb),
        at(u - r, v - r, yt), at(u + r, v - r, yt), at(u + r, v + r, yt), at(u - r, v + r, yt),
      ];
      solid(b, k8, lin(PILE, 1), lin(PILE, 0.85));
    }
  }
  return top;
}
