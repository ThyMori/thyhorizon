// Le voilier en 3D : coque, pont, cabine, mât, bôme, grand-voile, foc, barre, quille.
// Repère local du bateau : +X = tribord (droite), +Y = haut, −Z = avant. Le bateau tourne avec le cap (yaw) et penche avec la gîte.
// Les voiles sont recalculées à chaque image : elles gonflent du côté sous le vent et battent quand elles faseyent.

import * as THREE from 'three';
import { bottomHeight, deckHeight, halfBeam } from '../core/hull';
import type { BoatSpec, BoatState } from '../core/sailing';

// Passe des coordonnées « bateau » (avant, haut, tribord) aux coordonnées de la scène (x = tribord, y = haut, z = −avant).
const P = (u: number, y: number, v: number): THREE.Vector3 => new THREE.Vector3(v, y, -u);

const STATIONS = 28; // tranches de la coque, de l'arrière à l'étrave
const RING = 9; // points par demi-section
const MAST_U = 1.1; // position du mât (m, + vers l'avant)
const MAST_HEIGHT = 11.2; // hauteur du mât au-dessus du pont (m)
const BOOM_HEIGHT = 1.05; // hauteur de la bôme au-dessus du pont (m)
const BOOM_LENGTH = 3.6; // longueur de la bôme (m)
const SAIL_ROWS = 8; // lignes du maillage d'une voile
const SAIL_COLS = 8; // colonnes du maillage d'une voile

// Couleurs du bateau (matières 3D, pas de l'interface).
const COLORS = {
  hull: 0xe6e1d0, // coque : blanc cassé
  deck: 0xa88a5c, // pont : teck clair
  cabin: 0xd8d1bc, // roof de cabine
  glass: 0x20303c, // hublots
  mast: 0xb7bcc2, // mât et bôme : aluminium
  sail: 0xf2ead6, // voiles : écru
  keel: 0x2a3036, // quille et safran
  wood: 0x6b4a2c, // barre
};

// Un maillage de voile : triangle découpé en grille, dont les points sont recalculés à chaque image.
class SailMesh {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;

