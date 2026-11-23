// Le jeu : relie le monde, le rendu, les contrôles, les menus et la sauvegarde.
// C'est le seul endroit qui connaît tous les morceaux ; chaque morceau reste simple de son côté.

import { SaveData, readSavedSeed, sanitizeSave } from './core/save';
import { formatCount } from './core/format';
import { hashSeed } from './core/noise';
import { Settings, sanitizeSettings } from './core/settings';
import { START_LAT, dayOfYearFromDate, wrapDay } from './core/geo';
import { Origin, snapOrigin, updateOrigin } from './core/origin';
import { sunState, wrapHours } from './core/sun';
import { Terrain, createTerrain } from './core/terrain';
import { PlayerControls } from './player/controls';
import { GameScene } from './render/scene';
import { SAVE_KEY, SETTINGS_KEY, loadJson, saveJson } from './storage';
import { byId } from './ui/dom';
import { anyDialogOpen, bindDialog, openDialog } from './ui/dialogs';
import { Hud } from './ui/hud';
import { SettingsPanel } from './ui/settingsPanel';
import { toast } from './ui/toast';
import { ChunkManager } from './world/chunkManager';

const LOADING_TIMEOUT_S = 15; // au-delà, on arrête d'attendre le terrain et on prévient

export class Game {
  private settings: Settings; // réglages courants
  private hours: number; // heure solaire locale du jeu
  private day: number; // jour de l'année du jeu (1 à 365)
  private origin: Origin; // origine flottante du rendu (voir core/origin.ts)
  private readonly seedText: string; // graine du monde (texte)
  private readonly terrain: Terrain;
  private readonly gs: GameScene;
  private readonly chunks: ChunkManager;
  private readonly controls: PlayerControls;
  private readonly hud = new Hud();
  private readonly pause = byId('pause');
  private readonly settingsDialog = byId<HTMLDialogElement>('dialog-settings');
  private readonly helpDialog = byId<HTMLDialogElement>('dialog-help');
  private readonly settingsPanel: SettingsPanel;
  private started = false; // a-t-on déjà joué depuis l'ouverture ? (change le texte du bouton)
  private lastUnlock = 0; // instant de la dernière libération de la souris
  private loadingDone = false; // le terrain proche est-il arrivé ?
  private elapsed = 0; // secondes depuis le démarrage
  private last = performance.now(); // instant de l'image précédente
  private fpsFrames = 0; // images comptées depuis la dernière mise à jour du compteur
  private fpsTime = 0; // temps écoulé depuis la dernière mise à jour du compteur

  constructor() {
    this.settings = sanitizeSettings(loadJson(SETTINGS_KEY)); // réglages sûrs, même si le stockage est abîmé
    const rawSave = loadJson(SAVE_KEY);
    this.seedText = readSavedSeed(rawSave);
    const seed = hashSeed(this.seedText);
    this.terrain = createTerrain(seed);
    const save = sanitizeSave(rawSave, this.terrain, this.seedText, dayOfYearFromDate(new Date())); // position valable, sinon départ sur la plage
    this.hours = save.hours;
    this.day = save.day;
    this.origin = snapOrigin(save.x, save.z); // le rendu démarre près du joueur

    this.gs = new GameScene(byId('stage')); // peut lever une erreur si WebGL est indisponible : main.ts l'affiche
    this.gs.applySettings(this.settings);
    this.gs.resize();
    this.chunks = new ChunkManager(this.gs.scene, this.gs.terrainMaterial, seed, (message) =>
      toast(`Le terrain a rencontré un problème (${message}). Si des trous apparaissent, recharge la page.`, 'error'),
    );
    this.applyOrigin(); // le rendu (tuiles, grain du sol, vagues) apprend où est l'origine
    this.controls = new PlayerControls(this.gs.renderer.domElement, this.terrain, save);
    this.controls.sensitivity = this.settings.mouseSensitivity;
    this.hud.setFpsVisible(this.settings.showFps);
    this.settingsPanel = new SettingsPanel({
      getSettings: () => this.settings,
      setSettings: (next) => this.applySettings(next),
      getHours: () => this.hours,
      setHours: (h) => {
        this.hours = wrapHours(h);
      },
      getDay: () => this.day,
      setDay: (d) => {
        this.day = wrapDay(d);
      },
    });
    this.wireEvents();
    this.showPause(); // on démarre sur l'écran d'accueil
    if (new URLSearchParams(location.search).has('debug')) this.exposeDebug(); // outils de développement
  }

