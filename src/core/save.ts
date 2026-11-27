// La partie sauvegardée : où l'on était. Logique pure. (Depuis 1.45 le jeu est en temps réel : l'heure et la date ne sont plus sauvegardées,
// on note seulement QUAND on a quitté, pour le futur « journal de bord au retour ».)
// Ce qui est lu depuis le stockage passe TOUJOURS par sanitizeSave : si la cible n'existe plus
// (graine différente, position sous l'eau profonde, données abîmées), on retombe sur un départ valide.

import { clamp } from './math';
import { Terrain, findSpawn } from './terrain';
import { isWalkable } from './movement';
import { WORLD_VERSION, readWorldVersion } from './worldVersion';

// Graine du monde par défaut (le texte est transformé en nombre par hashSeed).
export const DEFAULT_SEED = 'horizon';

export interface SaveData {
  version: 2; // 2 = monde du vrai relief (une sauvegarde de version 1 date de l'ancien monde inventé : sa position n'a plus de sens)
  seed: string; // graine du monde
  x: number; // position est-ouest
  z: number; // position nord-sud
  y: number; // altitude des yeux (utile seulement en vol libre)
  yaw: number; // cap
  pitch: number; // inclinaison du regard
  savedAt: number; // instant de l'enregistrement (ms depuis 1970, horloge du monde) ; 0 = inconnu (ancienne sauvegarde)
  fly: boolean; // vol libre actif
  worldVersion: number; // version du monde (voir worldVersion.ts) sur laquelle cette partie a été jouée
}

// Lit la graine d'une sauvegarde brute (ou la graine par défaut).
export function readSavedSeed(raw: unknown): string {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return typeof r.seed === 'string' && r.seed.length > 0 && r.seed.length < 100 ? r.seed : DEFAULT_SEED;
}

// Sauvegarde de départ pour un nouveau monde.
export function defaultSave(terrain: Terrain, seed: string): SaveData {
  const s = findSpawn(terrain); // point de départ sur la plage
  return { version: 2, seed, x: s.x, z: s.z, y: terrain.heightAt(s.x, s.z) + 1.7, yaw: s.yaw, pitch: s.pitch, savedAt: 0, fly: false, worldVersion: WORLD_VERSION };
}

// Nettoie une sauvegarde brute pour ce terrain. La position redevient celle du départ si elle n'est plus valable.
export function sanitizeSave(raw: unknown, terrain: Terrain, seed: string): SaveData {
  const fallback = defaultSave(terrain, seed); // départ par défaut
  if (typeof raw !== 'object' || raw === null) return fallback; // rien de lisible
  const r = raw as Record<string, unknown>;
  if (readSavedSeed(raw) !== seed) return fallback; // la sauvegarde appartient à un autre monde
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d); // nombre valide ou repli
  const x = num(r.x, NaN);
  const z = num(r.z, NaN);
  const positionOk = Number.isFinite(x) && Math.abs(x) < 1e6 && Number.isFinite(z) && Math.abs(z) < 1e6 && r.version === 2 && isWalkable(terrain, x, z); // position plausible, du monde actuel et hors eau profonde
  const fly = r.fly === true; // vol libre ?
  const ground = positionOk ? terrain.heightAt(x, z) : 0; // sol sous la position
  return {
    version: 2,
    seed,
    x: positionOk ? x : fallback.x,
    z: positionOk ? z : fallback.z,
    y: positionOk && fly ? clamp(num(r.y, ground + 1.7), ground + 1.7, ground + 3000) : (positionOk ? ground : terrain.heightAt(fallback.x, fallback.z)) + 1.7,
    yaw: positionOk ? num(r.yaw, fallback.yaw) : fallback.yaw,
    pitch: clamp(positionOk ? num(r.pitch, fallback.pitch) : fallback.pitch, -1.5, 1.5),
    savedAt: clamp(num(r.savedAt, 0), 0, 8.64e15), // ancienne sauvegarde sans date : inconnu
    fly: positionOk && fly,
    worldVersion: readWorldVersion(raw), // on garde le numéro de la sauvegarde (absent = 1)
  };
}
