// Le système audio du jeu : crée le contexte audio au premier geste du joueur (les navigateurs interdisent de jouer du son avant),
// suspend le son quand l'onglet est caché, et passe les niveaux du mixage au moteur.

import { SoundMix } from '../core/soundMix';
import { Ambient } from './ambient';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private ambient: Ambient | null = null;
  private mix: SoundMix | null = null; // dernier mixage reçu (appliqué dès que le contexte existe)
  private failed = false; // l'audio est-il indisponible (navigateur sans Web Audio) ?

  constructor() {
    const unlock = (): void => {
      this.start(); // premier geste : on peut créer le son
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend(); // onglet caché : silence
      else void this.ctx.resume();
    });
  }

  private start(): void {
    if (this.ctx || this.failed) return;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio indisponible');
      this.ctx = new Ctor();
      this.ambient = new Ambient(this.ctx);
      if (this.mix) this.ambient.apply(this.mix);
      void this.ctx.resume();
    } catch {
      this.failed = true; // pas de son, mais le jeu continue normalement
    }
  }

  // Nouveau mixage (quelques fois par seconde).
  setMix(mix: SoundMix): void {
    this.mix = mix;
    this.ambient?.apply(mix);
  }

  // À appeler à chaque image (planifie les gouttes isolées).
  tick(dt: number): void {
    this.ambient?.tick(dt);
  }
}
