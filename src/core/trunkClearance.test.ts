// Garde-fou (1.40.2) : même avec les arbres agrandis, la caméra ne peut pas entrer dans l'écorce (on verrait l'intérieur du tronc).
import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS } from './treeCollide';
import { TRUNK_BASE, TREE_GROWTH, TreeKind, trunkRadius } from './trees';

const CAMERA_NEAR = 0.3; // plan de coupe de la caméra (render/scene.ts)
const MAX_SIZE = (0.75 + 0.6) * TREE_GROWTH * 1.3 * 1.2; // plus gros arbre possible (taille de base × croissance × bonus de loin × marge)

describe('distance caméra / tronc', () => {
  it('la caméra reste à plus que le plan de coupe de l\'écorce dessinée, pour tous les arbres', () => {
    for (const kind of Object.keys(TRUNK_BASE) as TreeKind[]) {
      for (let size = 0.3; size <= MAX_SIZE; size += 0.1) {
        const drawn = TRUNK_BASE[kind] * size; // rayon dessiné au pied
        const gap = trunkRadius({ kind, size }) + PLAYER_RADIUS - drawn; // distance entre l'écorce et le joueur (caméra)
        expect(gap).toBeGreaterThan(CAMERA_NEAR + 0.1);
      }
    }
  });
});
