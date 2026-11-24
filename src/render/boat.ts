// Le voilier en 3D : assemble les pièces fixes (render/boatParts.ts) et anime ce qui bouge :
// bôme, voiles (creux, battement), barre à roue, écoute de grand-voile.
// Repère local du bateau : +X = tribord (droite), +Y = haut, −Z = avant. Le bateau tourne avec le cap (yaw) et penche avec la gîte.

import * as THREE from 'three';
import { LAYOUT, bottomHeight, deckHeight, roofHeight, stationOf } from '../core/hull';
import { mainHeight, penonFlow } from '../core/sailing';
import type { BoatSpec, BoatState } from '../core/sailing';
import type { Wind } from '../core/wind';
import { Penons } from './penons';
import { deckTexture, teakTexture } from './boatTextures';
import { P, box, buildCabin, buildCockpitFloor, buildCockpitWalls, buildDeck, buildKeel, buildLifelines, buildMast, buildRigging, buildToeRail, cabinWindow, cylinderBetween, hullBand, merge, transom } from './boatParts';

const SAIL_ROWS = 10; // lignes du maillage d'une voile
const SAIL_COLS = 8; // colonnes du maillage d'une voile
const BATTENS = [0.2, 0.4, 0.6, 0.8]; // hauteurs relatives des lattes de la grand-voile

// Couleurs du bateau (matières 3D, pas de l'interface).
const COLORS = {
  gelcoat: 0xf1eee4, // coque blanche
  antifoul: 0x7a2c26, // carène : antifouling rouge brique
  navy: 0x1c3452, // liserés bleu marine
  deck: 0xece8dc, // pont
  cabin: 0xf0ece0, // rouf
  glass: 0x15222d, // hublots
  alu: 0xc7ccd1, // mât, bôme
  steel: 0xb5bbc1, // accastillage inox
  sail: 0xf4efe0, // voiles : écru
  keel: 0x2b3238, // quille
  dark: 0x12171c, // intérieur sombre de l'entrée de cabine
  batten: 0x8a8880, // lattes
};

// Un maillage de voile : triangle découpé en grille, recalculé à chaque image (creux et battement).
class SailMesh {
  readonly mesh: THREE.Mesh;
  readonly battens: THREE.LineSegments | null;
  private readonly positions: Float32Array;
  private readonly battenPositions: Float32Array | null;

