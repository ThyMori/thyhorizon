// Le dessin de la faune (1.42) : un modèle simple (quelques boîtes et ailes) par espèce, dessiné en INSTANCES (une seule demande à la
// carte graphique par espèce, quelle que soit la quantité). Les bêtes viennent de core/fauna.ts, qui donne leurs positions dans le monde ;
// ici on les passe en repère du rendu (moins l'origine flottante : jamais de grande coordonnée envoyée à la carte graphique).
// Les battements d'ailes se font dans le vertex shader : chaque sommet d'aile se lève ou s'abaisse selon sa distance au corps.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ALL_SPECIES, Critter, MAX_PER_SPECIES, Species } from '../core/fauna';
import { Rgb, srgbToLinear } from '../core/math';

type P3 = [number, number, number];

// Une couleur sRGB → lumière linéaire.
const lin = (c: Rgb): Rgb => [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];

// Une boîte (largeur, hauteur, profondeur) centrée en (x, y, z), d'une couleur. Le museau regarde vers +z.
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: Rgb): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  const n = g.getAttribute('position').count;
  const c = lin(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('wing', new THREE.BufferAttribute(new Float32Array(n), 1)); // 0 = corps : ne bat pas
  return g;
}

// Une paire d'ailes (deux quadrilatères, un de chaque côté) : de x0 à x1 vers l'extérieur, du bord d'attaque (zf) au bord de fuite (zb) ;
// le bout de l'aile est un peu en arrière (`sweep`).
function wings(x0: number, x1: number, zf: number, zb: number, sweep: number, y: number, color: Rgb): THREE.BufferGeometry {
  const c = lin(color);
  const pos: number[] = [];
  const quad = (s: number): void => {
    const a: P3 = [s * x0, y, zf];
    const b: P3 = [s * x1, y, zf - sweep];
    const d: P3 = [s * x1, y, zb - sweep];
    const e: P3 = [s * x0, y, zb];
    pos.push(...a, ...b, ...d, ...a, ...d, ...e);
  };
  quad(1);
  quad(-1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  const n = pos.length / 3;
  const nrm = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) nrm.set([0, 1, 0], i * 3);
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('wing', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1)); // 1 = aile : bat
  return g;
}

const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(parts, false)!;

