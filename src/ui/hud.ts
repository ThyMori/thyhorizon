// Affichage tête haute : compteur d'images, version, viseur, attente, pastille « update en cours ».

import { UPDATE_PENDING } from '../flags';
import { VERSION } from '../version';
import { byId } from './dom';

export class Hud {
  private readonly fps = byId('fps');
  private readonly loading = byId('loading');
  private readonly hint = byId('click-hint');

  constructor() {
    byId('version-badge').textContent = `ThyHorizon v${VERSION}`; // numéro de version, en petit en bas de l'écran
    byId('pause-version').textContent = `Version ${VERSION}`; // et dans le menu pause
    byId('help-version').textContent = `Version ${VERSION}`; // et dans l'aide
    byId('update-dot').hidden = !UPDATE_PENDING; // pastille rouge seulement si une mise à jour externe est en attente
  }

  // Affiche ou cache le compteur d'images par seconde.
  setFpsVisible(visible: boolean): void {
    this.fps.hidden = !visible;
  }

  setFpsText(text: string): void {
    this.fps.textContent = text;
  }

  // Écran « le monde se forme ».
  setLoading(loading: boolean): void {
    this.loading.hidden = !loading;
  }

  // Invitation « Clique pour reprendre ».
  setHint(visible: boolean): void {
    this.hint.hidden = !visible;
  }

  // Marque l'état « on joue » (affiche le viseur).
  setPlaying(playing: boolean): void {
    document.body.classList.toggle('is-playing', playing);
  }
}
