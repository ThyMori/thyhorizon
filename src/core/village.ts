// Le plan d'un village : où sont ses rues, ses maisons, ses panneaux. Logique pure, déterministe :
// le même lieu donne toujours le même village (il ne dépend que de la position réelle de la ville, de sa population et du terrain).
// Repère : monde du jeu (x = est, z = sud). Une maison a un repère local : u (le long de la rue, « largeur » w) et v (vers l'arrière, « profondeur » d).

import { Rgb, clamp } from './math';
import { Terrain, slopeAt } from './terrain';
import { hash01 } from './trees';
import { RoofKind, VillageStyle, styleForClass } from './villageStyle';

export const MAX_SNAP = 8000; // distance maximale (m) dont on déplace une ville en mer vers la côte ; au-delà, on l'ignore
export const CLEAR_MARGIN = 22; // les arbres s'écartent de cette distance autour du village (m)
export const STREET_HALF = 3.5; // demi-largeur d'une rue (m)

// Combien de maisons et quel rayon pour une ville de `pop` habitants (plafonné : une métropole reste jouable).
export function villageSize(pop: number): { houses: number; radius: number } {
  const houses = clamp(Math.round(10 + 14 * Math.log2(Math.max(5000, pop) / 5000)), 10, 160);
  return { houses, radius: 40 + 18 * Math.sqrt(houses) };
}

export interface House {
  x: number; // centre (monde)
  z: number;
  w: number; // largeur le long de la rue (m)
  d: number; // profondeur (m)
  yaw: number; // angle de l'axe u dans le plan (x, z) : u = (cos yaw, sin yaw), v = (−sin yaw, cos yaw)
  doorSide: 1 | -1; // la porte est du côté v = doorSide × d/2 (face à la rue)
  stories: number; // étages
  wallH: number; // hauteur des murs (m)
  floorY: number; // altitude du sol de la maison
  baseY: number; // bas des fondations (plus bas que le sol, pour ne jamais flotter sur une pente)
  wall: Rgb;
  roofColor: Rgb;
  roof: RoofKind;
  pitch: number;
  chimney: boolean;
  seed: number; // nombre stable pour les petits détails
}

export interface Sign {
  x: number; // pied du poteau
  z: number;
  nx: number; // direction vers laquelle le panneau est tourné (vecteur unitaire)
  nz: number;
  name: string;
}

export interface Village {
  id: number; // numéro de la ville dans le fichier des villes
  name: string;
  pop: number;
  x: number; // centre du village (déjà recalé sur la terre ferme)
  z: number;
  radius: number; // rayon des maisons (m)
  style: VillageStyle;
  houses: House[];
  signs: Sign[];
}

export interface CityInfo {
  id: number;
  name: string;
  pop: number;
  lat: number;
  lon: number;
  x: number;
  z: number;
}

// Un endroit convenable pour bâtir : sur la terre ferme, hors plage, assez plat (y compris autour).
function suitable(t: Terrain, x: number, z: number, maxSlope: number): boolean {
  const h = t.heightAt(x, z);
  if (h < 5 || h > 2500) return false; // trop bas (plage, mer) ou trop haut
  for (const [dx, dz] of [[25, 0], [-25, 0], [0, 25], [0, -25]] as const) if (t.heightAt(x + dx, z + dz) < 3.5) return false; // pas au bord de l'eau
  return slopeAt(t, x, z, 8) < maxSlope;
}

// Place le centre du village : sur la position réelle si elle est convenable, sinon sur le point convenable le plus proche (en spirale). null si rien à moins de MAX_SNAP.
export function findAnchor(t: Terrain, x0: number, z0: number): { x: number; z: number } | null {
  for (const maxSlope of [0.3, 0.5]) {
    if (suitable(t, x0, z0, maxSlope)) return { x: x0, z: z0 }; // la position réelle convient
    for (let r = 60; r <= MAX_SNAP; r += r < 600 ? 60 : 200) {
      const n = clamp(Math.round((2 * Math.PI * r) / 120), 8, 72); // points sur ce cercle
      const phase = hash01(Math.round(x0), Math.round(z0), 91) * Math.PI * 2; // départ du tour (stable)
      for (let k = 0; k < n; k++) {
        const a = phase + (k / n) * Math.PI * 2;
        const x = x0 + r * Math.cos(a);
        const z = z0 + r * Math.sin(a);
        if (suitable(t, x, z, maxSlope)) return { x, z };
      }
    }
  }
  return null;
}

interface Street {
  cx: number; // centre
  cz: number;
  ux: number; // direction (unitaire)
  uz: number;
  half: number; // demi-longueur
}

