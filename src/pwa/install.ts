// Invitation à installer ThyHorizon comme une application (ordinateur ou téléphone), sur le modèle de ThyChat.
// - Chrome, Edge, Android : le navigateur envoie « beforeinstallprompt » ; « Installer » ouvre sa fenêtre native.
// - iPhone / iPad (Safari), Safari sur Mac : pas d'installation par programme, on affiche le guide.
// - Déjà installée (ouverte en mode application) : rien n'est proposé.
// Les règles (report d'une semaine, trois fois au plus) sont dans core/install.ts.

import { InstallState, bannerAllowed, detectPlatform, sanitizeInstallState, snooze } from '../core/install';
import { byId } from '../ui/dom';

// Événement du navigateur qui propose l'installation (absent des types standard).
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const KEY = 'thyhorizon.install'; // clé de stockage de l'état d'installation

// Lit l'état gardé sur l'appareil (jamais d'erreur : stockage bloqué = état vide).
function load(): InstallState {
  try {
    return sanitizeInstallState(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return {};
  }
}

// Fusionne un changement dans l'état gardé.
function save(patch: InstallState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch }));
  } catch {
    /* stockage indisponible : le rappel reviendra, sans conséquence */
  }
}

// L'application tourne-t-elle déjà comme une application (fenêtre dédiée) ?
function isStandalone(): boolean {
  const matches = (query: string): boolean => Boolean(window.matchMedia?.(query).matches);
  return (
    matches('(display-mode: standalone)') ||
    matches('(display-mode: fullscreen)') ||
    matches('(display-mode: minimal-ui)') ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true // Safari iOS
  );
}

// Ce que le jeu fournit pour ouvrir et fermer la fenêtre du guide (il gère aussi le retour au menu).
export interface InstallOptions {
  openGuide: () => void;
  closeGuide: () => void;
}

export function initInstall({ openGuide, closeGuide }: InstallOptions): void {
  const platform = detectPlatform(navigator);
  let deferred: InstallPromptEvent | null = null; // événement « beforeinstallprompt » mis de côté
  const banner = byId('install-banner');
  const installed = (): boolean => isStandalone() || load().installed === true;

  // Met à jour ce qui est affiché selon l'état.
  function refresh(): void {
    byId('btn-install').hidden = installed(); // le bouton du menu reste disponible tant que ce n'est pas installé (même après trois reports)
    banner.hidden = !bannerAllowed(load(), Date.now(), platform, isStandalone());
    byId('install-now').textContent = deferred ? 'Installer' : 'Voir comment';
    byId('install-prompt').hidden = !deferred; // le bouton natif n'existe que si le navigateur l'a proposé
  }

  // « Plus tard » : report d'une semaine.
  function later(): void {
    save(snooze(load(), Date.now()));
    refresh();
  }

  // Installe si le navigateur le permet, sinon montre le guide.
  async function promptInstall(): Promise<void> {
    if (!deferred) return openGuide();
    const event: InstallPromptEvent = deferred;
    deferred = null; // l'événement ne peut servir qu'une fois
    try {
      await event.prompt();
      const choice = await event.userChoice;
      if (choice.outcome === 'accepted') save({ installed: true });
      else save(snooze(load(), Date.now()));
    } catch {
      /* fenêtre fermée ou refusée : on n'insiste pas */
    }
    closeGuide();
    refresh();
  }

  // Le guide met l'appareil de la personne en premier et le déplie.
  const dialog = byId<HTMLDialogElement>('dialog-install');
  for (const details of dialog.querySelectorAll<HTMLDetailsElement>('details[data-platform]')) {
    const here = details.dataset.platform === platform;
    details.open = here; // déplié pour cet appareil
    details.style.order = here ? '-1' : '0'; // et placé en premier
    details.querySelector<HTMLElement>('.here')!.hidden = !here; // étiquette « Ton appareil »
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // on affiche notre propre invitation, au bon moment
    deferred = event as InstallPromptEvent;
    save({ installed: false }); // le navigateur propose l'installation : elle n'est donc pas faite
    refresh();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    save({ installed: true });
    closeGuide();
    refresh();
  });

  byId('install-now').addEventListener('click', () => void promptInstall());
  byId('install-prompt').addEventListener('click', () => void promptInstall());
  byId('install-later').addEventListener('click', later);
  byId('btn-install').addEventListener('click', () => void promptInstall()); // le bouton du menu installe directement quand c'est possible, sinon ouvre le guide

  // Chrome / Edge : détecte une installation faite plus tôt quand on ouvre le site dans un onglet.
  const related = (navigator as Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> }).getInstalledRelatedApps;
  related?.call(navigator)
    .then((apps) => {
      if (apps.length > 0 && !deferred) {
        save({ installed: true });
        refresh();
      }
    })
    .catch(() => {});

  refresh();
}
