// Les penons : petits rubans cousus sur la grand-voile, un de chaque côté, à trois hauteurs.
// Ils disent comment l'air coule sur la voile : droit vers l'arrière = bien réglé ; soulevé côté vent = trop choqué ;
// qui flotte ou tombe côté sous le vent = trop bordé (décrochage). Rouge = côté tribord, vert = côté bâbord (comme les feux).

import * as THREE from 'three';
import type { PenonFlow } from '../core/sailing';

const HEIGHTS = [0.3, 0.52, 0.74]; // hauteur de chaque paire sur la voile (fraction de la guindant)
const NODES = 5; // points par ruban (4 segments)
const LENGTH = 0.5; // longueur d'un ruban (m)
const WIDTH = 0.06; // largeur d'un ruban (m)
const FRONT = 0.16; // position le long de la corde, depuis le bord d'attaque (fraction)

// Donne un point de la voile (repère local de la bôme) : hauteur q et position p le long de la corde, de 0 à 1.
export type SailSampler = (q: number, p: number, out: THREE.Vector3) => void;

export class Penons {
  readonly group = new THREE.Group();
  private readonly red: Ribbon;
  private readonly green: Ribbon;
  private readonly materials: THREE.Material[] = [];
  private readonly a = new THREE.Vector3(); // points de travail (évite de recréer des objets à chaque image)
  private readonly b = new THREE.Vector3();

  constructor() {
    const mat = (color: number): THREE.Material => new THREE.MeshStandardMaterial({ color, roughness: 0.8, emissive: color, emissiveIntensity: 0.12, side: THREE.DoubleSide });
    const redMat = mat(0xd9362f);
    const greenMat = mat(0x2fae5b);
    this.materials.push(redMat, greenMat);
    this.red = new Ribbon(HEIGHTS.length, redMat);
    this.green = new Ribbon(HEIGHTS.length, greenMat);
    this.group.add(this.red.mesh, this.green.mesh);
  }

  // À bord, on voit les deux rubans à travers la voile (comme à travers les fenêtres d'une vraie voile) : on coupe le test de profondeur.
  setSeeThrough(on: boolean): void {
    for (const m of this.materials) {
      m.depthTest = !on;
      m.depthWrite = !on;
      m.transparent = on; // dessinés après la voile (opaque), donc par-dessus elle
      m.needsUpdate = true;
    }
    this.group.renderOrder = on ? 20 : 0;
  }

  // windSide : +1 si le vent vient de tribord. t : secondes.
  update(sample: SailSampler, flow: PenonFlow, windSide: number, t: number): void {
    HEIGHTS.forEach((q, i) => {
      sample(q, FRONT, this.a);
      sample(q, FRONT + 0.12, this.b);
      for (const side of [1, -1]) {
        const ribbon = side === 1 ? this.red : this.green;
        const toWind = side === windSide; // ce ruban est-il du côté du vent ?
        // défaut d'écoulement : côté vent, il se soulève si la voile est trop choquée ; sous le vent, il flotte si elle est trop bordée
        const disturbed = toWind ? Math.max(0, -flow.trim) : Math.max(0, flow.trim);
        ribbon.write(i, this.a, this.b, side, disturbed, flow.flow, t + i * 1.9 + (side === 1 ? 0 : 0.7));
      }
    });
    this.red.commit();
    this.green.commit();
  }
}

// Un ensemble de rubans de même couleur dans un seul maillage.
class Ribbon {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;

  constructor(count: number, material: THREE.Material) {
    this.positions = new Float32Array(count * NODES * 2 * 3);
    const indices: number[] = [];
    for (let r = 0; r < count; r++) {
      for (let n = 0; n < NODES - 1; n++) {
        const a = (r * NODES + n) * 2; // deux sommets par point (haut, bas)
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setIndex(indices);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
  }

  // Écrit le ruban n° index : il part du point a, dans la direction a→b (le sens de la corde), du côté side.
  write(index: number, a: THREE.Vector3, b: THREE.Vector3, side: number, disturbed: number, flow: number, t: number): void {
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const norm = Math.hypot(dx, dz) || 1;
    dx /= norm; // direction de la corde (vers l'arrière), dans le plan horizontal
    dz /= norm;
    const ox = dz * side; // sens « vers l'extérieur » : perpendiculaire à la corde, du côté du ruban
    const oz = -dx * side;
    let x = a.x + side * 0.012; // le ruban est posé juste à côté de la toile
    let y = a.y;
    let z = a.z;
    const seg = LENGTH / (NODES - 1); // longueur d'un segment
    let angle = 0; // écart du ruban par rapport à la corde (rad), positif vers l'extérieur de son côté
    for (let n = 0; n < NODES; n++) {
      const k = (index * NODES + n) * 6; // position du point dans le tableau
      const half = WIDTH / 2;
      this.positions[k] = x; // bord haut du ruban
      this.positions[k + 1] = y + half;
      this.positions[k + 2] = z;
      this.positions[k + 3] = x; // bord bas du ruban
      this.positions[k + 4] = y - half;
      this.positions[k + 5] = z;
      // l'angle se cumule le long du ruban : le bout bouge plus que la racine
      const wave = Math.sin(t * 12 + n * 1.6); // battement rapide quand l'écoulement est perturbé
      angle += disturbed * (0.35 + 0.45 * wave) * (0.4 + n * 0.25) + (1 - flow) * 0.3 * Math.sin(t * 2 + n); // défaut + balancement sans vent
      const c = Math.cos(angle);
      const sn = Math.sin(angle);
      y -= ((1 - flow) * 0.5 + disturbed * 0.35) * seg * (n / (NODES - 1)); // sans vent ou décroché, le ruban pend
      x += (dx * c + ox * sn) * seg; // avance d'un segment, dévié vers l'extérieur
      z += (dz * c + oz * sn) * seg;
    }
  }

  commit(): void {
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
  }
}
