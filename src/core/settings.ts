// Réglages du jeu (qualité, souris, temps) : leurs valeurs par défaut, leurs bornes et leur nettoyage.
// Logique pure : un réglage lu depuis le disque est TOUJOURS passé par sanitizeSettings avant usage.

import { clamp } from './math';

// Préréglages de qualité. « custom » = l'utilisateur a modifié un réglage à la main.
export type Quality = 'eco' | 'balanced' | 'beautiful' | 'custom';

export interface Settings {
  quality: Quality; // préréglage courant
  viewDistance: number; // distance d'affichage, en tuiles de 64 m
  shadows: boolean; // ombres portées du soleil
  shadowSize: number; // finesse des ombres (1024 ou 2048)
  constellations: boolean; // traits des constellations (visibles la nuit)
  bloom: boolean; // halo lumineux autour des lumières (soleil, étoiles) : plus beau, plus gourmand
  resolution: number; // netteté de l'image, de 0.5 à 1 (1 = résolution native de l'écran)
  showFps: boolean; // affiche le compteur d'images par seconde
  showInstruments: boolean; // affiche les instruments du voilier (touche I) ; coupés, on navigue aux penons
  realWeather: boolean; // météo et houle RÉELLES du lieu (Open-Meteo, besoin d'Internet) ; sinon tout est simulé en local
  soundVolume: number; // volume du son, de 0 (coupé) à 1
  mouseSensitivity: number; // sensibilité de la souris, de 0.5 à 2
  daysPass: boolean; // le calendrier avance-t-il (un jour de plus à chaque minuit du jeu) ?
  realTime: boolean; // « Temps réel » : l'heure et la date du jeu suivent la vraie horloge (journées de 24 h)
  dayLengthMinutes: number; // durée d'une journée du jeu en minutes réelles (0 = le temps est arrêté)
}

// Valeurs imposées par chaque préréglage.
export const PRESETS: Record<Exclude<Quality, 'custom'>, Pick<Settings, 'viewDistance' | 'shadows' | 'shadowSize' | 'resolution' | 'bloom'>> = {
  eco: { viewDistance: 10, shadows: false, shadowSize: 1024, resolution: 0.75, bloom: false }, // pour les petites configurations
  balanced: { viewDistance: 20, shadows: true, shadowSize: 1024, resolution: 1, bloom: false }, // par défaut
  beautiful: { viewDistance: 28, shadows: true, shadowSize: 2048, resolution: 1, bloom: true }, // plus beau, plus gourmand
};

// Réglages par défaut.
export const DEFAULT_SETTINGS: Settings = {
  quality: 'balanced',
  ...PRESETS.balanced,
  constellations: false, // les traits n'apparaissent que si on les demande (touche L)
  showFps: true, // visible au début : on a besoin de mesurer la fluidité
  showInstruments: true, // les instruments aident au début ; on peut les cacher pour naviguer « à l'œil »
  realWeather: false, // désactivé par défaut : rien n'est envoyé sur Internet tant que tu ne l'actives pas
  soundVolume: 0.6, // volume moyen par défaut
  mouseSensitivity: 1,
  daysPass: true, // les saisons avancent lentement tant qu'on joue
  realTime: false, // par défaut, les journées sont accélérées
  dayLengthMinutes: 30,
};

// Durées de journée proposées dans le menu (en minutes ; 0 = arrêté).
export const DAY_LENGTH_CHOICES = [0, 10, 30, 60, 120] as const;

// Bornes des curseurs.
export const LIMITS = {
  viewDistance: { min: 6, max: 36 },
  resolution: { min: 0.5, max: 1 },
  mouseSensitivity: { min: 0.5, max: 2 },
  soundVolume: { min: 0, max: 1 },
} as const;

const QUALITIES: readonly Quality[] = ['eco', 'balanced', 'beautiful', 'custom'];

// Applique un préréglage (sauf « custom » qui ne change rien).
export function applyPreset(s: Settings, quality: Quality): Settings {
  if (quality === 'custom') return { ...s, quality }; // on garde les valeurs actuelles
  return { ...s, ...PRESETS[quality], quality }; // on remplace les valeurs de qualité
}

// Détecte si les réglages de qualité correspondent exactement à un préréglage ; sinon « custom ».
export function detectQuality(s: Settings): Quality {
  for (const q of ['eco', 'balanced', 'beautiful'] as const) {
    const p = PRESETS[q];
    if (p.viewDistance === s.viewDistance && p.shadows === s.shadows && p.shadowSize === s.shadowSize && p.resolution === s.resolution && p.bloom === s.bloom) return q;
  }
  return 'custom';
}

// Nettoie une valeur inconnue (lue dans le stockage) pour obtenir des réglages valides.
export function sanitizeSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>; // objet quelconque
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback); // nombre valide ou repli
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback); // booléen valide ou repli
  const d = DEFAULT_SETTINGS;
  const out: Settings = {
    quality: QUALITIES.includes(r.quality as Quality) ? (r.quality as Quality) : d.quality,
    viewDistance: Math.round(clamp(num(r.viewDistance, d.viewDistance), LIMITS.viewDistance.min, LIMITS.viewDistance.max)),
    shadows: bool(r.shadows, d.shadows),
    shadowSize: num(r.shadowSize, d.shadowSize) >= 2048 ? 2048 : 1024, // seules deux tailles existent
    bloom: bool(r.bloom, d.bloom),
    realTime: bool(r.realTime, d.realTime),
    constellations: bool(r.constellations, d.constellations),
    resolution: clamp(num(r.resolution, d.resolution), LIMITS.resolution.min, LIMITS.resolution.max),
    showFps: bool(r.showFps, d.showFps),
    showInstruments: bool(r.showInstruments, d.showInstruments),
    realWeather: bool(r.realWeather, d.realWeather),
    soundVolume: clamp(num(r.soundVolume, d.soundVolume), LIMITS.soundVolume.min, LIMITS.soundVolume.max),
    mouseSensitivity: clamp(num(r.mouseSensitivity, d.mouseSensitivity), LIMITS.mouseSensitivity.min, LIMITS.mouseSensitivity.max),
    daysPass: bool(r.daysPass, d.daysPass),
    dayLengthMinutes: DAY_LENGTH_CHOICES.includes(num(r.dayLengthMinutes, d.dayLengthMinutes) as (typeof DAY_LENGTH_CHOICES)[number])
      ? num(r.dayLengthMinutes, d.dayLengthMinutes)
      : d.dayLengthMinutes,
  };
  return out;
}
