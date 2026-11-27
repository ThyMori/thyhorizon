// La vraie Lune : sa position dans le ciel et sa phase, calculées d'après la date réelle (formules astronomiques simplifiées,
// précision d'environ 0,3° pour la position et quelques minutes pour les levers et couchers). Logique pure.
// Le jeu connaît un jour de l'année (1 à 365) et une heure SOLAIRE locale ; l'année est celle de l'année en cours (la Lune
// y a donc ses vraies phases : en « temps réel », c'est celle du ciel d'aujourd'hui).

import { DAYS_IN_YEAR, siderealAngleDeg, skyRotation } from './geo';
import { worldClock } from './worldClock';

const DEG = Math.PI / 180;
export const CURRENT_YEAR = worldClock.date().getUTCFullYear(); // année de référence du calendrier du jeu (lue sur l'horloge du monde)

// Jour julien (jours depuis −4712) d'un instant : jour de l'année (1 = 1er janvier), heure UT (0 à 24).
export function julianDay(year: number, day: number, utHours: number): number {
  return Date.UTC(year, 0, 1) / 86400000 + 2440587.5 + (day - 1) + utHours / 24; // 1970-01-01 = JD 2440587,5
}

const mod360 = (a: number): number => ((a % 360) + 360) % 360;

// Longitude écliptique du Soleil (degrés), formule simple (±0,01°).
function sunEclipticLongitude(jd: number): number {
  const d = jd - 2451545;
  const g = mod360(357.528 + 0.9856003 * d); // anomalie moyenne
  return mod360(280.46 + 0.9856474 * d + 1.915 * Math.sin(g * DEG) + 0.02 * Math.sin(2 * g * DEG));
}

// Position écliptique de la Lune : longitude, latitude (degrés) — série abrégée de l'Astronomical Almanac.
function moonEcliptic(jd: number): { lon: number; lat: number } {
  const t = (jd - 2451545) / 36525; // siècles depuis J2000
  const s = (a: number, b: number): number => Math.sin((a + b * t) * DEG);
  const lon = 218.32 + 481267.881 * t + 6.29 * s(135, 477198.87) - 1.27 * s(259.3, -413335.36) + 0.66 * s(235.7, 890534.22) + 0.21 * s(269.9, 954397.74) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.5, 966404.03);
  const lat = 5.13 * s(93.3, 483202.02) + 0.28 * s(228.2, 960400.89) - 0.28 * s(318.3, 6003.15) - 0.17 * s(217.6, -407332.21);
  return { lon: mod360(lon), lat };
}

// Ascension droite et déclinaison de la Lune (degrés).
export function moonEquatorial(jd: number): { ra: number; dec: number } {
  const { lon, lat } = moonEcliptic(jd);
  const eps = (23.439 - 0.00000036 * (jd - 2451545)) * DEG; // inclinaison de l'axe de la Terre
  const l = Math.cos(lat * DEG) * Math.cos(lon * DEG);
  const m = Math.cos(lat * DEG) * Math.sin(lon * DEG);
  const n = Math.sin(lat * DEG);
  const x = l;
  const y = m * Math.cos(eps) - n * Math.sin(eps);
  const z = m * Math.sin(eps) + n * Math.cos(eps);
  return { ra: mod360(Math.atan2(y, x) / DEG), dec: Math.asin(Math.max(-1, Math.min(1, z))) / DEG };
}

export interface MoonPhase {
  elongation: number; // angle Lune–Soleil le long de l'écliptique (0 = nouvelle, 90 = premier quartier, 180 = pleine, 270 = dernier quartier)
  illumination: number; // part du disque éclairée, de 0 à 1
  name: string; // nom de la phase en français
}

// Nom de la phase d'après l'élongation (huit phases).
export function phaseName(elongation: number): string {
  const e = mod360(elongation);
  if (e < 22.5 || e >= 337.5) return 'nouvelle lune';
  if (e < 67.5) return 'premier croissant';
  if (e < 112.5) return 'premier quartier';
  if (e < 157.5) return 'lune gibbeuse croissante';
  if (e < 202.5) return 'pleine lune';
  if (e < 247.5) return 'lune gibbeuse décroissante';
  if (e < 292.5) return 'dernier quartier';
  return 'dernier croissant';
}

// Phase de la Lune à un instant (jour julien).
export function moonPhase(jd: number): MoonPhase {
  const elongation = mod360(moonEcliptic(jd).lon - sunEclipticLongitude(jd));
  return { elongation, illumination: (1 - Math.cos(elongation * DEG)) / 2, name: phaseName(elongation) };
}

export interface MoonState extends MoonPhase {
  direction: [number, number, number]; // vecteur unitaire vers la Lune dans le repère du jeu (+x est, +y haut, +z sud)
  elevationDeg: number; // hauteur au-dessus de l'horizon (négatif = couchée)
}

// La Lune vue du lieu (latitude, longitude en degrés) un jour de l'année à une heure SOLAIRE locale.
// Elle est placée avec la même rotation du ciel que les étoiles (core/geo.ts) : elle reste cohérente avec elles.
export function moonState(latDeg: number, lonDeg: number, day: number, hours: number, year = CURRENT_YEAR): MoonState {
  const utHours = hours - lonDeg / 15; // heure solaire locale → heure UT
  const jd = julianDay(year, day, utHours);
  const { ra, dec } = moonEquatorial(jd);
  // Direction dans le repère équatorial (X vers le point vernal, Z vers le pôle nord céleste), puis rotation vers le repère du jeu.
  const eq: [number, number, number] = [Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG)];
  const m = skyRotation(latDeg, day, hours);
  const direction: [number, number, number] = [
    m[0]! * eq[0] + m[1]! * eq[1] + m[2]! * eq[2],
    m[3]! * eq[0] + m[4]! * eq[1] + m[5]! * eq[2],
    m[6]! * eq[0] + m[7]! * eq[1] + m[8]! * eq[2],
  ];
  return { ...moonPhase(jd), direction, elevationDeg: Math.asin(Math.max(-1, Math.min(1, direction[1]))) / DEG };
}

// Lever et coucher de la Lune ce jour-là (heures solaires locales, pas de 6 min). Un des deux peut manquer (la Lune se lève ou se couche
// avec ~50 min de retard chaque jour : certains jours n'ont pas de lever).
export function moonRiseSet(latDeg: number, lonDeg: number, day: number, year = CURRENT_YEAR): { rise: number | null; set: number | null } {
  let rise: number | null = null;
  let set: number | null = null;
  let prev = moonState(latDeg, lonDeg, day, 0, year).elevationDeg;
  for (let h = 0.1; h <= 24.0001; h += 0.1) {
    const e = moonState(latDeg, lonDeg, day, h, year).elevationDeg;
    if (prev < 0 && e >= 0 && rise === null) rise = h - (0.1 * e) / (e - prev); // interpolation linéaire du passage de l'horizon
    if (prev >= 0 && e < 0 && set === null) set = h - (0.1 * -e) / (prev - e);
    prev = e;
  }
  return { rise, set };
}

// Texte pour les réglages : phase, part éclairée, et si elle est visible.
export function moonText(m: MoonState): string {
  return `${m.name} (${Math.round(m.illumination * 100)} % éclairée)${m.elevationDeg > 0 ? ', dans le ciel' : ', sous l’horizon'}`;
}

export { DAYS_IN_YEAR, siderealAngleDeg }; // (réexport pratique pour les tests)