// Les modèles. Unités : mètres, taille de référence de l'espèce (la taille de la bête les multiplie), pieds au sol (y = 0) pour les bêtes terrestres.
function model(sp: Species): THREE.BufferGeometry {
  switch (sp) {
    case 'songbird': // petit oiseau brun, envergure ≈ 35 cm
      return merge([box(0.07, 0.07, 0.15, 0, 0, 0, [0.42, 0.34, 0.27]), box(0.055, 0.055, 0.06, 0, 0.02, 0.1, [0.5, 0.4, 0.3]), box(0.04, 0.012, 0.1, 0, 0, -0.12, [0.3, 0.25, 0.2]), wings(0.035, 0.17, 0.04, -0.06, 0.03, 0.015, [0.34, 0.28, 0.22])]);
    case 'gull': // mouette blanche aux bouts d'ailes gris, envergure ≈ 1 m
      return merge([box(0.07, 0.07, 0.17, 0, 0, 0, [0.95, 0.95, 0.95]), box(0.055, 0.055, 0.07, 0, 0.025, 0.12, [0.95, 0.95, 0.95]), box(0.02, 0.015, 0.05, 0, 0.015, 0.18, [0.9, 0.7, 0.2]), box(0.05, 0.012, 0.08, 0, 0, -0.13, [0.9, 0.9, 0.9]), wings(0.035, 0.19, 0.045, -0.05, 0.05, 0.015, [0.9, 0.92, 0.95])]);
    case 'raptor': // rapace brun, ailes larges, envergure ≈ 1,5 m
      return merge([box(0.08, 0.07, 0.18, 0, 0, 0, [0.4, 0.28, 0.18]), box(0.055, 0.055, 0.06, 0, 0.02, 0.12, [0.55, 0.45, 0.32]), box(0.06, 0.012, 0.12, 0, 0, -0.15, [0.5, 0.35, 0.22]), wings(0.04, 0.2, 0.06, -0.07, 0.02, 0.015, [0.36, 0.26, 0.17])]);
    case 'butterfly': // papillon : ailes blanches que la nuance colorie, envergure ≈ 10 cm
      return merge([box(0.008, 0.008, 0.05, 0, 0, 0, [0.15, 0.12, 0.1]), wings(0.004, 0.05, 0.03, -0.03, 0.005, 0.004, [1, 1, 1])]);
    case 'dragonfly': // libellule : long corps fin, quatre ailes
      return merge([box(0.012, 0.012, 0.2, 0, 0, -0.04, [0.85, 0.85, 0.85]), box(0.02, 0.02, 0.025, 0, 0, 0.07, [0.7, 0.7, 0.7]), wings(0.008, 0.07, 0.045, 0.025, 0.005, 0.008, [0.85, 0.9, 0.95]), wings(0.008, 0.07, 0.02, 0.0, 0.005, 0.008, [0.85, 0.9, 0.95])]);
    case 'rabbit': // lapin brun, longues oreilles, queue blanche
      return merge([box(0.2, 0.2, 0.38, 0, 0.14, 0, [0.5, 0.42, 0.33]), box(0.13, 0.13, 0.14, 0, 0.22, 0.24, [0.52, 0.44, 0.35]), box(0.035, 0.15, 0.03, 0.04, 0.35, 0.22, [0.45, 0.37, 0.29]), box(0.035, 0.15, 0.03, -0.04, 0.35, 0.22, [0.45, 0.37, 0.29]), box(0.07, 0.07, 0.06, 0, 0.17, -0.21, [0.95, 0.95, 0.95])]);
    case 'deer': // cerf : corps brun, ventre clair, cou et tête, quatre pattes
      return merge([box(0.4, 0.46, 1.0, 0, 0.98, 0, [0.52, 0.34, 0.19]), box(0.36, 0.14, 0.8, 0, 0.78, 0, [0.78, 0.68, 0.54]), box(0.17, 0.5, 0.2, 0, 1.3, 0.55, [0.5, 0.33, 0.18]), box(0.15, 0.17, 0.3, 0, 1.55, 0.74, [0.55, 0.38, 0.22]), box(0.05, 0.12, 0.04, 0.07, 1.67, 0.64, [0.42, 0.3, 0.18]), box(0.05, 0.12, 0.04, -0.07, 1.67, 0.64, [0.42, 0.3, 0.18]), box(0.07, 0.1, 0.1, 0, 1.0, -0.55, [0.9, 0.85, 0.75]),
        box(0.09, 0.78, 0.09, 0.14, 0.39, 0.4, [0.36, 0.25, 0.14]), box(0.09, 0.78, 0.09, -0.14, 0.39, 0.4, [0.36, 0.25, 0.14]), box(0.09, 0.78, 0.09, 0.14, 0.39, -0.4, [0.36, 0.25, 0.14]), box(0.09, 0.78, 0.09, -0.14, 0.39, -0.4, [0.36, 0.25, 0.14])]);
    case 'sheep': // mouton : laine claire, tête et pattes sombres
      return merge([box(0.55, 0.5, 0.85, 0, 0.62, 0, [0.88, 0.86, 0.8]), box(0.17, 0.2, 0.24, 0, 0.72, 0.52, [0.22, 0.19, 0.17]), box(0.07, 0.05, 0.09, 0.12, 0.8, 0.46, [0.22, 0.19, 0.17]), box(0.07, 0.05, 0.09, -0.12, 0.8, 0.46, [0.22, 0.19, 0.17]),
        box(0.08, 0.4, 0.08, 0.17, 0.2, 0.3, [0.22, 0.19, 0.17]), box(0.08, 0.4, 0.08, -0.17, 0.2, 0.3, [0.22, 0.19, 0.17]), box(0.08, 0.4, 0.08, 0.17, 0.2, -0.3, [0.22, 0.19, 0.17]), box(0.08, 0.4, 0.08, -0.17, 0.2, -0.3, [0.22, 0.19, 0.17])]);
    case 'cow': // vache : blanche à taches noires, tête, quatre pattes
      return merge([box(0.8, 0.75, 1.7, 0, 1.05, 0, [0.9, 0.89, 0.86]), box(0.82, 0.4, 0.5, 0, 1.15, 0.35, [0.14, 0.12, 0.12]), box(0.82, 0.3, 0.45, 0, 1.0, -0.5, [0.14, 0.12, 0.12]), box(0.32, 0.34, 0.45, 0, 1.2, 1.05, [0.85, 0.84, 0.8]), box(0.12, 0.07, 0.1, 0.2, 1.4, 0.95, [0.14, 0.12, 0.12]), box(0.12, 0.07, 0.1, -0.2, 1.4, 0.95, [0.14, 0.12, 0.12]),
        box(0.13, 0.7, 0.13, 0.28, 0.35, 0.6, [0.8, 0.79, 0.76]), box(0.13, 0.7, 0.13, -0.28, 0.35, 0.6, [0.8, 0.79, 0.76]), box(0.13, 0.7, 0.13, 0.28, 0.35, -0.6, [0.8, 0.79, 0.76]), box(0.13, 0.7, 0.13, -0.28, 0.35, -0.6, [0.8, 0.79, 0.76])]);
  }
}

