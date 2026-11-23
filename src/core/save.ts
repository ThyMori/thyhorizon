// La partie sauvegardée : où l'on était, quelle heure il était. Logique pure.
// Ce qui est lu depuis le stockage passe TOUJOURS par sanitizeSave : si la cible n'existe plus
// (graine différente, position sous l'eau profonde, données abîmées), on retombe sur un départ valide.

import { START_LAT, startHours, wrapDay } from './geo';
import { clamp } from './math';
import { wrapHours } from './sun';
import { Terrain, findSpawn } from './terrain';
import { isWalkable } from './movement';

// Graine du monde par défaut (le texte est transformé en nombre par hashSeed).
export const DEFAULT_SEED = 'horizon';

export interface SaveData {
  version: 1; // format de la sauvegarde (pour de futures migrations)
  seed: string; // graine du monde
  x: number; // position est-ouest
  z: number; // position nord-sud
  y: number; // altitude des yeux (utile seulement en vol libre)
  yaw: number; // cap
  pitch: number; // inclinaison du regard
  hours: number; // heure solaire locale du jeu
  day: number; // jour de l'année du jeu (1 à 365)
  fly: boolean; // vol libre actif
}

// Lit la graine d'une sauvegarde brute (ou la graine par défaut).
export function readSavedSeed(raw: unknown): string {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return typeof r.seed === 'string' && r.seed.length > 0 && r.seed.length < 100 ? r.seed : DEFAULT_SEED;
}

// Sauvegarde de départ pour un nouveau monde.
// today = jour de l'année réel : le jeu commence à la date d'aujourd'hui, une heure avant le coucher du soleil.
export function defaultSave(terrain: Terrain, seed: string, today: number): SaveData {
  const s = findSpawn(terrain); // point de départ sur la plage
  const day = wrapDay(today); // jour valide
  return { version: 1, seed, x: s.x, z: s.z, y: terrain.heightAt(s.x, s.z) + 1.7, yaw: s.yaw, pitch: s.pitch, hours: startHours(START_LAT, day), day, fly: false };
}

// Nettoie une sauvegarde brute pour ce terrain. La position redevient celle du départ si elle n'est plus valable.
export function sanitizeSave(raw: unknown, terrain: Terrain, seed: string, today: number): SaveData {
  const fallback = defaultSave(terrain, seed, today); // départ par défaut
  if (typeof raw !== 'object' || raw === null) return fallback; // rien de lisible
  const r = raw as Record<string, unknown>;
  if (readSavedSeed(raw) !== seed) return fallback; // la sauvegarde appartient à un autre monde
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d); // nombre valide ou repli
  const x = num(r.x, NaN);
  const z = num(r.z, NaN);
  const positionOk = Number.isFinite(x) && Math.abs(x) < 1e6 && Number.isFinite(z) && Math.abs(z) < 1e6 && isWalkable(terrain, x, z); // position plausible et hors eau profonde
  const fly = r.fly === true; // vol libre ?
  const ground = positionOk ? terrain.heightAt(x, z) : 0; // sol sous la position
  return {
    version: 1,
    seed,
    x: positionOk ? x : fallback.x,
    z: positionOk ? z : fallback.z,
    y: positionOk && fly ? clamp(num(r.y, ground + 1.7), ground + 1.7, ground + 3000) : (positionOk ? ground : terrain.heightAt(fallback.x, fallback.z)) + 1.7,
    yaw: positionOk ? num(r.yaw, fallback.yaw) : fallback.yaw,
    pitch: clamp(positionOk ? num(r.pitch, fallback.pitch) : fallback.pitch, -1.5, 1.5),
    hours: wrapHours(num(r.hours, fallback.hours)), // ancienne sauvegarde sans heure : départ par défaut
    day: wrapDay(num(r.day, fallback.day)), // ancienne sauvegarde sans date : aujourd'hui
    fly: positionOk && fly,
  };
}
