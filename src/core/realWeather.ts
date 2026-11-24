// Météo et houle réelles (Open-Meteo) : logique pure, sans réseau ni DOM.
// Ici : choix des coordonnées envoyées (arrondies), adresses des requêtes, lecture des réponses, conversion en état du jeu.
// L'appel réseau lui-même est dans src/net/openMeteo.ts (le seul fichier qui touche Internet).

import { clamp, smoothstep } from './math';
import { BASE_HS, SeaState } from './sea';
import { WeatherState } from './weather';
import { Wind } from './wind';

export const ATTRIBUTION = 'Données météo : Open-Meteo.com (licence CC BY 4.0)'; // mention obligatoire de la licence
export const GRID_DEG = 0.5; // pas d'arrondi des coordonnées envoyées (≈ 55 km) : on ne révèle pas ta position exacte
export const REFRESH_SECONDS = 15 * 60; // le temps réel change lentement : une requête toutes les 15 minutes au plus
export const RETRY_SECONDS = 5 * 60; // après un échec (réseau coupé…), on réessaie plus tard

// Ce qu'on garde d'une réponse, déjà converti dans les unités du jeu.
export interface RealConditions {
  wind: Wind | null; // vent moyen à 10 m (m/s, direction d'origine en radians)
  weather: Pick<WeatherState, 'front' | 'cloud' | 'rain' | 'fog' | 'pressure'> | null; // ciel et pression
  hs: number | null; // hauteur significative réelle des vagues (m) ; null sur terre ou si la mer n'est pas fournie
  fetchedAt: number; // instant de la mesure (ms, horloge réelle)
}

// Arrondit une coordonnée à la grille (évite d'envoyer la position exacte, et permet de réutiliser la réponse en bougeant un peu).
export const roundCoord = (deg: number): number => Math.round(deg / GRID_DEG) * GRID_DEG;

// Clé d'une case de la grille (pour savoir si on a changé de case).
export const cellKey = (lat: number, lon: number): string => `${roundCoord(lat).toFixed(1)},${roundCoord(lon).toFixed(1)}`;

// Faut-il (re)demander des données ? Oui si la case a changé, si la réponse est vieille, ou si la dernière tentative a échoué depuis assez longtemps.
export function needsRefresh(state: { key: string; at: number; ok: boolean } | null, key: string, nowMs: number): boolean {
  if (!state) return true; // jamais demandé
  if (state.key !== key) return nowMs - state.at > 20_000; // nouvelle case : on demande, mais pas plus d'une fois toutes les 20 s
  const wait = (state.ok ? REFRESH_SECONDS : RETRY_SECONDS) * 1000; // attente avant la prochaine tentative
  return nowMs - state.at > wait;
}

// Adresse de la requête « temps » (vent, nuages, pluie, pression, visibilité). Vitesses en m/s.
export function forecastUrl(lat: number, lon: number): string {
  const q = `latitude=${roundCoord(lat).toFixed(1)}&longitude=${roundCoord(lon).toFixed(1)}`;
  return `https://api.open-meteo.com/v1/forecast?${q}&current=wind_speed_10m,wind_direction_10m,cloud_cover,precipitation,pressure_msl,visibility&wind_speed_unit=ms&timezone=GMT`;
}

// Adresse de la requête « mer » (hauteur des vagues).
export function marineUrl(lat: number, lon: number): string {
  const q = `latitude=${roundCoord(lat).toFixed(1)}&longitude=${roundCoord(lon).toFixed(1)}`;
  return `https://marine-api.open-meteo.com/v1/marine?${q}&current=wave_height,wave_direction,swell_wave_height,wind_wave_height,wave_period&timezone=GMT`;
}

// Lit un nombre dans un objet inconnu (la réponse d'un serveur n'est jamais crue sur parole).
function field(obj: unknown, key: string): number | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// Convertit la réponse « temps » (ou null si elle est inutilisable).
export function parseForecast(json: unknown): Pick<RealConditions, 'wind' | 'weather'> | null {
  const cur = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).current : null;
  if (typeof cur !== 'object' || cur === null) return null;
  const speed = field(cur, 'wind_speed_10m');
  const dir = field(cur, 'wind_direction_10m');
  const cloud = field(cur, 'cloud_cover');
  const rain = field(cur, 'precipitation');
  const pressure = field(cur, 'pressure_msl');
  const visibility = field(cur, 'visibility');
  const wind: Wind | null = speed !== null && dir !== null ? { speed: clamp(speed, 0, 40), from: (((dir % 360) + 360) % 360) * (Math.PI / 180) } : null;
  if (!wind && cloud === null && pressure === null) return null; // rien d'exploitable
  const weather = {
    front: pressure !== null ? clamp((1015 - pressure) / 20, -1, 1) : 0, // basse pression = perturbation
    cloud: cloud !== null ? clamp(cloud / 100, 0, 1) : 0.3,
    rain: rain !== null ? Math.sqrt(clamp(rain / 8, 0, 1)) : 0, // 8 mm/h = averse violente ; racine pour que la bruine se voie
    fog: visibility !== null ? clamp((4000 - visibility) / 4000, 0, 1) ** 2 : 0, // brouillard sous ~1 km
    pressure: pressure !== null ? clamp(pressure, 900, 1080) : 1015,
  };
  return { wind, weather };
}

// Convertit la réponse « mer » : hauteur significative des vagues (null sur terre : l'API répond alors sans valeur).
export function parseMarine(json: unknown): number | null {
  const cur = typeof json === 'object' && json !== null ? (json as Record<string, unknown>).current : null;
  const hs = field(cur, 'wave_height');
  return hs === null ? null : clamp(hs, 0, 15);
}

// État de mer visé quand la hauteur des vagues est connue : la houle suit la mesure, le clapot et les moutons suivent le vent local.
export function seaFromReal(hs: number, windSpeed: number): SeaState {
  return {
    swell: clamp(hs / BASE_HS, 0.12, 5),
    chop: clamp(windSpeed / 7, 0.15, 2.2),
    foam: smoothstep(5.5, 14, windSpeed) * 0.9,
    hs,
  };
}

// Vent à utiliser : le vent réel s'il existe (avec de petites rafales), sinon null (le jeu retombe sur le vent simulé).
export function realWindWithGusts(real: Wind | null, tSeconds: number): Wind | null {
  if (!real) return null;
  const gust = 0.06 * Math.sin(tSeconds * 0.52) + 0.05 * Math.sin(tSeconds * 0.19) + 0.03 * Math.sin(tSeconds * 1.3 + 2); // mêmes rafales que le vent simulé
  return { speed: clamp(real.speed * (1 + gust), 0.3, 32), from: real.from };
}

// Rapproche doucement un vent d'un autre (la vitesse et la direction par le plus court chemin) : pas de saut quand la réponse arrive.
export function approachWind(current: Wind, target: Wind, k: number): Wind {
  const t = clamp(k, 0, 1);
  let d = target.from - current.from; // écart d'angle
  d = ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI; // ramené entre −π et π
  return { speed: current.speed + (target.speed - current.speed) * t, from: (current.from + d * t + 2 * Math.PI) % (2 * Math.PI) };
}
