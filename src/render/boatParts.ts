// Les pièces fixes du voilier, construites par le code : coque, pont, cockpit, rouf, accastillage, gréement.
// Repère local : +X = tribord, +Y = haut, −Z = avant (voir P). Toutes les formes viennent du plan `LAYOUT` (core/hull.ts).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LAYOUT, bottomHeight, cabinHalfWidth, deckHeight, halfBeam, rakeShift, roofHeight, stationOf } from '../core/hull';
import { lerp } from '../core/math';
import type { BoatSpec } from '../core/sailing';

// Passe des coordonnées « bateau » (avant, haut, tribord) aux coordonnées de la scène.
export const P = (u: number, y: number, v: number): THREE.Vector3 => new THREE.Vector3(v, y, -u);

const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Un cylindre fin entre deux points (câble, rambarde, étai…).
export function cylinderBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number, sides = 5): THREE.BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(radius, radius, dir.length(), sides, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

// Fusionne plusieurs formes en une seule (un seul objet à dessiner = moins de travail pour la carte graphique).
export const merge = (geoms: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(geoms.map((g) => (g.index ? g : g.toNonIndexed())))!;

// Une boîte positionnée (centre en coordonnées bateau).
export function box(w: number, h: number, l: number, u: number, y: number, v: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l); // largeur (X), hauteur (Y), longueur (Z)
  g.translate(v, y, -u);
  return g;
}

// ---------- Coque ----------

// Une bande de la coque entre deux hauteurs absolues (y0Fn, y1Fn : fonctions de la position s, du fond et du pont).
// offset : léger décalage vers l'extérieur (pour poser des liserés sans qu'ils « clignotent » avec la coque).
export function hullBand(spec: BoatSpec, y0Fn: (s: number, bot: number, top: number) => number, y1Fn: (s: number, bot: number, top: number) => number, offset: number, stations = 40, steps = 8): THREE.BufferGeometry {
  const verts: number[] = [];
  const idx: number[] = [];
  const perSide = steps + 1;
  for (const side of [-1, 1]) {
    const base = verts.length / 3;
    for (let i = 0; i <= stations; i++) {
      const s = i / stations;
      const bot = bottomHeight(s);
      const top = deckHeight(s);
      const b = halfBeam(spec, s);
      const y0 = Math.max(bot, y0Fn(s, bot, top));
      const y1 = Math.min(top, y1Fn(s, bot, top));
      for (let k = 0; k <= steps; k++) {
        const y = lerp(y0, y1, k / steps);
        const fy = (y - bot) / (top - bot); // hauteur relative sur la section
        const theta = Math.acos(Math.min(1, Math.max(-1, 1 - fy))); // section arrondie : voir core/hull.ts
        const v = side * (b * Math.sin(theta) + offset);
        const u = -spec.length / 2 + s * spec.length + rakeShift(s, fy); // l'étrave est inclinée
        const p = P(u, y, v);
        verts.push(p.x, p.y, p.z);
      }
    }
    for (let i = 0; i < stations; i++) {
      for (let k = 0; k < steps; k++) {
        const a = base + i * perSide + k;
        const c = a + perSide;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Le tableau arrière : un éventail entre les points du contour de la section arrière, entre deux hauteurs.
export function transom(spec: BoatSpec, yLo: (bot: number, top: number) => number, yHi: (bot: number, top: number) => number, inset = 0): THREE.BufferGeometry {
  const s = 0;
  const bot = bottomHeight(s);
  const top = deckHeight(s);
  const b = halfBeam(spec, s);
  const u = -spec.length / 2 + inset;
  const pts: THREE.Vector3[] = [];
  const steps = 10;
  const ring = (side: number, y0: number, y1: number): void => {
    for (let k = 0; k <= steps; k++) {
      const y = lerp(y0, y1, k / steps);
      const fy = (y - bot) / (top - bot);
      const theta = Math.acos(Math.min(1, Math.max(-1, 1 - fy)));
      pts.push(P(u, y, side * b * Math.sin(theta)));
    }
  };
  const lo = Math.max(bot, yLo(bot, top));
  const hi = Math.min(top, yHi(bot, top));
  ring(-1, hi, lo); // du haut vers le bas côté bâbord…
  ring(1, lo, hi); // …puis du bas vers le haut côté tribord : contour fermé
  const center = P(u, (lo + hi) / 2, 0);
  const verts: number[] = [center.x, center.y, center.z];
  for (const p of pts) verts.push(p.x, p.y, p.z);
  const idx: number[] = [];
  for (let i = 1; i < pts.length; i++) idx.push(0, i, i + 1);
  idx.push(0, pts.length, 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------- Pont ----------

// Une bande de pont horizontale entre deux courbes de largeur (v signé) sur [u0, u1].
function deckStrip(_spec: BoatSpec, u0: number, u1: number, vA: (u: number) => number, vB: (u: number) => number, steps: number, yFn: (u: number) => number): THREE.BufferGeometry {
  const verts: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = lerp(u0, u1, i / steps);
    const y = yFn(u);
    const a = P(u, y, vA(u));
    const c = P(u, y, vB(u));
    verts.push(a.x, a.y, a.z, c.x, c.y, c.z);
    uvs.push(a.x * 0.5, a.z * 0.5, c.x * 0.5, c.z * 0.5);
  }
  for (let i = 0; i < steps; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // sens des triangles : normale vers le haut (vA < vB)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Tout le pont : avant, passavants le long du rouf et du cockpit, plage arrière. Le cockpit lui-même est laissé creux.
export function buildDeck(spec: BoatSpec): THREE.BufferGeometry {
  const half = (u: number): number => halfBeam(spec, stationOf(spec, u)) * 0.985; // un peu en retrait du bord
  const y = (u: number): number => deckHeight(stationOf(spec, u)) + 0.004;
  const bow = spec.length / 2;
  const c = LAYOUT.cabin;
  const k = LAYOUT.cockpit;
  const parts: THREE.BufferGeometry[] = [
    deckStrip(spec, c.u1, bow, (u) => -half(u), (u) => half(u), 14, y), // pont avant, d'un bord à l'autre
    deckStrip(spec, c.u0, c.u1, (u) => -half(u), (u) => -cabinHalfWidth(u), 8, y), // passavant bâbord le long du rouf
    deckStrip(spec, c.u0, c.u1, (u) => cabinHalfWidth(u), (u) => half(u), 8, y), // passavant tribord
    deckStrip(spec, k.u0, k.u1, (u) => -half(u), () => -k.half - 0.06, 6, y), // le long du cockpit, bâbord
    deckStrip(spec, k.u0, k.u1, () => k.half + 0.06, (u) => half(u), 6, y), // tribord
    deckStrip(spec, -bow, k.u0, (u) => -half(u), (u) => half(u), 5, y), // plage arrière
  ];
  return merge(parts);
}

// Plancher du cockpit (plan avec coordonnées de texture pour le teck).
export function buildCockpitFloor(): THREE.BufferGeometry {
  const k = LAYOUT.cockpit;
  const len = k.u1 - k.u0;
  const g = new THREE.PlaneGeometry(k.half * 2, len);
  g.rotateX(-Math.PI / 2); // à plat ; l'axe long suit Z
  g.translate(0, k.floor, -(k.u0 + k.u1) / 2);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 7); // texture répétée : lames d'environ 15 cm
  return g;
}

// Parois du cockpit (blanches) et liston de teck sur le dessus.
export function buildCockpitWalls(spec: BoatSpec): { walls: THREE.BufferGeometry; teak: THREE.BufferGeometry } {
  const k = LAYOUT.cockpit;
  const len = k.u1 - k.u0;
  const uMid = (k.u0 + k.u1) / 2;
  const deckY = deckHeight(stationOf(spec, uMid));
  const h = deckY - k.floor;
  const walls: THREE.BufferGeometry[] = [
    box(0.05, h, len, uMid, (deckY + k.floor) / 2, -k.half - 0.025), // flanc bâbord
    box(0.05, h, len, uMid, (deckY + k.floor) / 2, k.half + 0.025), // flanc tribord
    box(k.half * 2 + 0.1, h, 0.05, k.u0 + 0.025, (deckY + k.floor) / 2, 0), // paroi arrière
    box(k.half * 2 + 0.1, h, 0.05, k.u1 - 0.025, (deckY + k.floor) / 2, 0), // paroi avant (le fond du cockpit, devant le rouf)
  ];
  const teak: THREE.BufferGeometry[] = [
    box(0.1, 0.03, len + 0.1, uMid, deckY + 0.02, -k.half - 0.055), // liston bâbord
    box(0.1, 0.03, len + 0.1, uMid, deckY + 0.02, k.half + 0.055), // liston tribord
    box(k.half * 2 + 0.2, 0.03, 0.1, k.u0 + 0.025, deckY + 0.02, 0), // liston arrière
  ];
  // Marches/banquettes : deux bancs de teck le long des flancs.
  for (const side of [-1, 1]) teak.push(box(0.36, 0.05, len - 0.6, uMid - 0.05, k.floor + 0.42, side * (k.half - 0.18)));
  return { walls: merge(walls), teak: merge(teak) };
}

// Le rouf : un volume qui se rétrécit et s'abaisse vers l'avant.
export function buildCabin(spec: BoatSpec): THREE.BufferGeometry {
  const c = LAYOUT.cabin;
  const len = c.u1 - c.u0;
  const g = new THREE.BoxGeometry(c.halfBack * 2, c.height + 0.06, len, 1, 1, 8);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, 0.5 - pos.getZ(i) / len)); // 0 à l'arrière, 1 à l'avant
    const u = c.u0 + t * len;
    const x = pos.getX(i);
    pos.setX(i, (x / c.halfBack) * cabinHalfWidth(u)); // largeur suivant le plan
    if (pos.getY(i) > 0) pos.setY(i, pos.getY(i) - 0.14 * t); // le toit descend vers l'avant
  }
  g.translate(0, deckHeight(stationOf(spec, (c.u0 + c.u1) / 2)) + (c.height + 0.06) / 2 - 0.05, -(c.u0 + c.u1) / 2);
  g.computeVertexNormals();
  return g;
}

// Un hublot allongé aux coins arrondis, posé sur le flanc du rouf (côté +1 tribord, −1 bâbord) à la position u.
export function cabinWindow(spec: BoatSpec, side: 1 | -1, u: number, w = 0.46, h = 0.16): THREE.Mesh {
  const shape = new THREE.Shape();
  const r = h / 2.2;
  const x0 = -w / 2;
  const y0 = -h / 2;
  shape.moveTo(x0 + r, y0);
  shape.lineTo(-x0 - r, y0);
  shape.quadraticCurveTo(-x0, y0, -x0, y0 + r);
  shape.lineTo(-x0, -y0 - r);
  shape.quadraticCurveTo(-x0, -y0, -x0 - r, -y0);
  shape.lineTo(x0 + r, -y0);
  shape.quadraticCurveTo(x0, -y0, x0, -y0 - r);
  shape.lineTo(x0, y0 + r);
  shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape));
  const y = deckHeight(stationOf(spec, u)) + 0.3;
  const half = cabinHalfWidth(u);
  const slope = (cabinHalfWidth(u + 0.1) - cabinHalfWidth(u - 0.1)) / 0.2; // le flanc se rapproche de l'axe vers l'avant
  const normal = new THREE.Vector3(side, 0, 0).add(new THREE.Vector3(0, 0, -slope * side * -1)).normalize(); // normale sortante
  const p = P(u, y, side * (half + 0.012));
  mesh.position.copy(p);
  mesh.rotation.y = Math.atan2(normal.x, normal.z);
  return mesh;
}

// ---------- Accastillage ----------

// Rambardes : chandeliers et filières tout autour du pont, balcon avant et balcon arrière.
export function buildLifelines(spec: BoatSpec): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bow = spec.length / 2;
  const edge = (u: number): number => halfBeam(spec, stationOf(spec, u)) * 0.93;
  const deckY = (u: number): number => deckHeight(stationOf(spec, u));
  const us: number[] = [];
  for (let u = -bow + 0.55; u < bow - 0.9; u += 0.95) us.push(u); // positions des chandeliers
  for (const side of [-1, 1]) {
    for (const u of us) parts.push(cylinderBetween(P(u, deckY(u), side * edge(u)), P(u, deckY(u) + 0.62, side * edge(u)), 0.012));
    for (const level of [0.3, 0.62]) {
      for (let i = 0; i < us.length - 1; i++) {
        const a = us[i]!;
        const b = us[i + 1]!;
        parts.push(cylinderBetween(P(a, deckY(a) + level, side * edge(a)), P(b, deckY(b) + level, side * edge(b)), 0.006, 4));
      }
    }
  }
  // Balcon avant : les deux filières se rejoignent en pointe devant l'étrave.
  const lastU = us[us.length - 1]!;
  const apexU = bow - 0.55;
  for (const level of [0.3, 0.62]) {
    for (const side of [-1, 1]) {
      parts.push(cylinderBetween(P(lastU, deckY(lastU) + level, side * edge(lastU)), P(apexU, deckY(apexU) + level + 0.04, side * 0.12), 0.01, 4));
    }
  }
  // Balcon arrière : une barre qui ferme la plage arrière.
  const sternU = -bow + 0.3;
  for (const side of [-1, 1]) parts.push(cylinderBetween(P(sternU, deckY(sternU), side * edge(sternU)), P(sternU, deckY(sternU) + 0.7, side * edge(sternU)), 0.014));
  parts.push(cylinderBetween(P(sternU, deckY(sternU) + 0.7, -edge(sternU)), P(sternU, deckY(sternU) + 0.7, edge(sternU)), 0.012));
  return merge(parts);
}

// Liston de bordé (rail de teck) : une bande de teck tout autour du pont, au ras du plat-bord.
export function buildToeRail(spec: BoatSpec): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 36;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const u0 = -spec.length / 2 + (i / n) * spec.length * 0.985;
      const u1 = -spec.length / 2 + ((i + 1) / n) * spec.length * 0.985;
      const e = (u: number): number => halfBeam(spec, stationOf(spec, u)) * 0.995;
      parts.push(cylinderBetween(P(u0, deckHeight(stationOf(spec, u0)) + 0.02, side * e(u0)), P(u1, deckHeight(stationOf(spec, u1)) + 0.02, side * e(u1)), 0.028, 5));
    }
  }
  return merge(parts);
}

