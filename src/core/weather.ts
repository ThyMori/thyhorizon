// La météo simulée hors ligne (logique pure). Même lieu + même instant = même ciel, toujours.
// Elle dépend de trois choses : le CLIMAT du lieu (classification de Köppen : désert, tropical, océanique…),
// la SAISON (hémisphère compris : saison des pluies, étés secs, hivers dépressionnaires) et le TEMPS qui passe
// (des perturbations lentes qui traversent le monde en quelques jours : beau temps, nuages, pluie, retour du beau).
// Elle règle le ciel (nuages, lumière), la brume, la pluie et force le vent. En ligne (1.19), la vraie météo la remplacera.

import { Rgb, clamp, lerp, smoothstep } from './math';
import { Noise2D, hashSeed } from './noise';
import type { SunState } from './sun';
import type { Wind } from './wind';

// L'état du temps à un endroit et un instant.
export interface WeatherState {
  front: number; // −1 (anticyclone, beau temps stable) à +1 (perturbation active)
  cloud: number; // 0 (ciel dégagé) à 1 (totalement couvert)
  rain: number; // 0 (sec) à 1 (averse violente)
  fog: number; // 0 (visibilité parfaite) à 1 (brouillard épais)
  windScale: number; // facteur appliqué au vent simulé (0,6 calme plat … 2 coup de vent)
  pressure: number; // pression en hPa (indicatif)
}

export const CLEAR_WEATHER: WeatherState = { front: -0.3, cloud: 0.1, rain: 0, fog: 0, windScale: 1, pressure: 1020 };

const noise = new Noise2D(hashSeed('ThyHorizon-meteo')); // source des perturbations, toujours la même

// Ce que le climat permet : « wet » = part de temps humide possible, « fogProne » = tendance à la brume.
export interface ClimateProfile {
  wet: number; // 0 (désert) à 1 (équatorial humide)
  fogProne: number; // 0 à 1
}

// Saison d'un jour de l'année : +1 au cœur de l'été de l'hémisphère, −1 au cœur de l'hiver.
export function summerness(latDeg: number, day: number): number {
  const northSummer = -Math.cos((2 * Math.PI * (day - 15)) / 365); // +1 vers le 15 juillet
  return latDeg >= 0 ? northSummer : -northSummer;
}

// Traduit une classe de Köppen (ex. « Cfb », « Aw », « BWh ») en profil de temps, selon la saison.
export function climateProfile(cls: string, latDeg: number, day: number): ClimateProfile {
  const summer = summerness(latDeg, day);
  const k = cls[0] ?? 'C';
  const k2 = cls[1] ?? 'f';
  let wet: number;
  let fogProne = 0.25;
  switch (k) {
    case 'A': // tropical
      if (k2 === 'f') wet = 0.9; // toujours humide
      else if (k2 === 'm') wet = 0.7 + 0.2 * summer; // mousson
      else wet = 0.45 + 0.4 * summer; // savane : saison des pluies en été
      fogProne = 0.15;
      break;
    case 'B': // aride
      wet = k2 === 'W' ? 0.07 : 0.18; // désert / steppe
      fogProne = k2 === 'W' ? 0.1 : 0.15;
      break;
    case 'C': // tempéré
      if (k2 === 's') wet = 0.5 - 0.3 * summer; // méditerranéen : été sec
      else if (k2 === 'w') wet = 0.5 + 0.4 * summer; // hiver sec
      else wet = 0.64; // toute l'année humide (océanique, subtropical)
      fogProne = k2 === 'f' ? 0.45 : 0.3;
      break;
    case 'D': // continental
      wet = k2 === 'w' ? 0.4 + 0.35 * summer : 0.48;
      fogProne = 0.3;
      break;
    case 'E': // polaire
      wet = 0.3;
      fogProne = 0.55;
      break;
    default:
      wet = 0.5;
  }
  return { wet: clamp(wet, 0.02, 1), fogProne };
}

