// Le maillage 3D d'un village (maisons, poteaux de panneaux) : des tableaux de sommets prêts pour la carte graphique. Logique pure.
// Les positions sont RELATIVES au centre du village (x, z) ; la hauteur y est absolue. Couleurs de sommets en linéaire (comme les arbres).

import { Rgb, clamp } from './math';
import { hash01, MeshBuilder } from './trees';
import type { Board, House, Sign, Village } from './village';
import type { VillageStyle } from './villageStyle';

type P3 = [number, number, number];

const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)); // sRGB → linéaire
const shade = (c: Rgb, k: number): Rgb => [lin(clamp(c[0] * k, 0, 1)), lin(clamp(c[1] * k, 0, 1)), lin(clamp(c[2] * k, 0, 1))];
const WOOD: Rgb = [0.36, 0.26, 0.17]; // bois des poteaux
export const SIGN_W = 2.8; // largeur du panneau (m)
export const SIGN_H = 0.7; // hauteur du panneau (m)
export const SIGN_Y = 1.75; // hauteur du bas de la planche du bas au-dessus du sol (m)
export const BOARD_OFFSET = 0.14; // distance entre le poteau et la planche (la planche est devant le poteau, qui ne cache jamais le texte)
export const LEVEL_STEP = SIGN_H + 0.12; // écart de hauteur entre la planche du bas et celle du haut

