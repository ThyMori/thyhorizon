// Le joueur dans le monde : deux bras avec leurs mains (la gauche tient la boussole) et un corps provisoire visible à la troisième personne.
// À la première personne on ne voit que les bras ; à la troisième, tout. Les bras sont posés par cinématique inverse (core/arm.ts) :
// les épaules suivent le corps, les mains suivent le regard avec un léger retard et se balancent à la marche.

import * as THREE from 'three';
import { twoBoneIK, V3 } from '../core/arm';
import { wrapPi } from '../core/compass';
import { clamp, lerp } from '../core/math';
import { HOLD_COMPASS, RELAXED, blendPose } from '../core/handPose';
import { CompassModel } from './compassModel';
import { Hand } from './hand';

const UPPER = 0.29; // longueur du bras (m)
const FORE = 0.27; // longueur de l'avant-bras (m)
const COAT = 0x35504a; // manches : un manteau vert sombre
const CUFF = 0x4a6a62; // poignet de la manche
const UP = new THREE.Vector3(0, 1, 0);
const Q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); // main à plat : doigts vers l'avant, dos vers le haut
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

// Les paramètres de chaque image.
export interface AvatarFrame {
  dt: number;
  time: number; // horloge (s)
  eye: THREE.Vector3; // position des yeux, dans le repère du rendu (relatif à l'origine flottante)
  yaw: number;
  pitch: number;
  roll: number;
  eyeHeight: number; // hauteur des yeux au-dessus des pieds (m) : plus bas accroupi
  walkSpeed: number; // vitesse de marche (m/s)
  compassCard: number; // angle de la rose (voir core/compass.ts)
  raise: number; // 0 = boussole tenue bas, 1 = levée devant les yeux pour la lire
  blend: number; // 0 = première personne, 1 = troisième
  showHands: boolean; // réglage : montrer les bras en première personne
}

// Pose un cylindre de rayon fixe entre deux points (le cylindre de base a une hauteur de 1).
function place(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  tmpA.copy(b).sub(a);
  const len = tmpA.length();
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(UP, tmpA.multiplyScalar(1 / len));
  mesh.scale.y = len;
}

class Arm {
  readonly hand: Hand;
  readonly upper: THREE.Mesh;
  readonly fore: THREE.Mesh;
  readonly cuff: THREE.Mesh;
  readonly joints: THREE.Mesh[];

  constructor(side: 'left' | 'right', parent: THREE.Group) {
    this.hand = new Hand(side);
    const coat = new THREE.MeshStandardMaterial({ color: COAT, roughness: 0.88, side: THREE.DoubleSide }); // double face : si la caméra coupe une manche, on voit l'étoffe et non un trou
    const cuffMat = new THREE.MeshStandardMaterial({ color: CUFF, roughness: 0.8, side: THREE.DoubleSide });
    const cyl = (r0: number, r1: number, mat: THREE.Material): THREE.Mesh => new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 14, 1), mat);
    this.upper = cyl(0.052, 0.049, coat);
    this.fore = cyl(0.047, 0.041, coat);
    this.cuff = cyl(0.046, 0.046, cuffMat);
    const ball = (r: number): THREE.Mesh => new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), coat);
    this.joints = [ball(0.056), ball(0.05)]; // épaule, coude
    parent.add(this.upper, this.fore, this.cuff, this.hand.root, ...this.joints);
  }

  // Place le bras : épaule fixe, poignet visé, coude du côté du pôle.
  pose(shoulder: THREE.Vector3, wrist: THREE.Vector3, pole: THREE.Vector3): void {
    const r = twoBoneIK(shoulder.toArray() as V3, wrist.toArray() as V3, UPPER, FORE, pole.toArray() as V3);
    const elbow = new THREE.Vector3(...r.elbow);
    const w = new THREE.Vector3(...r.wrist);
    const dir = tmpB.copy(w).sub(elbow).normalize();
    const forearmEnd = w.clone().addScaledVector(dir, -0.02); // la manche s'arrête un peu avant le poignet
    place(this.upper, shoulder, elbow);
    place(this.fore, elbow, forearmEnd);
    place(this.cuff, forearmEnd.clone().addScaledVector(dir, -0.045), forearmEnd);
    this.joints[0]!.position.copy(shoulder);
    this.joints[1]!.position.copy(elbow);
  }
}

