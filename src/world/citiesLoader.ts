// Charge le fichier des villes du monde (src/data/cities.bin). Il est sur le réseau du jeu lui-même (rien n'est demandé à un service externe) et se met en cache hors ligne.

import citiesUrl from '../data/cities.bin?url';

// Télécharge les octets du fichier des villes.
export async function loadCitiesBytes(): Promise<Uint8Array> {
  const response = await fetch(citiesUrl);
  if (!response.ok) throw new Error(`villes du monde introuvables (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}
