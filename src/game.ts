// Le jeu : relie le monde, le rendu, les contrôles, les menus et la sauvegarde.
// C'est le seul endroit qui connaît tous les morceaux ; chaque morceau reste simple de son côté.

import { SaveData, readSavedSeed, sanitizeSave } from './core/save';
import { formatCount } from './core/format';
import { hashSeed } from './core/noise';
import { Settings, sanitizeSettings } from './core/settings';
import { dayOfYearFromDate, realSolarClock, wrapDay } from './core/geo';
import { Origin, snapOrigin, updateOrigin } from './core/origin';
import { sunState, wrapHours } from './core/sun';
import { createRelief } from './core/relief';
import { realClimate } from './world/climateData';
import { CALM_SEA, SeaState, approachSea, seaName, seaStateFor } from './core/sea';
import { CLEAR_WEATHER, WeatherState, applyWeatherToSky, blendWeather, weatherAt, weatherText } from './core/weather';
import { Wind, msToKnots, beaufort, beaufortName, windAt, windVelocity } from './core/wind';
import { RealConditions, approachWind, cellKey, needsRefresh, realWindWithGusts, seaFromReal, shouldTurnSea, waveTurnFor } from './core/realWeather';
import { fetchRealConditions } from './net/openMeteo';
import { WIND_START } from './player/boatDriver';
import type { ReliefGrid } from './core/relief';
import { Terrain, createTerrain } from './core/terrain';
import { clamp } from './core/math';
import { PlayerControls } from './player/controls';
import { Avatar } from './render/avatar';
import { EditObjects } from './render/editObjects';
import { EditStore } from './core/worldEdits';
import { WORLD_VERSION, readWorldVersion, worldVersionStatus } from './core/worldVersion';
import { EditsPersistence, openEditsDb } from './storage/editsDb';
import { CompassState, bearingFromYaw, compassText, newCompass, stepCompass } from './core/compass';
import { THIRD_DISTANCE, THIRD_SHOULDER, ViewMode, clampAboveGround, nextViewBlend, thirdPersonOffset, toggleView } from './core/cameraRig';
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT } from './core/movement';
import { BoatDriver } from './player/boatDriver';
import { BoatHud } from './ui/boatHud';
import { TouchUi } from './player/touchUi';
import { PlacesPanel } from './ui/placesPanel';
import { WorldMap } from './ui/worldMap';
import { latLonToWorld, worldToLatLon } from './core/geo';
import { snapToLand } from './core/worldmap';
import type { Relief } from './core/relief';
import { Place, placePosition } from './core/places';
import { GameScene } from './render/scene';
import { SAVE_KEY, SETTINGS_KEY, loadJson, saveJson } from './storage';
import { byId } from './ui/dom';
import { anyDialogOpen, bindDialog, openDialog } from './ui/dialogs';
import { Hud } from './ui/hud';
import { initInstall } from './pwa/install';
import { initPwa } from './pwa/pwa';
import { moonState, moonText } from './core/moon';
import { LensDrops } from './render/lensDrops';
import { AudioSystem } from './audio/audioSystem';
import { Ambient } from './audio/ambient';
import { MusicEngine } from './audio/music';
import { boatSoundMix } from './core/boatSound';
import { musicMood, newMusicState, stepMusic } from './core/music';
import { mulberry32 } from './core/noise';
import { shoreProximity, soundMix } from './core/soundMix';
import { LifeInput, lifeMix } from './core/wildlife';
import { SettingsPanel } from './ui/settingsPanel';
import { toast } from './ui/toast';
import { ChunkManager } from './world/chunkManager';

const LOADING_TIMEOUT_S = 15; // au-delà, on arrête d'attendre le terrain et on prévient