  constructor(material: THREE.Material, withBattens: boolean) {
    const count = (SAIL_ROWS + 1) * (SAIL_COLS + 1);
    this.positions = new Float32Array(count * 3);
    const indices: number[] = [];
    for (let r = 0; r < SAIL_ROWS; r++) {
      for (let c = 0; c < SAIL_COLS; c++) {
        const a = r * (SAIL_COLS + 1) + c;
        const b = a + 1;
        const d = a + SAIL_COLS + 1;
        const e = d + 1;
        indices.push(a, b, d, b, e, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setIndex(indices);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    if (withBattens) {
      this.battenPositions = new Float32Array(BATTENS.length * 2 * 3);
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.BufferAttribute(this.battenPositions, 3));
      this.battens = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: COLORS.batten }));
      this.battens.frustumCulled = false;
    } else {
      this.battenPositions = null;
      this.battens = null;
    }
  }

  // Donne le point de la voile à la hauteur q et à la position p de la corde (0 à 1), tel que calculé à la dernière image.
  sample(q: number, p: number, out: THREE.Vector3): void {
    const r = Math.min(SAIL_ROWS, Math.max(0, Math.round(q * SAIL_ROWS)));
    const c = Math.min(SAIL_COLS, Math.max(0, Math.round(p * SAIL_COLS)));
    const k = (r * (SAIL_COLS + 1) + c) * 3;
    out.set(this.positions[k]!, this.positions[k + 1]!, this.positions[k + 2]!);
  }

  // Remplit la voile entre ses trois coins. belly = creux (fraction de la corde), dir = côté du creux,
  // flutter = battement (0 = tendue), time = secondes.
  fill(tack: THREE.Vector3, head: THREE.Vector3, clew: THREE.Vector3, belly: number, dir: number, flutter: number, time: number): void {
    let k = 0;
    for (let r = 0; r <= SAIL_ROWS; r++) {
      const q = r / SAIL_ROWS;
      const luffX = tack.x + (head.x - tack.x) * q;
      const luffY = tack.y + (head.y - tack.y) * q;
      const luffZ = tack.z + (head.z - tack.z) * q;
      // la chute (bord de fuite) est légèrement bombée (le « rond de chute » de la grand-voile)
      const roach = this.battens ? 0.18 * Math.sin(Math.PI * q) : 0;
      const leechX = clewLerp(clew.x, head.x, q);
      const leechY = clewLerp(clew.y, head.y, q);
      const leechZ = clewLerp(clew.z, head.z, q) + roach;
      const chord = Math.hypot(leechX - luffX, leechZ - luffZ);
      for (let c = 0; c <= SAIL_COLS; c++) {
        const p = c / SAIL_COLS;
        const shape = Math.sin(Math.PI * p * 0.92 + 0.12) * (1 - 0.45 * q); // creux maximal au tiers avant de la corde
        let x = luffX + (leechX - luffX) * p + dir * belly * chord * shape;
        const y = luffY + (leechY - luffY) * p;
        const z = luffZ + (leechZ - luffZ) * p;
        x += flutter * 0.35 * p * p * Math.sin(time * 17 + q * 7 + p * 11) * (0.4 + q);
        this.positions[k++] = x;
        this.positions[k++] = y;
        this.positions[k++] = z;
      }
    }
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
    if (this.battenPositions && this.battens) {
      // lattes : de la chute vers l'intérieur de la voile, aux hauteurs voulues (on lit les sommets déjà calculés)
      BATTENS.forEach((q, i) => {
        const row = Math.round(q * SAIL_ROWS) * (SAIL_COLS + 1);
        const outer = (row + SAIL_COLS) * 3;
        const inner = (row + SAIL_COLS - 2) * 3;
        for (let a = 0; a < 3; a++) {
          this.battenPositions![i * 6 + a] = this.positions[outer + a]!;
          this.battenPositions![i * 6 + 3 + a] = this.positions[inner + a]!;
        }
      });
      (this.battens.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

const clewLerp = (a: number, b: number, t: number): number => a + (b - a) * t; // de la mi-hauteur à la tête de la chute

export class BoatView {
  readonly group = new THREE.Group();
  private readonly boomPivot = new THREE.Group(); // tourne avec la bôme
  private readonly wheel = new THREE.Group(); // roue de barre : tourne avec le safran
  private readonly mainsail: SailMesh;
  private readonly jib: SailMesh;
  private readonly penons = new Penons(); // rubans de la grand-voile
  private readonly mainBundle: THREE.Mesh; // grand-voile affalée, pliée sur la bôme
  private readonly jibRoll: THREE.Mesh; // foc roulé sur l'étai
  private readonly tmpA = new THREE.Vector3(); // vecteurs de travail
  private readonly tmpB = new THREE.Vector3();
  private readonly mainsheet: THREE.Mesh; // l'écoute de grand-voile : suit la bôme
  private bellyDir = 1;
  private lastTime = 0;

  constructor(scene: THREE.Scene, private readonly spec: BoatSpec) {
    const std = (color: number, roughness = 0.6, metalness = 0, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness, side });
    const gel = std(COLORS.gelcoat, 0.28);
    const antifoul = std(COLORS.antifoul, 0.8);
    const navy = std(COLORS.navy, 0.3);
    const stripePolygon = (m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => {
      m.polygonOffset = true; // les liserés collés à la coque ne « clignotent » pas avec elle
      m.polygonOffsetFactor = -2;
      m.polygonOffsetUnits = -2;
      return m;
    };
    const teakMat = new THREE.MeshStandardMaterial({ map: teakTexture(), roughness: 0.75 });
    const plainTeak = std(0xa5733f, 0.75);
    const deckMat = new THREE.MeshStandardMaterial({ map: deckTexture(), roughness: 0.65 });
    const metal = std(COLORS.steel, 0.35, 0.45);
    const aluMat = std(COLORS.alu, 0.4, 0.4);
    const addMesh = (geometry: THREE.BufferGeometry, material: THREE.Material, cast = true, receive = true): THREE.Mesh => {
      const m = new THREE.Mesh(geometry, material);
      m.castShadow = cast;
      m.receiveShadow = receive;
      this.group.add(m);
      return m;
    };

    // --- Coque : carène (antifouling), œuvres mortes (blanc), liserés, tableau arrière ---
    addMesh(hullBand(spec, (_s, bot) => bot, () => 0, 0), antifoul, false);
    addMesh(hullBand(spec, () => 0, (_s, _b, top) => top, 0), gel);
    addMesh(hullBand(spec, () => 0, () => 0.07, 0.004), stripePolygon(std(COLORS.navy, 0.4)), false, false); // ligne de flottaison
    addMesh(hullBand(spec, (_s, _b, top) => top - 0.3, (_s, _b, top) => top - 0.17, 0.004), stripePolygon(navy), false, false); // liseré de livet
    addMesh(transom(spec, (bot) => bot, () => 0), antifoul, false);
    addMesh(transom(spec, () => 0, (_bot, top) => top), gel);
    addMesh(transom(spec, (_bot, top) => top - 0.3, (_bot, top) => top - 0.17, 0.004), stripePolygon(navy), false, false);

    // --- Pont, liston, rambardes, cockpit ---
    addMesh(buildDeck(spec), deckMat, false, true);
    addMesh(buildToeRail(spec), plainTeak, false, false);
    addMesh(buildLifelines(spec), metal, false, false);
    addMesh(buildCockpitFloor(), teakMat, false, true);
    const cockpit = buildCockpitWalls(spec);
    addMesh(cockpit.walls, gel, true, true);
    addMesh(cockpit.teak, plainTeak, true, true);

    // --- Rouf, hublots, entrée de descente ---
    const cabinMat = std(COLORS.cabin, 0.5);
    addMesh(buildCabin(spec), cabinMat);
    const glass = std(COLORS.glass, 0.15, 0.3);
    glass.side = THREE.DoubleSide;
    for (const side of [-1, 1] as const) {
      for (const u of [-0.1, 0.8, 1.7]) {
        const w = cabinWindow(spec, side, u);
        w.material = glass;
        this.group.add(w);
      }
    }
    const k = LAYOUT.cockpit;
    const door = 0.62; // largeur de l'entrée
    const doorTop = roofHeight(spec, LAYOUT.cabin.u0) - 0.1;
    addMesh(box(door, doorTop - k.floor, 0.02, LAYOUT.cabin.u0 - 0.065, (doorTop + k.floor) / 2, 0), std(COLORS.dark, 0.9), false, false); // l'entrée sombre : la future cabine
    addMesh(box(door + 0.12, 0.05, 0.08, LAYOUT.cabin.u0 - 0.06, doorTop + 0.03, 0), plainTeak, false, false); // linteau de teck
    // écoutille de pont et aérateur
    const hatchY = roofHeight(spec, 1.6) + 0.025;
    addMesh(box(0.55, 0.05, 0.55, 1.6, hatchY, 0), std(0x2a3b4a, 0.2, 0.2), false, false);
    const vent = new THREE.CylinderGeometry(0.06, 0.06, 0.14, 8);
    vent.translate(0.45, roofHeight(spec, 0.2) + 0.07, -0.2);
    addMesh(vent, metal, false, false);

    // --- Mât, gréement, bôme ---
    addMesh(buildMast(spec), aluMat);
    addMesh(buildRigging(spec), std(0x2d3238, 0.5, 0.5), false, false);
    const roof = roofHeight(spec, LAYOUT.mastU);
    this.boomPivot.position.copy(P(LAYOUT.mastU, roof + LAYOUT.boomHeight, 0));
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, LAYOUT.boomLength, 8), aluMat);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 0, LAYOUT.boomLength / 2);
    boom.castShadow = true;
    this.boomPivot.add(boom);
    const sailMat = new THREE.MeshStandardMaterial({ color: COLORS.sail, roughness: 0.92, side: THREE.DoubleSide });
    this.mainsail = new SailMesh(sailMat, true);
    this.boomPivot.add(this.mainsail.mesh);
    if (this.mainsail.battens) this.boomPivot.add(this.mainsail.battens);
    this.boomPivot.add(this.penons.group);
    this.mainBundle = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), sailMat);
    this.mainBundle.rotation.x = Math.PI / 2; // couché le long de la bôme
    this.mainBundle.castShadow = true;
    this.boomPivot.add(this.mainBundle);
    this.group.add(this.boomPivot);
    this.jib = new SailMesh(sailMat, false);
    this.group.add(this.jib.mesh);
    this.jibRoll = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), sailMat);
    this.jibRoll.castShadow = true;
    this.group.add(this.jibRoll);
    // enrouleur de foc à l'étrave
    const drum = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10);
    drum.translate(0, deckHeight(0.97) + 0.25, -(spec.length / 2 - 0.45));
    addMesh(drum, metal, false, false);

    // --- Écoute de grand-voile : un fil de la bôme au pied du cockpit ---
    this.mainsheet = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 4), std(0x2a2a2a, 0.8));
    this.group.add(this.mainsheet);

    // --- Poste de barre : piédestal, roue, compas ---
    const pedestal = new THREE.CylinderGeometry(0.07, 0.09, 0.95, 10);
    pedestal.translate(0, k.floor + 0.475, -LAYOUT.wheelU);
    addMesh(pedestal, metal, true, false);
    const compass = new THREE.SphereGeometry(0.09, 10, 8);
    compass.translate(0, k.floor + 1.0, -LAYOUT.wheelU + 0.03);
    addMesh(compass, std(0x1b1f24, 0.3), false, false);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.02, 6, 24), std(0x2a2a2a, 0.6));
    rim.castShadow = true;
    const spokes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      spokes.push(cylinderBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.31, Math.sin(a) * 0.31, 0), 0.012, 4));
    }
    const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.05, 10);
    hub.rotateX(Math.PI / 2);
    spokes.push(hub);
    const spokesMesh = new THREE.Mesh(merge(spokes), metal);
    this.wheel.add(rim, spokesMesh);
    this.wheel.position.copy(P(LAYOUT.wheelU, k.floor + 1.0, 0));
    const wheelBase = new THREE.Group(); // la roue est légèrement inclinée vers le barreur
    wheelBase.position.copy(this.wheel.position);
    wheelBase.rotation.x = -0.45;
    this.wheel.position.set(0, 0, 0);
    wheelBase.add(this.wheel);
    this.group.add(wheelBase);

    // --- Winches sur les listons du cockpit ---
    const winch = merge([-1, 1].map((side) => {
      const g = new THREE.CylinderGeometry(0.06, 0.07, 0.1, 10);
      g.translate(side * (k.half + 0.05), deckHeight(stationOf(spec, -2.6)) + 0.08, -(-2.6));
      return g;
    }));
    addMesh(winch, metal, true, false);

    // --- Proue : davier, treuil de mouillage, ancre simplifiée ---
    const bowU = spec.length / 2 - 0.5;
    const roller = merge([box(0.12, 0.05, 0.55, bowU - 0.1, deckHeight(0.98) + 0.08, 0), box(0.14, 0.12, 0.14, bowU - 1.0, deckHeight(0.9) + 0.07, 0)]);
    addMesh(roller, metal, true, false);

    // --- Feux de navigation (rouge à bâbord, vert à tribord, blanc à l'arrière) ---
    const lamp = (color: number, u: number, y: number, v: number): void => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color }));
      m.position.copy(P(u, y, v));
      this.group.add(m);
    };
    const lampY = deckHeight(0.92) + 0.4;
    lamp(0xff3030, spec.length / 2 - 0.9, lampY, -0.45);
    lamp(0x30ff60, spec.length / 2 - 0.9, lampY, 0.45);
    lamp(0xffffff, -spec.length / 2 + 0.2, deckHeight(0.01) + 0.75, 0);

    // --- Quille et safran ---
    const keels = buildKeel(spec);
    const keelMat = std(COLORS.keel, 0.6);
    addMesh(keels.keel, keelMat, false, false);
    addMesh(keels.rudder, keelMat, false, false);

    // Le bas de coque doit aussi masquer l'eau transparente proprement : rien de plus à faire ici.
    void bottomHeight;
    this.group.rotation.order = 'YXZ';
    this.group.renderOrder = 5;
    scene.add(this.group);
  }

  // Place le bateau, oriente ses pièces mobiles. y = hauteur de la surface de l'eau sous le bateau.
  update(s: BoatState, wind: Wind, originX: number, originZ: number, y: number, timeSeconds: number, pitch = 0, roll = 0): void {
    const dt = Math.min(0.1, Math.max(0, timeSeconds - this.lastTime));
    this.lastTime = timeSeconds;
    this.group.position.set(s.x - originX, y, s.z - originZ);
    this.group.rotation.set(pitch, s.yaw, -(s.heel + roll), 'YXZ'); // gîte positive à tribord : rotation Z négative ; tangage (étrave en haut > 0) et roulis dus aux vagues en plus
    this.boomPivot.rotation.y = s.boom;
    this.wheel.rotation.z = -s.rudder * 4; // la roue tourne dans le sens du virage (plus que le safran : démultiplication)

    // Creux des voiles : côté sous le vent, qui change doucement au virement.
    this.bellyDir += (-s.side - this.bellyDir) * Math.min(1, dt * 4);
    const flutter = s.luff;
    const belly = 0.1 * (1 - 0.6 * flutter);
    const L = this.spec.length;
    const roof = roofHeight(this.spec, LAYOUT.mastU);
    const h = mainHeight(s); // hauteur utile de la grand-voile : hissée et réduite par les ris
    const headLocal = new THREE.Vector3(0, 0.1 + (LAYOUT.mastHeight - LAYOUT.boomHeight - 0.45 - 0.1) * h, 0.06 * h);
    this.mainsail.mesh.visible = h > 0.04;
    this.mainsail.fill(new THREE.Vector3(0, 0.1, 0.05), headLocal, new THREE.Vector3(0, 0.12, LAYOUT.boomLength - 0.12), belly, this.bellyDir, flutter, timeSeconds);
    // grand-voile affalée : un paquet de toile sur la bôme (il grossit quand la voile descend)
    const folded = Math.min(1, Math.max(0, (0.5 - h) / 0.5));
    this.mainBundle.visible = folded > 0.02;
    const radius = 0.03 + 0.14 * folded;
    this.mainBundle.scale.set(radius, (LAYOUT.boomLength - 0.5) * (0.5 + 0.5 * folded), radius * 1.4);
    this.mainBundle.position.set(0, 0.07 + radius, 0.25 + (LAYOUT.boomLength - 0.5) * (0.25 + 0.25 * folded));
    this.penons.group.visible = h > 0.25; // pas de penons sur une voile presque affalée

    this.penons.update((q, p, out) => this.mainsail.sample(q, p, out), penonFlow(s, wind), s.side, timeSeconds);

    // Foc : l'étai donne le bord d'attaque ; l'écoute suit la bôme.
    const tack = P(L / 2 - 0.5, deckHeight(0.96) + 0.3, 0);
    const head = P(LAYOUT.mastU + 0.05, roof + LAYOUT.mastHeight - 0.9, 0);
    const clewAngle = s.boom * 0.95;
    const sheetLength = 3.9;
    const clewFull = P(L / 2 - 0.5 - Math.cos(clewAngle) * sheetLength, deckHeight(0.55) + 0.9, Math.sin(clewAngle) * sheetLength);
    // foc roulé : l'écoute remonte vers l'étai ; la toile s'enroule autour de l'étai (le guindant garde sa longueur)
    const tClew = (clewFull.y - tack.y) / (head.y - tack.y); // hauteur relative du point d'écoute sur l'étai
    const luffAtClew = tack.clone().lerp(head, tClew);
    const jibOut = Math.min(1, Math.max(0, s.jibOut));
    const clew = luffAtClew.clone().lerp(clewFull, jibOut);
    this.jibRoll.visible = true;
    this.jib.mesh.visible = jibOut > 0.03;
    this.jib.fill(tack, head, clew, belly * 1.1, this.bellyDir, flutter, timeSeconds + 1.7);
    // le rouleau de toile le long de l'étai
    const rollR = 0.035 + 0.07 * (1 - jibOut);
    this.tmpA.copy(head).sub(tack);
    const rollLen = this.tmpA.length();
    this.tmpB.copy(tack).addScaledVector(this.tmpA, 0.5);
    this.jibRoll.position.copy(this.tmpB);
    this.jibRoll.scale.set(rollR, rollLen * 0.96, rollR);
    this.jibRoll.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmpA.normalize());

    // Écoute de grand-voile : de l'extrémité de la bôme au chariot, devant la roue.
    const boomEnd = P(LAYOUT.mastU, roof + LAYOUT.boomHeight, 0).add(new THREE.Vector3(Math.sin(s.boom) * (LAYOUT.boomLength - 0.3), -0.05, Math.cos(s.boom) * (LAYOUT.boomLength - 0.3)));
    const traveler = P(-1.6, LAYOUT.cockpit.floor + 0.3, 0.0);
    const dir = boomEnd.clone().sub(traveler);
    this.mainsheet.position.copy(traveler.clone().add(boomEnd).multiplyScalar(0.5));
    this.mainsheet.scale.y = dir.length();
    this.mainsheet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.group.updateMatrixWorld(true);
  }

  // Position des yeux du barreur dans le monde (coordonnées absolues).
  eyeWorld(originX: number, originZ: number, u: number = this.spec.eyeU, h: number = this.spec.eyeHeight, v = 0): THREE.Vector3 {
    const eye = this.group.localToWorld(P(u, h, v));
    return eye.add(new THREE.Vector3(originX, 0, originZ));
  }

  // Le joueur est à bord : il voit les penons des deux côtés de la voile.
  setAboard(aboard: boolean): void {
    this.penons.setSeeThrough(aboard);
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }
}
