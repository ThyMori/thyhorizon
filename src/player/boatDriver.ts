// Le pilote : relie le voilier (physique + rendu) au joueur. Il gère la mise à l'eau, le débarquement,
// les commandes au clavier (barre, écoute), le vent, la caméra posée sur le pont et les messages.

import type * as THREE from 'three';
import { findLandingSpot, findLaunchSpot } from '../core/boarding';
import { worldToLatLon } from '../core/geo';
import { EYE_HEIGHT } from '../core/movement';
import type { Origin } from '../core/origin';
import { HELM_POS, WALK_EYE, WALK_SPEED, deckStep, deckSurface, moveOnDeck, nearHelm } from '../core/deck';
import type { DeckPos } from '../core/deck';
import { BoatInput, BoatState, forwardOf, starboardOf, CRUISER, MAX_REEFS, Readout, apparentWind, autoTrim, autopilotHelm, createBoat, readout, startHeading, stepBoat, Vec2, NO_CURRENT } from '../core/sailing';
import type { Terrain } from '../core/terrain';
import { waveHeight } from '../core/waves';
import { CALM_SEA, SeaState } from '../core/sea';
import { CLEAR_WEATHER, WeatherState, weatherWind } from '../core/weather';
import { Wind, windAt } from '../core/wind';
import { realWindWithGusts } from '../core/realWeather';
import { BoatView } from '../render/boat';
import { toast } from '../ui/toast';
import type { PlayerControls } from './controls';

export const WIND_START = 36000; // le « temps météo » démarre à 10 h : le vent n'est pas le même à chaque lancement du calcul
const BOARD_DISTANCE = 45; // distance maximale pour remonter sur son bateau (m)

