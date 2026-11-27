// La voix des animaux visibles (1.43). Logique pure : à partir des bêtes réellement présentes autour du joueur (core/fauna.ts),
// dit quelles espèces s'entendent, à quel rythme elles crient, d'où (gauche / droite) et à quel niveau (loin = faible et étouffé).
// Le moteur audio (audio/ambient.ts) tire les cris au hasard à ce rythme. Chaque cri vient d'UNE bête précise : un mouton à ta gauche
// bêle à gauche. Les chœurs lointains non liés à une bête précise restent dans core/wildlife.ts.

import type { Critter } from './fauna';
import { clamp } from './math';

// Une bête audible : où elle est (−1 gauche … +1 droite), à quel niveau (0 à 1) et sa part des cris de l'espèce.
export interface VoiceSource {
  pan: number;
  gain: number;
  weight: number;
}

// La voix d'une espèce : cris par seconde (tout compris) et les bêtes qui peuvent les pousser.
export interface Voice {
  rate: number;
  sources: VoiceSource[];
}

// Les espèces qui ont une voix (les papillons et libellules sont silencieux).
export type VoicedSpecies = 'songbird' | 'gull' | 'raptor' | 'sheep' | 'cow' | 'deer' | 'rabbit';
export const VOICED: readonly VoicedSpecies[] = ['songbird', 'gull', 'raptor', 'sheep', 'cow', 'deer', 'rabbit'];
export type FaunaVoices = Record<VoicedSpecies, Voice>;

export const SILENT_VOICES: FaunaVoices = { songbird: { rate: 0, sources: [] }, gull: { rate: 0, sources: [] }, raptor: { rate: 0, sources: [] }, sheep: { rate: 0, sources: [] }, cow: { rate: 0, sources: [] }, deer: { rate: 0, sources: [] }, rabbit: { rate: 0, sources: [] } };

// Distance d'audition (m) et cris par seconde et par bête (à portée de voix).
export const HEARING: Record<VoicedSpecies, number> = { songbird: 70, gull: 150, raptor: 220, sheep: 90, cow: 130, deer: 90, rabbit: 16 };
const CALL_RATE: Record<VoicedSpecies, number> = { songbird: 0.1, gull: 0.06, raptor: 0.025, sheep: 0.035, cow: 0.02, deer: 0.004, rabbit: 0 };
const MAX_SOURCES = 4; // on ne garde que les bêtes audibles les plus proches

// Ce que le joueur entend : position et cap (yaw du jeu : 0 = nord, positif = tourné vers la gauche).
export interface Listener {
  x: number;
  z: number;
  y: number;
  yaw: number;
}

// Voix de toutes les espèces. `wind` (m/s) : le vent fort couvre les cris ; `rain` : sous la pluie, presque tout se tait.
export function faunaVoices(critters: readonly Critter[], l: Listener, wind: number, rain: number): FaunaVoices {
  const cover = clamp(1 - Math.max(0, wind - 6) / 12, 0.15, 1) * clamp(1 - rain * 0.8, 0.2, 1); // vent et pluie couvrent les voix
  const rx = Math.cos(l.yaw); // à sa droite
  const rz = -Math.sin(l.yaw);
  const out: FaunaVoices = { songbird: { rate: 0, sources: [] }, gull: { rate: 0, sources: [] }, raptor: { rate: 0, sources: [] }, sheep: { rate: 0, sources: [] }, cow: { rate: 0, sources: [] }, deer: { rate: 0, sources: [] }, rabbit: { rate: 0, sources: [] } };
  for (const c of critters) {
    const sp = c.species as VoicedSpecies;
    const range = HEARING[sp];
    if (range === undefined) continue; // espèce muette
    const dx = c.x - l.x;
    const dz = c.z - l.z;
    const dy = c.y - l.y;
    const d = Math.hypot(dx, dz, dy * 0.5); // la hauteur compte moins que la distance au sol
    if (d >= range) continue;
    const near = 1 - d / range; // 1 tout près, 0 à la limite
    let rate = CALL_RATE[sp];
    if (sp === 'deer' && c.moving >= 1) rate = 0.12; // un cerf qui fuit aboie
    if (sp === 'rabbit') rate = c.moving >= 1 ? 1.2 : 0; // un lapin qui détale tambourine
    if (rate <= 0) continue;
    const dh = Math.hypot(dx, dz) || 1;
    out[sp].rate += rate * near * cover;
    out[sp].sources.push({ pan: clamp((dx * rx + dz * rz) / dh, -0.9, 0.9) * clamp(dh / 4, 0, 1), gain: Math.pow(near, 1.5) * cover, weight: near }); // tout près, le son est centré
  }
  for (const sp of VOICED) out[sp].sources = out[sp].sources.sort((a, b) => b.weight - a.weight).slice(0, MAX_SOURCES);
  return out;
}
