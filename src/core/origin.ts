// Origine flottante : le rendu 3D ne travaille jamais avec de grandes coordonnées.
// Les positions du monde restent en double précision (JavaScript), mais tout ce qui est envoyé à la carte graphique
// est exprimé par rapport à une « origine » proche du joueur, qui se déplace par grands pas quand il s'éloigne.
// La carte graphique n'a que 7 chiffres de précision : à 3 000 km de l'origine, elle n'aurait plus que ~25 cm.
// Logique pure (aucun accès au DOM ni à la carte graphique).

export interface Origin {
  readonly x: number; // position de l'origine, est-ouest, en mètres du monde
  readonly z: number; // position de l'origine, nord-sud, en mètres du monde
}

export const ORIGIN_STEP = 1024; // l'origine se pose sur une grille de 1 024 m (multiple de la taille d'une tuile, 64 m)
export const ORIGIN_LIMIT = 1536; // dès que le joueur s'éloigne de plus de 1 536 m de l'origine, on la déplace

export const NO_ORIGIN: Origin = { x: 0, z: 0 }; // origine du monde

// Pose l'origine sur la case de la grille la plus proche du point donné (le « -0 » devient 0).
export function snapOrigin(px: number, pz: number): Origin {
  return { x: Math.round(px / ORIGIN_STEP) * ORIGIN_STEP || 0, z: Math.round(pz / ORIGIN_STEP) * ORIGIN_STEP || 0 };
}

// Renvoie la même origine tant que le joueur reste près d'elle, une nouvelle sinon (le même objet = rien n'a changé).
export function updateOrigin(current: Origin, px: number, pz: number): Origin {
  if (Math.abs(px - current.x) <= ORIGIN_LIMIT && Math.abs(pz - current.z) <= ORIGIN_LIMIT) return current; // encore près : on ne bouge pas
  return snapOrigin(px, pz); // trop loin : nouvelle origine sous le joueur
}

// Le grain du sol est un bruit calculé dans le shader d'après la position dans le monde. Il se répète tous les 512 « cases » de bruit.
// Si le shader reçoit des positions relatives à l'origine, il doit ajouter ce décalage pour retrouver exactement le même motif.
export const GRAIN_FREQUENCIES = [1.1, 4.3, 15.0] as const; // fréquences du bruit (grandes taches, brins, grain fin), en cases par mètre
export const GRAIN_PERIOD = 512; // période de répétition du bruit, en cases

// Décalage (en cases de bruit, dans [0 ; 512[) à ajouter pour une fréquence donnée.
export function grainShift(origin: Origin, frequency: number): [number, number] {
  const wrap = (v: number): number => (((v * frequency) % GRAIN_PERIOD) + GRAIN_PERIOD) % GRAIN_PERIOD; // modulo toujours positif
  return [wrap(origin.x), wrap(origin.z)];
}

// Les vagues sont des sinusoïdes de la position dans le monde. Avec des positions relatives à l'origine, il faut ajouter ce déphasage
// (en radians, dans [0 ; 2π[) pour retrouver exactement la même vague. dx, dz = direction de la vague ; k = nombre d'onde (rad/m).
export function wavePhase(origin: Origin, dx: number, dz: number, k: number): number {
  const twoPi = 2 * Math.PI;
  return ((((origin.x * dx + origin.z * dz) * k) % twoPi) + twoPi) % twoPi;
}
