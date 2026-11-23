// Le vrai climat du monde, prêt à l'emploi : le fichier src/data/climate.json (78 Ko) est inclus dans le code du jeu et des workers.
// Pas de téléchargement séparé : le décodage est immédiat.

import { Climate, ClimateFile, createClimate } from '../core/climate';
import data from '../data/climate.json';

export const realClimate: Climate = createClimate(data as unknown as ClimateFile);
