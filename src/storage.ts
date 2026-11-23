// Stockage local (localStorage) : réglages et sauvegarde de la partie, sur cet ordinateur uniquement.
// Tout accès est protégé : navigation privée, stockage plein ou bloqué ne doivent jamais faire planter le jeu.

export const SETTINGS_KEY = 'thyhorizon.settings'; // clé des réglages
export const SAVE_KEY = 'thyhorizon.save'; // clé de la partie

// Lit une valeur JSON ; renvoie null si elle n'existe pas ou n'est pas lisible.
export function loadJson(key: string): unknown {
  try {
    const text = localStorage.getItem(key); // texte brut
    return text ? JSON.parse(text) : null; // converti en objet
  } catch {
    return null; // stockage inaccessible ou texte abîmé : on repart de zéro
  }
}

// Écrit une valeur JSON ; renvoie false si le navigateur a refusé.
export function saveJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // stockage plein ou interdit
  }
}
