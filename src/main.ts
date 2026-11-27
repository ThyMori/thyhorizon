// Point d'entrée : démarre le jeu, et signale clairement tout échec au démarrage.

import './style.css';
import { Game } from './game';
import { toast } from './ui/toast';
import { loadCitiesBytes } from './world/citiesLoader';
import { loadReliefGrid } from './world/reliefLoader';

// Éléments ajoutés à « window » (par l'écran de secours de index.html et par les outils de développement).
declare global {
  interface Window {
    __thyReady?: boolean; // vrai dès que la première image est dessinée
    __thyFail?: (message: string) => void; // affiche l'écran de secours avec un message
    __thy?: {
      teleport(x: number, z: number, yaw: number, pitch: number, fly?: boolean, y?: number): void;
      moon(): { name: string; illumination: number; elevation: number; yaw: number; pitch: number }; // la Lune ici et maintenant (essais)
      setHours(hours: number): void;
      setDay(day: number): void; // change le jour de l'année (1 à 365)
      origin(): { x: number; z: number; camera: number[] }; // origine flottante et position de la caméra (pour vérifier)
      pose(): { x: number; z: number; yaw: number; pitch: number; fly: boolean; playing: boolean }; // position et regard (pour vérifier)
      view(mode: 'first' | 'third'): string; // change de vue (essais)
      water(): { ground: number; surface: number; depth: number }; // eau douce sous le joueur (essais)
      villages(): { shown: number; names: string[]; near: { name: string; x: number; z: number; r: number; houses: number; style: string; signs: { x: number; z: number; boards: number }[] }[] }; // villages dessinés (essais)
      edits(): { count: number; shown: number; persistent: boolean | null; worldVersion: number; list: { id: string; x: number; z: number }[] }; // constructions du joueur (essais)
      compass(): { card: number; text: string } | null; // état de la boussole (essais)
      hideUi(): void;
      boat(): { aboard: boolean; state: Record<string, unknown> | null; wind: { speed: number; from: number }; board(): void }; // le voilier (pour vérifier)
      sea(hs: number): string; // impose une mer de hauteur significative hs (m) pour les essais
      musicTest(scale?: string): Promise<{ rms: number; peak: number; bad: number; chords: number }>; // rend de la musique hors ligne et la mesure (essais)
      audioTest(over?: Record<string, unknown>, life?: Record<string, unknown>, boat?: Record<string, unknown>): Promise<{ rms: number; peak: number; bad: number }>; // rend du son hors ligne et le mesure (essais)
      real(c: { wind?: { speed: number; from: number } | null; weather?: { front: number; cloud: number; rain: number; fog: number; pressure: number } | null; hs?: number | null; waveFrom?: number | null; current?: { x: number; z: number } | null } | null): string; // impose des conditions « réelles » (essais)
      weather(w: { cloud?: number; rain?: number; fog?: number; windScale?: number } | null): string; // impose le temps (essais)
      temperature(t: number | null): string; // impose la température en °C (null = calculée) ; sous 0 °C la pluie devient neige (essais)
      snow(cover?: number): { temp: number; fall: number; cover: number }; // (cover : impose la neige au sol) température, part de neige dans la précipitation, neige au sol (essais)
      play(on: boolean): void; // fait « jouer » sans capture de souris (essais automatiques)
      ready(): boolean;
      pending(): number;
      stats(): { tiles: number; pending: number; triangles: number; calls: number };
    };
  }
}

void (async () => {
  try {
    const relief = await loadReliefGrid(); // le relief réel de la Terre (≈ 0,9 Mo, mis en cache ensuite)
    const cities = await loadCitiesBytes(); // les villes réelles du monde (≈ 1,4 Mo, mis en cache ensuite)
    const game = new Game(relief, cities); // peut échouer (WebGL absent, par exemple)
    game.start();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    window.__thyFail?.(`Démarrage impossible : ${reason}. Vérifie ta connexion et que l'accélération graphique est activée dans ton navigateur.`);
  }
})();

// Une erreur imprévue pendant le jeu : un message clair plutôt qu'un écran figé sans explication.
window.addEventListener('error', (event) => {
  if (window.__thyReady) toast(`Une erreur est survenue (${event.message}). Si le jeu se comporte bizarrement, recharge la page.`, 'error');
});
