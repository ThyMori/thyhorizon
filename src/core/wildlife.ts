// La vie sauvage sonore : selon le lieu (biome, saison), l'heure, la météo et l'environnement, calcule QUELS bruits d'animaux
// et de feuillage s'entendent, et à quel rythme. Logique pure (aucun son ici) ; le moteur audio joue les cris (src/audio/ambient.ts).

import { clamp, smoothstep } from './math';
import { summerness } from './weather';

// Ce que le monde dit à la vie sauvage.
export interface LifeInput {
  cls: string; // classe climatique de Köppen (ex. « Cfb »)
  lat: number; // latitude (°)
  day: number; // jour de l'année
  sunElevation: number; // hauteur du soleil (°) ; négatif = sous l'horizon
  hours: number; // heure solaire (0 à 24)
  forest: number; // densité d'arbres du biome (0 à 1)
  conifer: number; // part de conifères (0 à 1)
  land: boolean; // sur la terre ferme (pas sur l'eau) ?
  snowy: boolean; // au-dessus de la limite des neiges (ou glace) ?
  shore: number; // proximité du rivage (0 à 1)
  rain: number; // pluie (0 à 1)
  wind: number; // vent ressenti (m/s)
}

// Les bruits vivants : des rythmes (événements par seconde) pour les cris, des niveaux pour les bruits continus.
export interface LifeMix {
  birds: number; // chants d'oiseaux par seconde
  gulls: number; // cris de goélands par seconde
  frogs: number; // coassements par seconde
  owl: number; // hululements par seconde
  crickets: { gain: number; pulse: number }; // grillons : niveau, rapidité des stridulations (1 = normale ; plus rapide quand il fait chaud)
  cicadas: number; // cigales : niveau
  foliage: { gain: number; freq: number }; // vent dans les feuilles : niveau, fréquence centrale (Hz) (plus grave dans les conifères)
}

export const SILENT_LIFE: LifeMix = { birds: 0, gulls: 0, frogs: 0, owl: 0, crickets: { gain: 0, pulse: 1 }, cicadas: 0, foliage: { gain: 0, freq: 3000 } };

// Chaleur ambiante de 0 (glacial) à 1 (tropical), d'après le climat et la saison.
export function warmth(cls: string, lat: number, day: number): number {
  const s = summerness(lat, day); // −1 hiver … +1 été
  const k = cls.charAt(0);
  if (k === 'A') return clamp(0.85 + 0.05 * s, 0, 1); // tropical : chaud toute l'année
  if (k === 'B') return clamp((cls.charAt(2) === 'h' ? 0.8 : 0.5) + 0.15 * s, 0, 1); // sec : chaud ou froid
  if (k === 'C') return clamp(0.5 + 0.38 * s, 0, 1); // tempéré : très saisonnier
  if (k === 'D') return clamp(0.25 + 0.5 * s, 0, 1); // continental : hiver glacial
  return clamp(0.05 + 0.15 * s, 0, 0.2); // polaire
}

// Humidité du climat (0 à 1) : les grenouilles aiment l'humide.
export function wetness(cls: string): number {
  const k = cls.charAt(0);
  if (k === 'A') return cls === 'Aw' || cls === 'As' ? 0.5 : 0.95;
  if (k === 'B') return 0.1;
  if (k === 'C') return cls.charAt(1) === 'f' ? 0.75 : 0.5;
  if (k === 'D') return cls.charAt(1) === 'f' ? 0.6 : 0.4;
  return 0.1;
}

