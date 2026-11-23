// Géographie et calendrier du monde : où l'on est sur la planète, quel jour de l'année, où est le soleil.
// Logique pure (aucun accès au DOM). Les formules sont celles de l'astronomie de position simplifiée :
// précises à un demi-degré près, largement assez pour un ciel de jeu.

// Lieu de départ : Lannion (Côtes-d'Armor), là où Thierry est né.
export const START_LAT = 48.73; // latitude en degrés (nord positif)
export const START_LON = -3.46; // longitude en degrés (est positif, donc ouest négatif)
export const START_PLACE = 'Lannion'; // nom du lieu de départ

const DEG = Math.PI / 180; // conversion degrés → radians
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // jours par mois (année de 365 jours, pas de 29 février)
const MONTH_NAMES = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']; // noms courts
export const DAYS_IN_YEAR = 365; // durée de l'année du jeu

// Mois (1 à 12) et jour du mois → numéro du jour dans l'année (1 à 365).
export function dayOfYear(month: number, dayOfMonth: number): number {
  const m = Math.min(12, Math.max(1, Math.round(month))); // mois borné
  let total = 0; // jours des mois déjà écoulés
  for (let i = 0; i < m - 1; i++) total += MONTH_LENGTHS[i]!; // on additionne les mois précédents
  return total + Math.min(MONTH_LENGTHS[m - 1]!, Math.max(1, Math.round(dayOfMonth))); // le 29 février devient le 28
}

// Numéro du jour dans l'année d'une vraie date (heure locale de l'ordinateur).
export const dayOfYearFromDate = (date: Date): number => dayOfYear(date.getMonth() + 1, date.getDate());

// Ramène un numéro de jour dans [1 ; 365] (366 → 1, 0 → 365).
export const wrapDay = (day: number): number => ((((Math.round(day) - 1) % DAYS_IN_YEAR) + DAYS_IN_YEAR) % DAYS_IN_YEAR) + 1;

// Numéro du jour → « 23 nov. ».
export function formatDay(day: number): string {
  let left = wrapDay(day); // jours restants à placer
  for (let i = 0; i < 12; i++) {
    if (left <= MONTH_LENGTHS[i]!) return `${left} ${MONTH_NAMES[i]}`; // on est dans ce mois
    left -= MONTH_LENGTHS[i]!; // mois suivant
  }
  return `31 ${MONTH_NAMES[11]}`; // jamais atteint, par sécurité
}

const OBLIQUITY = 23.44 * DEG; // inclinaison de l'axe de la Terre, en radians
const YEAR_DAYS = 365.2422; // durée de l'année tropique, en jours

// Longitude écliptique du soleil (radians) : 0 à l'équinoxe de mars (≈ 20 mars), 90° au solstice de juin.
const sunLongitude = (day: number): number => ((wrapDay(day) + 0.5 - 79.6) / YEAR_DAYS) * 2 * Math.PI;

// Déclinaison du soleil (angle entre le soleil et l'équateur) en degrés : +23,44° au solstice d'été, −23,44° à celui d'hiver.
export const declinationDeg = (day: number): number => Math.asin(Math.sin(OBLIQUITY) * Math.sin(sunLongitude(day))) / DEG;

// Ascension droite du soleil en degrés (0 à 360) : sa position le long de l'équateur céleste, qui avance d'environ 1° par jour.
export function sunRightAscensionDeg(day: number): number {
  const lambda = sunLongitude(day); // longitude écliptique
  return ((Math.atan2(Math.cos(OBLIQUITY) * Math.sin(lambda), Math.cos(lambda)) / DEG) + 360) % 360; // ramenée dans [0 ; 360[
}

// Angle sidéral local en degrés : de combien le ciel étoilé a tourné. Il vaut l'ascension droite des étoiles qui passent au sud à cet instant.
// Il est égal à l'ascension droite du soleil plus l'angle horaire du soleil (15° par heure solaire depuis midi).
export const siderealAngleDeg = (day: number, hours: number): number => (((sunRightAscensionDeg(day) + (hours - 12) * 15) % 360) + 360) % 360;

// Matrice 3×3 (9 nombres, ligne par ligne) qui fait passer une direction « équatoriale » (X vers le point vernal, Z vers le pôle nord céleste)
// dans le repère du jeu (+x est, +y haut, +z sud). Elle applique la rotation du ciel : latitude du lieu, jour et heure.
export function skyRotation(latDeg: number, day: number, hours: number): number[] {
  const phi = latDeg * DEG; // latitude
  const theta = siderealAngleDeg(day, hours) * DEG; // angle sidéral
  const [sp, cp, st, ct] = [Math.sin(phi), Math.cos(phi), Math.sin(theta), Math.cos(theta)]; // sinus et cosinus utiles
  return [
    -st, ct, 0, // x (est) = −ouest
    cp * ct, cp * st, sp, // y (haut)
    sp * ct, sp * st, -cp, // z (sud)
  ];
}

