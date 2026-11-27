// Planter et cultiver (1.46, étape 2 de la feuille de route). Logique pure.
// Une plante est une modification du monde de type « plant » : sa date de plantation est `t` (horloge du monde).
// Rien n'est stocké sur sa taille : elle se CALCULE à partir du temps écoulé depuis la plantation (`growth`), donc elle grandit
// aussi pendant que le jeu est fermé, et un « retour dans le temps » de l'horloge ne casse rien (la taille ne descend pas sous zéro).

import type { WorldEdit } from './worldEdits';

export type PlantSpecies = 'carrot' | 'sunflower' | 'hazel' | 'oak';

// L'ordre est celui des touches 1 à 4 et de la molette.
export const PLANT_SPECIES: readonly PlantSpecies[] = ['carrot', 'sunflower', 'hazel', 'oak'];

export const DAY_MS = 24 * 3600 * 1000; // un jour en millisecondes

export interface PlantDef {
  name: string; // nom affiché
  fem: boolean; // féminin (« plantée ») ou masculin (« planté »)
  growMs: number; // durée pour atteindre la taille adulte, en temps réel
  adultHeight: number; // hauteur adulte (m)
  spacing: number; // distance minimale entre deux plantes de cette espèce (m)
}

// Durées voulues par le joueur (1.46) : « plus rapide ». Carotte 4 jours, tournesol 2 semaines, noisetier 2 mois, chêne 1 an.
export const PLANTS: Record<PlantSpecies, PlantDef> = {
  carrot: { name: 'Carotte', fem: true, growMs: 4 * DAY_MS, adultHeight: 0.35, spacing: 0.4 },
  sunflower: { name: 'Tournesol', fem: false, growMs: 14 * DAY_MS, adultHeight: 1.9, spacing: 0.8 },
  hazel: { name: 'Noisetier', fem: false, growMs: 60 * DAY_MS, adultHeight: 3.2, spacing: 1.6 },
  oak: { name: 'Chêne', fem: false, growMs: 365 * DAY_MS, adultHeight: 8, spacing: 3 },
};

export const MAX_PLANTS = 5000; // plafond de plantes (le plafond général des modifications est de 20 000)
export const SEED_FRACTION = 0.04; // taille d'une plante juste plantée, en part de la taille adulte
export const PLANT_REACH = 1.6; // distance devant soi où l'on plante (m)
export const PLANT_INSPECT = 3; // portée pour observer ou arracher (m)

// Avancement de la croissance, de 0 (plantée à l'instant) à 1 (adulte). Une date dans le futur (horloge reculée) donne 0.
export function growth(species: PlantSpecies, plantedAtMs: number, nowMs: number): number {
  const age = nowMs - plantedAtMs;
  if (!Number.isFinite(age) || age <= 0) return 0;
  return Math.min(1, age / PLANTS[species].growMs);
}

// Hauteur (m) à un avancement donné : ça pousse vite au début, puis de plus en plus lentement.
export function plantHeight(species: PlantSpecies, g: number): number {
  const c = Math.min(1, Math.max(0, g));
  const eased = 1 - (1 - c) * (1 - c); // décélération
  return PLANTS[species].adultHeight * (SEED_FRACTION + (1 - SEED_FRACTION) * eased);
}

export type PlantStage = 'juste planté' | 'pousse' | 'en croissance' | 'adulte';

export function plantStage(g: number): PlantStage {
  if (g < 0.03) return 'juste planté';
  if (g < 0.3) return 'pousse';
  if (g < 1) return 'en croissance';
  return 'adulte';
}

// « il y a 3 jours », « il y a 2 mois »… (durée écoulée en ms).
export function formatAge(ms: number): string {
  const plural = (n: number, unit: string, pluralUnit = `${unit}s`): string => `il y a ${n} ${n > 1 ? pluralUnit : unit}`;
  if (!Number.isFinite(ms) || ms < 60000) return 'à l\'instant';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, 'heure');
  const days = Math.floor(hours / 24);
  if (days < 14) return plural(days, 'jour');
  if (days < 60) return plural(Math.floor(days / 7), 'semaine');
  if (days < 730) return plural(Math.floor(days / 30), 'mois', 'mois');
  return plural(Math.floor(days / 365), 'an');
}

// Une durée « ronde » : 4 jours, 2 semaines, 2 mois, 1 an (pour dire en combien de temps une plante devient adulte).
export function formatSpan(ms: number): string {
  const days = Math.max(1, Math.round(ms / DAY_MS));
  const unit = (n: number, one: string, many = `${one}s`): string => `${n} ${n > 1 ? many : one}`;
  if (days < 14) return unit(days, 'jour');
  if (days < 60) return unit(Math.round(days / 7), 'semaine');
  if (days < 365) return unit(Math.round(days / 30), 'mois', 'mois');
  return unit(Math.round(days / 365), 'an');
}

// La phrase affichée quand on observe une plante.
export function plantInfo(species: PlantSpecies, plantedAtMs: number, nowMs: number): string {
  const def = PLANTS[species];
  const g = growth(species, plantedAtMs, nowMs);
  const percent = Math.floor(g * 100); // jamais arrondi vers le haut : « 100 % » veut dire adulte
  const h = plantHeight(species, g);
  const size = h >= 1 ? `${h.toFixed(1).replace('.', ',')} m` : `${Math.round(h * 100)} cm`;
  return `${def.name} ${def.fem ? 'plantée' : 'planté'} ${formatAge(nowMs - plantedAtMs)} : ${plantStage(g)}, ${percent} % (${size}).`;
}

// Peut-on planter ici ? Renvoie la raison du refus, ou null si c'est possible.
// `others` = les modifications déjà posées près du point (toutes, de n'importe quel type).
export function plantBlockedBy(others: readonly WorldEdit[], x: number, z: number, species: PlantSpecies): string | null {
  let plants = 0;
  for (const e of others) {
    if (e.type === 'plant') plants++;
  }
  if (plants >= MAX_PLANTS) return 'Tu as déjà planté beaucoup : arrache-en avant d\'en planter d\'autres.';
  for (const e of others) {
    const d = Math.hypot(e.x - x, e.z - z);
    if (e.type === 'plant' && e.species) {
      if (d < Math.max(PLANTS[species].spacing, PLANTS[e.species].spacing)) return `Trop près d'un autre plant (${PLANTS[e.species].name.toLowerCase()}) : laisse-leur de la place.`;
    } else if (d < 0.8) {
      return 'Il y a déjà une construction ici.';
    }
  }
  return null;
}
