// Le pilote : relie le voilier (physique + rendu) au joueur. Il gère la mise à l'eau, le débarquement,
// les commandes au clavier (barre, écoute), le vent, la caméra posée sur le pont et les messages.

import type * as THREE from 'three';
import { findLandingSpot, findLaunchSpot } from '../core/boarding';
import { worldToLatLon } from '../core/geo';
import { EYE_HEIGHT } from '../core/movement';
import type { Origin } from '../core/origin';
import { BoatInput, BoatState, CRUISER, Readout, apparentWind, createBoat, readout, startHeading, stepBoat } from '../core/sailing';
import type { Terrain } from '../core/terrain';
import { waveHeight } from '../core/waves';
import { Wind, windAt } from '../core/wind';
import { BoatView } from '../render/boat';
import { toast } from '../ui/toast';
import type { PlayerControls } from './controls';

const WIND_START = 36000; // le « temps météo » démarre à 10 h : le vent n'est pas le même à chaque lancement du calcul
const BOARD_DISTANCE = 45; // distance maximale pour remonter sur son bateau (m)

export class BoatDriver {
  state: BoatState | null = null; // le bateau (null tant qu'on n'en a pas mis un à l'eau)
  aboard = false; // le joueur est-il à bord ?
  private view: BoatView | null = null;
  private shore: { x: number; z: number; yaw: number } | null = null; // où le joueur a embarqué (sert à la sauvegarde)
  private lastGround = 0; // dernier message « tu touches le fond »
  wind: Wind = { speed: 5, from: 0 }; // dernier vent calculé au bateau
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
    const wind = windAt(lat, lon, WIND_START + this.clock());
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
    c.setFly(false);
    c.aboard = true;
    c.yaw = boat.yaw; // on regarde vers l'avant
    c.pitch = -0.08;
    this.aboard = true;
    this.onChange?.(true);
    toast('À bord ! A/D : barre · W/S : écoute (W borde, S choque) · Espace : barre au milieu · B : débarquer.');
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
    this.controls.aboard = false;
    this.controls.roll = 0;
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
    this.wind = windAt(lat, lon, WIND_START + seconds);
    if (this.aboard && this.controls.locked) {
      const yawBefore = boat.yaw;
      stepBoat(boat, CRUISER, this.wind, this.readInput(), dt, (x, z) => -this.terrain.heightAt(x, z));
      this.controls.yaw += boat.yaw - yawBefore; // le pont tourne avec le bateau : le regard reste dans le même sens du bateau
      this.report(boat);
    }
    const y = waveHeight(boat.x, boat.z, seconds); // le bateau suit la surface de l'eau
    this.view.update(boat, origin.x, origin.z, y, seconds);
    if (this.aboard) {
      const eye = this.view.eyeWorld(origin.x, origin.z); // position des yeux du barreur
      this.controls.x = eye.x;
      this.controls.y = eye.y;
      this.controls.z = eye.z;
      this.controls.roll = -boat.heel * 0.6; // la caméra penche un peu moins que le bateau (plus confortable)
    }
  }

  // Ce qu'affichent les instruments (null si on n'est pas à bord).
  getReadout(): Readout | null {
    return this.aboard && this.state ? readout(this.state, this.wind) : null;
  }

  // Les commandes du joueur lues sur le clavier.
  private readInput(): BoatInput {
    const c = this.controls;
    const right = c.down('KeyD') || c.down('ArrowRight') ? 1 : 0; // D : barre à droite (le bateau tourne à tribord)
    const left = c.down('KeyA') ? 1 : 0; // A (ou Q sur AZERTY, même touche physique) : à gauche
    const ease = c.down('KeyS') ? 1 : 0; // S : choquer
    const pull = c.down('KeyW') ? 1 : 0; // W (Z sur AZERTY) : border
    return { helm: right - left, trim: ease - pull, center: c.down('Space') };
  }

  // Messages d'événements (virement, empannage, fond).
  private report(boat: BoatState): void {
    if (boat.event === 'tack') toast('Virement de bord : la voile change de côté.');
    else if (boat.event === 'gybe') toast('Empannage ! La bôme est passée de l’autre côté : fais attention à sa vitesse.');
    boat.event = null;
    if (boat.aground && performance.now() - this.lastGround > 8000) {
      this.lastGround = performance.now();
      toast('Tu touches le fond. Barre dans l’autre sens pour retrouver de l’eau profonde.', 'error');
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
