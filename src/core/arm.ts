// Un bras à deux os (épaule → coude → poignet) : cinématique inverse. Logique pure, vecteurs en tableaux [x, y, z].
// On donne l'épaule, la position voulue du poignet et la direction vers laquelle le coude doit plier ; on obtient le coude.

export type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

// Calcule coude et poignet. Si la cible est hors de portée, le bras se tend vers elle (le poignet reste à la longueur maximale).
export function twoBoneIK(shoulder: V3, target: V3, upper: number, fore: number, pole: V3): { elbow: V3; wrist: V3; reach: number } {
  const toTarget = sub(target, shoulder);
  const dist = len(toTarget);
  const minReach = Math.abs(upper - fore) + 1e-3; // bras trop replié : impossible
  const maxReach = upper + fore - 1e-3; // bras tendu au maximum
  const d = Math.min(Math.max(dist, minReach), maxReach); // distance réellement atteinte
  const axis: V3 = dist > 1e-9 ? mul(toTarget, 1 / dist) : [0, 0, 1]; // direction épaule → cible
  const wrist = add(shoulder, mul(axis, d));
  const along = (upper * upper - fore * fore + d * d) / (2 * d); // distance, le long de l'axe, du pied du coude
  const height = Math.sqrt(Math.max(upper * upper - along * along, 0)); // écart du coude à l'axe
  let p = sub(pole, mul(axis, dot(pole, axis))); // direction du coude, rendue perpendiculaire à l'axe
  let pl = len(p);
  if (pl < 1e-6) {
    p = Math.abs(axis[1]) < 0.9 ? [0, -1, 0] : [1, 0, 0]; // pôle aligné avec l'axe : on en prend un autre
    p = sub(p, mul(axis, dot(p, axis)));
    pl = len(p);
  }
  const elbow = add(add(shoulder, mul(axis, along)), mul(p, height / pl));
  return { elbow, wrist, reach: d / (upper + fore) };
}