export class Avatar {
  readonly group = new THREE.Group();
  private readonly arms = new THREE.Group(); // bras et mains
  private readonly body = new THREE.Group(); // corps provisoire (troisième personne)
  private readonly left: Arm;
  private readonly right: Arm;
  private readonly compass = new CompassModel();
  private readonly legs: THREE.Group[] = [];
  private readonly head = new THREE.Group();
  private vYaw = 0; // regard « retardé » que suivent les mains
  private vPitch = 0;
  private bodyYaw = 0;
  private raise = 0;
  private phase = 0; // phase de la marche
  private shadows = false;
  private first = true;

  constructor(parent: THREE.Object3D) {
    this.group.add(this.arms, this.body);
    this.left = new Arm('left', this.arms);
    this.right = new Arm('right', this.arms);
    this.left.hand.root.add(this.compass.group);
    this.compass.group.position.set(0, 0.07, -0.032); // posée sur la paume, côté doigts
    this.compass.group.scale.setScalar(1.3); // un peu plus grande qu'une boussole de poche : lisible à l'écran
    this.compass.group.rotation.set(0, Math.PI, 0); // le cadran regarde à l'opposé de la paume, le haut du cadran vers les doigts
    this.left.hand.setPose(HOLD_COMPASS);
    this.right.hand.setPose(RELAXED);
    this.buildBody();
    this.group.traverse((o) => (o.frustumCulled = false)); // les pièces bougent à chaque image : pas de découpage par la caméra
    parent.add(this.group);
  }