export class Game {
  private settings: Settings; // réglages courants
  private hours: number; // heure solaire locale du jeu
  private gameHours = 0; // temps de jeu continu (heures) : fait évoluer la météo sans saut à minuit ni au changement d'année
  private weather: WeatherState = CLEAR_WEATHER; // temps actuel au lieu du joueur (adouci)
  private weatherTarget: WeatherState = CLEAR_WEATHER; // temps visé (recalculé deux fois par seconde)
  private readonly lens: LensDrops; // gouttes de pluie sur l'écran
  private readonly audio = new AudioSystem(); // ambiance sonore (démarre au premier geste)
  private readonly edits = new EditStore(); // les modifications du monde faites par le joueur (cairns…)
  private editsDb: EditsPersistence | null = null; // leur enregistrement durable (null tant que la base n'est pas ouverte)
  private editObjects!: EditObjects; // leur dessin
  private savedWorldVersion = WORLD_VERSION; // version du monde lue dans la sauvegarde
  private editsReadOnly = false; // vrai si la sauvegarde vient d'un jeu plus récent : on ne touche à rien
  private editClock = 0; // temps depuis le dernier rafraîchissement du dessin (s)
  private avatar!: Avatar; // les bras, les mains, la boussole et le corps du joueur
  private compass: CompassState | null = null; // la rose de la boussole (null avant la première image)
  private viewMode: ViewMode = 'first'; // première ou troisième personne
  private viewBlend = 0; // 0 = première personne, 1 = troisième (fondu)
  private lastX = 0; // position de l'image précédente (pour estimer la vitesse de marche)
  private lastZ = 0;
  private walkSpeed = 0; // vitesse de marche lissée (m/s)
  private soundTimer = 0;
  private shore = 0; // proximité du rivage (0 à 1), recalculée quelques fois par seconde
  private weatherTimer = 0;
  private sea: SeaState = CALM_SEA; // état de mer actuel (suit le vent avec retard)
  private seaInit = false;
  private real: RealConditions | null = null; // dernières conditions réelles reçues (null = météo simulée)
  private realWind: Wind | null = null; // vent réel lissé (évite un saut quand la réponse arrive)
  private realState: { key: string; at: number; ok: boolean } | null = null; // dernière tentative de requête
  private realKey = ''; // case de la grille d'où viennent les données réelles
  private realDebug = false; // conditions imposées par ?debug : on ne les efface pas
  private realBusy = false; // une requête est-elle en cours ?
  private realAnnounced = false; // a-t-on déjà dit au joueur si la météo réelle marche ?
  private waveTurn = 0; // rotation actuelle de la mer (houle réelle)
  private seaIsReal = false; // la mer vient-elle des vagues réelles ?
  private seaForced: SeaState | null = null; // pour les essais (?debug)
  private weatherForced: Partial<WeatherState> | null = null; // pour les essais (?debug)
  private day: number; // jour de l'année du jeu (1 à 365)
  private origin: Origin; // origine flottante du rendu (voir core/origin.ts)
  private readonly seedText: string; // graine du monde (texte)
  private readonly terrain: Terrain;
  private readonly gs: GameScene;
  private readonly chunks: ChunkManager;
  private readonly controls: PlayerControls;
  private readonly boat: BoatDriver; // le voilier (physique, rendu, commandes)
  private readonly boatHud = new BoatHud(); // instruments du voilier
  private readonly hud = new Hud();
  private readonly pause = byId('pause');
  private readonly settingsDialog = byId<HTMLDialogElement>('dialog-settings');
  private readonly mapDialog = byId<HTMLDialogElement>('dialog-map');
  private relief!: Relief; // le relief réel (pour la carte)
  private worldMap!: WorldMap; // la carte du monde
  private readonly placesDialog = byId<HTMLDialogElement>('dialog-places');
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
    this.relief = createRelief(reliefGrid);
    this.terrain = createTerrain(seed, this.relief, realClimate); // le vrai relief de la Terre + un détail inventé
    this.savedWorldVersion = readWorldVersion(rawSave); // version du monde de la sauvegarde lue
    const save = sanitizeSave(rawSave, this.terrain, this.seedText, dayOfYearFromDate(new Date())); // position valable, sinon départ sur la plage
    this.hours = save.hours;
    this.gameHours = save.day * 24 + save.hours;
    this.day = save.day;
    this.origin = snapOrigin(save.x, save.z); // le rendu démarre près du joueur

