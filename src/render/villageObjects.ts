// L'affichage des villages proches : maisons (un seul maillage par village) et panneaux avec le nom de la ville.
// Positions en repère du rendu (monde − origine flottante) : jamais de coordonnée du monde pour la carte graphique.

import * as THREE from 'three';
import { SIGN_H, SIGN_W, SIGN_Y, buildVillageMesh } from '../core/villageMesh';
import type { Village } from '../core/village';
import type { VillageSystem } from '../core/villageSystem';

const SHOW_RADIUS = 1800; // on dessine les villages à moins de 1,8 km
const KEEP_RADIUS = 2300; // et on les garde un peu plus loin (pas de clignotement à la limite)

// La texture d'un panneau : le nom de la ville sur une planche claire, bordée de sombre. Le texte est dessiné sur un canevas (jamais de HTML).
function signTexture(name: string): THREE.CanvasTexture {
  const w = 1024;
  const h = Math.round((w * SIGN_H) / SIGN_W);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e9e4d3'; // planche claire
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3b2a1c'; // bordure sombre
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, w - 14, h - 14);
  let size = Math.round(h * 0.62); // on réduit la police jusqu'à ce que le nom tienne
  ctx.font = `bold ${size}px "Segoe UI", system-ui, sans-serif`;
  while (size > 24 && ctx.measureText(name).width > w - 90) {
    size -= 4;
    ctx.font = `bold ${size}px "Segoe UI", system-ui, sans-serif`;
  }
  ctx.fillStyle = '#25211c'; // texte sombre
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, w / 2, h / 2 + size * 0.04);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

interface Shown {
  group: THREE.Group;
  geometry: THREE.BufferGeometry;
  texture: THREE.CanvasTexture | null;
  signMaterial: THREE.MeshStandardMaterial | null;
  stamp: number; // numéro des plans avec lesquels il a été construit
}

export class VillageObjects {
  private readonly shown = new Map<number, Shown>();
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  private shadowsOn = false;

  constructor(private readonly scene: THREE.Scene, private readonly villages: VillageSystem, private readonly renderer: THREE.WebGLRenderer) {}

  // Remet l'affichage à jour : construit ce qui entre dans le rayon (un village par appel au plus), retire ce qui en sort, replace tout par rapport à l'origine.
  update(px: number, pz: number, ox: number, oz: number, groundAt: (x: number, z: number) => number): void {
    if (this.renderer.shadowMap.enabled !== this.shadowsOn) {
      this.shadowsOn = this.renderer.shadowMap.enabled;
      this.material.needsUpdate = true; // le matériau doit être recompilé pour inclure/exclure les ombres
    }
    const near = this.villages.near(px, pz, SHOW_RADIUS).filter((v) => Math.hypot(v.x - px, v.z - pz) < SHOW_RADIUS + v.radius);
    const keep = new Set<number>();
    let built = 0; // limite de construction par appel : pas de saccade
    for (const v of near) {
      keep.add(v.id);
      let s = this.shown.get(v.id);
      if (s && s.stamp !== this.villages.stamp) {
        this.dispose(v.id); // les plans ont changé : on refait
        s = undefined;
      }
      if (!s) {
        if (built >= 1) continue;
        s = this.build(v, groundAt);
        this.shown.set(v.id, s);
        built++;
      }
      s.group.position.set(v.x - ox, 0, v.z - oz); // repère du rendu
    }
    for (const id of [...this.shown.keys()]) {
      if (keep.has(id)) continue;
      const v = this.villages.village(id);
      if (v && Math.hypot(v.x - px, v.z - pz) < KEEP_RADIUS) {
        const s = this.shown.get(id)!;
        s.group.position.set(v.x - ox, 0, v.z - oz); // encore gardé : on le suit
        continue;
      }
      this.dispose(id);
    }
  }

  private build(v: Village, groundAt: (x: number, z: number) => number): Shown {
    const mesh = buildVillageMesh(v, groundAt);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(mesh.colors, 3));
    geometry.setIndex(mesh.indices);
    geometry.computeBoundingSphere();
    const group = new THREE.Group();
    const houses = new THREE.Mesh(geometry, this.material);
    houses.castShadow = true;
    houses.receiveShadow = true;
    group.add(houses);
    let texture: THREE.CanvasTexture | null = null;
    let signMaterial: THREE.MeshStandardMaterial | null = null;
    if (v.signs.length > 0) {
      texture = signTexture(v.name);
      signMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.85, metalness: 0 });
      const plane = new THREE.PlaneGeometry(SIGN_W - 0.1, SIGN_H - 0.08);
      for (const sg of v.signs) {
        const m = new THREE.Mesh(plane, signMaterial);
        const ground = groundAt(sg.x, sg.z);
        m.position.set(sg.x - v.x + sg.nx * 0.045, ground + SIGN_Y + SIGN_H / 2, sg.z - v.z + sg.nz * 0.045); // un peu devant la planche
        m.rotation.y = Math.atan2(sg.nx, sg.nz); // la face avant regarde vers (nx, nz)
        m.castShadow = false;
        group.add(m);
      }
    }
    this.scene.add(group);
    return { group, geometry, texture, signMaterial, stamp: this.villages.stamp };
  }

  private dispose(id: number): void {
    const s = this.shown.get(id);
    if (!s) return;
    this.scene.remove(s.group);
    s.geometry.dispose();
    s.texture?.dispose();
    s.signMaterial?.dispose();
    s.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== s.geometry) o.geometry.dispose(); // les plans des panneaux
    });
    this.shown.delete(id);
  }

  get count(): number {
    return this.shown.size;
  }

  // Les villages dessinés en ce moment (pour les essais).
  names(): string[] {
    return [...this.shown.keys()].map((id) => this.villages.village(id)?.name ?? '?');
  }
}
