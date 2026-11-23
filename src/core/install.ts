// Règles de l'invitation à installer l'application (comme dans ThyChat). Logique pure : aucun accès au navigateur.
// - « Plus tard » reporte le rappel d'une semaine ; après 3 reports il ne revient plus tout seul
//   (le bouton « Installer l'application » reste dans le menu).
// - Rien n'est proposé si l'application est déjà installée, ni sur Firefox pour ordinateur (qui ne sait pas installer).

export type Platform = 'ios' | 'android' | 'firefox-desktop' | 'mac-safari' | 'desktop-chromium';

// Ce qui est gardé sur l'appareil (localStorage).
export interface InstallState {
  installed?: boolean; // l'application a-t-elle été installée ?
  snoozedUntil?: number; // pas de rappel avant cet instant (millisecondes)
  count?: number; // nombre de fois où l'on a répondu « Plus tard »
}

export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // une semaine
export const MAX_SNOOZES = 3; // au plus trois reports

// Détecte le type d'appareil d'après le navigateur.
export function detectPlatform(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }): Platform {
  const ua = nav.userAgent || '';
  const iPadOnMac = nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1; // iPadOS se présente comme un Mac
  if (/iPhone|iPad|iPod/.test(ua) || iPadOnMac) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Firefox\//.test(ua)) return 'firefox-desktop';
  if (/Macintosh/.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(ua)) return 'mac-safari';
  return 'desktop-chromium';
}

// Nettoie un état lu dans le stockage (valeur absente, abîmée ou étrange → état vide).
export function sanitizeInstallState(raw: unknown): InstallState {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const state: InstallState = {};
  if (typeof r.installed === 'boolean') state.installed = r.installed;
  if (typeof r.snoozedUntil === 'number' && Number.isFinite(r.snoozedUntil)) state.snoozedUntil = r.snoozedUntil;
  if (typeof r.count === 'number' && Number.isFinite(r.count) && r.count >= 0) state.count = Math.floor(r.count);
  return state;
}

// Le bandeau d'invitation a-t-il le droit de s'afficher maintenant ?
export function bannerAllowed(state: InstallState, now: number, platform: Platform, standalone: boolean): boolean {
  if (standalone || state.installed === true) return false; // déjà installée
  if (platform === 'firefox-desktop') return false; // rien à proposer
  if ((state.count ?? 0) >= MAX_SNOOZES) return false; // trop de reports : seulement dans le menu
  return now >= (state.snoozedUntil ?? 0); // pas pendant un report
}

// « Plus tard » : reporte d'une semaine et compte le report.
export function snooze(state: InstallState, now: number): InstallState {
  return { ...state, snoozedUntil: now + SNOOZE_MS, count: (state.count ?? 0) + 1 };
}