// Position du soleil dans le repère du jeu pour une latitude, un jour et une heure SOLAIRE locale (midi = soleil au sud).
// Renvoie la hauteur au-dessus de l'horizon (degrés) et le vecteur unitaire vers le soleil (+x est, +z sud, y haut).
export function sunPosition(latDeg: number, day: number, hours: number): { elevationDeg: number; direction: [number, number, number] } {
  const phi = latDeg * DEG; // latitude en radians
  const delta = declinationDeg(day) * DEG; // déclinaison en radians
  const hourAngle = (hours - 12) * 15 * DEG; // angle horaire : 15° par heure, 0 à midi
  const up = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(hourAngle); // composante verticale
  const south = Math.sin(phi) * Math.cos(delta) * Math.cos(hourAngle) - Math.cos(phi) * Math.sin(delta); // composante vers le sud
  const west = Math.cos(delta) * Math.sin(hourAngle); // composante vers l'ouest
  const elevationDeg = (Math.asin(Math.max(-1, Math.min(1, up))) * 180) / Math.PI; // hauteur en degrés
  return { elevationDeg, direction: [-west, up, south] }; // monde : +x = est (donc −ouest), +z = sud
}

// « Temps réel » : heure solaire locale et jour de l'année pour un instant réel (UTC), au lieu de départ.
// Le soleil est au sud à midi solaire, soit 12 h UTC corrigées de la longitude (15° = 1 h). Équation du temps ignorée (±15 min).
export function realSolarClock(date: Date, lonDeg = START_LON): { hours: number; day: number } {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600 + date.getUTCMilliseconds() / 3600000; // heure UTC décimale
  const solar = utcHours + lonDeg / 15; // heure solaire locale (peut sortir de 0 à 24)
  const hours = ((solar % 24) + 24) % 24; // ramenée entre 0 et 24
  const shift = Math.floor(solar / 24); // −1 : la date solaire est celle de la veille ; +1 : du lendemain
  const day = dayOfYear(date.getUTCMonth() + 1, date.getUTCDate()) + shift; // jour de l'année, décalé si besoin
  return { hours, day: wrapDay(day) };
}

// Heures de lever et de coucher (heure solaire, horizon géométrique) ; null au cercle polaire (jour ou nuit continus).
export function sunriseSunset(latDeg: number, day: number): { sunrise: number; sunset: number } | null {
  const c = -Math.tan(latDeg * DEG) * Math.tan(declinationDeg(day) * DEG); // cosinus de l'angle horaire du lever
  if (c >= 1 || c <= -1) return null; // le soleil ne se couche pas (ou ne se lève pas)
  const halfDay = (Math.acos(c) / DEG / 15); // demi-journée en heures
  return { sunrise: 12 - halfDay, sunset: 12 + halfDay };
}

// Heure de départ d'une partie neuve : une heure avant le coucher du soleil (la lumière dorée), sinon 17 h 30.
export function startHours(latDeg: number, day: number): number {
  const ss = sunriseSunset(latDeg, day); // lever et coucher du jour
  return ss ? Math.max(0, ss.sunset - 1) : 17.5; // repli pour les jours polaires
}

// ---------- Du monde du jeu à la latitude / longitude réelles ----------

export const METERS_PER_DEGREE = 111320; // longueur d'un degré de latitude, en mètres (1 m du jeu = 1 m réel)

// Le monde du jeu est centré sur le lieu de départ (x = 0, z = 0) : +x = est, +z = sud (donc le NORD est vers −z).
// Sur chaque ligne de latitude, un degré de longitude est plus court (× cos de la latitude) ; on garde cette relation.
const cosLat = (latDeg: number): number => Math.max(0.002, Math.cos((Math.min(89.9, Math.max(-89.9, latDeg)) * Math.PI) / 180));

// Latitude et longitude réelles (degrés) d'un point du monde du jeu (mètres depuis le départ).
export function worldToLatLon(x: number, z: number): { lat: number; lon: number } {
  const lat = Math.min(90, Math.max(-90, START_LAT - z / METERS_PER_DEGREE)); // vers le sud (z > 0), la latitude diminue
  return { lat, lon: START_LON + x / (METERS_PER_DEGREE * cosLat(lat)) };
}

// L'inverse : position dans le monde du jeu (mètres) d'une latitude et d'une longitude réelles.
export function latLonToWorld(latDeg: number, lonDeg: number): { x: number; z: number } {
  return { x: (lonDeg - START_LON) * METERS_PER_DEGREE * cosLat(latDeg), z: (START_LAT - latDeg) * METERS_PER_DEGREE };
}
