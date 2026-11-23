// Les constellations : les traits qui relient les étoiles. Logique pure : fabrique les tableaux pour la carte graphique.

// Un trait : ascension droite et déclinaison (°) de ses deux extrémités.
export type Segment = readonly [number, number, number, number];

export interface LineBuffers {
  positions: Float32Array; // 2 extrémités × 3 nombres par trait, sur une sphère de rayon donné (repère équatorial)
  seeds: Float32Array; // 2 nombres identiques par trait (0 à 1) : sert à décaler le scintillement d'un trait à l'autre
}

// Position sur la sphère d'une ascension droite et d'une déclinaison.
const onSphere = (raDeg: number, decDeg: number, radius: number): [number, number, number] => {
  const a = (raDeg * Math.PI) / 180;
  const d = (decDeg * Math.PI) / 180;
  return [Math.cos(d) * Math.cos(a) * radius, Math.cos(d) * Math.sin(a) * radius, Math.sin(d) * radius]; // même repère que les étoiles
};

// Nombre pseudo-aléatoire stable (0 à 1) pour un entier : même trait → même valeur.
export const seedOf = (index: number): number => {
  const s = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

export function buildLineBuffers(segments: readonly Segment[], radius: number): LineBuffers {
  const positions = new Float32Array(segments.length * 6);
  const seeds = new Float32Array(segments.length * 2);
  segments.forEach(([ra1, dec1, ra2, dec2], i) => {
    positions.set(onSphere(ra1, dec1, radius), i * 6);
    positions.set(onSphere(ra2, dec2, radius), i * 6 + 3);
    seeds[i * 2] = seeds[i * 2 + 1] = seedOf(i);
  });
  return { positions, seeds };
}
