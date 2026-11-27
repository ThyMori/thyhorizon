// Le dessin des plantes (1.46). Chaque modèle est fabriqué à la taille « 1 m » : la plante réelle est ce groupe MULTIPLIÉ par sa hauteur du moment
// (`plantHeight`, qui dépend du temps écoulé depuis la plantation). Géométries et matières sont partagées : une plante ne coûte que quelques maillages.
// Repère du groupe : le pied est en (0, 0, 0), la plante monte selon +y.

import * as THREE from 'three';
import type { PlantSpecies } from '../core/plants';

const mat = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color, flatShading: true }); // matière mate partagée
const GREEN = [mat(0x5a8f3c), mat(0x4a8236), mat(0x6a9a44)]; // trois verts de feuillage
const DARK = mat(0x3d6e30); // feuillage sombre du chêne
const STEM = mat(0x55803a); // tige verte
const BARK = mat(0x6b4a2b); // écorce
const ORANGE = mat(0xe08a2e); // carotte
const YELLOW = mat(0xe6bf2a); // pétales de tournesol
const SEEDS = mat(0x4a3320); // cœur du tournesol

const BLADE = new THREE.ConeGeometry(0.05, 1, 4); // une feuille fine (carotte)
const BLOB = new THREE.IcosahedronGeometry(1, 0); // une touffe de feuillage
const STEM_GEO = new THREE.CylinderGeometry(0.02, 0.03, 1, 6); // tige de hauteur 1
const TRUNK_GEO = new THREE.CylinderGeometry(0.05, 0.085, 1, 7); // tronc de hauteur 1
const DISC = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 14); // couronne de pétales
const HEART = new THREE.CylinderGeometry(0.095, 0.095, 0.04, 12); // cœur de la fleur
const ROOT = new THREE.SphereGeometry(0.07, 6, 5); // épaule de la carotte

// Un petit nombre stable (0 à 1) à partir d'un texte : la même plante est toujours la même.
function hash01(text: string, k: number): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function add(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  g.add(mesh);
  return mesh;
}

function buildCarrot(id: string): THREE.Group {
  const g = new THREE.Group();
  add(g, ROOT, ORANGE, 0, 0.03, 0); // l'épaule orange affleure le sol
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + hash01(id, i) * 0.6; // autour du pied
    const lean = 0.25 + hash01(id, 10 + i) * 0.35; // inclinaison vers l'extérieur
    const len = 0.7 + hash01(id, 20 + i) * 0.3;
    const leaf = add(g, BLADE, GREEN[i % GREEN.length]!, Math.sin(a) * 0.06 * len, len * 0.45, Math.cos(a) * 0.06 * len, 1, len, 1);
    leaf.rotation.set(Math.cos(a) * lean, 0, -Math.sin(a) * lean); // penche vers l'extérieur
  }
  return g;
}

function buildSunflower(id: string): THREE.Group {
  const g = new THREE.Group();
  add(g, STEM_GEO, STEM, 0, 0.5, 0); // la tige
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7 + hash01(id, i) * 0.8; // les grandes feuilles, à des hauteurs et des côtés différents
    const y = 0.2 + i * 0.14;
    add(g, BLOB, GREEN[i % GREEN.length]!, Math.sin(a) * 0.13, y, Math.cos(a) * 0.13, 0.14, 0.025, 0.09).rotation.y = -a;
  }
  const head = new THREE.Group(); // la fleur, tournée vers le sud et un peu vers le haut
  head.position.set(0, 0.985, 0.03);
  head.rotation.x = 1.15;
  add(head, DISC, YELLOW, 0, 0, 0);
  add(head, HEART, SEEDS, 0, 0.02, 0);
  g.add(head);
  return g;
}

function buildHazel(id: string): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + hash01(id, i) * 0.8; // quatre tiges qui partent du pied
    const lean = 0.18 + hash01(id, 10 + i) * 0.15;
    const stem = add(g, STEM_GEO, BARK, Math.sin(a) * 0.05, 0.42, Math.cos(a) * 0.05, 1.6, 0.85, 1.6);
    stem.rotation.set(Math.cos(a) * lean, 0, -Math.sin(a) * lean);
  }
  for (let i = 0; i < 8; i++) {
    const a = i * 2.4 + hash01(id, 20 + i) * 0.6; // le feuillage en touffes autour
    const r = 0.12 + hash01(id, 30 + i) * 0.16;
    const y = 0.38 + (i / 8) * 0.55;
    const s = 0.18 + hash01(id, 40 + i) * 0.07;
    add(g, BLOB, GREEN[i % GREEN.length]!, Math.sin(a) * r, y, Math.cos(a) * r, s, s * 0.85, s);
  }
  return g;
}

function buildOak(id: string): THREE.Group {
  const g = new THREE.Group();
  add(g, TRUNK_GEO, BARK, 0, 0.3, 0, 1, 0.6, 1); // le tronc (0,6 de la hauteur)
  const crown = [
    [0, 0.78, 0, 0.34], // le centre de la couronne
    [0.2, 0.68, 0.06, 0.26],
    [-0.18, 0.7, -0.08, 0.27],
    [0.04, 0.9, 0.12, 0.25],
    [-0.06, 0.84, -0.2, 0.23],
  ] as const;
  crown.forEach(([x, y, z, r], i) => add(g, BLOB, i % 2 === 0 ? DARK : GREEN[1]!, x + (hash01(id, i) - 0.5) * 0.06, y, z, r, r * 0.85, r));
  return g;
}

// Fabrique le modèle d'une plante à la taille « 1 m » (à multiplier par sa hauteur).
export function buildPlant(species: PlantSpecies, id: string): THREE.Group {
  switch (species) {
    case 'carrot':
      return buildCarrot(id);
    case 'sunflower':
      return buildSunflower(id);
    case 'hazel':
      return buildHazel(id);
    case 'oak':
      return buildOak(id);
  }
}