// Distance d'un point à un segment de rue (le segment va de c − u×half à c + u×half).
function distToStreet(s: Street, x: number, z: number): number {
  const t = clamp((x - s.cx) * s.ux + (z - s.cz) * s.uz, -s.half, s.half); // position la plus proche sur la rue
  return Math.hypot(x - (s.cx + s.ux * t), z - (s.cz + s.uz * t));
}

// Dessine le village de la ville `c`, centré sur `anchor`.
export function layoutVillage(c: CityInfo, anchor: { x: number; z: number }, t: Terrain): Village {
  const { houses: target, radius } = villageSize(c.pop);
  const style = styleForClass(t.climateClassAt(anchor.x, anchor.z)); // style du climat d'ici
  const sa = Math.round(c.lat * 1e4); // graines stables : la position réelle de la ville
  const sb = Math.round(c.lon * 1e4);
  const rnd = (k: number): number => hash01(sa, sb, k);
  // Direction de la rue principale : le long des courbes de niveau s'il y a une pente (les rues suivent le relief), sinon au hasard.
  const gx = (t.heightAt(anchor.x + 20, anchor.z) - t.heightAt(anchor.x - 20, anchor.z)) / 40;
  const gz = (t.heightAt(anchor.x, anchor.z + 20) - t.heightAt(anchor.x, anchor.z - 20)) / 40;
  const axis = Math.hypot(gx, gz) > 0.03 ? Math.atan2(gz, gx) + Math.PI / 2 : rnd(1) * Math.PI;
  const ux = Math.cos(axis);
  const uz = Math.sin(axis);
  const nx = -uz; // la normale (perpendiculaire à la rue principale)
  const nz = ux;

  // Les rues : la principale, des rues parallèles pour les grandes villes, et des rues transversales.
  const streets: Street[] = [{ cx: anchor.x, cz: anchor.z, ux, uz, half: radius }];
  const parallels = target < 30 ? 0 : target < 70 ? 1 : 2; // rues parallèles de chaque côté
  for (let k = 1; k <= parallels; k++) {
    for (const side of [-1, 1]) {
      const off = side * k * (30 + 8 * rnd(10 + k));
      streets.push({ cx: anchor.x + nx * off, cz: anchor.z + nz * off, ux, uz, half: radius * 0.85 });
    }
  }
  const crossings = Math.min(6, 1 + Math.floor(target / 14)); // transversales de chaque côté du centre
  for (let k = 1; k <= crossings; k++) {
    for (const side of [-1, 1]) {
      const along = side * k * (26 + 12 * rnd(20 + k)) * (k === 1 ? 1.2 : 1);
      if (Math.abs(along) > radius * 0.9) continue; // hors du village
      streets.push({ cx: anchor.x + ux * along, cz: anchor.z + uz * along, ux: nx, uz: nz, half: radius * (0.45 + 0.3 * rnd(30 + k)) });
    }
  }

  // Les maisons candidates, le long de chaque côté de chaque rue.
  interface Cand { x: number; z: number; w: number; d: number; yaw: number; door: 1 | -1; dist: number; key: number }
  const cands: Cand[] = [];
  streets.forEach((s, si) => {
    const yaw = Math.atan2(s.uz, s.ux);
    const sNx = -s.uz; // normale de cette rue
    const sNz = s.ux;
    for (const side of [-1, 1] as const) {
      let pos = -s.half + 2; // position le long de la rue
      for (let k = 0; pos < s.half - 3; k++) {
        const key = si * 1000 + (side > 0 ? 500 : 0) + k; // identifiant stable de l'emplacement
        const w = 6 + 5 * hash01(sa, sb, 100 + key); // largeur 6 à 11 m
        const d = 5 + 3 * hash01(sa, sb, 2000 + key); // profondeur 5 à 8 m
        const along = pos + w / 2;
        const off = side * (STREET_HALF + d / 2 + 0.6 + 1.4 * hash01(sa, sb, 4000 + key)); // recul par rapport à la rue
        const x = s.cx + s.ux * along + sNx * off;
        const z = s.cz + s.uz * along + sNz * off;
        cands.push({ x, z, w, d, yaw, door: side > 0 ? -1 : 1, dist: Math.hypot(x - anchor.x, z - anchor.z), key });
        pos += w + 1 + 3 * hash01(sa, sb, 6000 + key); // la maison suivante, un peu plus loin
      }
    }
  });
  cands.sort((a, b) => a.dist - b.dist || a.key - b.key); // du centre vers l'extérieur

  const houses: House[] = [];
  for (const cd of cands) {
    if (houses.length >= target) break;
    const reach = 0.5 * Math.hypot(cd.w, cd.d);
    if (cd.dist + reach > radius) continue; // hors du village
    // Densité : au bord du village, on laisse des vides.
    const edge = cd.dist / radius;
    if (hash01(sa, sb, 8000 + cd.key) > 1 - 0.55 * edge * edge) continue;
    // Terrain : les quatre coins et le centre doivent être sur la terre ferme et pas trop de dénivelé.
    const c = Math.cos(cd.yaw);
    const s = Math.sin(cd.yaw);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([a, b]) => t.heightAt(cd.x + c * a! * cd.w * 0.5 - s * b! * cd.d * 0.5, cd.z + s * a! * cd.w * 0.5 + c * b! * cd.d * 0.5));
    const lo = Math.min(...corners);
    const hi = Math.max(...corners);
    if (lo < 3.5 || hi - lo > 2.4) continue;
    // Pas sur une autre rue ni sur une autre maison.
    if (streets.some((st) => distToStreet(st, cd.x, cd.z) < STREET_HALF + 0.45 * Math.min(cd.w, cd.d))) continue;
    if (houses.some((h) => Math.hypot(h.x - cd.x, h.z - cd.z) < 0.44 * (Math.hypot(h.w, h.d) + Math.hypot(cd.w, cd.d)) + 0.8)) continue;
    const central = cd.dist < radius * 0.35;
    const extra = target >= 100 && central ? 1 : 0; // un étage de plus au cœur d'une grande ville
    const stories = Math.min(style.maxStories + extra, 1 + (hash01(sa, sb, 9000 + cd.key) < (central ? 0.7 : 0.35) ? 1 : 0) + extra);
    const floorY = corners.reduce((sum, v) => sum + v, 0) / corners.length;
    houses.push({
      x: cd.x,
      z: cd.z,
      w: cd.w,
      d: cd.d,
      yaw: cd.yaw,
      doorSide: cd.door,
      stories,
      wallH: stories * style.storyHeight,
      floorY,
      baseY: lo - 0.4,
      wall: style.walls[Math.floor(hash01(sa, sb, 10000 + cd.key) * style.walls.length)]!,
      roofColor: style.roofs[Math.floor(hash01(sa, sb, 11000 + cd.key) * style.roofs.length)]!,
      roof: style.roof,
      pitch: style.pitch * (0.9 + 0.2 * hash01(sa, sb, 12000 + cd.key)),
      chimney: style.roof === 'gable' && hash01(sa, sb, 13000 + cd.key) < style.chimneys,
      seed: hash01(sa, sb, 14000 + cd.key),
    });
  }

  // Deux panneaux, un à chaque bout de la rue principale, tournés vers celui qui arrive.
  const signs: Sign[] = [];
  for (const dir of [-1, 1]) {
    const x = anchor.x + ux * dir * (radius + 9) + nx * 5;
    const z = anchor.z + uz * dir * (radius + 9) + nz * 5;
    if (t.heightAt(x, z) < 3) continue; // pas dans l'eau
    signs.push({ x, z, nx: ux * dir, nz: uz * dir, name: c.name });
  }
  return { id: c.id, name: c.name, pop: c.pop, x: anchor.x, z: anchor.z, radius, style, houses, signs };
}

