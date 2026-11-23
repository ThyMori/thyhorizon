// Mise en forme de textes pour l'interface (logique pure).

import { wrapHours } from './sun';

// 17.4 → « 17 h 24 ».
export function formatHours(hours: number): string {
  const total = Math.round(wrapHours(hours) * 60) % 1440; // minutes depuis minuit, bouclées sur 24 h
  const h = Math.floor(total / 60); // heures
  const m = total % 60; // minutes
  return `${h} h ${String(m).padStart(2, '0')}`; // minutes sur deux chiffres
}

// Latitude et longitude → « 48,73° N, 3,46° O ».
export function formatCoords(lat: number, lon: number): string {
  const part = (v: number, plus: string, minus: string): string => `${Math.abs(v).toFixed(2).replace('.', ',')}° ${v >= 0 ? plus : minus}`; // une coordonnée avec son point cardinal
  return `${part(lat, 'N', 'S')}, ${part(lon, 'E', 'O')}`; // nord/sud puis est/ouest
}

// Distance d'affichage en tuiles → « 896 m » ou « 1,2 km ».
export function formatDistance(chunks: number, chunkSize = 64): string {
  const meters = chunks * chunkSize; // mètres
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${meters} m`; // virgule française
}

// Nombre avec espaces fines pour les milliers : 1234567 → « 1 234 567 ».
export function formatCount(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // espace fine insécable
}