// Météo à une latitude/longitude (degrés), pour une classe de climat, un jour de l'année (1–365) et un temps continu
// tHours (heures de jeu depuis le début : sert à faire évoluer les perturbations), hourOfDay (0–24, pour la brume du matin).
export function weatherAt(latDeg: number, lonDeg: number, cls: string, day: number, tHours: number, hourOfDay: number): WeatherState {
  const prof = climateProfile(cls, latDeg, day);
  const lat = Math.abs(latDeg);
  const tDays = tHours / 24;
  // Perturbation synoptique : un champ de bruit qui dérive d'ouest en est en quelques jours (échelle ≈ 1500 km, vie ≈ 3 jours).
  const drift = lat > 25 ? tDays * 0.5 : tDays * 0.3; // aux latitudes moyennes, les systèmes passent plus vite
  const s = clamp(1.25 * noise.noise(lonDeg / 16 - drift, latDeg / 9 + tDays * 0.04), -1, 1);
  // Hiver et latitudes moyennes : plus de dépressions ; l'été, anticyclones plus stables.
  const winter = -summerness(latDeg, day);
  const storm = smoothstep(25, 45, lat) * (1 - smoothstep(65, 80, lat)) * 0.2 * winter;
  const front = clamp(s + storm, -1, 1);
  // Couverture nuageuse : le climat donne la tendance, la perturbation l'accentue ou la dissipe.
  const base = 0.22 + 0.5 * prof.wet;
  const cloud = clamp(base + 0.55 * front + 0.12 * noise.noise(lonDeg / 5 + tDays * 2.3, latDeg / 5 + 9.1), 0, 1);
  // Pluie : il faut un ciel bien chargé ET un climat qui s'y prête.
  const rain = clamp(smoothstep(0.62, 0.98, cloud) * (0.25 + 0.9 * prof.wet) - 0.05, 0, 1);
  // Brume : air calme et humide, surtout au petit matin ; n'arrive pas sous la pluie battante.
  const mist = noise.noise(lonDeg / 9 + 31.7 - tDays * 0.7, latDeg / 9 + tDays * 0.2 + 5.3); // champ lent
  const morning = 0.55 + 0.45 * Math.cos(((hourOfDay - 6) / 24) * 2 * Math.PI); // 1 à 6 h, 0,1 en fin d'après-midi
  const calm = 1 - smoothstep(0.1, 0.7, front); // la brume veut un air stable
  const fog = clamp(smoothstep(0.35, 0.85, mist) * prof.fogProne * 3 * morning * calm * (1 - rain), 0, 1);
  // Vent : plus fort dans une perturbation, plus faible sous un anticyclone.
  const windScale = clamp(1 + 0.55 * Math.max(0, front - 0.05) + 0.4 * Math.max(0, front - 0.6) - 0.3 * Math.max(0, -front), 0.6, 2);
  return { front, cloud, rain, fog, windScale, pressure: Math.round(1016 - 18 * front + 2 * noise.noise(lonDeg / 30, tDays)) };
}

// Passe en douceur d'une météo à la suivante (pas de saut quand on change de lieu ou d'heure).
export function blendWeather(from: WeatherState, to: WeatherState, k: number): WeatherState {
  const t = clamp(k, 0, 1);
  return {
    front: lerp(from.front, to.front, t),
    cloud: lerp(from.cloud, to.cloud, t),
    rain: lerp(from.rain, to.rain, t),
    fog: lerp(from.fog, to.fog, t),
    windScale: lerp(from.windScale, to.windScale, t),
    pressure: lerp(from.pressure, to.pressure, t),
  };
}

// Le vent simulé, ajusté par la météo.
export function weatherWind(base: Wind, w: WeatherState): Wind {
  return { speed: clamp(base.speed * w.windScale, 0.3, 32), from: base.from };
}

// Le ciel, ajusté par la météo : plus gris, moins de soleil, moins d'étoiles.
export function applyWeatherToSky(s: SunState, w: WeatherState): SunState {
  const cover = clamp(w.cloud, 0, 1);
  const overcast = smoothstep(0.25, 0.95, cover); // 0 dégagé … 1 plafond bas
  const grey = clamp(0.8 * overcast + 0.15 * w.rain + 0.2 * w.fog, 0, 0.95); // part de gris
  const dim = 1 - 0.38 * overcast - 0.2 * w.rain; // ciel un peu plus sombre
  const toGrey = (c: Rgb, bias: number): Rgb => {
    const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    const g = lum * bias; // gris de même luminosité
    return [lerp(c[0], g, grey) * dim, lerp(c[1], g, grey) * dim, lerp(c[2], g, grey) * dim];
  };
  const sunBlock = 1 - 0.88 * Math.pow(overcast, 1.2) - 0.08 * w.rain; // le soleil direct s'efface sous un ciel couvert
  return {
    ...s,
    skyTop: toGrey(s.skyTop, 0.95),
    skyHorizon: toGrey(s.skyHorizon, 1.05), // la brume reprend la couleur de l'horizon : mêmes retouches
    sunIntensity: s.sunIntensity * clamp(sunBlock, 0.08, 1),
    ambientIntensity: s.ambientIntensity * (1 - 0.12 * overcast), // le ciel couvert éclaire encore, de façon diffuse
    moonIntensity: s.moonIntensity * (1 - 0.8 * overcast),
    starsOpacity: s.starsOpacity * (1 - smoothstep(0.1, 0.55, cover)),
    sunVisibility: s.sunVisibility * (1 - smoothstep(0.35, 0.8, cover)),
  };
}

// Facteur de densité de la brume (1 = temps clair).
export const fogFactor = (w: WeatherState): number => 1 + 12 * w.fog * w.fog + 1.8 * w.rain + 0.6 * smoothstep(0.6, 1, w.cloud);

// Description courte du temps, en français.
export function weatherText(w: WeatherState, snow = 0): string {
  const parts: string[] = [];
  if (w.cloud < 0.2) parts.push('ciel dégagé');
  else if (w.cloud < 0.45) parts.push('quelques nuages');
  else if (w.cloud < 0.7) parts.push('nuageux');
  else if (w.cloud < 0.9) parts.push('très nuageux');
  else parts.push('ciel couvert');
  const snowy = snow > 0.5; // la précipitation est de la neige
  if (w.rain > 0.7) parts.push(snowy ? 'forte neige' : 'forte pluie');
  else if (w.rain > 0.35) parts.push(snowy ? 'neige' : 'pluie');
  else if (w.rain > 0.08) parts.push(snowy ? 'flocons' : 'bruine');
  if (w.fog > 0.6) parts.push('brouillard');
  else if (w.fog > 0.25) parts.push('brume');
  return parts.join(' · ');
}
