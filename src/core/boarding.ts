// Monter à bord et débarquer (logique pure) : où poser le bateau, où poser le joueur à terre.

import { WALK_MIN_HEIGHT } from './movement';
import { BoatSpec, forwardOf, minDepth } from './sailing';

// Tout ce dont on a besoin du terrain : sa hauteur (négative sous l'eau).
export interface HeightField {
  heightAt(x: number, z: number): number;
}

const ANGLES = 24; // directions essayées autour du joueur
const MIN_LAUNCH_DEPTH = 3.5; // profondeur minimale sous toute la coque pour mettre le bateau à l'eau (m)

// Cherche une eau assez profonde près du joueur, en privilégiant la direction du regard.
// Renvoie le point (x, z) ou null s'il n'y a pas d'eau à moins de maxRadius mètres.
export function findLaunchSpot(terrain: HeightField, spec: BoatSpec, x: number, z: number, yaw: number, maxRadius = 1500): { x: number; z: number } | null {
  const depthAt = (px: number, pz: number): number => -terrain.heightAt(px, pz); // profondeur d'eau (positive sous l'eau)
  const look = forwardOf(yaw); // direction du regard
  const base = Math.atan2(look.z, look.x); // angle du regard dans le plan (x, z)
  for (let r = 12; r <= maxRadius; r += 12) {
    for (let k = 0; k < ANGLES; k++) {
      const step = Math.ceil(k / 2) * ((2 * Math.PI) / ANGLES); // 0, +1, −1, +2, −2… : on s'écarte du regard progressivement
      const a = base + (k % 2 === 1 ? step : -step);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const heading = { x: Math.cos(a), z: Math.sin(a) }; // le bateau est posé dans l'alignement de cette direction
      if (minDepth(spec, depthAt, px, pz, heading) >= MIN_LAUNCH_DEPTH) return { x: px, z: pz };
    }
  }
  return null;
}

// Cherche la terre ferme (ou eau peu profonde, où l'on peut marcher) la plus proche d'un point, à moins de maxRadius mètres.
export function findLandingSpot(terrain: HeightField, x: number, z: number, maxRadius = 18): { x: number; z: number } | null {
  for (let r = 3; r <= maxRadius; r += 1.5) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (terrain.heightAt(px, pz) >= WALK_MIN_HEIGHT + 0.3) return { x: px, z: pz }; // assez de fond pour marcher
    }
  }
  return null;
}