  // Corps provisoire : torse, tête, jambes en formes simples. Il sera remplacé par un vrai personnage plus tard.
  private buildBody(): void {
    const coat = new THREE.MeshStandardMaterial({ color: COAT, roughness: 0.9 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x3b3d4a, roughness: 0.9 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.8 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xd8a58c, roughness: 0.6 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.95 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.4, 5, 14), coat);
    torso.scale.z = 0.68;
    torso.position.y = 1.14;
    this.body.add(torso);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10), skin);
    neck.position.y = 1.5;
    this.body.add(neck);
    this.head.position.y = 1.62; // le centre de la tête (les yeux sont réglés à l'exécution)
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.105, 20, 16), skin);
    skull.scale.set(0.92, 1.08, 1);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    cap.scale.set(0.95, 1.1, 1.03);
    cap.position.y = 0.012;
    cap.rotation.x = -0.18;
    this.head.add(skull, cap);
    this.body.add(this.head);
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.095, 0.9, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.62, 4, 12), trousers);
      leg.position.y = -0.4;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, 0.26), boots);
      boot.position.set(0, -0.84, -0.04);
      hip.add(leg, boot);
      this.legs.push(hip);
      this.body.add(hip);
    }
  }

  // Les corps projettent une ombre seulement à la troisième personne (sinon des ombres de bras parasites).
  private setShadows(on: boolean): void {
    if (on === this.shadows) return;
    this.shadows = on;
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = on;
    });
  }

  update(f: AvatarFrame): void {
    const dt = clamp(f.dt, 0, 0.1);
    const third = f.blend > 0.02;
    if (this.first) {
      this.vYaw = f.yaw; // premier tour : pas de glissement depuis zéro
      this.vPitch = f.pitch;
      this.bodyYaw = f.yaw;
      this.first = false;
    }
    const k = 1 - Math.exp(-14 * dt);
    this.vYaw += wrapPi(f.yaw - this.vYaw) * k; // les mains suivent le regard avec un petit retard : elles ont du poids
    this.vPitch += (f.pitch - this.vPitch) * k;
    this.bodyYaw += wrapPi(f.yaw - this.bodyYaw) * (1 - Math.exp(-9 * dt));
    this.raise += (f.raise - this.raise) * (1 - Math.exp(-8 * dt));
    this.phase += dt * f.walkSpeed * 2.4; // un cycle de marche
    this.arms.visible = f.showHands || third;
    this.body.visible = third;
    this.setShadows(third);
    this.compass.setCard(f.compassCard);
    if (!this.arms.visible && !third) return;

    // Repère de la vue (cap + inclinaison atténuée + un peu du roulis du bateau).
    const qView = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.vPitch * 0.85, this.vYaw, f.roll * 0.5, 'YXZ'));
    const sway = clamp(f.walkSpeed / 4, 0, 1.5);
    const breathe = Math.sin(f.time * 1.4) * 0.0025;
    const toWorld = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyQuaternion(qView).add(f.eye);
    const rise = this.raise;

    // Main gauche : tient la boussole, la lève devant les yeux sur demande.
    const lx = lerp(-0.17, -0.055, rise) + Math.sin(this.phase) * 0.008 * sway;
    const ly = lerp(-0.295, -0.145, rise) + Math.sin(this.phase * 2) * 0.01 * sway + breathe;
    const lz = lerp(-0.4, -0.33, rise);
    const wristL = toWorld(lx, ly, lz);
    const qL = qView
      .clone()
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(lerp(0.45, 0.75, rise), 0, 0)))
      .multiply(Q0)
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)));
    this.left.hand.root.position.copy(wristL);
    this.left.hand.root.quaternion.copy(qL);

    // Main droite : détendue, balance doucement.
    const wristR = toWorld(0.2 + Math.sin(this.phase + Math.PI) * 0.008 * sway, -0.255 + Math.sin(this.phase * 2 + 1) * 0.01 * sway - breathe, -0.4);
    const qR = qView
      .clone()
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0, 0)))
      .multiply(Q0)
      .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -1.1, 0)));
    this.right.hand.root.position.copy(wristR);
    this.right.hand.root.quaternion.copy(qR);
    this.left.hand.setPose(blendPose(HOLD_COMPASS, HOLD_COMPASS, 0));
    this.right.hand.setPose(RELAXED);

    // Épaules : elles suivent le corps (cap seulement), pas la tête.
    const cy = Math.cos(this.bodyYaw);
    const sy = Math.sin(this.bodyYaw);
    const bodyRight = new THREE.Vector3(cy, 0, -sy);
    const bodyFwd = new THREE.Vector3(-sy, 0, -cy);
    const shoulder = (side: number): THREE.Vector3 => f.eye.clone().addScaledVector(bodyRight, side * 0.19).addScaledVector(bodyFwd, -0.07).add(new THREE.Vector3(0, -0.26, 0));
    const pole = (side: number): THREE.Vector3 => bodyRight.clone().multiplyScalar(side * 0.55).addScaledVector(bodyFwd, -0.5).add(new THREE.Vector3(0, -1, 0));
    this.left.pose(shoulder(-1), wristL, pole(-1));
    this.right.pose(shoulder(1), wristR, pole(1));

    // Corps provisoire.
    if (third) {
      const s = f.eyeHeight / 1.7; // accroupi : le corps se tasse
      this.body.position.set(f.eye.x, f.eye.y - f.eyeHeight, f.eye.z);
      this.body.rotation.y = this.bodyYaw;
      this.body.scale.set(1, s, 1);
      this.head.position.y = 1.7 - 0.07;
      this.head.rotation.x = clamp(f.pitch, -0.9, 0.9) * 0.7;
      const swing = Math.sin(this.phase) * clamp(f.walkSpeed / 3, 0, 1) * 0.7;
      this.legs[0]!.rotation.x = swing;
      this.legs[1]!.rotation.x = -swing;
    }
  }
}
