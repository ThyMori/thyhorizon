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

// Déclinaison du soleil (angle entre le soleil et l'équateur) en degrés : +23,44° au solstice d'été, −23,44° à celui d'hiver.
export const declinationDeg = (day: number): number => -23.44 * Math.cos(((2 * Math.PI) / DAYS_IN_YEAR) * (wrapDay(day) + 10));

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
