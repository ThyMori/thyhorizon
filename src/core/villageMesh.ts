// Le maillage 3D d'un village (maisons, poteaux de panneaux) : des tableaux de sommets prêts pour la carte graphique. Logique pure.
// Les positions sont RELATIVES au centre du village (x, z) ; la hauteur y est absolue. Couleurs de sommets en linéaire (comme les arbres).

import { Rgb, clamp } from './math';
import { hash01, MeshBuilder } from './trees';
import type { House, Sign, Village } from './village';

type P3 = [number, number, number];

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // sRGB → linéaire
const shade = (c: Rgb, k: number): Rgb => [lin(clamp(c[0] * k, 0, 1)), lin(clamp(c[1] * k, 0, 1)), lin(clamp(c[2] * k, 0, 1))];
const WOOD: Rgb = [0.36, 0.26, 0.17]; // bois des poteaux
export const SIGN_W = 2.3; // largeur du panneau (m)
export const SIGN_H = 0.6; // hauteur du panneau (m)
export const SIGN_Y = 1.75; // hauteur du bas du panneau au-dessus du sol (m)

// Ajoute un polygone plan convexe (3 ou 4 points), avec une normale calculée. Le matériau est à double face : le sens des points n'a pas d'importance.
function face(b: MeshBuilder, pts: P3[], color: Rgb): void {
  const [p0, p1, p2] = pts as [P3, P3, P3];
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  const base = b.positions.length / 3;
  for (const p of pts) {
    b.positions.push(p[0], p[1], p[2]);
    b.normals.push(nx, ny, nz);
    b.colors.push(color[0], color[1], color[2]);
  }
  for (let k = 1; k + 1 < pts.length; k++) b.indices.push(base, base + k, base + k + 1); // éventail de triangles
}

// Une maison, posée dans le repère du village (ax, az = centre du village).
function addHouse(b: MeshBuilder, h: House, ax: number, az: number, door: Rgb, win: Rgb): void {
  const c = Math.cos(h.yaw);
  const s = Math.sin(h.yaw);
  // Repère local (u le long de la rue, v vers l'arrière, y) → repère du village.
  const P = (u: number, y: number, v: number): P3 => [h.x + u * c - v * s - ax, y, h.z + u * s + v * c - az];
  const hw = h.w / 2;
  const hd = h.d / 2;
  const top = h.floorY + h.wallH;
  const bottom = h.baseY;
  const k = (i: number): number => 0.93 + 0.14 * hash01(Math.floor(h.seed * 1e6), i, 3); // petite variation de ton par face
  const wall = (i: number): Rgb => shade(h.wall, k(i));
  const roof = (i: number): Rgb => shade(h.roofColor, k(i + 10));
  const flat = h.roof === 'flat';
  const topW = flat ? top + 0.4 : top; // le toit plat a un petit rebord

  // Les quatre murs.
  face(b, [P(-hw, bottom, -hd), P(hw, bottom, -hd), P(hw, topW, -hd), P(-hw, topW, -hd)], wall(0)); // v = −d/2
  face(b, [P(-hw, bottom, hd), P(hw, bottom, hd), P(hw, topW, hd), P(-hw, topW, hd)], wall(1)); // v = +d/2
  const gableTop = !flat && h.roof === 'gable';
  const pitchRise = h.pitch * hd; // hauteur du faîte au-dessus des murs
  if (gableTop) {
    face(b, [P(-hw, bottom, -hd), P(-hw, bottom, hd), P(-hw, top, hd), P(-hw, top + pitchRise, 0), P(-hw, top, -hd)], wall(2)); // pignon gauche (pentagone : mur + triangle)
    face(b, [P(hw, bottom, -hd), P(hw, bottom, hd), P(hw, top, hd), P(hw, top + pitchRise, 0), P(hw, top, -hd)], wall(3)); // pignon droit
  } else {
    face(b, [P(-hw, bottom, -hd), P(-hw, bottom, hd), P(-hw, topW, hd), P(-hw, topW, -hd)], wall(2));
    face(b, [P(hw, bottom, -hd), P(hw, bottom, hd), P(hw, topW, hd), P(hw, topW, -hd)], wall(3));
  }

  // Le toit.
  const ov = h.roof === 'flat' ? 0 : 0.3 + 0.3 * h.seed; // débord
  if (flat) {
    face(b, [P(-hw, topW - 0.05, -hd), P(hw, topW - 0.05, -hd), P(hw, topW - 0.05, hd), P(-hw, topW - 0.05, hd)], roof(0)); // dalle
  } else if (gableTop) {
    const ew = hw + ov; // débord aux pignons
    const ed = hd + ov * 0.6; // débord aux gouttières
    const rise = h.pitch * ed; // le faîte monte un peu plus avec le débord (même pente)
    face(b, [P(-ew, top - 0.1, -ed), P(ew, top - 0.1, -ed), P(ew, top + rise, 0), P(-ew, top + rise, 0)], roof(1));
    face(b, [P(-ew, top - 0.1, ed), P(ew, top - 0.1, ed), P(ew, top + rise, 0), P(-ew, top + rise, 0)], roof(2));
  } else {
    // Toit à quatre pentes.
    const ew = hw + ov;
    const ed = hd + ov;
    const rise = h.pitch * Math.min(ew, ed);
    const half = Math.max(0, ew - ed); // demi-longueur du faîte (0 = pyramide)
    face(b, [P(-ew, top - 0.1, -ed), P(ew, top - 0.1, -ed), P(half, top + rise, 0), P(-half, top + rise, 0)], roof(1));
    face(b, [P(-ew, top - 0.1, ed), P(ew, top - 0.1, ed), P(half, top + rise, 0), P(-half, top + rise, 0)], roof(2));
    face(b, [P(-ew, top - 0.1, -ed), P(-ew, top - 0.1, ed), P(-half, top + rise, 0)], roof(3)); // les deux bouts
    face(b, [P(ew, top - 0.1, -ed), P(ew, top - 0.1, ed), P(half, top + rise, 0)], roof(4));
  }

  // Cheminée de pignon.
  if (h.chimney) {
    const cu = (h.seed > 0.5 ? 1 : -1) * (hw - 0.55);
    const cb = top; // la base est cachée sous le toit
    const ctop = top + pitchRise + 0.9;
    const q = 0.3;
    const col = shade(h.wall, 0.8);
    face(b, [P(cu - q, cb, -q), P(cu + q, cb, -q), P(cu + q, ctop, -q), P(cu - q, ctop, -q)], col);
    face(b, [P(cu - q, cb, q), P(cu + q, cb, q), P(cu + q, ctop, q), P(cu - q, ctop, q)], col);
    face(b, [P(cu - q, cb, -q), P(cu - q, cb, q), P(cu - q, ctop, q), P(cu - q, ctop, -q)], col);
    face(b, [P(cu + q, cb, -q), P(cu + q, cb, q), P(cu + q, ctop, q), P(cu + q, ctop, -q)], col);
    face(b, [P(cu - q, ctop, -q), P(cu + q, ctop, -q), P(cu + q, ctop, q), P(cu - q, ctop, q)], shade([0.1, 0.1, 0.1], 1));
  }

  // Porte et fenêtres (de petits rectangles collés sur les murs).
  const front = h.doorSide * (hd + 0.03); // mur de la rue
  const doorU = (h.seed - 0.5) * (h.w - 3);
  const dw = 0.5;
  face(b, [P(doorU - dw, h.floorY, front), P(doorU + dw, h.floorY, front), P(doorU + dw, h.floorY + 2.0, front), P(doorU - dw, h.floorY + 2.0, front)], shade(door, 1));
  const winCol = shade(win, 1);
  for (let st = 0; st < h.stories; st++) {
    const y0 = h.floorY + st * (h.wallH / h.stories) + 0.95;
    const n = Math.max(1, Math.floor((h.w - 1) / 3)); // fenêtres par étage sur la façade
    for (let i = 0; i < n; i++) {
      const u = -hw + ((i + 0.5) * h.w) / n; // réparties sur la largeur
      if (st === 0 && Math.abs(u - doorU) < 1.3) continue; // pas sur la porte
      face(b, [P(u - 0.4, y0, front), P(u + 0.4, y0, front), P(u + 0.4, y0 + 1.05, front), P(u - 0.4, y0 + 1.05, front)], winCol);
      face(b, [P(u - 0.4, y0, -front), P(u + 0.4, y0, -front), P(u + 0.4, y0 + 1.05, -front), P(u - 0.4, y0 + 1.05, -front)], winCol); // et à l'arrière
    }
  }
}

