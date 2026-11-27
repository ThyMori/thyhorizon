// La température de l'air et la neige (1.40). Logique pure : aucun DOM, aucun réseau.
// La température dépend de la latitude, de la saison (hémisphère compris), de l'heure solaire, de l'altitude et du temps
// (un ciel couvert garde la chaleur : nuits douces, jours frais ; un ciel dégagé refroidit la nuit).
// Quand il tombe de l'eau et qu'il fait froid, ce sont des flocons : `snowFraction`. Le sol blanchit (`stepSnowCover`) puis fond.

import { clamp, smoothstep } from './math';
import { summerness, WeatherState } from './weather';

// Température moyenne de l'année selon la latitude (°C) : ≈ 28 à l'équateur, ≈ 12 vers Lannion, ≈ −25 aux pôles.
export const meanTemperature = (latDeg: number): number => 28 - 0.0065 * latDeg * latDeg;

// Température de l'air (°C) à un lieu, un jour (0 à 364), une heure solaire, une altitude (m) et un temps donnés.
export function airTemperature(latDeg: number, day: number, hours: number, altitude: number, w: Pick<WeatherState, 'cloud' | 'front'>): number {
  const mean = meanTemperature(latDeg);
  const swing = Math.min(9, 0.15 * Math.abs(latDeg)) * summerness(latDeg, day); // été chaud, hiver froid (rien aux tropiques)
  const clear = 1 - clamp(w.cloud, 0, 1); // ciel dégagé = grands écarts entre jour et nuit
  const daily = (1.5 + 4 * clear) * Math.cos(((hours - 15) / 24) * 2 * Math.PI); // maximum vers 15 h, minimum vers 3 h
  const lapse = -0.0065 * Math.max(0, altitude); // −6,5 °C tous les 1 000 m
  const perturbation = -1.5 * clamp(w.front, -1, 1); // une perturbation amène de l'air plus frais
  return mean + swing + daily + lapse + perturbation;
}

// Part des précipitations qui tombe en neige : 1 sous −0,5 °C, 0 au-dessus de 2,5 °C.
export const snowFraction = (tempC: number): number => 1 - smoothstep(-0.5, 2.5, tempC);

// Épaisseur de neige au sol (0 à 1) : monte avec les chutes de neige, fond doucement au-dessus de 0 °C.
// `snowRate` = intensité de la neige qui tombe (0 à 1). `dt` en secondes. Un lieu chaud efface la neige d'un coup (téléportation).
export function stepSnowCover(cover: number, dt: number, snowRate: number, tempC: number): number {
  const gain = (clamp(snowRate, 0, 1) * dt) / 240; // une chute soutenue blanchit tout en 4 minutes
  const melt = tempC > 0.5 ? (tempC * dt) / 2400 : 0.00002 * dt; // fonte : plus vite quand il fait doux ; lente sublimation sinon
  const cap = 1 - smoothstep(2, 10, tempC); // au-dessus de ~10 °C la neige ne peut pas exister
  return clamp(Math.min(cover + gain - melt, cap), 0, 1);
}

// Température écrite en français : « −3 °C » (signe moins typographique, arrondi à l'entier).
export function temperatureText(tempC: number): string {
  const r = Math.round(tempC);
  return `${r < 0 ? '−' : ''}${Math.abs(r)} °C`;
}