    this.gs = new GameScene(byId('stage'));
    this.lens = new LensDrops(byId('stage')); // couche 2D au-dessus de la 3D // peut lever une erreur si WebGL est indisponible : main.ts l'affiche
    this.gs.applySettings(this.settings);
    this.gs.resize();
    this.chunks = new ChunkManager(this.gs.scene, this.gs.terrainMaterial, seed, reliefGrid, (message) =>
      toast(`Le terrain a rencontré un problème (${message}). Si des trous apparaissent, recharge la page.`, 'error'),
    );
    this.applyOrigin(); // le rendu (tuiles, grain du sol, vagues) apprend où est l'origine
    this.controls = new PlayerControls(this.gs.renderer.domElement, this.terrain, save);
    this.controls.sensitivity = this.settings.mouseSensitivity;
    this.boat = new BoatDriver(this.gs.scene, this.terrain, this.controls);
    this.boat.onChange = (aboard) => {
      this.boatHud.setVisible(aboard && this.settings.showInstruments); // instruments visibles seulement à bord, si on les veut
      byId('btn-boat').textContent = aboard ? 'Voilier : débarquer (B)' : 'Voilier : monter à bord (B)';
    };
    this.hud.setFpsVisible(this.settings.showFps);
    this.settingsPanel = new SettingsPanel({
      getSettings: () => this.settings,
      setSettings: (next) => this.applySettings(next),
      getHours: () => this.hours,
      setHours: (h) => {
        this.hours = wrapHours(h);
      },
      getMoonText: () => {
        const { lat, lon } = worldToLatLon(this.controls.x, this.controls.z);
        return moonText(moonState(lat, lon, this.day, this.hours)); // phase de la vraie Lune ici et maintenant
      },
      getDay: () => this.day,
      setDay: (d) => {
        this.day = wrapDay(d);
      },
    });
    this.touchUi = new TouchUi(this.controls, () => this.pauseTouch(), () => this.toggleConstellations());
    this.touchUi.setConstellations(this.settings.constellations); // état initial du bouton ✦
    this.setTouchMode(window.matchMedia?.('(pointer: coarse)').matches ?? false); // écran tactile principal : commandes au doigt dès le départ
    this.wireEvents();
    this.showPause(); // on démarre sur l'écran d'accueil
    if (new URLSearchParams(location.search).has('debug')) this.exposeDebug(); // outils de développement
  }

  // Lance la boucle d'animation.
  start(): void {
    requestAnimationFrame(this.frame);
  }

  // ---------- Météo ----------

  // Calcule le temps visé au lieu du joueur et s'en approche doucement ; donne le vent au voilier et au ciel.
  private updateWeather(dt: number, seconds: number): void {
    if (this.settings.realTime) this.gameHours = Date.now() / 3600000; // temps réel : la météo suit vraiment les jours qui passent
    else if (this.controls.locked && this.settings.dayLengthMinutes > 0) this.gameHours += (dt * 24) / (this.settings.dayLengthMinutes * 60);
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = 0.5; // inutile de recalculer à chaque image
      const { lat, lon } = worldToLatLon(this.controls.x, this.controls.z);
      let target = weatherAt(lat, lon, realClimate.classAt(lat, lon), this.day, this.gameHours, this.hours);
      this.manageReal(lat, lon); // demande la météo réelle si l'option est active et qu'il est temps
      if (this.real?.weather) target = { ...target, ...this.real.weather, windScale: this.real.wind ? 1 : target.windScale }; // le temps réel remplace le simulé
      if (this.boat.aboard) this.boatHud.setWeather(`${weatherText(this.weather)} · ${beaufortName(beaufort(this.boat.wind.speed))} · ${seaName(this.sea.hs)}${this.boat.current.x || this.boat.current.z ? ` · courant ${(Math.round(msToKnots(Math.hypot(this.boat.current.x, this.boat.current.z)) * 10) / 10).toString().replace('.', ',')} nd` : ''}${this.real ? ' · météo réelle' : ''}`);
      this.weatherTarget = this.weatherForced ? { ...target, ...this.weatherForced } : target;
    }
    this.weather = blendWeather(this.weather, this.weatherTarget, 1 - Math.exp(-dt / 4)); // le temps change en quelques secondes si on change de lieu
    this.boat.weather = this.weather;
    // Vent réel : on s'en approche doucement (≈ 20 s) ; sans vent réel, le vent simulé s'applique.
    if (this.real?.wind) this.realWind = this.realWind ? approachWind(this.realWind, this.real.wind, 1 - Math.exp(-dt / 20)) : this.real.wind;
    else this.realWind = null;
    this.boat.realWind = this.realWind;
    const { lat, lon } = worldToLatLon(this.controls.x, this.controls.z);
    const base = windAt(lat, lon, WIND_START + seconds);
    const wind = windVelocity(realWindWithGusts(this.realWind, seconds) ?? { speed: base.speed * this.weather.windScale, from: base.from }); // vent réel, sinon vent du lieu renforcé par la météo
    this.gs.setWeather(this.weather, wind.x, wind.z);
    // État de mer : le vent établi et les dépressions font la mer ; elle réagit lentement. Avec la houle réelle, elle suit la mesure.
    const windSpeed = Math.hypot(wind.x, wind.z);
    const realHs = this.real?.hs ?? null;
    const target = realHs !== null ? seaFromReal(realHs, windSpeed) : seaStateFor(windSpeed, this.weather.front, lat);
    if ((realHs !== null) !== this.seaIsReal) {
      this.seaIsReal = realHs !== null; // on change de source : la mer s'ajuste d'un coup (pas de longue transition)
      this.seaInit = false;
    }
    this.sea = this.seaForced ?? (this.seaInit ? approachSea(this.sea, target, dt) : target); // au premier calcul, la mer est déjà formée
    this.seaInit = true;
    // Houle réelle : on tourne la mer vers la direction mesurée, seulement pour un écart net (ou à la première mesure).
    const wantedTurn = this.real?.waveFrom != null ? waveTurnFor(this.real.waveFrom) : 0;
    if (this.real?.waveFrom == null ? this.waveTurn !== 0 : shouldTurnSea(this.waveTurn, wantedTurn)) this.waveTurn = wantedTurn;
    this.gs.setWaveTurn(this.waveTurn);
    this.boat.waveTurn = this.waveTurn;
    this.boat.current = this.real?.current ?? { x: 0, z: 0 }; // courant réel (sinon aucun)
    this.gs.setSea(this.sea);
    this.boat.sea = this.sea;
  }

  // Ambiance sonore : quelques fois par seconde, le monde est traduit en niveaux sonores (vent, pluie, mer, rivage, coque).
  private updateSound(dt: number): void {
    this.audio.tick(dt); // gouttes isolées de la pluie
    this.soundTimer -= dt;
    if (this.soundTimer > 0) return;
    this.soundTimer = 0.25;
    const aboard = this.boat.aboard;
    this.shore = shoreProximity((x, z) => this.terrain.heightAt(x, z), this.controls.x, this.controls.z); // loin du rivage = 0
    const r = aboard ? this.boat.getReadout() : null; // instruments : vent apparent et vitesse
    const wind = this.boat.wind;
    const { lat, lon } = worldToLatLon(this.controls.x, this.controls.z);
    const biome = this.terrain.biomeAt(this.controls.x, this.controls.z);
    const ground = this.terrain.heightAt(this.controls.x, this.controls.z);
    const sun = sunState(this.hours, lat, this.day, lon);
    const windFelt = r ? r.aws : wind.speed;
    const bs = aboard ? this.boat.state : null; // état du bateau (voiles, gîte) pour ses bruits
    const life = lifeMix({
      cls: realClimate.classAt(lat, lon),
      lat,
      day: this.day,
      sunElevation: sun.elevationDeg,
      hours: this.hours,
      forest: biome.forest,
      conifer: biome.conifer,
      land: !aboard && ground > 0, // à bord, on est sur l'eau
      snowy: ground > biome.snowLine,
      shore: this.shore,
      rain: this.weather.rain,
      wind: windFelt,
    });
    this.audio.setMood(
      musicMood({
        sunElevation: sun.elevationDeg,
        hours: this.hours,
        day: this.day,
        cloud: this.weather.cloud,
        rain: this.weather.rain,
        fog: this.weather.fog,
        wind: windFelt,
        onWater: aboard,
        volume: this.settings.musicVolume * this.settings.soundVolume ** 0.5, // le volume général pèse aussi, plus doucement
        active: this.controls.locked,
      }),
    );
    this.audio.setMix(
      soundMix({
        windSpeed: windFelt, // à bord on entend le vent apparent
        rain: this.weather.rain,
        seaHs: this.sea.hs,
        onWater: aboard,
        shore: this.shore,
        boatSpeed: r ? r.speed : 0,
        aboard,
        volume: this.settings.soundVolume,
        active: this.controls.locked,
        boat: bs
          ? boatSoundMix({
              aboard,
              walking: this.boat.walking,
              walkSpeed: this.boat.walkSpeed,
              luff: bs.luff,
              mainUp: bs.mainUp,
              jibOut: bs.jibOut,
              aws: windFelt,
              heelDeg: r ? r.heelDeg : 0,
              heelRate: bs.heelRate,
              boatSpeed: r ? r.speed : 0,
              seaHs: this.sea.hs,
              rain: this.weather.rain,
            })
          : undefined,
        life,
      }),
    );
  }

  // Gère la météo réelle : rien si l'option est coupée ; sinon une requête quand la case de 0,5° change ou que la réponse vieillit.
  private manageReal(lat: number, lon: number): void {
    if (this.realDebug) return; // essais : on garde les conditions imposées
    if (!this.settings.realWeather) {
      this.real = null; // option coupée : retour au simulé
      this.realState = null;
      this.realAnnounced = false;
      return;
    }
    const key = cellKey(lat, lon);
    if (this.realBusy || !needsRefresh(this.realState, key, Date.now())) return; // rien à faire
    this.realBusy = true;
    this.realState = { key, at: Date.now(), ok: true }; // on note la tentative tout de suite
    void fetchRealConditions(lat, lon, Date.now()).then((r) => {
      this.realBusy = false;
      if (!this.settings.realWeather) return; // coupée pendant la requête
      this.realState = { key, at: Date.now(), ok: r !== null };
      if (r) {
        this.real = r; // données fraîches
        this.realKey = key;
      } else if (this.real && this.realKey !== key) this.real = null; // case différente et échec : les anciennes données ne valent plus
      if (!this.realAnnounced) {
        this.realAnnounced = true;
        toast(r ? 'Météo réelle activée (Open-Meteo.com).' : 'Météo réelle indisponible (pas de réseau ?) : le jeu garde la météo simulée et réessaiera.', r ? 'info' : 'error');
      }
    });
  }

  // ---------- Boucle principale ----------

  private frame = (now: number): void => {
    requestAnimationFrame(this.frame); // prochaine image
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000)); // durée de l'image, bornée (retour d'onglet, etc.)
    this.last = now;
    this.elapsed += dt;
    if (this.settings.realTime) {
      const clock = realSolarClock(new Date(), worldToLatLon(this.controls.x, this.controls.z).lon); // vraie heure UTC → heure solaire là où tu te trouves (nuit à Paris, jour à Sydney)
      this.hours = clock.hours;
      this.day = clock.day;
    } else if (this.controls.locked && this.settings.dayLengthMinutes > 0) {
      const before = this.hours; // heure avant ce pas de temps
      this.hours = wrapHours(this.hours + (dt * 24) / (this.settings.dayLengthMinutes * 60)); // le temps ne passe que quand on joue
      if (this.settings.daysPass && this.hours < before) this.day = wrapDay(this.day + 1); // minuit passé : le calendrier avance d'un jour
    }
    this.updateWeather(dt, now / 1000);
    const origin = updateOrigin(this.origin, this.controls.x, this.controls.z); // le joueur s'est-il trop éloigné de l'origine ?
    if (origin !== this.origin) {
      this.origin = origin; // oui : l'origine saute sous le joueur (invisible, tout est replacé d'un coup)
      this.applyOrigin();
    }
    this.boat.update(dt, now / 1000, this.origin); // le bateau avance et pose la caméra sur le pont (s'il y a lieu)
    this.controls.update(dt, this.gs.camera, this.origin.x, this.origin.z);
    this.updateAvatar(dt, now / 1000); // bras, mains, boussole (et caméra extérieure)
    this.editClock += dt;
    if (this.editClock > 0.5) {
      this.editClock = 0;
      this.editObjects.update(this.controls.x, this.controls.z, this.origin.x, this.origin.z, (x, z) => this.terrain.heightAt(x, z)); // dessin des cairns proches
    }
    if (this.boat.aboard && this.boat.state) this.boatHud.update(this.boat.getReadout(), this.boat.state.boom, this.boat.state.rudder, now);
    this.chunks.update(this.controls.x, this.controls.z, this.settings.viewDistance);
    this.gs.updateEnvironment(applyWeatherToSky(sunState(this.hours, this.playerLat(), this.day, this.playerLon()), this.weather), now / 1000); // le soleil dépend de la latitude du joueur
    const sky = sunState(this.hours, this.playerLat(), this.day, this.playerLon());
    this.updateSound(dt);
    this.lens.update(dt, this.weather.rain, sky.daylight, this.controls.locked); // gouttes sur l'écran quand il pleut et qu'on joue
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
    byId('btn-boat').addEventListener('click', () => {
      const wasAboard = this.boat.aboard;
      this.boat.toggle(); // monte à bord ou débarque
      if (!wasAboard && this.boat.aboard) this.resume(); // à bord : on entre directement dans le jeu
    });
    byId('click-hint').addEventListener('click', () => this.resume());
    byId('btn-settings').addEventListener('click', () => this.openSettings());
    byId('btn-help').addEventListener('click', () => this.openHelp());
    byId('btn-places').addEventListener('click', () => this.openPlaces());
    byId('btn-map').addEventListener('click', () => this.openMap());
    this.worldMap = new WorldMap({
      relief: this.relief,
      climate: realClimate,
      getPlayer: () => worldToLatLon(this.controls.x, this.controls.z),
      getTime: () => (this.settings.realTime ? realSolarClock(new Date()) : { hours: this.hours, day: this.day }), // en temps réel, la carte reçoit l'heure de Lannion (référence de l'ombre de nuit)
      onGo: (lat, lon) => this.travelToLatLon(lat, lon),
    });
    bindDialog(this.mapDialog, () => this.onDialogClosed());
    this.mapDialog.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) this.worldMap.go(); // Entrée : y aller (sauf sur un bouton)
      if (e.code === 'KeyM') this.mapDialog.close(); // M referme la carte
    });
    new PlacesPanel((place) => this.travelTo(place)); // liste des lieux (boutons)
    bindDialog(this.placesDialog, () => this.onDialogClosed());
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
    this.controls.onMapKey = () => this.openMap();
    this.controls.onBoatKey = () => this.boat.toggle();
    this.controls.onInstrumentsKey = () => this.toggleInstruments();
    this.controls.onConstellationsKey = () => this.toggleConstellations();
    this.controls.onViewKey = () => this.toggleViewMode();
    this.avatar = new Avatar(this.gs.scene);
    this.editObjects = new EditObjects(this.gs.scene, this.edits);
    this.controls.onEditKey = (remove) => this.editAction(remove);
    this.edits.onChange((c) => {
      this.editClock = 99; // le dessin se met à jour tout de suite
      if (c.added) void this.editsDb?.put(c.added).catch(() => toast('Impossible d\'enregistrer ce cairn sur cet appareil.', 'error'));
      if (c.removed) void this.editsDb?.delete(c.removed.id).catch(() => undefined);
    });
    void this.loadEdits(); // lecture de l'enregistrement, sans bloquer le démarrage
  }

  // Lit les modifications enregistrées. Un monde enregistré par un jeu plus récent est laissé intact (lecture seule).
  private async loadEdits(): Promise<void> {
    this.editsReadOnly = worldVersionStatus(this.savedWorldVersion) === 'future';
    const db = await openEditsDb();
    this.editsDb = db;
    try {
      this.edits.load(await db.loadAll());
    } catch {
      toast('Tes constructions n\'ont pas pu être relues.', 'error');
    }
    if (!db.persistent) toast('Ce navigateur ne garde pas les constructions (navigation privée ?) : elles disparaîtront au rechargement.', 'error');
    if (this.editsReadOnly) toast('Ce monde a été enregistré par une version plus récente du jeu : tu peux le visiter, pas le modifier.', 'error');
    this.editClock = 99;
  }

  // K : pose un cairn devant soi ; Maj+K : retire le plus proche (à 3 m).
  private editAction(remove: boolean): void {
    if (this.boat.aboard || this.controls.fly) return toast('Les cairns se posent à pied, sur la terre ferme.');
    if (!this.editsDb) return toast('Un instant, le monde se charge…');
    if (this.editsReadOnly) return toast('Ce monde vient d\'une version plus récente du jeu : impossible de le modifier.', 'error');
    const { x, z, yaw } = this.controls;
    if (remove) {
      const e = this.edits.nearest(x, z, 3, 'cairn');
      return toast(e && this.edits.remove(e.id) ? 'Cairn retiré.' : 'Aucun cairn à moins de 3 m.');
    }
    const px = x - Math.sin(yaw) * 1.6; // 1,6 m devant (devant = direction −sin, −cos)
    const pz = z - Math.cos(yaw) * 1.6;
    if (this.terrain.heightAt(px, pz) <= 0.3) return toast('Il faut poser le cairn sur la terre ferme.');
    if (this.edits.nearest(px, pz, 0.8)) return toast('Il y a déjà un cairn ici.');
    toast(this.edits.add('cairn', px, pz, yaw, Date.now()) ? 'Cairn posé. Maj+K pour le retirer.' : 'Trop de constructions : retires-en avant d\'en poser.', 'info');
  }


  // Longitude actuelle du joueur (sert à la Lune : l'heure UT en dépend).
  private playerLon(): number {
    return worldToLatLon(this.controls.x, this.controls.z).lon;
  }

  // Latitude actuelle du joueur, en degrés (sert au soleil : sa hauteur dépend du lieu).
  private playerLat(): number {
    return worldToLatLon(this.controls.x, this.controls.z).lat; // converti depuis la position dans le monde
  }

  // Montre ou cache les instruments du voilier (touche I) : sans eux, on lit les penons et les voiles.
  private toggleInstruments(): void {
    if (!this.boat.aboard) return; // sans bateau, rien à cacher
    const on = !this.settings.showInstruments;
    this.applySettings({ ...this.settings, showInstruments: on });
    toast(on ? 'Instruments affichés (I pour les cacher).' : 'Instruments cachés : lis les penons et la voile. I pour les remettre.');
  }

  // Montre ou cache les traits des constellations ; de jour, on prévient qu'ils n'apparaîtront qu'à la nuit.
  // T : bascule entre la première et la troisième personne (pas à bord pour l'instant : le corps ne suit pas encore le pont).
  private toggleViewMode(): void {
    if (this.boat.aboard) {
      toast('La vue à la troisième personne n\'est pas encore disponible à bord.', 'info');
      return;
    }
    this.viewMode = toggleView(this.viewMode);
    toast(this.viewMode === 'third' ? 'Troisième personne (corps provisoire). T pour revenir.' : 'Première personne.', 'info');
  }

  // Bras, mains, boussole et (en vue extérieure) corps du joueur ; place aussi la caméra à la troisième personne.
  private updateAvatar(dt: number, seconds: number): void {
    const c = this.controls;
    const cam = this.gs.camera;
    const moved = Math.hypot(c.x - this.lastX, c.z - this.lastZ) / Math.max(dt, 1e-3); // vitesse de déplacement horizontale
    this.lastX = c.x;
    this.lastZ = c.z;
    let speed = 0;
    if (this.boat.aboard) speed = this.boat.walking ? this.boat.walkSpeed : 0; // à bord, seuls nos pas comptent (pas le mouvement du bateau)
    else if (!c.fly) {
      this.walkSpeed += (Math.min(moved, 12) - this.walkSpeed) * (1 - Math.exp(-8 * dt));
      speed = this.walkSpeed;
    } else this.walkSpeed = 0;
    const bearing = bearingFromYaw(c.yaw);
    if (!this.compass) this.compass = newCompass(bearing);
    const shake = Math.sin(seconds * 8.3) * 0.02 * Math.min(speed / 4, 1.5); // la marche secoue un peu la rose
    this.compass = stepCompass(this.compass, bearing, dt, shake);
    if (this.boat.aboard) this.viewMode = 'first';
    this.viewBlend = nextViewBlend(this.viewBlend, this.viewMode, dt);
    const ground = this.terrain.heightAt(c.x, c.z);
    const eyeHeight = c.fly || this.boat.aboard ? EYE_HEIGHT : clamp(c.y - ground, CROUCH_EYE_HEIGHT - 0.1, EYE_HEIGHT + 0.1); // accroupi : yeux plus bas
    this.avatar.update({
      dt,
      time: seconds,
      eye: cam.position,
      yaw: c.yaw,
      pitch: c.pitch,
      roll: c.roll,
      eyeHeight,
      walkSpeed: speed,
      compassCard: this.compass.card,
      raise: c.locked && c.down('KeyG') ? 1 : 0,
      blend: this.viewBlend,
      showHands: this.settings.showHands,
    });
    if (this.viewBlend > 0) {
      // Troisième personne : la caméra recule derrière l'épaule, sans passer sous le sol.
      const o = thirdPersonOffset(c.yaw, c.pitch, THIRD_DISTANCE * this.viewBlend, THIRD_SHOULDER * this.viewBlend);
      cam.position.x += o[0];
      cam.position.y += o[1];
      cam.position.z += o[2];
      cam.position.y = clampAboveGround(cam.position.y, this.terrain.heightAt(cam.position.x + this.origin.x, cam.position.z + this.origin.z));
    }
  }

  private toggleConstellations(): void {
    const on = !this.settings.constellations;
    this.applySettings({ ...this.settings, constellations: on });
    const night = sunState(this.hours, this.playerLat(), this.day, this.playerLon()).starsOpacity > 0.05;
    toast(on ? (night ? 'Constellations affichées.' : 'Constellations activées : elles apparaîtront à la nuit.') : 'Constellations cachées.');
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

  private openPlaces(): void {
    this.hidePause();
    openDialog(this.placesDialog);
  }

  private openMap(): void {
    if (this.controls.locked) document.exitPointerLock(); // la carte se manie à la souris
    this.hidePause();
    openDialog(this.mapDialog);
    this.worldMap.open();
  }

  // Voyage vers une latitude / longitude choisie sur la carte : si c'est la mer, on se pose sur la côte la plus proche.
  private travelToLatLon(lat: number, lon: number): void {
    const land = snapToLand(this.relief, Math.max(-89.5, Math.min(89.5, lat)), lon);
    if (!land) {
      toast('Il n\'y a pas de terre à proximité de ce point de l\'océan. Choisis un autre endroit.', 'error');
      return;
    }
    const { x, z } = latLonToWorld(land.lat, land.lon);
    // Le relief réel est flou : on cherche à pied, autour du point, un sol vraiment hors de l'eau (pas de 100 m, jusqu'à 5 km).
    let best = { x, z };
    for (let r = 0; r <= 5000 && this.terrain.heightAt(best.x, best.z) < 3; r += 100) {
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const cx = x + r * Math.cos(a);
        const cz = z + r * Math.sin(a);
        if (this.terrain.heightAt(cx, cz) >= 3) {
          best = { x: cx, z: cz };
          break;
        }
      }
    }
    this.mapDialog.close();
    this.teleport(best.x, best.z, land.moved ? 'Tu es posé sur la côte la plus proche.' : 'Voyage terminé.');
  }

  // Place le joueur au sol, face au nord.
  private teleport(x: number, z: number, message: string): void {
    this.boat.leave(); // le voyage nous sort du bateau (il reste là où il est)
    this.controls.x = x;
    this.controls.z = z;
    this.controls.yaw = 0;
    this.controls.pitch = 0.04;
    this.controls.y = this.terrain.heightAt(x, z) + 1.7;
    this.controls.fly = false;
    this.touchUi.setFly(false);
    toast(`${message} Le terrain apparaît en quelques secondes. Touche « Entrer dans le monde ».`);
    this.saveNow();
  }

  // Voyage instantané vers un lieu : on se pose au sol, face au nord, et on ferme la liste.
  private travelTo(place: Place): void {
    const { x, z } = placePosition(place);
    this.placesDialog.close(); // retour au menu : « Entrer dans le monde »
    this.teleport(x, z, `${place.name} :`);
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
    this.boatHud.setVisible(this.boat.aboard && next.showInstruments); // instruments du voilier
    this.controls.sensitivity = next.mouseSensitivity;
    this.touchUi.setConstellations(next.constellations); // bouton ✦ à jour
  }

  private saveNow(): void {
    const shore = this.boat.savedPose(); // à bord : on enregistre le point d'embarquement, pas la pleine mer
    const data: SaveData = {
      version: 2,
      seed: this.seedText,
      x: shore ? shore.x : this.controls.x,
      z: shore ? shore.z : this.controls.z,
      y: shore ? this.terrain.heightAt(shore.x, shore.z) + 1.7 : this.controls.y,
      yaw: shore ? shore.yaw : this.controls.yaw,
      pitch: this.controls.pitch,
      hours: this.hours,
      day: this.day,
      fly: shore ? false : this.controls.fly,
      worldVersion: this.savedWorldVersion, // le monde garde son numéro d'origine
    };
    if (this.editsReadOnly) return; // sauvegarde d'un jeu plus récent : on ne l'écrase pas
    saveJson(SAVE_KEY, data);
  }

  // ---------- Outils de développement (adresse terminée par ?debug) ----------

  private exposeDebug(): void {
    window.__thy = {
      teleport: (x, z, yaw, pitch, fly = false, y) => {
        this.boat.leave();
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
      moon: () => {
        // Où est la Lune ? (essais) : phase, hauteur, et le cap/inclinaison à donner à la caméra pour la viser.
        const { lat, lon } = worldToLatLon(this.controls.x, this.controls.z);
        const m = moonState(lat, lon, this.day, this.hours);
        return { name: m.name, illumination: m.illumination, elevation: m.elevationDeg, yaw: Math.atan2(m.direction[0], m.direction[2]) + Math.PI, pitch: Math.asin(m.direction[1]) };
      },
      hideUi: () => {
        this.hidePause();
        this.hud.setLoading(false);
        byId('toast').hidden = true;
      },
      view: (mode) => {
        this.viewMode = mode;
        if (mode === 'first') this.viewBlend = 0;
        else this.viewBlend = 1;
        return mode;
      },
      edits: () => ({ count: this.edits.size, shown: this.editObjects.count, persistent: this.editsDb?.persistent ?? null, worldVersion: WORLD_VERSION, list: this.edits.all().slice(0, 20).map((e) => ({ id: e.id, x: e.x, z: e.z })) }),
      compass: () => (this.compass ? { card: this.compass.card, text: compassText(bearingFromYaw(this.controls.yaw)) } : null),
      ready: () => this.chunks.isReadyAround(this.controls.x, this.controls.z, 2),
      pending: () => this.chunks.stats().pending,
      boat: () => ({ aboard: this.boat.aboard, state: this.boat.state as unknown as Record<string, unknown> | null, wind: this.boat.wind, board: () => this.boat.toggle() }),
      play: (on) => this.controls.setTouchActive(on),
      sea: (hs) => {
        const wind = Math.sqrt(Math.max(0, hs) / 0.0213); // vent qui donnerait cette mer
        this.seaForced = { ...seaStateFor(wind, -1, 0), swell: Math.max(0.12, hs / 1.2), hs }; // impose la mer (essais)
        return `${hs} m`;
      },
      weather: (w) => {
        this.weatherForced = w; // impose (ou rend) le temps pour les essais
        this.weatherTimer = 0;
        if (w) this.weather = { ...this.weather, ...w };
        return weatherText(this.weather);
      },
      audioTest: async (over, life, boat) => {
        // Rend 2 s de son hors ligne (sans haut-parleur) et mesure : niveau moyen, crête, valeurs invalides. Pour vérifier le moteur sans l'écouter.
        const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
        const amb = new Ambient(ctx);
        const base: LifeInput = { cls: 'Cfb', lat: 48.7, day: 196, sunElevation: 40, hours: 13, forest: 0.55, conifer: 0.1, land: true, snowy: false, shore: 0, rain: 0, wind: 2 };
        const mix = soundMix({ windSpeed: 2, rain: 0, seaHs: 0.2, onWater: false, shore: 0, boatSpeed: 0, aboard: false, volume: 0.8, active: true, ...over, life: lifeMix({ ...base, ...life }), boat: boat ? boatSoundMix({ aboard: true, walking: false, walkSpeed: 0, luff: 0, mainUp: 1, jibOut: 1, aws: 6, heelDeg: 0, heelRate: 0, boatSpeed: 0, seaHs: 0.1, rain: 0, ...boat }) : undefined });
        amb.apply(mix, true);
        amb.renderCalls(2);
        const data = (await ctx.startRendering()).getChannelData(0);
        let sum = 0, peak = 0, bad = 0;
        for (const v of data) {
          if (!Number.isFinite(v)) bad++;
          sum += v * v;
          peak = Math.max(peak, Math.abs(v));
        }
        return { rms: Math.sqrt(sum / data.length), peak, bad };
      },
      musicTest: async (scale) => {
        // Rend 40 s de musique hors ligne et mesure : niveau, crête, valeurs invalides, accords joués.
        const ctx = new OfflineAudioContext(2, 44100 * 40, 44100);
        const eng = new MusicEngine(ctx, ctx.destination, mulberry32(7));
        eng.setImmediate(true);
        const mood = musicMood({ sunElevation: scale === 'aeolian' ? -30 : 40, hours: 13, day: 100, cloud: 0.1, rain: 0, fog: 0, wind: 3, onWater: false, volume: 1, active: true });
        eng.apply(mood);
        const rnd = mulberry32(11);
        const st = newMusicState(rnd);
        let chords = 0;
        for (let t = 0; t < 30; t += 0.5) {
          const c = stepMusic(st, 0.5, mood, rnd);
          if (c) { eng.play(c, t); chords++; }
        }
        const buf = await ctx.startRendering();
        let sum = 0, peak = 0, bad = 0, n = 0;
        for (let ch = 0; ch < 2; ch++) for (const v of buf.getChannelData(ch)) {
          if (!Number.isFinite(v)) bad++;
          sum += v * v; n++;
          peak = Math.max(peak, Math.abs(v));
        }
        return { rms: Math.sqrt(sum / n), peak, bad, chords };
      },
      real: (c) => {
        this.real = c ? { wind: c.wind ?? null, weather: c.weather ?? null, hs: c.hs ?? null, waveFrom: c.waveFrom ?? null, current: c.current ?? null, fetchedAt: Date.now() } : null; // impose des conditions réelles simulées (essais)
        this.realDebug = c !== null; // tant qu'elles sont imposées, la gestion réseau est suspendue
        this.weatherTimer = 0;
        return this.real ? 'conditions réelles imposées' : 'retour au simulé';
      },
      pose: () => ({ x: this.controls.x, z: this.controls.z, yaw: this.controls.yaw, pitch: this.controls.pitch, fly: this.controls.fly, playing: this.controls.locked }),
      origin: () => ({ x: this.origin.x, z: this.origin.z, camera: [this.gs.camera.position.x, this.gs.camera.position.y, this.gs.camera.position.z] }),
      stats: () => ({ ...this.chunks.stats(), triangles: this.gs.renderer.info.render.triangles, calls: this.gs.renderer.info.render.calls }),
    };
  }
}
