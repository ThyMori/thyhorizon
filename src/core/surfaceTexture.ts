// Texture procédurale des surfaces (1.44) : sol moucheté, cailloux, écorce sillonnée, strates de roche.
// Le dessin lui-même est dans le shader (render/surfaceTexture.ts) ; ici, les réglages partagés et les règles qui le gardent exact.
// Logique pure (aucun accès au DOM ni à la carte graphique).

// Fréquences du bruit, en cases par mètre. Elles sont TOUTES ENTIÈRES : l'origine flottante se pose sur une grille de 1 024 m
// et le bruit boucle tous les 512 cases, donc un décalage de 1 024 × f cases revient toujours à 0 (voir `shiftIsZero`).
// Conséquence : ces textures n'ont besoin d'aucun décalage envoyé au shader et ne « sautent » pas quand l'origine bouge.
export const TEXTURE_FREQ = {
  patch: 2, // grandes plaques de teinte (chaudes / froides)
  mottle: 7, // moucheture du sol
  pebbleA: 23, // cailloux sombres, tout près
  pebbleB: 31, // cailloux clairs, tout près
  furrowAcross: 12, // sillons de l'écorce, en travers (par mètre le long de la paroi)
  furrowUp: 2, // allongement des sillons vers le haut (peu de cases par mètre = longs sillons)
  strataAcross: 2, // strates de roche : étendue
  strataUp: 7, // strates de roche : épaisseur (beaucoup de cases par mètre = fines bandes)
} as const;

// Distances (m) de fondu : au-delà, le détail fin disparaît (sinon il scintille de loin).
export const TEXTURE_FADE = {
  pebblesNear: 12, // cailloux : pleins en deçà
  pebblesFar: 45, // cailloux : disparus au-delà
  furrowNear: 30, // sillons : pleins en deçà
  furrowFar: 110, // sillons : disparus au-delà
} as const;

// Pente : en dessous de `flatBelow` (valeur absolue de la composante verticale de la normale), la face est une paroi (tronc, rocher, falaise) ;
// au-dessus de `flatAbove`, c'est du sol. Entre les deux, on mélange.
export const TEXTURE_SLOPE = { wall: 0.45, ground: 0.8 } as const;

// Le même lissage que `smoothstep` du shader (pour tester les fondus).
export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Part de détail restante à une distance donnée (1 = tout, 0 = rien), comme dans le shader.
export function detailFade(near: number, far: number, dist: number): number {
  return 1 - smoothstep(near, far, dist);
}

// Un décalage de bruit est-il nul pour toutes les origines possibles ? Vrai si la fréquence est entière (voir plus haut).
export function shiftIsZero(frequency: number, originStep: number, period: number): boolean {
  return Number.isInteger(frequency) && (originStep * frequency) % period === 0;
}
