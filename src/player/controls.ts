// Contrôles du joueur à la première personne : souris (regard), clavier (déplacement), marche ou vol libre.
// La souris est « capturée » par le navigateur (pointer lock) tant qu'on joue ; Échap la libère.

import * as THREE from 'three';
import { clamp } from '../core/math';
import { EYE_HEIGHT, MoveInput, flyDelta, smoothTo, stepWalk } from '../core/movement';
import type { SaveData } from '../core/save';
import type { Terrain } from '../core/terrain';

const LOOK_SPEED = 0.0022; // radians par pixel de souris, à sensibilité 1
const MAX_PITCH = 1.5; // on ne peut pas regarder plus haut/bas que ~86°

export class PlayerControls {
  x: number; // position est-ouest
  y: number; // altitude des yeux
  z: number; // position nord-sud
  yaw: number; // cap
  pitch: number; // inclinaison du regard
  fly: boolean; // vol libre actif ?
  sensitivity = 1; // sensibilité de la souris
  onBlocked: (() => void) | null = null; // appelé quand l'eau profonde bloque le chemin
  onFlyChange: ((on: boolean) => void) | null = null; // appelé quand on active/désactive le vol
  onHelpKey: (() => void) | null = null; // appelé quand on appuie sur la touche d'aide
  private readonly keys = new Set<string>(); // touches physiques actuellement enfoncées
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
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear()); // si la fenêtre perd le focus, on lâche toutes les touches
    document.addEventListener('mousemove', (e) => this.onMouseMove(e));
    document.addEventListener('pointerlockchange', () => this.keys.clear()); // changement de capture : on repart de zéro
  }

  // La souris est-elle capturée (= on joue) ?
  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  // Demande la capture de la souris (doit venir d'un clic ou d'une touche de l'utilisateur).
  requestLock(): void {
    try {
      void Promise.resolve(this.element.requestPointerLock()).catch(() => undefined); // certains navigateurs renvoient une promesse
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
        forward: this.axis('KeyW', 'ArrowUp') - this.axis('KeyS', 'ArrowDown'), // W/Z avance, S recule (touches physiques)
        right: this.axis('KeyD', 'ArrowRight') - this.axis('KeyA', 'ArrowLeft'), // D droite, A/Q gauche
        run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      };
      if (this.fly) {
        const up = this.axis('Space', 'Space') - (this.keys.has('KeyC') || this.keys.has('ControlLeft') ? 1 : 0); // Espace monte, C/Ctrl descend
        const [dx, dy, dz] = flyDelta(this.yaw, this.pitch, { ...input, up }, dt);
        this.x += dx;
        this.y += dy;
        this.z += dz;
        this.y = clamp(this.y, this.terrain.heightAt(this.x, this.z) + 1, 3000); // pas sous le sol, pas dans l'espace
      } else {
        const r = stepWalk(this.terrain, this.x, this.z, this.yaw, input, dt);
        this.x = r.x;
        this.z = r.z;
        if (r.blocked && this.blockedCooldown === 0 && (input.forward !== 0 || input.right !== 0)) {
          this.blockedCooldown = 4; // au plus un message toutes les 4 s
          this.onBlocked?.();
        }
      }
    }
    if (!this.fly) {
      const target = this.terrain.heightAt(this.x, this.z) + EYE_HEIGHT; // hauteur des yeux voulue
      this.y = this.y > target ? smoothTo(this.y, target, 5, dt) : smoothTo(this.y, target, 14, dt); // descente douce, relief suivi vite
    }
    camera.position.set(this.x - originX, this.y, this.z - originZ); // la caméra est placée relativement à l'origine flottante
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ'); // d'abord le cap, puis l'inclinaison
  }

  // 1 si l'une des deux touches est enfoncée, sinon 0.
  private axis(a: string, b: string): number {
    return this.keys.has(a) || this.keys.has(b) ? 1 : 0;
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat) return; // on ignore la répétition automatique
    if (!this.locked) {
      if (e.code === 'KeyH' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) this.onHelpKey?.(); // aide depuis le menu
      return;
    }
    this.keys.add(e.code);
    if (e.code === 'KeyV') this.setFly(!this.fly); // V : vol libre
    if (e.code === 'KeyH') this.onHelpKey?.(); // H : aide
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); // pas de défilement de page
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.locked) return;
    this.yaw -= e.movementX * LOOK_SPEED * this.sensitivity; // droite = tourner vers la droite
    this.pitch = clamp(this.pitch - e.movementY * LOOK_SPEED * this.sensitivity, -MAX_PITCH, MAX_PITCH);
  }
}
