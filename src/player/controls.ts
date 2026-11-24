// Contrôles du joueur à la première personne : souris (regard), clavier (déplacement), marche ou vol libre.
// La souris est « capturée » par le navigateur (pointer lock) tant qu'on joue ; Échap la libère.

import * as THREE from 'three';
import { clamp } from '../core/math';
import { CROUCH_EYE_HEIGHT, EYE_HEIGHT, MoveInput, flyDelta, keyLookDelta, smoothTo, stepWalk } from '../core/movement';
import type { SaveData } from '../core/save';
import type { Terrain } from '../core/terrain';
import { TreeObstacles } from '../core/treeCollide';

const LOOK_SPEED = 0.0022; // radians par pixel de souris, à sensibilité 1
const MAX_PITCH = 1.5; // on ne peut pas regarder plus haut/bas que ~86°

export class PlayerControls {
  x: number; // position est-ouest
  y: number; // altitude des yeux
  z: number; // position nord-sud
  yaw: number; // cap
  pitch: number; // inclinaison du regard
  fly: boolean; // vol libre actif ?
  aboard = false; // à bord du bateau ? (le bateau pose lui-même la position ; le joueur ne marche plus)
  roll = 0; // roulis de la caméra (rad), donné par la gîte du bateau
  pitchBias = 0; // tangage ajouté au regard (rad), donné par les vagues
  sensitivity = 1; // sensibilité de la souris
  onBlocked: (() => void) | null = null; // appelé quand l'eau profonde bloque le chemin
  onFlyChange: ((on: boolean) => void) | null = null; // appelé quand on active/désactive le vol
  onViewKey: (() => void) | null = null; // appelé quand on appuie sur T (première / troisième personne)
  onConstellationsKey: (() => void) | null = null; // appelé quand on appuie sur L (constellations)
  onMapKey: (() => void) | null = null; // appelé quand on appuie sur M (carte du monde)
  onBoatKey: (() => void) | null = null; // appelé quand on appuie sur B (monter à bord / débarquer)
  onInstrumentsKey: (() => void) | null = null; // appelé quand on appuie sur I (instruments du voilier)
  onHelpKey: (() => void) | null = null; // appelé quand on appuie sur la touche d'aide
  touchActive = false; // joue-t-on au doigt (sans capture de souris) ?
  touchMove = { forward: 0, right: 0 }; // intention du joystick virtuel, de -1 à 1
  touchRun = false; // bouton « Courir » enfoncé (ou joystick à fond)
  touchUp = 0; // vol au doigt : +1 monte, -1 descend, 0 stable
  private readonly keys = new Set<string>(); // touches physiques actuellement enfoncées
  private readonly trees: TreeObstacles; // les troncs d'arbres autour de nous (on ne les traverse pas)
  crouching = false; // accroupi (touche C tenue, à pied) ?
  private blockedCooldown = 0; // évite d'afficher le message d'eau à chaque image

