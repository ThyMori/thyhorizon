// Le numéro de version du MONDE (différent du numéro du jeu). Logique pure.
// Le monde est calculé : même graine + même code = même Lannion à chaque visite. Si on change le code qui génère le monde
// (forme des arbres, placement, villages…), les endroits déjà visités changeraient. Ce numéro permet de le savoir.
//
// RÈGLE : on ne monte WORLD_VERSION que si une modification déplace ou transforme des choses que le joueur a déjà vues
// ET sur lesquelles il peut avoir bâti. Une amélioration purement visuelle qui ne bouge rien n'y touche pas.
// Une sauvegarde garde SON numéro ; le jeu choisit alors le bon générateur (tant qu'un seul existe, rien à choisir).

export const WORLD_VERSION = 1; // version du monde générée par ce code

export type WorldVersionStatus = 'ok' | 'older' | 'future';

// Lit le numéro de version du monde d'une sauvegarde brute. Une sauvegarde sans numéro date d'avant : version 1.
export function readWorldVersion(raw: unknown): number {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const v = r.worldVersion;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v < 1000 ? v : 1;
}

// Cette sauvegarde est-elle lisible par ce jeu ?
// ok = même version ; older = faite avec un monde plus ancien (le jeu doit encore savoir le générer) ; future = faite par un jeu plus récent.
export function worldVersionStatus(saved: number): WorldVersionStatus {
  if (saved === WORLD_VERSION) return 'ok';
  return saved < WORLD_VERSION ? 'older' : 'future';
}
