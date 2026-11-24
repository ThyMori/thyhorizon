// L'affichage des modifications du monde posées par le joueur (pour l'instant : des cairns, petits tas de pierres).
// On ne dessine que celles qui sont près du joueur. Positions en repère du rendu (monde − origine flottante) : jamais de coordonnée du monde pour la carte graphique.

import * as THREE from 'three';
import type { EditStore, WorldEdit } from '../core/worldEdits';

const SHOW_RADIUS = 250; // on dessine ce qui est à moins de 250 m
const STONE_GEO = new THREE.IcosahedronGeometry(1, 1); // une pierre arrondie, partagée par toutes
const STONE_MATS = [0x8a8a84, 0x7a7c7a, 0x9a978e].map((c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true })); // trois gris légèrement différents

// Petit nombre pseudo-aléatoire stable à partir d'un texte (la même pierre est toujours pareille).
function hash01(text: string, k: number): number {
  let h = 2166136261 ^ k;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

// Fabrique un cairn : cinq pierres empilées, de plus en plus petites, un peu décalées.
function buildCairn(e: WorldEdit): THREE.Group {
  const g = new THREE.Group();
  let y = 0; // hauteur du dessous de la pierre en cours
  let size = 0.34; // rayon de la première pierre
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(STONE_GEO, STONE_MATS[i % STONE_MATS.length]);
    const sy = size * (0.55 + hash01(e.id, i) * 0.15); // pierres aplaties
    m.scale.set(size * (1 + hash01(e.id, 10 + i) * 0.25), sy, size * (1 + hash01(e.id, 20 + i) * 0.25));
    m.position.set((hash01(e.id, 30 + i) - 0.5) * size * 0.35, y + sy * 0.85, (hash01(e.id, 40 + i) - 0.5) * size * 0.35);
    m.rotation.y = hash01(e.id, 50 + i) * 6.28;
    g.add(m);
    y += sy * 1.6; // la suivante pose sur celle-ci
    size *= 0.78; // et elle est plus petite
  }
  return g;
}

export class EditObjects {
  private readonly shown = new Map<string, THREE.Group>(); // modifications actuellement dessinées
  private readonly baseY = new Map<string, number>(); // altitude du sol au pied de chacune (m)

  constructor(private readonly scene: THREE.Scene, private readonly store: EditStore) {}

  // Remet l'affichage à jour : ajoute ce qui entre dans le rayon, retire ce qui en sort, replace tout par rapport à l'origine.
  update(px: number, pz: number, ox: number, oz: number, heightAt: (x: number, z: number) => number): void {
    const near = this.store.near(px, pz, SHOW_RADIUS);
    const keep = new Set<string>();
    for (const e of near) {
      keep.add(e.id);
      let g = this.shown.get(e.id);
      if (!g) {
        g = buildCairn(e); // (un seul type pour l'instant)
        g.rotation.y = e.yaw;
        this.scene.add(g);
        this.shown.set(e.id, g);
        this.baseY.set(e.id, heightAt(e.x, e.z)); // le sol sous le cairn
      }
      g.position.set(e.x - ox, this.baseY.get(e.id) ?? 0, e.z - oz); // repère du rendu
    }
    for (const [id, g] of this.shown) {
      if (keep.has(id)) continue;
      this.scene.remove(g); // trop loin ou retiré : on le retire de la scène (géométrie et matières sont partagées, rien à libérer)
      this.shown.delete(id);
      this.baseY.delete(id);
    }
  }

  get count(): number {
    return this.shown.size;
  }
}
