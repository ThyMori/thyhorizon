// Maillage polaire de l'océan : des anneaux concentriques, très fins près du joueur et de plus en plus larges au loin.
// Logique pure (aucune dépendance à Three.js) pour pouvoir vérifier le sens des triangles par des tests.

export interface PolarGrid {
  positions: Float32Array; // x,y,z de chaque sommet, sur un disque de rayon 1 dans le plan y = 0
  indices: Uint32Array; // triangles, tous orientés face vers le haut (+y)
}

// Fabrique le disque : 1 sommet central, puis « rings » anneaux de « segments » sommets.
// Le premier anneau est à rayon rMin ; les anneaux suivants croissent géométriquement jusqu'à 1.
export function buildPolarGrid(rings: number, segments: number, rMin: number): PolarGrid {
  const vertexCount = 1 + rings * segments; // centre + anneaux
  const positions = new Float32Array(vertexCount * 3); // le centre reste en (0,0,0)
  for (let r = 0; r < rings; r++) {
    const radius = rMin * Math.pow(1 / rMin, r / (rings - 1)); // croissance géométrique de rMin à 1
    for (let k = 0; k < segments; k++) {
      const a = (k / segments) * Math.PI * 2; // angle du sommet
      const v = 1 + r * segments + k; // numéro du sommet
      positions[v * 3] = Math.cos(a) * radius; // x
      positions[v * 3 + 2] = Math.sin(a) * radius; // z (y reste à 0)
    }
  }
  const tris: number[] = []; // triangles accumulés
  const ring = (r: number, k: number): number => 1 + r * segments + (k % segments); // numéro du sommet k de l'anneau r (avec rebouclage)
  for (let k = 0; k < segments; k++) tris.push(0, ring(0, k + 1), ring(0, k)); // éventail central
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < segments; k++) {
      const a0 = ring(r, k); // intérieur, début
      const a1 = ring(r, k + 1); // intérieur, fin
      const b0 = ring(r + 1, k); // extérieur, début
      const b1 = ring(r + 1, k + 1); // extérieur, fin
      tris.push(a0, a1, b0); // premier triangle de la case
      tris.push(a1, b1, b0); // second triangle de la case
    }
  }
  return { positions, indices: Uint32Array.from(tris) };
}
