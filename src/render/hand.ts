// Une main réaliste construite à la main (aucun fichier 3D) : paume, quatre doigts à trois phalanges, pouce, ongles, poignet.
// Repère de la main : l'origine est le poignet ; Y va vers les doigts ; Z sort du dos de la main ; X va de l'index vers l'auriculaire.
// La main gauche est la droite en miroir (dans `geo`) : ce qu'on y accroche à côté (la boussole) n'est donc pas inversé.

import * as THREE from 'three';
import type { HandPose } from '../core/handPose';

// Couleur de peau et d'ongles (partagées par les deux mains).
let skin: THREE.MeshStandardMaterial | null = null;
let nail: THREE.MeshStandardMaterial | null = null;
const skinMaterial = (): THREE.MeshStandardMaterial => (skin ??= new THREE.MeshStandardMaterial({ color: 0xb27c64, roughness: 0.62, metalness: 0, emissive: 0x1c0803, emissiveIntensity: 0.1 })); // léger éclat chaud : la chair laisse passer un peu de lumière
const nailMaterial = (): THREE.MeshStandardMaterial => (nail ??= new THREE.MeshStandardMaterial({ color: 0xf0c4b8, roughness: 0.32, metalness: 0 }));

type Lens = [number, number, number];
interface FingerSpec {
  x: number; // position de la base du doigt sur le bord de la paume
  y: number;
  lens: Lens; // longueurs des trois phalanges (m)
  r: number; // rayon à la base du doigt (m)
}
// Proportions d'une main adulte (m).
const FINGERS: FingerSpec[] = [
  { x: -0.031, y: 0.094, lens: [0.045, 0.026, 0.021], r: 0.0092 }, // index
  { x: -0.011, y: 0.098, lens: [0.05, 0.03, 0.022], r: 0.0094 }, // majeur
  { x: 0.009, y: 0.095, lens: [0.046, 0.028, 0.021], r: 0.009 }, // annulaire
  { x: 0.028, y: 0.088, lens: [0.036, 0.021, 0.019], r: 0.008 }, // auriculaire
];
const THUMB: { lens: Lens; r: number } = { lens: [0.046, 0.034, 0.027], r: 0.0108 };

// Une phalange : capsule dirigée vers +Y dans son articulation.
function segment(len: number, radius: number, nailOn: boolean): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(len - 2 * radius, 0.002), 4, 10), skinMaterial());
  m.position.y = len / 2;
  g.add(m);
  if (nailOn) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), nailMaterial()); // ongle : une petite lentille sur le dos du bout du doigt
    n.scale.set(radius * 0.7, len * 0.36, radius * 0.22);
    n.position.set(0, len * 0.55, radius * 0.82);
    g.add(n);
  }
  return g;
}

// Une chaîne de trois articulations : renvoie la racine et les trois groupes à faire tourner.
function chain(lens: Lens, r: number): { root: THREE.Group; joints: THREE.Group[] } {
  const joints: THREE.Group[] = [];
  let parent: THREE.Group | null = null;
  let root!: THREE.Group;
  lens.forEach((len, k) => {
    const j = segment(len, r * (1 - 0.1 * k), k === 2);
    if (parent) {
      j.position.y = lens[k - 1]!; // la phalange suivante commence au bout de la précédente
      parent.add(j);
    } else root = j;
    joints.push(j);
    parent = j;
  });
  return { root, joints };
}

export class Hand {
  readonly root = new THREE.Group(); // origine = poignet (non inversé)
  private readonly geo = new THREE.Group(); // la main elle-même (inversée pour la gauche)
  private readonly fingerRoots: THREE.Group[] = [];
  private readonly fingerJoints: THREE.Group[][] = [];
  private readonly thumbRoot: THREE.Group;
  private readonly thumbJoints: THREE.Group[];

  constructor(readonly side: 'left' | 'right') {
    this.root.add(this.geo);
    if (side === 'left') this.geo.scale.x = -1; // la main gauche est le miroir de la droite
    const mat = skinMaterial();
    const ell = (sx: number, sy: number, sz: number, x: number, y: number, z: number): void => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      this.geo.add(m);
    };
    ell(0.043, 0.05, 0.0155, 0, 0.05, 0); // paume
    ell(0.046, 0.02, 0.016, 0, 0.088, 0); // bande des articulations de la base des doigts
    ell(0.02, 0.032, 0.013, -0.027, 0.032, -0.011); // masse du pouce, côté paume
    ell(0.03, 0.026, 0.014, 0.004, 0.012, -0.004); // talon de la main
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.0255, 0.0285, 0.07, 14), mat); // poignet
    wrist.position.y = -0.03;
    wrist.scale.z = 0.82;
    this.geo.add(wrist);
    for (const f of FINGERS) {
      const c = chain(f.lens, f.r);
      c.root.position.set(f.x, f.y, 0);
      this.geo.add(c.root);
      this.fingerRoots.push(c.root);
      this.fingerJoints.push(c.joints);
    }
    const t = chain(THUMB.lens, THUMB.r);
    t.root.position.set(-0.03, 0.014, -0.008);
    this.geo.add(t.root);
    this.thumbRoot = t.root;
    this.thumbJoints = t.joints;
    this.setPose({ fingers: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], spread: [0, 0, 0, 0], thumb: [0, 0, 0], thumbSwing: 0 });
  }

  // Plie les doigts selon la pose. Plier = tourner vers la paume (côté −Z) : rotation négative autour de X.
  setPose(p: HandPose): void {
    for (let f = 0; f < 4; f++) {
      this.fingerRoots[f]!.rotation.set(-p.fingers[f]![0], 0, p.spread[f]!, 'XYZ');
      this.fingerJoints[f]![1]!.rotation.x = -p.fingers[f]![1];
      this.fingerJoints[f]![2]!.rotation.x = -p.fingers[f]![2];
    }
    // Le pouce part en biais vers l'extérieur et vers la paume ; thumbSwing l'écarte ou le rapproche.
    this.thumbRoot.rotation.set(-0.3 - p.thumb[0], 0, 0.55 - p.thumbSwing, 'XYZ');
    this.thumbJoints[1]!.rotation.x = -p.thumb[1];
    this.thumbJoints[2]!.rotation.x = -p.thumb[2];
  }
}
