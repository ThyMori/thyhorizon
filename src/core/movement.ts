// Déplacement du joueur à pied et en vol libre. Logique pure : testable sans navigateur.
// Convention du regard : yaw = 0 regarde le nord (-z), yaw = π/2 regarde l'ouest (-x) ; pitch > 0 regarde vers le haut.

import { MAX_WALK_DEPTH } from './hydro';
import type { Terrain } from './terrain';

export const EYE_HEIGHT = 1.7; // hauteur des yeux au-dessus du sol, en mètres
export const WALK_MIN_HEIGHT = -1.2; // on ne peut pas s'aventurer là où le sol est plus bas : sans bateau, on ne nage pas
export const CROUCH_EYE_HEIGHT = 0.95; // hauteur des yeux accroupi, en mètres
export const CROUCH_SPEED = 1.6; // marche accroupie, en m/s (lente : on avance à pas feutrés)
export const WALK_SPEED = 4; // marche, en m/s
export const RUN_SPEED = 9; // course, en m/s
export const FLY_SPEED = 25; // vol libre, en m/s
export const FLY_FAST_SPEED = 90; // vol libre rapide, en m/s

// Intention de déplacement, de -1 à 1 sur chaque axe.
export interface MoveInput {
  forward: number; // +1 = avancer, -1 = reculer
  right: number; // +1 = pas de côté vers la droite
  run: boolean; // course ou vol rapide
  crouch?: boolean; // accroupi : on avance lentement et on ne court pas
}

// Est-ce qu'on peut se tenir ici ?
export const isWalkable = (terrain: Terrain, x: number, z: number): boolean => {
  const h = terrain.heightAt(x, z); // altitude du sol (lit de rivière compris)
  if (h < WALK_MIN_HEIGHT) return false; // mer profonde
  const s = terrain.waterSurfaceAt(x, z); // eau douce ici ?
  return Number.isNaN(s) || s - h <= MAX_WALK_DEPTH; // un gué se traverse à pied, une eau profonde non
};

// Ramène un vecteur d'entrée à une longueur de 1 au maximum (pour que la diagonale ne soit pas plus rapide).
function normalizeInput(forward: number, right: number): [number, number] {
  const len = Math.hypot(forward, right); // longueur du vecteur d'entrée
  return len > 1 ? [forward / len, right / len] : [forward, right]; // on ne réduit que si > 1
}

// Un pas de marche. Si le déplacement mène en eau profonde, on essaie de glisser le long du bord.
export function stepWalk(
  terrain: Terrain,
  x: number,
  z: number,
  yaw: number,
  input: MoveInput,
  dt: number,
): { x: number; z: number; blocked: boolean } {
  const [f, r] = normalizeInput(input.forward, input.right); // intention normalisée
  if (f === 0 && r === 0) return { x, z, blocked: false }; // rien à faire
  const speed = input.crouch ? CROUCH_SPEED : input.run ? RUN_SPEED : WALK_SPEED; // vitesse choisie (accroupi : toujours lent)
  const sinY = Math.sin(yaw); // sinus du cap
  const cosY = Math.cos(yaw); // cosinus du cap
  const dx = (-sinY * f + cosY * r) * speed * dt; // déplacement en x (devant = (-sin, -cos), droite = (cos, -sin))
  const dz = (-cosY * f - sinY * r) * speed * dt; // déplacement en z
  if (isWalkable(terrain, x + dx, z + dz)) return { x: x + dx, z: z + dz, blocked: false }; // chemin libre
  if (isWalkable(terrain, x + dx, z)) return { x: x + dx, z, blocked: true }; // on glisse en x
  if (isWalkable(terrain, x, z + dz)) return { x, z: z + dz, blocked: true }; // on glisse en z
  return { x, z, blocked: true }; // complètement bloqué
}

// Déplacement en vol libre : on avance dans la direction du regard (verticale comprise).
export function flyDelta(
  yaw: number,
  pitch: number,
  input: MoveInput & { up: number },
  dt: number,
): [number, number, number] {
  const [f, r] = normalizeInput(input.forward, input.right); // intention horizontale normalisée
  const speed = (input.run ? FLY_FAST_SPEED : FLY_SPEED) * dt; // distance de ce pas
  const sinY = Math.sin(yaw);
  const cosY = Math.cos(yaw);
  const cosP = Math.cos(pitch);
  const dx = (-sinY * cosP * f + cosY * r) * speed; // avant = direction du regard, côté = horizontal
  const dy = (Math.sin(pitch) * f + input.up) * speed; // monter en regardant vers le haut, ou avec Espace
  const dz = (-cosY * cosP * f - sinY * r) * speed;
  return [dx, dy, dz];
}

// Rapproche doucement une valeur de sa cible (indépendant du nombre d'images par seconde).
export const smoothTo = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

export const KEY_LOOK_SPEED = 1.6; // rotation du regard aux flèches, en radians par seconde (≈ 92°/s) à sensibilité 1

// Rotation du regard commandée par les flèches : gauche/droite tournent le cap, haut/bas inclinent. Valeurs -1, 0 ou 1.
export const keyLookDelta = (left: number, right: number, up: number, down: number, sensitivity: number, dt: number): [number, number] => [
  (left - right) * KEY_LOOK_SPEED * sensitivity * dt, // variation du cap (gauche = positif, comme la souris vers la gauche)
  (up - down) * KEY_LOOK_SPEED * sensitivity * dt, // variation de l'inclinaison (haut = lever la tête)
];
