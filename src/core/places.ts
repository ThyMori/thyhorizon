// Les lieux du monde proposés dans le menu « Lieux » : un point de chaque grand climat de la Terre, pour les visiter d'un coup.
// Logique pure : latitude / longitude réelles → position dans le monde du jeu.

import { latLonToWorld } from './geo';

// Un lieu : son nom, ses coordonnées réelles, ce qu'on y verra, et la grande famille de climat attendue (1re lettre de Köppen : A, B, C, D ou E).
export interface Place {
  id: string;
  name: string; // nom affiché
  lat: number; // latitude en degrés (nord positif)
  lon: number; // longitude en degrés (est positif)
  climate: string; // description courte du climat
  family: 'A' | 'B' | 'C' | 'D' | 'E'; // famille de climat de Köppen attendue (sert aux tests)
}

export const PLACES: readonly Place[] = [
  { id: 'lannion', name: 'Lannion (départ)', lat: 48.73, lon: -3.46, climate: 'Océanique doux : prairies vertes', family: 'C' },
  { id: 'provence', name: 'Provence', lat: 43.6, lon: 5.6, climate: 'Méditerranéen : olive et ocre', family: 'C' },
  { id: 'alpes', name: 'Alpes (Mont-Blanc)', lat: 45.9, lon: 7.0, climate: 'Haute montagne : neige dès 700 m', family: 'E' },
  { id: 'sahara', name: 'Sahara', lat: 23, lon: 12, climate: 'Désert chaud : sable ocre', family: 'B' },
  { id: 'sahel', name: 'Sahel', lat: 14, lon: 5, climate: 'Steppe chaude : herbe sèche', family: 'B' },
  { id: 'gobi', name: 'Désert de Gobi', lat: 42, lon: 105, climate: 'Désert froid : terre et gravier', family: 'B' },
  { id: 'atacama', name: 'Atacama (Chili)', lat: -24, lon: -69, climate: 'Désert froid d\'altitude', family: 'B' },
  { id: 'outback', name: 'Outback (Australie)', lat: -25, lon: 135, climate: 'Désert chaud rouge', family: 'B' },
  { id: 'congo', name: 'Forêt du Congo', lat: 0, lon: 23, climate: 'Équatorial : vert profond', family: 'A' },
  { id: 'amazonie', name: 'Amazonie', lat: -3, lon: -60, climate: 'Équatorial : vert profond', family: 'A' },
  { id: 'mekong', name: 'Delta du Mékong', lat: 15, lon: 105, climate: 'Savane tropicale : herbe dorée', family: 'A' },
  { id: 'argentine', name: 'Pampa (Argentine)', lat: -35, lon: -62, climate: 'Tempéré humide chaud', family: 'C' },
  { id: 'kazakhstan', name: 'Steppe du Kazakhstan', lat: 50, lon: 70, climate: 'Continental : grandes plaines', family: 'D' },
  { id: 'siberie', name: 'Sibérie (taïga)', lat: 62, lon: 100, climate: 'Taïga : vert sombre', family: 'D' },
  { id: 'tibet', name: 'Plateau tibétain', lat: 33, lon: 88, climate: 'Haute altitude : neige dès 700 m', family: 'E' },
  { id: 'groenland', name: 'Groenland', lat: 72, lon: -40, climate: 'Calotte glaciaire : glace partout', family: 'E' },
  { id: 'antarctique', name: 'Antarctique', lat: -80, lon: 0, climate: 'Calotte glaciaire : glace partout', family: 'E' },
];

// Position dans le monde (mètres depuis Lannion) d'un lieu.
export const placePosition = (place: Place): { x: number; z: number } => latLonToWorld(place.lat, place.lon);
