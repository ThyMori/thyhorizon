// Le seul fichier du jeu qui parle à Internet : il interroge Open-Meteo (temps et mer) quand l'option « météo réelle » est active.
// Jamais de plantage : une erreur réseau, un délai dépassé ou une réponse bizarre donnent simplement null (le jeu garde la météo simulée).

import { RealConditions, forecastUrl, marineUrl, parseForecast, parseMarine } from '../core/realWeather';

export type Fetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>; // forme minimale de fetch (remplaçable dans les tests)

const TIMEOUT_MS = 8000; // au-delà, on abandonne

// Demande une adresse et renvoie le JSON, ou null en cas de souci.
async function getJson(url: string, doFetch: Fetcher): Promise<unknown | null> {
  const ctl = new AbortController(); // permet d'interrompre la requête
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS); // minuterie de sécurité
  try {
    const res = await doFetch(url, { signal: ctl.signal }); // la requête (sans cookie ni identifiant)
    if (!res.ok) return null; // erreur du serveur
    return await res.json(); // contenu
  } catch {
    return null; // réseau coupé, délai dépassé, JSON invalide…
  } finally {
    clearTimeout(timer); // on arrête la minuterie
  }
}

// Récupère le temps et la mer pour un lieu (coordonnées arrondies par les fonctions d'adresse). null si rien d'exploitable.
export async function fetchRealConditions(lat: number, lon: number, nowMs: number, doFetch: Fetcher = (u, i) => fetch(u, { ...i, credentials: 'omit', referrerPolicy: 'no-referrer' })): Promise<RealConditions | null> {
  const [fc, mar] = await Promise.all([getJson(forecastUrl(lat, lon), doFetch), getJson(marineUrl(lat, lon), doFetch)]); // les deux requêtes en parallèle
  const forecast = fc ? parseForecast(fc) : null; // temps
  const hs = mar ? parseMarine(mar) : null; // vagues
  if (!forecast && hs === null) return null; // les deux ont échoué
  return { wind: forecast?.wind ?? null, weather: forecast?.weather ?? null, hs, fetchedAt: nowMs };
}