  // Lance la boucle d'animation.
  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ---------- Boucle principale ----------

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame); // prochaine image
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000)); // durée de l'image, bornée (retour d'onglet, etc.)
    this.last = now;
    this.elapsed += dt;
    if (this.controls.locked && this.settings.dayLengthMinutes > 0) {
      const before = this.hours; // heure avant ce pas de temps
      this.hours = wrapHours(this.hours + (dt * 24) / (this.settings.dayLengthMinutes * 60)); // le temps ne passe que quand on joue
      if (this.settings.daysPass && this.hours < before) this.day = wrapDay(this.day + 1); // minuit passé : le calendrier avance d'un jour
    }
    const origin = updateOrigin(this.origin, this.controls.x, this.controls.z); // le joueur s'est-il trop éloigné de l'origine ?
    if (origin !== this.origin) {
      this.origin = origin; // oui : l'origine saute sous le joueur (invisible, tout est replacé d'un coup)
      this.applyOrigin();
    }
    this.controls.update(dt, this.gs.camera, this.origin.x, this.origin.z);
    this.chunks.update(this.controls.x, this.controls.z, this.settings.viewDistance);
    this.gs.updateEnvironment(sunState(this.hours, START_LAT, this.day), now / 1000);
    this.gs.render();
    this.updateFps(dt);
    this.updateLoading();
    window.__thyReady = true; // le jeu a dessiné une image : l'écran de secours ne se déclenchera pas
  };

  // Transmet l'origine flottante à tout ce qui est dessiné.
  private applyOrigin(): void {
    this.chunks.setOrigin(this.origin);
    this.gs.setOrigin(this.origin);
  }

  // Compteur d'images par seconde, rafraîchi deux fois par seconde.
  private updateFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime < 0.5) return;
    if (this.settings.showFps) {
      const stats = this.chunks.stats();
      const tris = this.gs.renderer.info.render.triangles;
      this.hud.setFpsText(`${Math.round(this.fpsFrames / this.fpsTime)} i/s · ${stats.tiles} tuiles · ${formatCount(tris)} triangles`);
    }
    this.fpsFrames = 0;
    this.fpsTime = 0;
  }

  // Écran « le monde se forme » : disparaît quand le terrain proche est là (ou après un délai maximal).
  private updateLoading(): void {
    if (this.loadingDone) return;
    if (this.chunks.isReadyAround(this.controls.x, this.controls.z, 2)) {
      this.loadingDone = true;
      this.hud.setLoading(false);
    } else if (this.elapsed > LOADING_TIMEOUT_S) {
      this.loadingDone = true;
      this.hud.setLoading(false);
      toast('Le terrain met du temps à apparaître. Baisse la distance d\'affichage dans Réglages, ou recharge la page.', 'error');
    }
  }

  // ---------- Événements ----------

  private wireEvents(): void {
    byId('btn-resume').addEventListener('click', () => this.resume());
    byId('click-hint').addEventListener('click', () => this.resume());
    byId('btn-settings').addEventListener('click', () => this.openSettings());
    byId('btn-help').addEventListener('click', () => this.openHelp());
    byId('btn-reset').addEventListener('click', () => byId('rescue-reset').click()); // réutilise la remise à zéro de l'écran de secours
    bindDialog(this.settingsDialog, () => this.onDialogClosed());
    bindDialog(this.helpDialog, () => this.onDialogClosed());
    this.gs.renderer.domElement.addEventListener('click', () => {
      if (!this.controls.locked && !anyDialogOpen() && this.pause.hidden) this.resume(); // clic direct sur le monde (invitation affichée)
    });
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('pointerlockerror', () =>
      toast('Le navigateur n\'a pas donné le contrôle de la souris. Clique à nouveau sur le jeu.', 'error'),
    );
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('resize', () => this.gs.resize());
    window.addEventListener('pagehide', () => this.saveNow());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.saveNow(); // l'onglet passe en arrière-plan : on enregistre
    });
    window.setInterval(() => this.saveNow(), 5000); // et toutes les 5 secondes
    this.gs.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      toast('L\'affichage 3D a été interrompu par le navigateur. Recharge la page pour reprendre.', 'error');
    });
    this.controls.onBlocked = () => toast('L\'eau est trop profonde pour y marcher. Il faudra un bateau pour aller plus loin.');
    this.controls.onFlyChange = (on) =>
      toast(on ? 'Vol libre activé. Appuie sur V pour revenir à pied.' : 'Vol libre coupé : tu retombes doucement au sol.');
    this.controls.onHelpKey = () => this.openHelp();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || anyDialogOpen()) return; // dans une fenêtre, Échap la ferme déjà toute seule
    if (performance.now() - this.lastUnlock < 300) return; // Échap vient de libérer la souris : pas de double effet
    if (!this.controls.locked && !this.pause.hidden) {
      this.hidePause(); // Échap sur le menu : on le ferme pour voir le monde…
      this.hud.setHint(true); // …et on propose de reprendre d'un clic
    }
  }

  // ---------- Menu pause ----------

  private resume(): void {
    this.started = true;
    this.hidePause();
    this.hud.setHint(false);
    this.enterFullscreen(); // plein écran d'abord (le clic de l'utilisateur sert aux deux demandes)
    this.controls.requestLock(); // la souris est capturée : on joue
  }

  // Passe la page en plein écran si elle ne l'est pas déjà (doit venir d'un clic ou d'une touche).
  private enterFullscreen(): void {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return; // déjà en plein écran, ou non géré par ce navigateur
    try {
      void Promise.resolve(document.documentElement.requestFullscreen()).catch(() => undefined); // refus possible : on joue alors en fenêtre
    } catch {
      /* le navigateur a refusé : le jeu reste en fenêtre, sans gravité */
    }
  }

  private showPause(): void {
    byId('btn-resume').textContent = this.started ? 'Reprendre' : 'Entrer dans le monde';
    this.pause.hidden = false;
    this.hud.setHint(false);
    this.hud.setPlaying(false);
    byId('btn-resume').focus(); // le bouton principal est prêt au clavier
  }

  private hidePause(): void {
    this.pause.hidden = true;
  }

  private onLockChange(): void {
    const locked = this.controls.locked;
    this.hud.setPlaying(locked);
    if (locked) {
      this.hidePause();
      this.hud.setHint(false);
      return;
    }
    this.lastUnlock = performance.now();
    this.saveNow(); // on enregistre à chaque pause
    if (!anyDialogOpen()) this.showPause(); // la souris est libérée (Échap) : menu pause
  }

  private openSettings(): void {
    this.hidePause(); // on libère l'écran pour voir le monde pendant qu'on règle
    this.settingsPanel.sync();
    openDialog(this.settingsDialog);
  }

  private openHelp(): void {
    if (this.controls.locked) document.exitPointerLock(); // l'aide se lit à la souris
    this.hidePause();
    openDialog(this.helpDialog);
  }

  private onDialogClosed(): void {
    if (!this.controls.locked && !anyDialogOpen()) this.showPause(); // retour au menu
  }

  // ---------- Réglages et sauvegarde ----------

  private applySettings(next: Settings): void {
    this.settings = next;
    saveJson(SETTINGS_KEY, next);
    this.gs.applySettings(next);
    this.hud.setFpsVisible(next.showFps);
    this.controls.sensitivity = next.mouseSensitivity;
  }

  private saveNow(): void {
    const data: SaveData = {
      version: 1,
      seed: this.seedText,
      x: this.controls.x,
      z: this.controls.z,
      y: this.controls.y,
      yaw: this.controls.yaw,
      pitch: this.controls.pitch,
      hours: this.hours,
      day: this.day,
      fly: this.controls.fly,
    };
    saveJson(SAVE_KEY, data);
  }

  // ---------- Outils de développement (adresse terminée par ?debug) ----------

  private exposeDebug(): void {
    window.__thy = {
      teleport: (x, z, yaw, pitch, fly = false, y) => {
        this.controls.x = x;
        this.controls.z = z;
        this.controls.yaw = yaw;
        this.controls.pitch = pitch;
        this.controls.fly = fly;
        this.controls.y = y ?? this.terrain.heightAt(x, z) + 1.7;
      },
      setHours: (h) => {
        this.hours = wrapHours(h);
      },
      setDay: (d) => {
        this.day = wrapDay(d);
      },
      hideUi: () => {
        this.hidePause();
        this.hud.setLoading(false);
        byId('toast').hidden = true;
      },
      ready: () => this.chunks.isReadyAround(this.controls.x, this.controls.z, 2),
      pending: () => this.chunks.stats().pending,
      origin: () => ({ x: this.origin.x, z: this.origin.z, camera: [this.gs.camera.position.x, this.gs.camera.position.y, this.gs.camera.position.z] }),
      stats: () => ({ ...this.chunks.stats(), triangles: this.gs.renderer.info.render.triangles, calls: this.gs.renderer.info.render.calls }),
    };
  }
}
