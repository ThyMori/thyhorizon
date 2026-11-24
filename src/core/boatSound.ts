// Les bruits du bateau lui-même : voile qui faseye (claque), craquements de la coque et du gréement, pas sur le pont.
// Logique pure : à partir de l'état du bateau, donne combien de bruits par seconde et à quel niveau. Le moteur audio (src/audio/ambient.ts) les joue.

import { clamp, smoothstep } from './math';

export const STRIDE = 0.75; // longueur d'un pas (m) : la cadence des pas = vitesse de marche / cette longueur

// Ce que le bateau dit au son.
export interface BoatSoundInput {
  aboard: boolean; // le joueur est-il à bord ?
  walking: boolean; // debout sur le pont (et non à la barre) ?
  walkSpeed: number; // vitesse de marche sur le pont (m/s)
  luff: number; // 0 à 1 : la voile faseye
  mainUp: number; // grand-voile hissée, 0 à 1
  jibOut: number; // foc déroulé, 0 à 1
  aws: number; // vent apparent (m/s)
  heelDeg: number; // gîte (°)
  heelRate: number; // vitesse de gîte (rad/s)
  boatSpeed: number; // vitesse dans l'eau (m/s)
  seaHs: number; // hauteur des vagues (m)
  rain: number; // pluie, 0 à 1 (pont mouillé : pas plus « clapotants »)
}

// Combien de bruits par seconde (rate) et à quel niveau (0 à 1) pour chaque sorte.
export interface BoatSoundMix {
  flap: { rate: number; level: number }; // claquements de voile
  creak: { rate: number; level: number }; // craquements de bois et de cordages
  step: { rate: number; level: number; wet: number }; // pas (wet = pont mouillé, 0 à 1)
}

export const SILENT_BOAT: BoatSoundMix = { flap: { rate: 0, level: 0 }, creak: { rate: 0, level: 0 }, step: { rate: 0, level: 0, wet: 0 } };

export function boatSoundMix(i: BoatSoundInput): BoatSoundMix {
  if (!i.aboard) return SILENT_BOAT; // loin du bateau on n'entend rien de lui
  const aws = Math.max(0, i.aws);
  // Voile : ça claque seulement si une voile est dehors, qu'elle faseye et qu'il y a assez de vent pour la secouer.
  const sail = clamp(Math.max(i.mainUp, i.jibOut * 0.8), 0, 1);
  const shake = clamp(i.luff, 0, 1) * sail * smoothstep(1.2, 5, aws);
  const flap = { rate: shake * (1.2 + 5 * smoothstep(2, 12, aws)), level: shake * (0.25 + 0.75 * smoothstep(3, 14, aws)) };
  // Craquements : le bateau travaille quand il roule, tangue, gîte et file ; presque rien par mer d'huile.
  const roll = smoothstep(0.01, 0.12, Math.abs(i.heelRate));
  const sea = smoothstep(0.1, 2.5, Math.max(0, i.seaHs));
  const load = smoothstep(2, 22, Math.abs(i.heelDeg));
  const rate = 0.03 + 0.18 * sea + 0.22 * roll + 0.18 * load;
  const creak = { rate: clamp(rate, 0, 0.7), level: clamp(0.18 + 0.4 * load + 0.25 * sea + 0.15 * smoothstep(1, 5, i.boatSpeed), 0, 1) };
  // Pas : seulement debout sur le pont et en mouvement ; cadence selon la vitesse de marche.
  const walks = i.walking && i.walkSpeed > 0.25;
  const step = walks ? { rate: clamp(i.walkSpeed / STRIDE, 0, 4), level: clamp(0.35 + 0.1 * i.walkSpeed, 0, 0.6), wet: clamp(i.rain * 1.5, 0, 1) } : { rate: 0, level: 0, wet: 0 };
  return { flap, creak, step };
}