// Un poteau et le dos du panneau.
function addSign(b: MeshBuilder, sg: Sign, ground: number, ax: number, az: number): void {
  const x = sg.x - ax;
  const z = sg.z - az;
  const px = x - sg.nx * 0.12; // le poteau est DERRIÈRE la planche (il ne cache pas le texte)
  const pz = z - sg.nz * 0.12;
  const r = 0.07;
  const post = shade(WOOD, 1);
  const top = ground + SIGN_Y + SIGN_H + 0.1;
  const corner = (dx: number, dz: number): [number, number] => [px + dx, pz + dz];
  const [a, bb, cc, dd] = [corner(-r, -r), corner(r, -r), corner(r, r), corner(-r, r)];
  const sides: [[number, number], [number, number]][] = [[a, bb], [bb, cc], [cc, dd], [dd, a]];
  for (const [p, q] of sides) face(b, [[p[0], ground - 0.3, p[1]], [q[0], ground - 0.3, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]], post);
  // Planche : une boîte plate, tournée vers (nx, nz).
  const tx = -sg.nz; // direction le long de la planche
  const tz = sg.nx;
  const hw = SIGN_W / 2;
  const y0 = ground + SIGN_Y;
  const y1 = y0 + SIGN_H;
  const o = 0.03; // demi-épaisseur
  const P = (u: number, y: number, n: number): P3 => [x + tx * u + sg.nx * n, y, z + tz * u + sg.nz * n];
  face(b, [P(-hw, y0, -o), P(hw, y0, -o), P(hw, y1, -o), P(-hw, y1, -o)], post); // dos
  face(b, [P(-hw, y1, -o), P(hw, y1, -o), P(hw, y1, o), P(-hw, y1, o)], post); // dessus
  face(b, [P(-hw, y0, -o), P(-hw, y0, o), P(-hw, y1, o), P(-hw, y1, -o)], post); // côté
  face(b, [P(hw, y0, -o), P(hw, y0, o), P(hw, y1, o), P(hw, y1, -o)], post);
}

// Fabrique le maillage d'un village. `groundAt` donne l'altitude du sol (pour les pieds des poteaux).
export function buildVillageMesh(v: Village, groundAt: (x: number, z: number) => number): MeshBuilder {
  const b: MeshBuilder = { positions: [], normals: [], colors: [], indices: [] };
  for (const h of v.houses) addHouse(b, h, v.x, v.z, v.style.door, v.style.window);
  for (const sg of v.signs) addSign(b, sg, groundAt(sg.x, sg.z), v.x, v.z);
  return b;
}
