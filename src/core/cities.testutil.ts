// Aide pour les TESTS uniquement : charge le vrai fichier des villes depuis le disque (jamais importé par le jeu).
import { readFileSync } from 'node:fs';
import { Cities, parseCities } from './cities';

let cached: Cities | null = null; // une seule lecture pour tous les tests

// Les vraies villes du jeu (src/data/cities.bin).
export function loadRealCities(): Cities {
  if (cached) return cached;
  cached = parseCities(new Uint8Array(readFileSync(new URL('../data/cities.bin', import.meta.url))));
  return cached;
}