// Taille de chaque espèce par rapport à son modèle (le modèle est « de référence » : oiseau de 35 cm, etc.).
const BASE_SCALE: Record<Species, number> = { songbird: 1, gull: 2.7, raptor: 3.8, butterfly: 1, dragonfly: 1, rabbit: 1, deer: 1, sheep: 1, cow: 1 };

// Le battement d'ailes : chaque sommet d'aile (`wing` = 1) monte ou descend d'autant plus qu'il est loin du corps.
function patchFlap(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float wing;\nattribute float aFlap;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y += wing * abs(position.x) * aFlap * 1.7;');
}

export class FaunaView {
  private readonly meshes = new Map<Species, THREE.InstancedMesh>();
  private readonly flaps = new Map<Species, THREE.InstancedBufferAttribute>();
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    material.onBeforeCompile = patchFlap;
    for (const sp of ALL_SPECIES) {
      const g = model(sp);
      const flap = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_SPECIES), 1);
      flap.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('aFlap', flap);
      const m = new THREE.InstancedMesh(g, material, MAX_PER_SPECIES);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; // les bêtes sont partout autour : on laisse la carte graphique rejeter ce qui est hors champ
      m.count = 0;
      m.visible = false;
      m.castShadow = false;
      scene.add(m);
      this.meshes.set(sp, m);
      this.flaps.set(sp, flap);
    }
  }

  // Place les bêtes (positions du monde) dans le repère du rendu : on soustrait l'origine flottante.
  update(critters: readonly Critter[], originX: number, originZ: number): void {
    const counts = new Map<Species, number>();
    for (const c of critters) {
      const m = this.meshes.get(c.species)!;
      const i = counts.get(c.species) ?? 0;
      if (i >= MAX_PER_SPECIES) continue;
      counts.set(c.species, i + 1);
      const k = c.scale * BASE_SCALE[c.species];
      this.dummy.position.set(c.x - originX, c.y, c.z - originZ);
      this.dummy.rotation.set(0, c.yaw, 0);
      this.dummy.scale.set(k, k, k);
      this.dummy.updateMatrix();
      m.setMatrixAt(i, this.dummy.matrix);
      this.color.setRGB(srgbToLinear(c.tint[0]), srgbToLinear(c.tint[1]), srgbToLinear(c.tint[2])); // la nuance est en sRGB : on la passe en linéaire
      m.setColorAt(i, this.color);
      this.flaps.get(c.species)!.setX(i, c.flap);
    }
    for (const [sp, m] of this.meshes) {
      const n = counts.get(sp) ?? 0;
      m.count = n;
      m.visible = n > 0;
      if (n === 0) continue;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.flaps.get(sp)!.needsUpdate = true;
    }
  }

  // Combien de bêtes de chaque espèce sont dessinées (essais).
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [sp, m] of this.meshes) out[sp] = m.count;
    return out;
  }
}
