// Le modèle 3D de la boussole : boîtier en laiton, rose des vents qui tourne sous une vitre, trait de visée fixe, repères lumineux pour la nuit.
// Repère : le cadran est dans le plan XY, tourné vers +Z ; le haut du cadran (+Y) est l'avant, c'est là que se lit le cap.

import * as THREE from 'three';

const CARD_PX = 512;

// Dessine la rose : fond crème, graduations de 5 en 5°, chiffres tous les 30°, N E S O, aiguille (moitié nord rouge). Renvoie la texture normale et la texture lumineuse.
function drawCard(): { card: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const make = (): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } => {
    const c = document.createElement('canvas');
    c.width = CARD_PX;
    c.height = CARD_PX;
    return { c, g: c.getContext('2d')! };
  };
  const a = make();
  const b = make();
  const R = CARD_PX / 2;
  const grad = a.g.createRadialGradient(R, R, R * 0.2, R, R, R); // un peu plus sombre vers le bord : relief du cadran
  grad.addColorStop(0, '#f1ebd6');
  grad.addColorStop(1, '#d9d0b4');
  a.g.fillStyle = grad;
  a.g.fillRect(0, 0, CARD_PX, CARD_PX);
  b.g.fillStyle = '#000';
  b.g.fillRect(0, 0, CARD_PX, CARD_PX);
  for (let deg = 0; deg < 360; deg += 5) {
    const long = deg % 30 === 0;
    const mid = deg % 10 === 0;
    const r0 = R * 0.965;
    const r1 = R * (long ? 0.86 : mid ? 0.9 : 0.93);
    a.g.save();
    a.g.translate(R, R);
    a.g.rotate((deg * Math.PI) / 180);
    a.g.strokeStyle = '#1a1a1a';
    a.g.lineWidth = long ? 5 : mid ? 3 : 2;
    a.g.beginPath();
    a.g.moveTo(0, -r0);
    a.g.lineTo(0, -r1);
    a.g.stroke();
    if (long) {
      a.g.fillStyle = '#1a1a1a';
      a.g.font = `bold ${Math.round(R * 0.095)}px sans-serif`;
      a.g.textAlign = 'center';
      a.g.textBaseline = 'middle';
      if (deg % 90 !== 0) a.g.fillText(String(deg), 0, -R * 0.79); // les points cardinaux ont leur lettre plus bas
    }
    a.g.restore();
  }
  // Points cardinaux : N rouge, E S O noirs, au pied de la graduation.
  const cardinals: [string, number][] = [['N', 0], ['E', 90], ['S', 180], ['O', 270]];
  for (const [txt, deg] of cardinals) {
    for (const ctx of [a.g, b.g]) {
      ctx.save();
      ctx.translate(R, R);
      ctx.rotate((deg * Math.PI) / 180);
      ctx.font = `bold ${Math.round(R * (txt === 'N' ? 0.24 : 0.19))}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = ctx === a.g ? (txt === 'N' ? '#c1281f' : '#1a1a1a') : txt === 'N' ? '#b8ffb0' : '#000';
      ctx.fillText(txt, 0, -R * 0.74);
      ctx.restore();
    }
  }
  // Aiguille : losange, pointe nord rouge, pointe sud blanche ; la pointe nord brille la nuit.
  const needle = (g: CanvasRenderingContext2D, north: string, south: string): void => {
    g.save();
    g.translate(R, R);
    g.fillStyle = north;
    g.beginPath();
    g.moveTo(0, -R * 0.56);
    g.lineTo(R * 0.045, 0);
    g.lineTo(-R * 0.045, 0);
    g.closePath();
    g.fill();
    g.fillStyle = south;
    g.beginPath();
    g.moveTo(0, R * 0.56);
    g.lineTo(R * 0.045, 0);
    g.lineTo(-R * 0.045, 0);
    g.closePath();
    g.fill();
    g.restore();
  };
  needle(a.g, '#c1281f', '#f4f4f0');
  needle(b.g, '#9cff9c', '#000');
  a.g.fillStyle = '#444'; // axe central
  a.g.beginPath();
  a.g.arc(R, R, R * 0.035, 0, Math.PI * 2);
  a.g.fill();
  // Repères lumineux discrets aux quatre points cardinaux (graduation) pour la lecture de nuit.
  for (let deg = 0; deg < 360; deg += 90) {
    b.g.save();
    b.g.translate(R, R);
    b.g.rotate((deg * Math.PI) / 180);
    b.g.fillStyle = '#9cff9c';
    b.g.fillRect(-4, -R * 0.965, 8, R * 0.1);
    b.g.restore();
  }
  const card = new THREE.CanvasTexture(a.c);
  const glow = new THREE.CanvasTexture(b.c);
  card.colorSpace = THREE.SRGBColorSpace;
  glow.colorSpace = THREE.SRGBColorSpace;
  card.anisotropy = 4;
  return { card, glow };
}

export class CompassModel {
  readonly group = new THREE.Group(); // origine = centre du boîtier
  private readonly rose = new THREE.Group(); // la rose, qui tourne

  constructor() {
    const brass = new THREE.MeshStandardMaterial({ color: 0xb39255, roughness: 0.38, metalness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4a3a20, roughness: 0.5, metalness: 0.4 });
    const tex = drawCard();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.012, 40), brass); // boîtier
    body.rotation.x = Math.PI / 2; // l'axe du cylindre devient Z
    this.group.add(body);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0315, 0.0032, 10, 44), dark); // lunette
    bezel.position.z = 0.0065;
    this.group.add(bezel);
    const card = new THREE.Mesh(
      new THREE.CircleGeometry(0.0295, 56),
      new THREE.MeshStandardMaterial({ map: tex.card, emissiveMap: tex.glow, emissive: new THREE.Color(0x66ff80), emissiveIntensity: 0.55, roughness: 0.85 }),
    );
    card.position.z = 0.0062;
    this.rose.add(card);
    this.group.add(this.rose);
    const glass = new THREE.Mesh(
      new THREE.CircleGeometry(0.0298, 40),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, roughness: 0.05, metalness: 0.2, depthWrite: false }),
    );
    glass.position.z = 0.0072;
    this.group.add(glass);
    const lubber = new THREE.Mesh(new THREE.PlaneGeometry(0.0016, 0.012), new THREE.MeshBasicMaterial({ color: 0xd22a1e })); // trait de visée : fixe, au bord du cadran
    lubber.position.set(0, 0.0235, 0.0074);
    this.group.add(lubber);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.007, 0.0017, 8, 20), brass); // anneau de suspension
    loop.position.set(0, 0.0405, 0);
    this.group.add(loop);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.008, 12), brass); // poussoir
    crown.position.set(0, 0.0365, 0);
    this.group.add(crown);
  }

  // Tourne la rose : `card` = angle du nord par rapport à l'avant (sens horaire vu du joueur) → rotation inverse autour de +Z.
  setCard(card: number): void {
    this.rose.rotation.z = -card;
  }
}