// Hauteur du bas d'une planche selon son niveau.
export const boardBaseY = (ground: number, level: number): number => ground + SIGN_Y + level * LEVEL_STEP;

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
function addHouse(b: MeshBuilder, h: House, ax: number, az: number, st: VillageStyle): void {
  const c = Math.cos(h.yaw);
  const s = Math.sin(h.yaw);
  // Repère local (u le long de la rue, v vers l'arrière, y) → repère du village.
  const P = (u: number, y: number, v: number): P3 => [h.x + u * c - v * s - ax, y, h.z + u * s + v * c - az];
  const hw = h.w / 2;
  const hd = h.d / 2;
  const top = h.floorY + h.wallH;
  const bottom = h.baseY;
  const storyH = h.wallH / h.stories;
  const jet = h.jetty > 0 && h.stories >= 2 ? h.jetty : 0; // étage en surplomb ?
  const hdU = hd + jet; // demi-profondeur des étages
  const midY = h.floorY + storyH; // sous le premier étage
  const k = (i: number): number => 0.93 + 0.14 * hash01(Math.floor(h.seed * 1e6), i, 3); // petite variation de ton par face
  const wall = (i: number): Rgb => shade(h.wall, k(i));
  const lowWall = (i: number): Rgb => shade(h.stone ?? h.wall, k(i + 20)); // rez-de-chaussée (pierre s'il y en a)
  const roof = (i: number): Rgb => shade(h.roofColor, k(i + 10));
  const beamCol = shade(st.timberColor, 1);
  const flat = h.roof === 'flat';
  const topW = flat ? top + 0.4 : top; // le toit plat a un petit rebord
  const gableTop = !flat && h.roof === 'gable';
  const pitchRise = h.pitch * (jet > 0 ? hdU : hd); // hauteur du faîte au-dessus des murs

  // Les murs avant et arrière (v = ±profondeur) : un seul bloc, ou rez-de-chaussée + étages en surplomb.
  const wallsFB = (sgn: number): void => {
    if (jet > 0) {
      face(b, [P(-hw, bottom, sgn * hd), P(hw, bottom, sgn * hd), P(hw, midY, sgn * hd), P(-hw, midY, sgn * hd)], lowWall(sgn > 0 ? 1 : 0)); // rez-de-chaussée
      face(b, [P(-hw, midY, sgn * hd), P(hw, midY, sgn * hd), P(hw, midY, sgn * hdU), P(-hw, midY, sgn * hdU)], beamCol); // dessous du surplomb (bois)
      face(b, [P(-hw, midY, sgn * hdU), P(hw, midY, sgn * hdU), P(hw, topW, sgn * hdU), P(-hw, topW, sgn * hdU)], wall(sgn > 0 ? 5 : 4)); // étages
    } else {
      face(b, [P(-hw, bottom, sgn * hd), P(hw, bottom, sgn * hd), P(hw, topW, sgn * hd), P(-hw, topW, sgn * hd)], wall(sgn > 0 ? 1 : 0));
    }
  };
  wallsFB(-1);
  wallsFB(1);
  // Les pignons (murs des petits côtés) : rectangle de bas en haut, surmonté d'un triangle sous un toit à deux pentes.
  for (const su of [-1, 1]) {
    const u = su * hw;
    if (jet > 0) {
      face(b, [P(u, bottom, -hd), P(u, bottom, hd), P(u, midY, hd), P(u, midY, -hd)], lowWall(2 + (su > 0 ? 1 : 0)));
      const upper: P3[] = [P(u, midY, -hdU), P(u, midY, hdU), P(u, top, hdU)];
      if (gableTop) upper.push(P(u, top + pitchRise, 0));
      upper.push(P(u, top, -hdU));
      face(b, upper, wall(2 + (su > 0 ? 1 : 0)));
    } else {
      const g: P3[] = [P(u, bottom, -hd), P(u, bottom, hd), P(u, topW, hd)];
      if (gableTop) g.push(P(u, top + pitchRise, 0));
      g.push(P(u, topW, -hd));
      face(b, g, wall(2 + (su > 0 ? 1 : 0)));
    }
  }

  // Le toit.
  const hdR = jet > 0 ? hdU : hd; // demi-profondeur sous le toit
  const ov = flat ? 0 : 0.3 + 0.3 * h.seed; // débord
  if (flat) {
    face(b, [P(-hw, topW - 0.05, -hdR), P(hw, topW - 0.05, -hdR), P(hw, topW - 0.05, hdR), P(-hw, topW - 0.05, hdR)], roof(0)); // dalle
  } else if (gableTop) {
    const ew = hw + ov; // débord aux pignons
    const ed = hdR + ov * 0.6; // débord aux gouttières
    const rise = h.pitch * ed; // même pente avec le débord
    face(b, [P(-ew, top - 0.1, -ed), P(ew, top - 0.1, -ed), P(ew, top + rise, 0), P(-ew, top + rise, 0)], roof(1));
    face(b, [P(-ew, top - 0.1, ed), P(ew, top - 0.1, ed), P(ew, top + rise, 0), P(-ew, top + rise, 0)], roof(2));
  } else {
    // Toit à quatre pentes.
    const ew = hw + ov;
    const ed = hdR + ov;
    const rise = h.pitch * Math.min(ew, ed);
    const half = Math.max(0, ew - ed); // demi-longueur du faîte (0 = pyramide)
    face(b, [P(-ew, top - 0.1, -ed), P(ew, top - 0.1, -ed), P(half, top + rise, 0), P(-half, top + rise, 0)], roof(1));
    face(b, [P(-ew, top - 0.1, ed), P(ew, top - 0.1, ed), P(half, top + rise, 0), P(-half, top + rise, 0)], roof(2));
    face(b, [P(-ew, top - 0.1, -ed), P(-ew, top - 0.1, ed), P(-half, top + rise, 0)], roof(3)); // les deux bouts
    face(b, [P(ew, top - 0.1, -ed), P(ew, top - 0.1, ed), P(half, top + rise, 0)], roof(4));
  }

  // Cheminée.
  if (h.chimney) {
    const cu = (h.seed > 0.5 ? 1 : -1) * (hw - 0.55);
    const cb = top; // la base est cachée sous le toit
    const ctop = top + pitchRise + 0.9;
    const q = 0.3;
    const col = shade(h.stone ?? h.wall, 0.8);
    face(b, [P(cu - q, cb, -q), P(cu + q, cb, -q), P(cu + q, ctop, -q), P(cu - q, ctop, -q)], col);
    face(b, [P(cu - q, cb, q), P(cu + q, cb, q), P(cu + q, ctop, q), P(cu - q, ctop, q)], col);
    face(b, [P(cu - q, cb, -q), P(cu - q, cb, q), P(cu - q, ctop, q), P(cu - q, ctop, -q)], col);
    face(b, [P(cu + q, cb, -q), P(cu + q, cb, q), P(cu + q, ctop, q), P(cu + q, ctop, -q)], col);
    face(b, [P(cu - q, ctop, -q), P(cu + q, ctop, -q), P(cu + q, ctop, q), P(cu - q, ctop, q)], shade([0.1, 0.1, 0.1], 1));
  }

  // Colombage : des poutres sombres sur les murs avant et arrière (poteaux, sablières, croix de saint André).
  if (h.timber) {
    const bw = 0.13; // largeur des poutres
    // Une poutre : bande de largeur bw le long du segment (u0, y0) → (u1, y1) dans le plan du mur v = planeV, un peu en avant du mur.
    const beam = (planeV: number, out: number, u0: number, y0: number, u1: number, y1: number): void => {
      const du = u1 - u0;
      const dy = y1 - y0;
      const len = Math.hypot(du, dy) || 1;
      const pu = (-dy / len) * (bw / 2);
      const py = (du / len) * (bw / 2);
      const v = planeV + out * 0.02;
      face(b, [P(u0 + pu, y0 + py, v), P(u1 + pu, y1 + py, v), P(u1 - pu, y1 - py, v), P(u0 - pu, y0 - py, v)], beamCol);
    };
    for (const out of [-1, 1]) {
      // Hauteurs à garnir : tout le mur, ou seulement les étages quand il y a un surplomb.
      const ya = jet > 0 ? midY : h.floorY;
      const planeV = out * (jet > 0 ? hdU : hd);
      const yb = topW;
      beam(planeV, out, -hw, ya + bw / 2, hw, ya + bw / 2); // sablière basse
      beam(planeV, out, -hw, yb - bw / 2, hw, yb - bw / 2); // sablière haute
      if (h.stories >= 3 || (h.stories === 2 && jet === 0)) beam(planeV, out, -hw, h.floorY + storyH, hw, h.floorY + storyH); // plancher intermédiaire
      const cnt = Math.max(2, Math.round(h.w / 1.9) + 1); // nombre de poteaux
      const us: number[] = [];
      for (let i = 0; i < cnt; i++) us.push(-hw + bw / 2 + (i * (h.w - bw)) / (cnt - 1));
      for (const u of us) beam(planeV, out, u, ya, u, yb);
      for (let i = 0; i + 1 < cnt; i++) {
        const left = us[i]!;
        const right = us[i + 1]!;
        if (i % 2 === 0) beam(planeV, out, left, ya + bw / 2, right, yb - bw / 2);
        else beam(planeV, out, left, yb - bw / 2, right, ya + bw / 2);
      }
    }
  }

  // Porte (rez-de-chaussée, côté rue) et petites fenêtres.
  const front = h.doorSide * (hd + 0.03); // mur de la rue
  const doorU = (h.seed - 0.5) * (h.w - 3);
  const dw = 0.5;
  face(b, [P(doorU - dw, h.floorY, front), P(doorU + dw, h.floorY, front), P(doorU + dw, h.floorY + 2.0, front), P(doorU - dw, h.floorY + 2.0, front)], shade(st.door, 1));
  const winCol = shade(st.window, 1);
  for (let sto = 0; sto < h.stories; sto++) {
    const plane = sto >= 1 && jet > 0 ? hdU : hd;
    const y0 = h.floorY + sto * storyH + 0.95;
    const n = Math.max(1, Math.floor((h.w - 1) / 2.8)); // fenêtres par étage sur la façade
    for (let i = 0; i < n; i++) {
      const u = -hw + ((i + 0.5) * h.w) / n; // réparties sur la largeur
      if (sto === 0 && Math.abs(u - doorU) < 1.2) continue; // pas sur la porte
      for (const out of [-1, 1]) {
        const v = out * (plane + 0.03);
        face(b, [P(u - 0.32, y0, v), P(u + 0.32, y0, v), P(u + 0.32, y0 + 0.9, v), P(u - 0.32, y0 + 0.9, v)], winCol); // fenêtre devant et derrière
      }
    }
  }
}

