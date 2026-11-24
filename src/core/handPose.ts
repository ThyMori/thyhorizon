// Les poses de la main : de combien chaque articulation de chaque doigt se plie. Logique pure (aucun dessin ici).
// Angles en radians, 0 = doigt tendu, positif = plié vers la paume. Un doigt a trois articulations (base, milieu, bout).

export type Joints = [number, number, number];

export interface HandPose {
  fingers: [Joints, Joints, Joints, Joints]; // index, majeur, annulaire, auriculaire
  spread: [number, number, number, number]; // écartement latéral de chaque doigt (rad, positif = vers l'auriculaire)
  thumb: Joints; // pouce : base, articulation du milieu, bout
  thumbSwing: number; // pouce plus ou moins écarté de la paume (rad)
}

// Main détendue, doigts à peine pliés (la main libre qui pend).
export const RELAXED: HandPose = {
  fingers: [[0.32, 0.38, 0.22], [0.4, 0.46, 0.26], [0.5, 0.52, 0.3], [0.58, 0.55, 0.32]],
  spread: [-0.05, 0, 0.05, 0.12],
  thumb: [0.15, 0.2, 0.15],
  thumbSwing: 0.05,
};

// Main qui porte la boussole : doigts repliés sous le boîtier, pouce posé sur le dessus.
export const HOLD_COMPASS: HandPose = {
  fingers: [[0.75, 0.8, 0.5], [0.85, 0.9, 0.5], [0.95, 0.95, 0.55], [1.0, 0.95, 0.55]],
  spread: [-0.02, 0.02, 0.06, 0.1],
  thumb: [0.05, 0.1, 0.12],
  thumbSwing: -0.25, // le pouce se rapproche pour retenir le boîtier
};

const mixJoints = (a: Joints, b: Joints, t: number): Joints => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Mélange deux poses (t = 0 donne a, t = 1 donne b).
export function blendPose(a: HandPose, b: HandPose, t: number): HandPose {
  const k = Math.min(1, Math.max(0, t));
  return {
    fingers: [0, 1, 2, 3].map((i) => mixJoints(a.fingers[i]!, b.fingers[i]!, k)) as HandPose['fingers'],
    spread: [0, 1, 2, 3].map((i) => a.spread[i]! + (b.spread[i]! - a.spread[i]!) * k) as HandPose['spread'],
    thumb: mixJoints(a.thumb, b.thumb, k),
    thumbSwing: a.thumbSwing + (b.thumbSwing - a.thumbSwing) * k,
  };
}

// Une pose est-elle humainement possible ? (aucune articulation hyper-étendue ni pliée à l'excès)
export function poseIsPossible(p: HandPose): boolean {
  const joints = [...p.fingers.flat(), ...p.thumb];
  return joints.every((j) => j >= 0 && j <= 1.75) && p.spread.every((s) => Math.abs(s) <= 0.4) && Math.abs(p.thumbSwing) <= 0.8;
}
