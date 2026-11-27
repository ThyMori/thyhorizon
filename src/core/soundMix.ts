// Le « mixage » du son : à partir de l'état du monde (vent, pluie, mer, proximité du rivage, vitesse du bateau), calcule le niveau
// de chaque couche sonore. Logique pure (aucun son ici) : le moteur audio (src/audio/ambient.ts) ne fait que suivre ces valeurs.

import { clamp, lerp, smoothstep } from './math';
import { BoatSoundMix, SILENT_BOAT } from './boatSound';
import { FaunaVoices, SILENT_VOICES } from './faunaSound';
import { LifeMix, SILENT_LIFE } from './wildlife';
import { SILENT_WATER, WaterMix } from './waterSound';

// Ce que le monde dit au mixage.
export interface SoundInput {
  windSpeed: number; // vent ressenti (m/s) : le vent apparent quand on est à bord
  rain: number; // intensité de la pluie, 0 à 1
  seaHs: number; // hauteur significative des vagues (m)
  onWater: boolean; // le joueur est-il sur l'eau (à bord) ?
  shore: number; // proximité du rivage, 0 (loin) à 1 (au bord) : voir shoreProximity
  boatSpeed: number; // vitesse du bateau dans l'eau (m/s), 0 hors bateau
  aboard: boolean; // le joueur est-il à bord ?
  volume: number; // volume général choisi dans les réglages, 0 à 1
  active: boolean; // le joueur joue-t-il (souris capturée) ? Sinon le son baisse (menu)
  boat?: BoatSoundMix; // les bruits du bateau (voile, craquements, pas) déjà calculés par core/boatSound.ts ; absents = silence
  water?: WaterMix; // les bruits de l'eau douce (ruisseau, rivière, lac) déjà calculés par core/waterSound.ts ; absents = silence
  voices?: FaunaVoices; // la voix des animaux visibles autour de nous, déjà calculée par core/faunaSound.ts ; absente = silence
  life?: LifeMix; // la vie sauvage (oiseaux, insectes…) déjà calculée par core/wildlife.ts ; absente = silence
}

// Le niveau de chaque couche (gain 0 à 1) et quelques réglages de timbre.
export interface SoundMix {
  master: number; // niveau général
  wind: { gain: number; freq: number }; // souffle du vent : niveau, fréquence centrale (Hz)
  rig: number; // sifflement du vent dans le gréement (à bord, vent fort)
  rain: { hiss: number; body: number; plips: number }; // pluie : chuintement aigu, corps grave, gouttes isolées par seconde
  swell: { gain: number; depth: number }; // houle qui clapote sur la coque / l'eau : niveau, creux entre deux vagues (0 à 1)
  surf: { gain: number; depth: number }; // déferlement au rivage
  hull: { gain: number; freq: number }; // eau qui file le long de la coque
  boat: BoatSoundMix; // claquements de voile, craquements, pas
  water: WaterMix; // ruisseau, rivière, lac
  life: LifeMix; // oiseaux, insectes, grenouilles, chouette, feuillage
  voices: FaunaVoices; // la voix des animaux visibles (cris par seconde, d'où ils viennent)
}

export function soundMix(i: SoundInput): SoundMix {
  const vol = clamp(i.volume, 0, 1);
  const master = vol * vol * 0.9 * (i.active ? 1 : 0.3); // courbe douce : le milieu du curseur reste confortable ; moitié moins fort dans les menus
  const w = Math.max(0, i.windSpeed);
  const rain = i.rain < 0.03 ? 0 : clamp(i.rain, 0, 1);
  const hs = Math.max(0, i.seaHs);
  const shore = clamp(i.shore, 0, 1);
  const waves = smoothstep(0, 4, hs); // 0 = mer d'huile, 1 = mer forte
  return {
    master,
    wind: { gain: 0.04 + 0.6 * Math.pow(smoothstep(0.5, 17, w), 0.9), freq: 220 + w * 55 },
    rig: i.aboard ? 0.14 * smoothstep(8, 20, w) : 0,
    rain: { hiss: 0.5 * Math.pow(rain, 0.8), body: 0.28 * Math.pow(rain, 1.1), plips: rain * 14 },
    swell: { gain: i.onWater ? 0.1 + 0.4 * waves : 0.06 * waves * shore, depth: lerp(0.35, 0.75, waves) },
    surf: { gain: shore * (0.1 + 0.55 * waves) * (i.onWater ? 0.45 : 1), depth: lerp(0.5, 0.85, waves) },
    hull: { gain: i.aboard ? 0.45 * smoothstep(0.3, 5, i.boatSpeed) : 0, freq: 500 + i.boatSpeed * 120 },
    boat: i.boat ?? SILENT_BOAT,
    water: i.water ?? SILENT_WATER,
    life: i.life ?? SILENT_LIFE,
    voices: i.voices ?? SILENT_VOICES,
  };
}

// Proximité du rivage : 0 à 1. On regarde autour du joueur dans 8 directions à plusieurs distances ; dès qu'on change de milieu
// (terre ↔ eau), c'est le rivage. `heightAt(x, z)` > 0 = terre. Renvoie 1 au bord de l'eau, 0 au-delà de maxDistance.
export function shoreProximity(heightAt: (x: number, z: number) => number, x: number, z: number, maxDistance = 250): number {
  const land = heightAt(x, z) > 0; // où est-on ?
  const radii = [8, 20, 40, 80, 150, maxDistance];
  for (const r of radii) {
    if (r > maxDistance) break;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r) > 0 !== land) return clamp(1 - r / maxDistance, 0.02, 1); // premier rayon où le milieu change
    }
  }
  return 0;
}
