// Le jeu : relie le monde, le rendu, les contrôles, les menus et la sauvegarde.
// C'est le seul endroit qui connaît tous les morceaux ; chaque morceau reste simple de son côté.

import { SaveData, readSavedSeed, sanitizeSave } from './core/save';
import { formatCount } from './core/format';
import { hashSeed } from './core/noise';
import { Settings, sanitizeSettings } from './core/settings';
import { START_LAT, dayOfYearFromDate, wrapDay } from './core/geo';
import { Origin, snapOrigin, updateOrigin } from './core/origin';
import { sunState, wrapHours } from './core/sun';
import { createRelief } from './core/relief';
import type { ReliefGrid } from './core/relief';
import { Terrain, createTerrain } from './core/terrain';
import { PlayerControls } from './player/controls';
import { TouchUi } from './player/touchUi';
import { GameScene } from './render/scene';
import { SAVE_KEY, SETTINGS_KEY, loadJson, saveJson } from './storage';
import { byId } from './ui/dom';
import { anyDialogOpen, bindDialog, openDialog } from './ui/dialogs';
import { Hud } from './ui/hud';
import { initInstall } from './pwa/install';
import { initPwa } from './pwa/pwa';
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
  private readonly installDialog = byId<HTMLDialogElement>('dialog-install');
  private readonly settingsPanel: SettingsPanel;
  private touchUi!: TouchUi; // commandes tactiles (créées avec les contrôles)
  private touchMode = false; // joue-t-on au doigt ?
  private fullscreenPending: Promise<void> | null = null; // demande de plein écran en cours
  private wantsLock = false; // a-t-on demandé la capture de la souris (et attend-on la réponse) ?
  private lockRetries = 0; // nouvelles tentatives silencieuses déjà faites
  private lockTimer = 0; // minuteur de la prochaine tentative
  private started = false; // a-t-on déjà joué depuis l'ouverture ? (change le texte du bouton)
  private lastUnlock = 0; // instant de la dernière libération de la souris
  private loadingDone = false; // le terrain proche est-il arrivé ?
  private elapsed = 0; // secondes depuis le démarrage
  private last = performance.now(); // instant de l'image précédente
  private fpsFrames = 0; // images comptées depuis la dernière mise à jour du compteur
  private fpsTime = 0; // temps écoulé depuis la dernière mise à jour du compteur

  constructor(reliefGrid: ReliefGrid) {
    this.settings = sanitizeSettings(loadJson(SETTINGS_KEY)); // réglages sûrs, même si le stockage est abîmé
    const rawSave = loadJson(SAVE_KEY);
    this.seedText = readSavedSeed(rawSave);
    const seed = hashSeed(this.seedText);
    this.terrain = createTerrain(seed, createRelief(reliefGrid)); // le vrai relief de la Terre + un détail inventé
    const save = sanitizeSave(rawSave, this.terrain, this.seedText, dayOfYearFromDate(new Date())); // position valable, sinon départ sur la plage
    this.hours = save.hours;
    this.day = save.day;
    this.origin = snapOrigin(save.x, save.z); // le rendu démarre près du joueur

    this.gs = new GameScene(byId('stage')); // peut lever une erreur si WebGL est indisponible : main.ts l'affiche
    this.gs.applySettings(this.settings);
    this.gs.resize();
    this.chunks = new ChunkManager(this.gs.scene, this.gs.terrainMaterial, seed, reliefGrid, (message) =>
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
    this.touchUi = new TouchUi(this.controls, () => this.pauseTouch());
    this.setTouchMode(window.matchMedia?.('(pointer: coarse)').matches ?? false); // écran tactile principal : commandes au doigt dès le départ
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
    bindDialog(this.installDialog, () => this.onDialogClosed());
    initInstall({ openGuide: () => this.openInstallGuide(), closeGuide: () => this.installDialog.close() }); // invitation et guide d'installation
    initPwa({ isPlaying: () => this.controls.locked }); // service worker et bandeau de mise à jour
    this.gs.renderer.domElement.addEventListener('click', () => {
      if (!this.controls.locked && !anyDialogOpen() && this.pause.hidden) this.resume(); // clic direct sur le monde (invitation affichée)
    });
    document.addEventListener('pointerlockchange', () => this.onLockChange());
    document.addEventListener('pointerdown', (e) => {
      if (!this.controls.locked && (e.pointerType === 'touch' || e.pointerType === 'mouse')) this.setTouchMode(e.pointerType === 'touch'); // le dernier pointeur utilisé décide
    }, true);
    window.addEventListener('popstate', () => this.pauseTouch()); // Retour du téléphone : menu
    document.addEventListener('pointerlockerror', () => this.onLockError());
    // Plein écran permanent : s'il est perdu (Échap, F11…), le prochain clic ou la prochaine touche sur le menu le rétablit.
    document.addEventListener('pointerdown', () => this.restoreFullscreen(), true);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') this.restoreFullscreen(); // Échap sert à quitter : on ne le force pas à revenir
    }, true);
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
    this.controls.onFlyChange = (on) => {
      this.touchUi.setFly(on); // boutons ▲ ▼ visibles seulement en vol
      toast(on ? `Vol libre activé. ${this.touchMode ? 'Touche Vol' : 'Appuie sur V'} pour revenir à pied.` : 'Vol libre coupé : tu retombes doucement au sol.');
    };
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
    if (this.touchMode) {
      this.resumeTouch(); // au doigt : pas de capture de souris
      return;
    }
    this.wantsLock = true;
    this.lockRetries = 0;
    this.hidePause();
    this.hud.setHint(false);
    // Plein écran d'abord ; la souris n'est capturée qu'une fois le plein écran établi (sinon le navigateur refuse et il faut cliquer deux fois).
    void this.enterFullscreen().then(() => {
      if (this.wantsLock && !this.controls.locked) this.controls.requestLock(); // la souris est capturée : on joue
    });
  }

  // Entrée dans le monde au doigt : plein écran, puis mode tactile (le bouton Retour du téléphone ramène au menu).
  private resumeTouch(): void {
    this.hidePause();
    this.hud.setHint(false);
    void this.enterFullscreen();
    this.controls.setTouchActive(true);
    this.onLockChange(); // même effet qu'une capture de souris réussie : on joue
    if (!(history.state && (history.state as { play?: boolean }).play)) history.pushState({ play: true }, ''); // une entrée d'historique pour que Retour ouvre le menu
  }

  // Menu pause au doigt (bouton ☰ ou Retour).
  private pauseTouch(): void {
    if (!this.controls.touchActive) return;
    this.controls.setTouchActive(false);
    this.touchUi.reset();
    this.onLockChange(); // enregistre et affiche le menu
  }

  // Bascule entre commandes au doigt et à la souris (suit le dernier type de pointeur utilisé).
  private setTouchMode(on: boolean): void {
    this.touchMode = on;
    document.body.classList.toggle('is-touch', on);
  }

  // Le navigateur a refusé la capture (souvent : plein écran en cours d'installation, ou Échap pressé il y a un instant).
  // On réessaie sans bruit deux fois ; si ça échoue encore, le bouton « Clique pour reprendre » reste là, sans message d'erreur.
  private onLockError(): void {
    if (!this.wantsLock || this.controls.locked) return;
    if (this.lockRetries >= 2) {
      this.wantsLock = false;
      this.hud.setHint(true); // invitation discrète à cliquer
      return;
    }
    this.lockRetries++;
    window.clearTimeout(this.lockTimer);
    this.lockTimer = window.setTimeout(() => {
      if (this.wantsLock && !this.controls.locked) this.controls.requestLock();
    }, 450 * this.lockRetries);
  }

  // Rétablit le plein écran (appelé sur un geste de l'utilisateur) quand on joue sur un écran sans plein écran.
  private restoreFullscreen(): void {
    if (!document.fullscreenElement) void this.enterFullscreen();
  }

  // Passe la page en plein écran si elle ne l'est pas déjà (doit venir d'un clic ou d'une touche de l'utilisateur).
  // Renvoie une promesse qui se termine quand le plein écran est établi, refusé, ou inutile ; une demande déjà en cours est partagée.
  private enterFullscreen(): Promise<void> {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return Promise.resolve(); // déjà en plein écran, ou non géré
    if (this.fullscreenPending) return this.fullscreenPending; // une demande est déjà en route
    try {
      this.fullscreenPending = Promise.resolve(document.documentElement.requestFullscreen())
        .catch(() => undefined) // refus possible : on jouera en fenêtre
        .then(() => new Promise<void>((done) => window.setTimeout(done, 80))) // petite pause : laisse le navigateur finir sa transition
        .finally(() => {
          this.fullscreenPending = null;
        });
    } catch {
      this.fullscreenPending = null; // le navigateur a refusé : le jeu reste en fenêtre, sans gravité
      return Promise.resolve();
    }
    return this.fullscreenPending;
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
      this.wantsLock = false; // la capture a réussi
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

  // Ouvre le guide d'installation (même logique que l'aide).
  private openInstallGuide(): void {
    if (this.controls.locked) document.exitPointerLock();
    this.hidePause();
    openDialog(this.installDialog);
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
      version: 2,
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
      pose: () => ({ x: this.controls.x, z: this.controls.z, yaw: this.controls.yaw, pitch: this.controls.pitch, fly: this.controls.fly, playing: this.controls.locked }),
      origin: () => ({ x: this.origin.x, z: this.origin.z, camera: [this.gs.camera.position.x, this.gs.camera.position.y, this.gs.camera.position.z] }),
      stats: () => ({ ...this.chunks.stats(), triangles: this.gs.renderer.info.render.triangles, calls: this.gs.renderer.info.render.calls }),
    };
  }
}