// Gréement fixe : haubans, étai, pataras, barres de flèche.
export function buildRigging(spec: BoatSpec): THREE.BufferGeometry {
  const mastU = LAYOUT.mastU;
  const roof = roofHeight(spec, mastU);
  const top = roof + LAYOUT.mastHeight - 0.3;
  const bow = spec.length / 2;
  const parts: THREE.BufferGeometry[] = [];
  const deckAtMast = deckHeight(stationOf(spec, mastU));
  const chainU = mastU - 0.1;
  const chainV = halfBeam(spec, stationOf(spec, chainU)) * 0.93;
  for (const side of [-1, 1]) {
    for (const [h, len] of [[roof + 4.3, 0.75], [roof + 7.6, 0.55]] as const) { // deux étages de barres de flèche
      const tip = P(mastU - 0.12, h, side * len);
      parts.push(cylinderBetween(P(mastU, h, 0), tip, 0.02, 5));
    }
    const s1 = P(mastU - 0.12, roof + 4.3, side * 0.75);
    const s2 = P(mastU - 0.12, roof + 7.6, side * 0.55);
    parts.push(cylinderBetween(P(mastU, top, 0), s2, 0.006, 4)); // haubans : tête de mât → 2e barre de flèche → 1re → pont
    parts.push(cylinderBetween(s2, s1, 0.006, 4));
    parts.push(cylinderBetween(s1, P(chainU, deckAtMast + 0.02, side * chainV), 0.006, 4));
    parts.push(cylinderBetween(P(mastU, roof + 4.3, 0), P(chainU + 0.5, deckAtMast + 0.02, side * (chainV - 0.05)), 0.005, 4)); // bas-hauban
  }
  parts.push(cylinderBetween(P(mastU, top, 0), P(bow - 0.45, deckHeight(0.97) + 0.12, 0), 0.007, 4)); // étai
  parts.push(cylinderBetween(P(mastU, top, 0), P(-spec.length / 2 + 0.3, deckHeight(0.02) + 0.72, 0), 0.006, 4)); // pataras
  return merge(parts);
}