// Un panneau : un poteau au centre, des planches tournées vers chaque direction (le dos de la planche ; le texte est ajouté par l'affichage).
function addSign(b: MeshBuilder, sg: Sign, ground: number, ax: number, az: number): void {
  const x = sg.x - ax;
  const z = sg.z - az;
  const r = 0.09;
  const post = shade(WOOD, 1);
  const levels = Math.max(0, ...sg.boards.map((bd) => bd.level)) + 1;
  const top = boardBaseY(ground, levels - 1) + SIGN_H + 0.15;
  const corners: [number, number][] = [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r]];
  for (let i = 0; i < 4; i++) {
    const p = corners[i]!;
    const q = corners[(i + 1) % 4]!;
    face(b, [[p[0], ground - 0.3, p[1]], [q[0], ground - 0.3, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]], post);
  }
  for (const bd of sg.boards) addBoard(b, sg, bd, ground, ax, az);
}

// Une planche : une boîte plate (le texte vient par-dessus).
function addBoard(b: MeshBuilder, sg: Sign, bd: Board, ground: number, ax: number, az: number): void {
  const cx = sg.x - ax + bd.nx * BOARD_OFFSET;
  const cz = sg.z - az + bd.nz * BOARD_OFFSET;
  const tx = -bd.nz; // direction le long de la planche
  const tz = bd.nx;
  const hw = SIGN_W / 2;
  const y0 = boardBaseY(ground, bd.level);
  const y1 = y0 + SIGN_H;
  const o = 0.03; // demi-épaisseur
  const P = (u: number, y: number, n: number): P3 => [cx + tx * u + bd.nx * n, y, cz + tz * u + bd.nz * n];
  const wood = shade(WOOD, 1);
  face(b, [P(-hw, y0, -o), P(hw, y0, -o), P(hw, y1, -o), P(-hw, y1, -o)], wood); // dos
  face(b, [P(-hw, y1, -o), P(hw, y1, -o), P(hw, y1, o), P(-hw, y1, o)], wood); // dessus
  face(b, [P(-hw, y0, -o), P(hw, y0, -o), P(hw, y0, o), P(-hw, y0, o)], wood); // dessous
  face(b, [P(-hw, y0, -o), P(-hw, y0, o), P(-hw, y1, o), P(-hw, y1, -o)], wood); // côtés
  face(b, [P(hw, y0, -o), P(hw, y0, o), P(hw, y1, o), P(hw, y1, -o)], wood);
}

// Fabrique le maillage d'un village. `groundAt` donne l'altitude du sol (pour les pieds des poteaux).
export function buildVillageMesh(v: Village, groundAt: (x: number, z: number) => number): MeshBuilder {
  const b: MeshBuilder = { positions: [], normals: [], colors: [], indices: [] };
  for (const h of v.houses) addHouse(b, h, v.x, v.z, v.style);
  for (const sg of v.signs) addSign(b, sg, groundAt(sg.x, sg.z), v.x, v.z);
  return b;
}