export class BoatDriver {
  state: BoatState | null = null; // le bateau (null tant qu'on n'en a pas mis un à l'eau)
  aboard = false; // le joueur est-il à bord ?
  walking = false; // à bord mais debout sur le pont (pas à la barre) ?
  pilotOn = false; // le pilote automatique tient le cap ?
  private pilotYaw = 0; // cap tenu par le pilote (yaw)
  private deck: DeckPos = { ...HELM_POS }; // où se tient le joueur sur le pont
  private eyeH = 0; // hauteur des yeux (adoucie)
  private lastMain: 0 | 1 = 1; // dernières valeurs annoncées
  private lastJib: 0 | 1 = 1;
  private lastReef = 0;
  private readonly held = new Set<string>(); // touches de manœuvre déjà enfoncées (pour ne réagir qu'au premier appui)
  private view: BoatView | null = null;
  private shore: { x: number; z: number; yaw: number } | null = null; // où le joueur a embarqué (sert à la sauvegarde)
  private lastGround = 0; // dernier message « tu touches le fond »
  sea: SeaState = CALM_SEA; // l'état de mer (donné par le jeu) : hauteur des vagues
  private wavePitch = 0; // tangage dû aux vagues (rad, adouci)
  private waveRoll = 0; // roulis dû aux vagues (rad, adouci, + = tribord bas)
  weather: WeatherState = CLEAR_WEATHER; // le temps qu'il fait (donné par le jeu) : il renforce ou calme le vent
  wind: Wind = { speed: 5, from: 0 }; // dernier vent calculé au bateau
  current: Vec2 = NO_CURRENT; // courant (m/s, repère du monde) donné par le jeu
  waveTurn = 0; // rotation de la mer (rad) donnée par le jeu : le bateau suit les mêmes vagues que le rendu
  realWind: Wind | null = null; // vent réel lissé donné par le jeu (null = on utilise le vent simulé)
  onChange: ((aboard: boolean) => void) | null = null; // appelé quand on monte ou descend

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
    private readonly controls: PlayerControls,
  ) {}

  // B : monte à bord si on est à terre, débarque si on est à bord.
  toggle(): void {
    if (this.aboard) this.disembark();
    else this.board();
  }

  // Vent au lieu donné : le vent réel (lissé par le jeu) quand l'option est active et qu'il est connu, sinon le vent simulé.
  private localWind(lat: number, lon: number, seconds: number): Wind {
    const real = realWindWithGusts(this.realWind, seconds); // null si pas de vent réel
    return real ?? weatherWind(windAt(lat, lon, WIND_START + seconds), this.weather);
  }

  // Met le bateau à l'eau près du joueur (ou remonte sur celui qu'on a laissé tout près) et monte à bord.
  private board(): void {
    const c = this.controls;
    if (this.state && Math.hypot(this.state.x - c.x, this.state.z - c.z) < BOARD_DISTANCE) {
      this.embark(this.state); // c'est le bateau qu'on a amarré tout près
      return;
    }
    const spot = findLaunchSpot(this.terrain, CRUISER, c.x, c.z, c.yaw); // eau assez profonde, côté regard d'abord
    if (!spot) {
      toast('Pas d’eau assez profonde à moins de 1,5 km. Rapproche-toi de la mer et appuie de nouveau sur B.', 'error');
      return;
    }
    const { lat, lon } = worldToLatLon(spot.x, spot.z);
    const wind = this.localWind(lat, lon, this.clock()); // vent réel si disponible, sinon simulé
    const yaw = startHeading(c.yaw, wind); // jamais face au vent au départ
    const boat = createBoat(spot.x, spot.z, yaw);
    this.wind = wind;
    this.state = boat;
    this.ensureView();
    this.embark(boat);
  }

  // Le joueur monte sur le pont.
  private embark(boat: BoatState): void {
    const c = this.controls;
    boat.side = apparentWind(boat, this.wind).angle >= 0 ? 1 : -1; // le côté de la voile correspond au vent actuel (pas de faux « empannage »)
    this.shore = { x: c.x, z: c.z, yaw: c.yaw };
    this.lastMain = boat.mainTarget; // pas d'annonce pour l'état des voiles trouvé en montant à bord
    this.lastJib = boat.jibTarget;
    this.lastReef = boat.reef;
    c.setFly(false);
    c.aboard = true;
    c.yaw = boat.yaw; // on regarde vers l'avant
    c.pitch = -0.08;
    this.walking = false;
    this.pilotOn = false;
    this.deck = { ...HELM_POS };
    this.aboard = true;
    this.view?.setAboard(true); // les penons se voient des deux côtés de la voile
    this.onChange?.(true);
    toast('À bord ! A/D : barre · W/S : écoute · E : quitter la barre et marcher · P : pilote automatique · B : débarquer.');
  }

  // Descend à terre si le bord est proche, sinon explique quoi faire.
  private disembark(): void {
    const boat = this.state;
    if (!boat) return;
    const land = findLandingSpot(this.terrain, boat.x, boat.z);
    if (!land) {
      toast('Trop loin du bord pour débarquer : approche-toi de la côte (moins de 18 m) puis appuie sur B.', 'error');
      return;
    }
    this.leave();
    const c = this.controls;
    c.x = land.x;
    c.z = land.z;
    c.y = this.terrain.heightAt(land.x, land.z) + EYE_HEIGHT;
    toast('Tu es à terre. Le voilier reste amarré ici ; appuie sur B près de lui pour remonter.');
  }

  // Quitte le bateau sans condition (téléportation, par exemple) : il reste où il est, à l'arrêt.
  leave(): void {
    if (!this.aboard) return;
    this.aboard = false;
    this.walking = false;
    this.pilotOn = false;
    this.view?.setAboard(false);
    this.controls.aboard = false;
    this.controls.roll = 0;
    this.controls.pitchBias = 0;
    const boat = this.state;
    if (boat) {
      boat.u = boat.v = boat.omega = boat.heelRate = 0; // amarré
      boat.heel = 0;
      boat.rudder = 0;
      boat.sheet = 1; // voile choquée, elle bat doucement
    }
    this.onChange?.(false);
  }

  // Position à enregistrer dans la sauvegarde : à bord, on garde le dernier point à terre (sinon on rechargerait en pleine mer).
  savedPose(): { x: number; z: number; yaw: number } | null {
    return this.aboard ? this.shore : null;
  }

  // Un pas de temps. À appeler à chaque image, avant controls.update. seconds = horloge de jeu (pour les vagues et le vent).
  update(dt: number, seconds: number, origin: Origin): void {
    const boat = this.state;
    if (!boat || !this.view) return;
    const { lat, lon } = worldToLatLon(boat.x, boat.z);
    this.wind = this.localWind(lat, lon, seconds); // vent réel si disponible, sinon simulé
    if (this.aboard && this.controls.locked) {
      const yawBefore = boat.yaw;
      stepBoat(boat, CRUISER, this.wind, this.readInput(boat, dt), dt, (x, z) => -this.terrain.heightAt(x, z), this.current);
      this.controls.yaw += boat.yaw - yawBefore; // le pont tourne avec le bateau : le regard reste dans le même sens du bateau
      this.report(boat);
    }
    const sw = this.sea.swell;
    const y = waveHeight(boat.x, boat.z, seconds, sw, this.waveTurn); // le bateau suit la surface de l'eau
    // Tangage et roulis : la pente de la houle sous la coque (on mesure la hauteur à l'étrave, à l'étambot et sur les bords).
    const fw = forwardOf(boat.yaw);
    const sb = starboardOf(boat.yaw);
    const half = CRUISER.length * 0.4;
    const halfB = CRUISER.beam * 0.5;
    const hFront = waveHeight(boat.x + fw.x * half, boat.z + fw.z * half, seconds, sw, this.waveTurn);
    const hBack = waveHeight(boat.x - fw.x * half, boat.z - fw.z * half, seconds, sw, this.waveTurn);
    const hStbd = waveHeight(boat.x + sb.x * halfB, boat.z + sb.z * halfB, seconds, sw, this.waveTurn);
    const hPort = waveHeight(boat.x - sb.x * halfB, boat.z - sb.z * halfB, seconds, sw, this.waveTurn);
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 5); // la coque amortit les mouvements brusques
    this.wavePitch += (Math.atan2(hFront - hBack, half * 2) * 0.9 - this.wavePitch) * k;
    this.waveRoll += (Math.atan2(hPort - hStbd, halfB * 2) * 0.6 - this.waveRoll) * k;
    this.view.update(boat, this.wind, origin.x, origin.z, y, seconds, this.wavePitch, this.waveRoll);
    if (this.aboard) {
      let eye;
      if (this.walking) {
        // debout sur le pont : le déplacement se fait dans le repère du bateau
        const rel = this.controls.yaw - boat.yaw; // regard relatif au bateau
        const c = this.controls;
        if (c.locked) {
          const fwd = (c.down('KeyW') ? 1 : 0) - (c.down('KeyS') ? 1 : 0) + c.touchMove.forward;
          const right = (c.down('KeyD') ? 1 : 0) - (c.down('KeyA') ? 1 : 0) + c.touchMove.right;
          const step = deckStep(rel, Math.max(-1, Math.min(1, fwd)), Math.max(-1, Math.min(1, right)), WALK_SPEED * Math.min(dt, 0.1));
          this.deck = moveOnDeck(CRUISER, this.deck, step.du, step.dv);
        }
        const target = deckSurface(CRUISER, this.deck.u, this.deck.v) + WALK_EYE;
        this.eyeH += (target - this.eyeH) * Math.min(1, dt * 8); // on monte et descend les marches sans à-coup
        eye = this.view.eyeWorld(origin.x, origin.z, this.deck.u, this.eyeH, this.deck.v);
      } else {
        this.eyeH = CRUISER.eyeHeight;
        eye = this.view.eyeWorld(origin.x, origin.z);
      }
      this.controls.x = eye.x;
      this.controls.y = eye.y;
      this.controls.z = eye.z;
      this.controls.roll = -(boat.heel + this.waveRoll) * 0.6; // la caméra penche un peu moins que le bateau (plus confortable)
      this.controls.pitchBias = this.wavePitch * 0.6;
    }
  }

  // Ce qu'affichent les instruments (null si on n'est pas à bord).
  getReadout(): Readout | null {
    return this.aboard && this.state ? { ...readout(this.state, this.wind, this.current), pilot: this.pilotOn } : null;
  }

  // Les commandes du joueur lues sur le clavier.
  private readInput(boat: BoatState, dt: number): BoatInput {
    const c = this.controls;
    const right = c.down('KeyD') || c.down('ArrowRight') ? 1 : 0; // D : barre à droite (le bateau tourne à tribord)
    const left = c.down('KeyA') ? 1 : 0; // A (ou Q sur AZERTY, même touche physique) : à gauche
    // Réglage de l'écoute : à la barre W/S ; debout sur le pont, R (border) et F (choquer) car W/S servent à marcher.
    const ease = (this.walking ? c.down('KeyF') : c.down('KeyS')) ? 1 : 0;
    const pull = (this.walking ? c.down('KeyR') : c.down('KeyW')) ? 1 : 0;
    const input: BoatInput = { helm: this.walking ? 0 : right - left, trim: ease - pull, center: !this.walking && c.down('Space') };
    // Le pilote : à la barre, toucher A/D le coupe ; sinon il donne l'ordre de barre.
    if (this.pilotOn && !this.walking && (right || left || input.center)) this.setPilot(false, boat);
    if (this.pilotOn) {
      input.helm = autopilotHelm(boat, this.pilotYaw, dt);
      if (input.trim === 0) input.trim = autoTrim(boat, this.wind); // le pilote règle aussi l'écoute, sauf si tu y touches toi-même
    }
    // Manœuvres de voiles : un appui (pas une touche maintenue) déclenche l'action.
    const edge = (code: string): boolean => {
      const now = c.down(code);
      const was = this.held.has(code);
      if (now) this.held.add(code);
      else this.held.delete(code);
      return now && !was;
    };
    if (edge('KeyE')) this.toggleHelm(boat); // E : quitter la barre / la reprendre
    if (edge('KeyP')) this.setPilot(!this.pilotOn, boat); // P : pilote automatique
    if (edge('KeyY')) input.toggleMain = true; // Y : hisser / affaler la grand-voile
    if (edge('KeyU')) input.toggleJib = true; // U : dérouler / rouler le foc
    if (edge('KeyX')) input.reef = 1; // X : prendre un ris
    if (edge('KeyC')) input.reef = -1; // C : larguer un ris
    return input;
  }

  // Pilote automatique : tient le cap du moment.
  private setPilot(on: boolean, boat: BoatState): void {
    if (on === this.pilotOn) return;
    this.pilotOn = on;
    if (on) {
      this.pilotYaw = boat.yaw;
      boat.pilotInt = 0;
      toast(`Pilote automatique : cap ${Math.round(((-boat.yaw * 180) / Math.PI + 360) % 360)}° et écoute réglée seule. P ou A/D pour le couper.`);
    } else {
      toast('Pilote coupé : tu as la barre.');
    }
  }

  // E : à la barre, on s'en éloigne (le pilote prend le cap) ; debout près de la roue, on la reprend.
  private toggleHelm(boat: BoatState): void {
    if (!this.walking) {
      this.walking = true;
      this.deck = { ...HELM_POS };
      this.eyeH = CRUISER.eyeHeight;
      if (!this.pilotOn) this.setPilot(true, boat); // on ne laisse pas le bateau sans barreur
      toast('Tu marches sur le pont. WASD : avancer · R/F : écoute · E près de la roue : reprendre la barre.');
    } else if (nearHelm(this.deck)) {
      this.walking = false;
      this.deck = { ...HELM_POS };
      toast('Tu as repris la barre.');
    } else {
      toast('Trop loin de la roue : reviens dans le cockpit pour reprendre la barre (E).', 'error');
    }
  }

  // Messages d'événements (virement, empannage, fond).
  private report(boat: BoatState): void {
    this.announceSails(boat);
    if (boat.event === 'tack') toast('Virement de bord : la voile change de côté.');
    else if (boat.event === 'gybe') toast('Empannage ! La bôme est passée de l’autre côté : fais attention à sa vitesse.');
    boat.event = null;
    if (boat.aground && performance.now() - this.lastGround > 8000) {
      this.lastGround = performance.now();
      toast('Tu touches le fond. Barre dans l’autre sens pour retrouver de l’eau profonde.', 'error');
    }
  }

  // Dit à voix haute (message) ce que les manœuvres de voiles viennent de décider.
  private announceSails(boat: BoatState): void {
    if (boat.mainTarget !== this.lastMain) {
      toast(boat.mainTarget === 1 ? 'On hisse la grand-voile (environ 20 s). Y pour l’affaler.' : 'On affale la grand-voile. Y pour la hisser.');
      this.lastMain = boat.mainTarget;
    }
    if (boat.jibTarget !== this.lastJib) {
      toast(boat.jibTarget === 1 ? 'On déroule le foc. U pour le rouler.' : 'On roule le foc sur l’étai. U pour le dérouler.');
      this.lastJib = boat.jibTarget;
    }
    if (boat.reef !== this.lastReef) {
      toast(boat.reef === 0 ? 'Plus de ris.' : `${boat.reef} ris pris${boat.reef === MAX_REEFS ? ' (le maximum)' : ''}. X : un ris de plus · C : en larguer un.`);
      this.lastReef = boat.reef;
    }
  }

  private ensureView(): void {
    if (!this.view) this.view = new BoatView(this.scene, CRUISER);
  }

  // Horloge météo (secondes) utilisée au moment de la mise à l'eau.
  private clock(): number {
    return performance.now() / 1000;
  }
}
