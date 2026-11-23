// Application installable : enregistre le service worker, affiche le bandeau « Nouvelle version disponible »
// et gère le bouton « À jour ». Rien ne se recharge sans que la personne l'ait demandé.

import { byId } from '../ui/dom';
import { toast } from '../ui/toast';
import { watchUpdates } from './updates';

// Ce que le jeu fournit : sait-on qu'on est en train de jouer ? (le bandeau se tait alors, pour ne pas troubler la contemplation)
export interface PwaOptions {
  isPlaying: () => boolean;
}

export function initPwa({ isPlaying }: PwaOptions): void {
  const bar = byId('update-bar'); // bandeau « Nouvelle version disponible »
  let checkNow: () => Promise<void> = async () => {}; // vérification immédiate (réelle seulement une fois le service worker en place)

  // Pas de service worker en développement (npm run dev) : il garderait d'anciens fichiers en cache et brouillerait les essais.
  if ('serviceWorker' in navigator && !import.meta.env.DEV) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Service worker non enregistré :', error)); // chemin relatif : marche à la racine du site comme dans un dossier
    });
    const watcher = watchUpdates({
      sw: navigator.serviceWorker,
      doc: document,
      win: window,
      onUpdate: () => {
        bar.hidden = false; // le bandeau apparaît dans les menus (il est masqué en jeu par la feuille de style)
        if (isPlaying()) toast('Nouvelle version disponible : appuie sur Échap pour la charger.'); // pendant le jeu : un simple message discret
      },
    });
    checkNow = watcher.checkNow;
  }

  byId('update-now').addEventListener('click', () => window.location.reload()); // recharge : la nouvelle version est déjà en place
  byId('update-later').addEventListener('click', () => (bar.hidden = true)); // plus tard : le bandeau se ferme

  // Bouton « À jour » du menu : cherche la dernière version, puis recharge.
  const button = byId<HTMLButtonElement>('btn-update');
  button.addEventListener('click', async () => {
    button.disabled = true; // un seul essai à la fois
    toast('Recherche de la dernière version…');
    await checkNow(); // demande au serveur (sans effet hors ligne)
    window.location.reload(); // le service worker va chercher les fichiers frais (réseau d'abord)
  });
}
