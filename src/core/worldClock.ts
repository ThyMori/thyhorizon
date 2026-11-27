// L'horloge unique du monde (1.45). Le jeu est en TEMPS RÉEL, toujours : une journée du jeu dure 24 h, l'heure et la date sont celles du lieu
// où se trouve le joueur (heure solaire locale), et le monde continue d'avancer quand le jeu est fermé.
// RÈGLE : aucun autre fichier ne lit l'heure de l'ordinateur (`Date.now()`, `new Date()`) ; tout passe par `worldClock`
// (un test, `noRawClock.test.ts`, le vérifie). Une seule exception voulue : les chronomètres d'image (`performance.now()`).
// Logique pure : la source de l'heure est injectée (les tests donnent une fausse horloge).

import { START_LON, realSolarClock, wrapDay } from './geo';

const HOUR_MS = 3600000; // une heure en millisecondes
const DAY_MS = 24 * HOUR_MS; // un jour en millisecondes

export interface SolarTime {
  hours: number; // heure solaire locale, de 0 à 24
  day: number; // jour de l'année (1 à 365)
}

export class WorldClock {
  private offsetMs = 0; // décalage d'essai : toujours 0 en jeu normal (seul `?debug` y touche)

  // source = donne l'heure réelle en millisecondes depuis 1970 (UTC). En jeu : `() => Date.now()`.
  constructor(private readonly source: () => number) {}

  // L'instant du monde, en millisecondes depuis 1970 (UTC). C'est LA date qu'on enregistre (date de pose d'une construction, etc.).
  now(): number {
    return this.source() + this.offsetMs;
  }

  // Le même instant sous forme de date (pour les calculs de calendrier).
  date(): Date {
    return new Date(this.now());
  }

  // Heures écoulées depuis 1970 : une mesure continue du temps (la météo y puise sans saut à minuit ni au changement d'année).
  hoursSinceEpoch(): number {
    return this.now() / HOUR_MS;
  }

  // Heure solaire et jour de l'année à une longitude donnée (le soleil est au sud à midi solaire : nuit à Paris pendant qu'il fait jour à Sydney).
  solar(lonDeg: number = START_LON): SolarTime {
    return realSolarClock(this.date(), lonDeg);
  }

  // ----- Outils d'essai (ne servent qu'avec `?debug` ; jamais appelés en jeu normal) -----

  // Avance le monde de `ms` millisecondes (positif ou négatif).
  advance(ms: number): void {
    if (Number.isFinite(ms)) this.offsetMs += ms;
  }

  // Cale l'heure solaire à la longitude donnée (le jour ne change pas, sauf passage de minuit proche).
  setSolarHours(hours: number, lonDeg: number = START_LON): void {
    const now = this.solar(lonDeg).hours;
    let delta = (((hours - now) % 24) + 24) % 24; // avance nécessaire, de 0 à 24 h
    if (delta > 12) delta -= 24; // on prend le chemin le plus court (le jour de l'année reste ainsi le même)
    this.advance(delta * HOUR_MS);
  }

  // Cale le jour de l'année (la date change, l'heure ne bouge pas).
  setDayOfYear(day: number, lonDeg: number = START_LON): void {
    let delta = wrapDay(day) - this.solar(lonDeg).day; // jours à ajouter
    if (delta > 182) delta -= 365; // plus court dans l'autre sens
    if (delta < -182) delta += 365;
    this.advance(delta * DAY_MS);
  }

  // Revient à l'heure réelle.
  reset(): void {
    this.offsetMs = 0;
  }

  // Le décalage actuel (0 en jeu normal) : sert à vérifier que le monde n'est pas en train d'être faussé.
  get testOffsetMs(): number {
    return this.offsetMs;
  }
}

// L'horloge du jeu : la seule du programme à lire l'heure de l'ordinateur.
export const worldClock = new WorldClock(() => Date.now());