export function lifeMix(i: LifeInput): LifeMix {
  const w = warmth(i.cls, i.lat, i.day);
  const wet = wetness(i.cls);
  const rain = clamp(i.rain, 0, 1);
  const calm = 1 - smoothstep(7, 15, i.wind); // le vent fort couvre et fait taire les animaux
  const dry = 1 - Math.min(1, rain * 1.2); // sous la pluie, presque tout se tait
  const e = i.sunElevation;
  const night = 1 - smoothstep(-8, -2, e); // 1 = vraie nuit
  const veg = clamp(0.25 + 0.75 * i.forest + (i.cls.charAt(0) === 'A' ? 0.2 : 0), 0, 1); // plus il y a d'arbres, plus il y a d'oiseaux
  const life = i.snowy || w < 0.12 ? 0 : 1; // ni neige ni glace : aucune vie sonore à terre
  const warmGate = smoothstep(0.18, 0.5, w);

  // --- Terre ferme ---
  const morning = i.hours < 12 ? 1 : 0.55; // le chœur du matin est plus fort que celui du soir
  const dawn = smoothstep(-8, 3, e) * (1 - smoothstep(8, 32, e)) * morning; // chœur de l'aube
  const dayAct = smoothstep(2, 15, e) * 0.4; // chants plus rares en journée
  const dusk = smoothstep(-6, 4, e) * (1 - smoothstep(4, 12, e)) * (i.hours >= 12 ? 0.55 : 0); // petit chœur du soir
  const activity = Math.max(dawn, dayAct, dusk);
  const landOnly = i.land ? 1 : 0;
  const birds = landOnly * life * warmGate * veg * activity * dry * calm * 1.5;

  // Grillons : soirs et nuits chauds, herbe ou forêt, sans pluie ni vent.
  const warmNight = smoothstep(0.5, 0.78, w) * (1 - smoothstep(-2, 8, e)); // du crépuscule à l'aube
  const cricketGain = landOnly * life * warmNight * dry * calm * (i.cls.charAt(0) === 'B' && i.cls.charAt(1) === 'W' ? 0.5 : 1) * 0.2;
  const crickets = { gain: cricketGain, pulse: 0.8 + 0.7 * w };

  // Cigales : grosse chaleur du jour, climats secs ou méditerranéens ou tropicaux.
  const cicadaClimate = i.cls.startsWith('Cs') || i.cls === 'Aw' || i.cls === 'As' || i.cls === 'BSh' || i.cls === 'Cfa' || i.cls === 'Cwa' ? 1 : 0;
  const cicadas = landOnly * life * cicadaClimate * smoothstep(0.62, 0.85, w) * smoothstep(12, 40, e) * dry * calm * 1.5;

  // Grenouilles : humide, tiède, crépuscule/nuit (ou pluie), près de l'eau.
  const nearWater = smoothstep(0.02, 0.35, i.shore);
  const frogCondition = smoothstep(0.35, 0.65, wet) * smoothstep(0.35, 0.6, w) * Math.max(night, rain * 0.6); // la nuit, ou sous la pluie (même de jour)
  const frogs = landOnly * life * frogCondition * (0.25 + 0.75 * nearWater) * calm * 0.9;

  // Chouette : nuit, présence d'arbres, assez doux, pas de pluie forte.
  const owl = landOnly * life * night * smoothstep(0.15, 0.5, i.forest) * smoothstep(0.15, 0.4, w) * (1 - rain) * calm * 0.05;

  // Goélands : près des côtes, de jour ; en mer, quelques-uns seulement.
  const gullDay = smoothstep(-6, 6, e);
  const coast = i.land ? smoothstep(0.1, 0.5, i.shore) : 0.12 + 0.88 * smoothstep(0.05, 0.4, i.shore);
  const gulls = gullDay * coast * (1 - rain * 0.7) * (1 - smoothstep(11, 20, i.wind) * 0.6) * (w > 0.12 ? 1 : 0.3) * 0.28;

  // Vent dans les feuilles : sur terre, proportionnel au vent et au nombre d'arbres.
  const foliageGain = landOnly * (0.05 + 0.95 * i.forest) * smoothstep(1.5, 12, i.wind) * 0.4;
  const foliage = { gain: foliageGain, freq: 3600 - 1900 * clamp(i.conifer, 0, 1) }; // les conifères « soufflent » plus grave

  return { birds, gulls, frogs, owl, crickets, cicadas, foliage };
}