// Le mât : un cylindre effilé, avec sa platine en tête.
export function buildMast(spec: BoatSpec): THREE.BufferGeometry {
  const roof = roofHeight(spec, LAYOUT.mastU);
  const g = new THREE.CylinderGeometry(0.035, 0.07, LAYOUT.mastHeight, 10);
  g.translate(0, roof + LAYOUT.mastHeight / 2, 0);
  g.translate(0, 0, -LAYOUT.mastU);
  return g;
}

// Quille (aileron avec lest en bulbe) et safran, sous la flottaison.
export function buildKeel(spec: BoatSpec): { keel: THREE.BufferGeometry; rudder: THREE.BufferGeometry } {
  const finTop = -0.35;
  const finBottom = -(spec.draft - 0.15);
  const fin = new THREE.BoxGeometry(0.09, finTop - finBottom, 1.35);
  const pos = fin.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const low = pos.getY(i) < 0 ? 1 : 0; // le bas de l'aileron est plus court (profil effilé) et reculé
    pos.setZ(i, pos.getZ(i) * (1 - 0.45 * low) + low * 0.12);
  }
  fin.translate(0, (finTop + finBottom) / 2, 0);
  const bulb = new THREE.CapsuleGeometry(0.17, 1.1, 4, 10);
  bulb.rotateX(Math.PI / 2);
  bulb.translate(0, -(spec.draft - 0.08), 0.0);
  const keel = merge([fin, bulb]);
  keel.translate(0, 0, -spec.keelX);
  const rudder = new THREE.BoxGeometry(0.05, 1.05, 0.5);
  const rp = rudder.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) if (rp.getY(i) < 0) rp.setZ(i, rp.getZ(i) * 0.6 + 0.07); // pale effilée
  rudder.translate(0, -0.6, -(spec.rudderX - 0.05));
  return { keel, rudder };
}
