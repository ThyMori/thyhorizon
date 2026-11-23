// Messages à l'utilisateur : un seul à la fois, visible où qu'on soit, qui disparaît après 6 secondes.
// Un message dit ce qui s'est passé ET quoi faire ensuite, en français simple.

import { byId } from './dom';

export type ToastKind = 'info' | 'error' | 'success';

let timer: number | undefined; // minuteur de disparition en cours

export function toast(message: string, kind: ToastKind = 'info'): void {
  const el = byId('toast'); // le conteneur du message
  el.textContent = message; // textContent : jamais de HTML interprété
  el.className = kind === 'info' ? '' : kind; // la classe colore le bord
  el.hidden = false; // on l'affiche (un nouveau message remplace l'ancien)
  window.clearTimeout(timer); // on annule la disparition précédente
  timer = window.setTimeout(() => {
    el.hidden = true; // disparaît après 6 secondes
  }, 6000);
}