// Le point (x, z) est-il dans la maison (ou à moins de `margin` mètres de ses murs) ?
export function pointInHouse(h: House, x: number, z: number, margin = 0): boolean {
  const dx = x - h.x;
  const dz = z - h.z;
  const c = Math.cos(h.yaw);
  const s = Math.sin(h.yaw);
  const u = dx * c + dz * s; // coordonnée le long de la rue
  const v = -dx * s + dz * c; // coordonnée vers l'arrière
  return Math.abs(u) <= h.w / 2 + margin && Math.abs(v) <= h.d / 2 + margin;
}

// Pousse un cercle de rayon `radius` hors des maisons. Renvoie la position corrigée.
export function pushOutOfHouses(houses: readonly House[], x: number, z: number, radius: number): { x: number; z: number; hit: boolean } {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const h of houses) {
      if (Math.abs(x - h.x) > 14 || Math.abs(z - h.z) > 14) continue; // trop loin
      const c = Math.cos(h.yaw);
      const s = Math.sin(h.yaw);
      const u = (x - h.x) * c + (z - h.z) * s;
      const v = -(x - h.x) * s + (z - h.z) * c;
      const hu = h.w / 2 + radius;
      const hv = h.d / 2 + radius;
      if (Math.abs(u) >= hu || Math.abs(v) >= hv) continue; // dehors
      hit = true;
      // On sort par le côté le plus proche.
      const pu = hu - Math.abs(u);
      const pv = hv - Math.abs(v);
      let nu = u;
      let nv = v;
      if (pu < pv) nu = Math.sign(u || 1) * hu;
      else nv = Math.sign(v || 1) * hv;
      x = h.x + nu * c - nv * s;
      z = h.z + nu * s + nv * c;
    }
  }
  return { x, z, hit };
}