  constructor(material: THREE.Material) {
    const count = (SAIL_ROWS + 1) * (SAIL_COLS + 1); // nombre de sommets
    this.positions = new Float32Array(count * 3);
    const indices: number[] = [];
    for (let r = 0; r < SAIL_ROWS; r++) {
      for (let c = 0; c < SAIL_COLS; c++) {
        const a = r * (SAIL_COLS + 1) + c; // sommet en bas à gauche de la case
        const b = a + 1;
        const d = a + SAIL_COLS + 1;
        const e = d + 1;
        indices.push(a, b, d, b, e, d); // deux triangles par case
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setIndex(indices);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false; // la forme change à chaque image : pas de boîte englobante fiable
    this.mesh.castShadow = true;
  }

  // Remplit la voile entre ses trois coins. belly = creux (fraction de la corde), dir = côté du creux (−1..1 selon X),
  // flutter = amplitude du battement (0 = voile tendue), time = secondes.
  fill(tack: THREE.Vector3, head: THREE.Vector3, clew: THREE.Vector3, belly: number, dir: number, flutter: number, time: number): void {
    let k = 0;
    for (let r = 0; r <= SAIL_ROWS; r++) {
      const q = r / SAIL_ROWS; // hauteur relative : 0 en bas, 1 en haut
      const luffX = tack.x + (head.x - tack.x) * q; // point de l'envergure (bord d'attaque)
      const luffY = tack.y + (head.y - tack.y) * q;
      const luffZ = tack.z + (head.z - tack.z) * q;
      const leechX = clew.x + (head.x - clew.x) * q; // point de la chute (bord de fuite)
      const leechY = clew.y + (head.y - clew.y) * q;
      const leechZ = clew.z + (head.z - clew.z) * q;
      const chord = Math.hypot(leechX - luffX, leechZ - luffZ); // corde à cette hauteur
      for (let c = 0; c <= SAIL_COLS; c++) {
        const p = c / SAIL_COLS; // position le long de la corde
        const shape = Math.sin(Math.PI * p) * (1 - 0.45 * q); // forme du creux : max au milieu, moins en haut
        let x = luffX + (leechX - luffX) * p + dir * belly * chord * shape; // creux vers le côté sous le vent
        const y = luffY + (leechY - luffY) * p;
        const z = luffZ + (leechZ - luffZ) * p;
        x += flutter * 0.35 * p * p * Math.sin(time * 17 + q * 7 + p * 11) * (0.4 + q); // battement : surtout vers la chute
        this.positions[k++] = x;
        this.positions[k++] = y;
        this.positions[k++] = z;
      }
    }
    const attr = this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true; // la carte graphique recharge les sommets
    this.mesh.geometry.computeVertexNormals(); // lumière correcte sur les plis
  }
}

export class BoatView {
  readonly group = new THREE.Group();
  private readonly boomPivot = new THREE.Group(); // tourne avec la bôme
  private readonly tiller = new THREE.Group(); // tourne avec la barre
  private readonly mainsail: SailMesh;
  private readonly jib: SailMesh;
  private bellyDir = 1; // côté du creux, lissé pour que la voile passe par « plate » en changeant de bord
  private lastTime = 0;

  constructor(scene: THREE.Scene, private readonly spec: BoatSpec) {
    const std = (color: number, roughness = 0.75, side: THREE.Side = THREE.FrontSide): THREE.MeshStandardMaterial =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, side });
    const hullMat = std(COLORS.hull, 0.45, THREE.DoubleSide);
    const deckMat = std(COLORS.deck, 0.85);
    const sailMat = std(COLORS.sail, 0.95, THREE.DoubleSide);

    // Coque (flancs + tableau arrière) et pont.
    const hull = new THREE.Mesh(this.buildHull(), hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    const deck = new THREE.Mesh(this.buildDeck(), deckMat);
    deck.receiveShadow = true;
    this.group.add(hull, deck);

    // Cabine : un volume trapézoïdal posé sur le pont, avec une rangée de hublots.
    const cabinU0 = -0.9; // arrière de la cabine (m)
    const cabinU1 = 2.5; // avant de la cabine (m)
    const sCenter = (spec.length / 2 + (cabinU0 + cabinU1) / 2) / spec.length; // position relative du centre
    const cabinBase = deckHeight(sCenter) - 0.02; // hauteur du pont sous la cabine
    const cabinGeo = new THREE.BoxGeometry(1.9, 0.5, cabinU1 - cabinU0);
    const cabinPos = cabinGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < cabinPos.count; i++) {
      const front = Math.min(1, Math.max(0, (-cabinPos.getZ(i) / (cabinU1 - cabinU0)) + 0.5)); // 0 à l'arrière, 1 à l'avant de la cabine
      cabinPos.setX(i, cabinPos.getX(i) * (1 - 0.4 * front)); // la cabine se rétrécit vers l'avant
      if (cabinPos.getY(i) > 0) cabinPos.setY(i, cabinPos.getY(i) - 0.14 * front); // et son toit descend vers l'étrave
    }
    cabinGeo.computeVertexNormals();
    const cabin = new THREE.Mesh(cabinGeo, std(COLORS.cabin, 0.6));
    cabin.position.copy(P((cabinU0 + cabinU1) / 2, cabinBase + 0.25, 0));
    cabin.castShadow = true;
    cabin.receiveShadow = true;
    const glassMat = std(COLORS.glass, 0.2);
    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 2.2), glassMat);
      window.position.copy(P((cabinU0 + cabinU1) / 2, cabinBase + 0.28, side * 0.96));
      this.group.add(window);
    }
    this.group.add(cabin);

    // Mât.
    const mastBase = deckHeight((spec.length / 2 + MAST_U) / spec.length) + 0.3; // sur le roof
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, MAST_HEIGHT, 8), std(COLORS.mast, 0.4));
    mast.position.copy(P(MAST_U, mastBase + MAST_HEIGHT / 2, 0));
    mast.castShadow = true;
    this.group.add(mast);

    // Bôme (pivote autour du mât) et grand-voile qui y est accrochée.
    const boomY = mastBase + BOOM_HEIGHT;
    this.boomPivot.position.copy(P(MAST_U, boomY, 0));
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, BOOM_LENGTH, 6), std(COLORS.mast, 0.4));
    boom.rotation.x = Math.PI / 2; // le cylindre est couché le long de Z
    boom.position.set(0, 0, BOOM_LENGTH / 2); // la bôme part du mât vers l'arrière (+Z)
    boom.castShadow = true;
    this.boomPivot.add(boom);
    this.mainsail = new SailMesh(sailMat);
    this.boomPivot.add(this.mainsail.mesh);
    this.group.add(this.boomPivot);

    // Foc (dans le repère du bateau, ses coins sont recalculés à chaque image).
    this.jib = new SailMesh(sailMat);
    this.group.add(this.jib.mesh);

    // Étai (câble) du mât à l'étrave.
    const stay = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 4), std(COLORS.mast, 0.5));
    const stayTop = P(MAST_U, mastBase + MAST_HEIGHT - 0.4, 0);
    const stayBottom = P(spec.length / 2 - 0.3, deckHeight(0.97) + 0.05, 0);
    stay.position.copy(stayTop.clone().add(stayBottom).multiplyScalar(0.5));
    stay.scale.y = stayTop.distanceTo(stayBottom);
    stay.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), stayTop.clone().sub(stayBottom).normalize());
    this.group.add(stay);

    // Barre (à l'arrière) : une pièce de bois qui pivote avec le safran.
    const tillerBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.0), std(COLORS.wood, 0.7));
    tillerBar.position.set(0, 0, -0.5); // part de l'axe de safran vers l'avant (−Z)
    tillerBar.castShadow = true;
    this.tiller.add(tillerBar);
    this.tiller.position.copy(P(spec.rudderX + 0.1, deckHeight(0.06) + 0.32, 0));
    this.group.add(this.tiller);

    // Quille et safran, sous la flottaison.
    const keelMat = std(COLORS.keel, 0.6);
    const keel = new THREE.Mesh(new THREE.BoxGeometry(0.1, spec.draft - 0.35, 1.5), keelMat);
    keel.position.copy(P(spec.keelX, -(spec.draft - 0.35) / 2 - 0.35, 0));
    const rudderBlade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.0, 0.45), keelMat);
    rudderBlade.position.copy(P(spec.rudderX - 0.05, -0.55, 0));
    this.group.add(keel, rudderBlade);

    this.group.rotation.order = 'YXZ'; // cap d'abord, puis tangage, puis gîte (roulis)
    this.group.renderOrder = 5;
    scene.add(this.group);
  }

  // Place le bateau, penche et oriente ses pièces mobiles. y = hauteur de la surface de l'eau sous le bateau.
  update(s: BoatState, originX: number, originZ: number, y: number, timeSeconds: number): void {
    const dt = Math.min(0.1, Math.max(0, timeSeconds - this.lastTime));
    this.lastTime = timeSeconds;
    this.group.position.set(s.x - originX, y, s.z - originZ);
    this.group.rotation.set(0, s.yaw, -s.heel, 'YXZ'); // gîte positive à tribord : la voile penche vers X>0, donc rotation Z négative
    this.boomPivot.rotation.y = s.boom; // la bôme suit sa position (positive = vers tribord)
    this.tiller.rotation.y = s.rudder; // la barre : le bout avant va à bâbord quand le bateau tourne à tribord

    // Creux des voiles : côté sous le vent, qui change doucement au virement.
    this.bellyDir += (-s.side - this.bellyDir) * Math.min(1, dt * 4);
    const flutter = s.luff; // 0 (tendue) à 1 (bat au vent)
    const belly = 0.1 * (1 - 0.6 * flutter); // la voile qui bat est plus plate
    const mastTopLocal = new THREE.Vector3(0, MAST_HEIGHT - BOOM_HEIGHT - 0.3, 0.1); // point de drisse, dans le repère de la bôme
    this.mainsail.fill(new THREE.Vector3(0, 0.08, 0.05), mastTopLocal, new THREE.Vector3(0, 0.1, BOOM_LENGTH - 0.1), belly, this.bellyDir, flutter, timeSeconds);

    // Foc : l'avant (point d'amure) est à l'étrave, la tête au sommet du mât, l'écoute suit la bôme.
    const L = this.spec.length;
    const mastBase = deckHeight((L / 2 + MAST_U) / L) + 0.3;
    const tack = P(L / 2 - 0.5, deckHeight(0.96) + 0.25, 0); // point d'amure, sur le pont à l'avant
    const head = P(MAST_U + 0.05, mastBase + MAST_HEIGHT - 0.7, 0); // point de drisse, haut du mât
    const clewAngle = s.boom * 0.95; // le foc s'ouvre comme la grand-voile, un peu moins
    const sheetLength = 3.9; // distance entre le point d'amure et le point d'écoute (m)
    const clew = P(L / 2 - 0.5 - Math.cos(clewAngle) * sheetLength, deckHeight(0.55) + 0.9, Math.sin(clewAngle) * sheetLength);
    this.jib.fill(tack, head, clew, belly * 1.1, this.bellyDir, flutter, timeSeconds + 1.7);
    this.group.updateMatrixWorld(true); // pour que eyeWorld() lise une matrice à jour
  }

  // Position des yeux du barreur dans le monde (coordonnées absolues).
  eyeWorld(originX: number, originZ: number): THREE.Vector3 {
    const eye = this.group.localToWorld(P(this.spec.eyeU, this.spec.eyeHeight, 0)); // position scène (relative à l'origine flottante)
    return eye.add(new THREE.Vector3(originX, 0, originZ)); // on revient aux coordonnées du monde
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  // La coque : une peau lissée entre les sections, plus le tableau arrière.
  private buildHull(): THREE.BufferGeometry {
    const spec = this.spec;
    const verts: number[] = [];
    const idx: number[] = [];
    const ringSize = RING * 2 + 1; // points d'une section complète (bâbord → quille → tribord)
    for (let i = 0; i <= STATIONS; i++) {
      const s = i / STATIONS; // arrière 0 → étrave 1
      const u = -spec.length / 2 + s * spec.length; // position le long du bateau
      const b = halfBeam(spec, s);
      const top = deckHeight(s);
      const bot = bottomHeight(s);
      for (let j = -RING; j <= RING; j++) {
        const t = j / RING; // -1 (bâbord, haut) → 0 (quille) → +1 (tribord, haut)
        const theta = Math.abs(t) * (Math.PI / 2);
        const v = Math.sign(t) * b * Math.sin(theta); // largeur : arrondie au bouchain
        const yy = bot + (top - bot) * (1 - Math.cos(theta)); // hauteur : du fond au plat-bord
        const p = P(u, yy, v);
        verts.push(p.x, p.y, p.z);
      }
    }
    for (let i = 0; i < STATIONS; i++) {
      for (let j = 0; j < ringSize - 1; j++) {
        const a = i * ringSize + j;
        const b = a + 1;
        const c = a + ringSize;
        const d = c + 1;
        idx.push(a, c, b, b, c, d); // deux triangles par case
      }
    }
    // Tableau arrière : on ferme la première section avec un éventail autour de son centre.
    const center = verts.length / 3;
    const topMid = P(-spec.length / 2, (deckHeight(0) + bottomHeight(0)) / 2, 0);
    verts.push(topMid.x, topMid.y, topMid.z);
    for (let j = 0; j < ringSize - 1; j++) idx.push(center, j + 1, j);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Le pont : une bande plate qui suit le plat-bord.
  private buildDeck(): THREE.BufferGeometry {
    const spec = this.spec;
    const verts: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= STATIONS; i++) {
      const s = i / STATIONS;
      const u = -spec.length / 2 + s * spec.length;
      const b = halfBeam(spec, s) * 0.97; // un peu en retrait du plat-bord : pas de scintillement avec la coque
      const y = deckHeight(s) + 0.005;
      const l = P(u, y, -b);
      const r = P(u, y, b);
      verts.push(l.x, l.y, l.z, r.x, r.y, r.z);
    }
    for (let i = 0; i < STATIONS; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // sens des triangles : normale vers le haut
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
}