  constructor(
    private readonly element: HTMLElement, // l'élément qui capture la souris
    private readonly terrain: Terrain,
    save: SaveData,
  ) {
    this.x = save.x;
    this.z = save.z;
    this.y = save.y;
    this.yaw = save.yaw;
    this.pitch = save.pitch;
    this.fly = save.fly;
    this.trees = new TreeObstacles(terrain);
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear()); // si la fenêtre perd le focus, on lâche toutes les touches
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('pointerlockchange', () => this.keys.clear()); // changement de capture : on repart de zéro
  }

  // La souris est-elle capturée (= on joue) ?
  get locked(): boolean {
    return this.touchActive || document.pointerLockElement === this.element; // au doigt, « on joue » = mode tactile actif
  }

  // Tourne le regard d'un delta (utilisé par le glissement du doigt).
  look(dYaw: number, dPitch: number): void {
    this.yaw += dYaw;
    this.pitch = clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
  }

  // Active ou coupe le mode tactile ; en le coupant, le joystick est relâché.
  setTouchActive(on: boolean): void {
    this.touchActive = on;
    if (!on) {
      this.touchMove = { forward: 0, right: 0 };
      this.touchRun = false;
      this.touchUp = 0;
    }
  }

  // Demande la capture de la souris (doit venir d'un clic ou d'une touche de l'utilisateur).
  requestLock(): void {
    try {
      // Mouvement « brut » : sans l'accélération de souris du système (regard plus direct). Si le navigateur ne le gère pas, on redemande normalement.
      const raw = this.element.requestPointerLock({ unadjustedMovement: true }) as unknown as Promise<void> | undefined;
      void Promise.resolve(raw).catch(() => {
        try {
          void Promise.resolve(this.element.requestPointerLock()).catch(() => undefined); // repli : capture classique
        } catch {
          /* refus : pointerlockerror préviendra */
        }
      });
    } catch {
      /* le navigateur a refusé : l'événement pointerlockerror préviendra l'utilisateur */
    }
  }

  // Active ou coupe le vol libre.
  setFly(on: boolean): void {
    if (this.fly === on) return;
    this.fly = on;
    this.onFlyChange?.(on);
  }

  // Avance le joueur d'un pas de temps et place la caméra.
  update(dt: number, camera: THREE.PerspectiveCamera, originX = 0, originZ = 0): void {
    this.blockedCooldown = Math.max(0, this.blockedCooldown - dt);
    if (this.locked) {
      const input: MoveInput = {
        forward: clamp(this.axis('KeyW') - this.axis('KeyS') + this.touchMove.forward, -1, 1), // W/Z avance, S recule (touches physiques)
        right: clamp(this.axis('KeyD') - this.axis('KeyA') + this.touchMove.right, -1, 1), // D droite, A/Q gauche
        run: this.touchRun || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
        crouch: !this.fly && !this.aboard && this.keys.has('KeyC'), // C tenue : accroupi (en vol, C descend ; à bord, C largue un ris)
      };
      this.crouching = input.crouch === true;
      const [dYaw, dPitch] = keyLookDelta(this.axis('ArrowLeft'), this.axis('ArrowRight'), this.axis('ArrowUp'), this.axis('ArrowDown'), this.sensitivity, dt); // flèches : regard
      this.yaw += dYaw; // les flèches tournent le cap, en même temps que le déplacement
      this.pitch = clamp(this.pitch + dPitch, -MAX_PITCH, MAX_PITCH);
      if (this.aboard) {
        // À bord : pas de marche, le bateau place la caméra (les touches A/D/Z/S servent à barrer et régler la voile).
      } else if (this.fly) {
        const up = clamp(this.axis('Space') - (this.keys.has('KeyC') || this.keys.has('ControlLeft') ? 1 : 0) + this.touchUp, -1, 1); // Espace monte, C/Ctrl descend
        const [dx, dy, dz] = flyDelta(this.yaw, this.pitch, { ...input, up }, dt);
        this.x += dx;
        this.y += dy;
        this.z += dz;
        this.y = clamp(this.y, this.terrain.heightAt(this.x, this.z) + 1, 3000); // pas sous le sol, pas dans l'espace
      } else {
        const r = stepWalk(this.terrain, this.x, this.z, this.yaw, input, dt);
        const p = this.trees.resolve(r.x, r.z); // pas de passage à travers les troncs : on glisse autour
        this.x = p.x;
        this.z = p.z;
        if (r.blocked && this.blockedCooldown === 0 && (input.forward !== 0 || input.right !== 0)) {
          this.blockedCooldown = 4; // au plus un message toutes les 4 s
          this.onBlocked?.();
        }
      }
    }
    if (this.fly || this.aboard) this.crouching = false;
    if (!this.fly && !this.aboard) {
      const target = this.terrain.heightAt(this.x, this.z) + (this.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT); // hauteur des yeux voulue (plus bas accroupi)
      this.y = this.y > target ? smoothTo(this.y, target, 5, dt) : smoothTo(this.y, target, 14, dt); // descente douce, relief suivi vite
    }
    camera.position.set(this.x - originX, this.y, this.z - originZ); // la caméra est placée relativement à l'origine flottante
    camera.rotation.set(this.pitch + this.pitchBias, this.yaw, this.roll, 'YXZ'); // d'abord le cap, puis l'inclinaison, puis le roulis (gîte du bateau)
  }

  // Une touche physique est-elle enfoncée en ce moment ? (utilisé par le bateau pour la barre et l'écoute)
  down(code: string): boolean {
    return this.keys.has(code);
  }

  // 1 si l'une des deux touches est enfoncée, sinon 0.
  private axis(a: string, b = a): number {
    return this.keys.has(a) || this.keys.has(b) ? 1 : 0;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return; // on ignore la répétition automatique
    if (!this.locked) {
      if (e.code === 'KeyH' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) this.onHelpKey?.(); // aide depuis le menu
      if (e.code === 'KeyM' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) this.onMapKey?.(); // carte depuis le menu
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'KeyV' && !this.aboard) this.setFly(!this.fly); // V : vol libre (pas à bord)
    if (e.code === 'KeyB') this.onBoatKey?.(); // B : monter à bord / débarquer
    if (e.code === 'KeyH') this.onHelpKey?.(); // H : aide
    if (e.code === 'KeyM') this.onMapKey?.(); // M : carte du monde
    if (e.code === 'KeyI') this.onInstrumentsKey?.(); // I : montre ou cache les instruments du voilier
    if (e.code === 'KeyT') this.onViewKey?.(); // T : changer de vue (première / troisième personne)
    if (e.code === 'KeyL') this.onConstellationsKey?.(); // L : traits des constellations
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); // pas de défilement de page
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.locked) return;
    if (Math.abs(e.movementX) > 600 || Math.abs(e.movementY) > 600) return; // saut aberrant (bug connu de certains navigateurs) : ignoré
    this.yaw -= e.movementX * LOOK_SPEED * this.sensitivity; // droite = tourner vers la droite
    this.pitch = clamp(this.pitch - e.movementY * LOOK_SPEED * this.sensitivity, -MAX_PITCH, MAX_PITCH);
  }
}
