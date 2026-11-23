// Commandes tactiles : joystick flottant à gauche, glisser pour regarder à droite, boutons Courir / Vol / Menu.
// Le DOM est décrit dans index.html (#touch-ui) ; la logique pure est dans core/touch.ts.

import { joystick, touchLookDelta } from '../core/touch';
import { byId } from '../ui/dom';
import type { PlayerControls } from './controls';

export class TouchUi {
  private readonly moveZone = byId('touch-move-zone');
  private readonly lookZone = byId('touch-look-zone');
  private readonly joy = byId('joy');
  private readonly knob = byId('joy-knob');
  private readonly runBtn = byId<HTMLButtonElement>('touch-run');
  private readonly flyBtn = byId<HTMLButtonElement>('touch-fly');
  private readonly upBtn = byId<HTMLButtonElement>('touch-up');
  private readonly downBtn = byId<HTMLButtonElement>('touch-down');
  private moveId = -1; // doigt qui tient le joystick (-1 = aucun)
  private moveX = 0; // point de départ du joystick
  private moveY = 0;
  private lookId = -1; // doigt qui regarde (-1 = aucun)
  private lookX = 0; // dernière position du doigt qui regarde
  private lookY = 0;
  private runToggle = false; // bouton Courir enclenché
  private joyFull = false; // joystick poussé à fond

  constructor(
    private readonly controls: PlayerControls,
    onMenu: () => void, // ouvre le menu pause
  ) {
    for (const zone of [this.moveZone, this.lookZone]) zone.addEventListener('contextmenu', (e) => e.preventDefault()); // pas de menu contextuel sur appui long
    this.moveZone.addEventListener('pointerdown', (e) => this.moveDown(e));
    this.moveZone.addEventListener('pointermove', (e) => this.moveMove(e));
    for (const type of ['pointerup', 'pointercancel']) this.moveZone.addEventListener(type, (e) => this.moveEnd(e as PointerEvent));
    this.lookZone.addEventListener('pointerdown', (e) => this.lookDown(e));
    this.lookZone.addEventListener('pointermove', (e) => this.lookMove(e));
    for (const type of ['pointerup', 'pointercancel']) this.lookZone.addEventListener(type, (e) => this.lookEnd(e as PointerEvent));
    byId('touch-menu').addEventListener('click', onMenu); // un appui : menu
    this.runBtn.addEventListener('click', () => {
      this.runToggle = !this.runToggle; // Courir : un appui enclenche, un autre coupe
      this.runBtn.setAttribute('aria-pressed', String(this.runToggle));
      this.applyRun();
    });
    this.flyBtn.addEventListener('click', () => this.controls.setFly(!this.controls.fly)); // Vol : bascule (le retour visuel vient de setFly)
    this.holdButton(this.upBtn, 1); // ▲ : monte tant qu'on appuie
    this.holdButton(this.downBtn, -1); // ▼ : descend tant qu'on appuie
    this.setFly(controls.fly);
  }

  // Met à jour les boutons selon l'état du vol libre (appelé par le jeu).
  setFly(on: boolean): void {
    this.flyBtn.setAttribute('aria-pressed', String(on));
    this.upBtn.hidden = !on; // montée et descente n'existent qu'en vol
    this.downBtn.hidden = !on;
    if (!on) this.controls.touchUp = 0;
  }

  // Relâche tout (on quitte le mode tactile).
  reset(): void {
    this.moveId = -1;
    this.lookId = -1;
    this.joy.classList.remove('on');
    this.joyFull = false;
    this.controls.touchUp = 0;
    this.runToggle = false;
    this.runBtn.setAttribute('aria-pressed', 'false');
    this.controls.touchMove = { forward: 0, right: 0 };
    this.controls.touchRun = false;
  }

  // Le bouton de course = bouton enclenché ou joystick à fond.
  private applyRun(): void {
    this.controls.touchRun = this.runToggle || this.joyFull;
  }

  // Bouton à maintenir (monter / descendre en vol).
  private holdButton(btn: HTMLButtonElement, dir: number): void {
    btn.addEventListener('pointerdown', (e) => {
      btn.setPointerCapture(e.pointerId); // on garde le doigt même s'il glisse un peu
      this.controls.touchUp = dir;
    });
    for (const type of ['pointerup', 'pointercancel']) btn.addEventListener(type, () => (this.controls.touchUp = 0));
  }

  // ----- Joystick (moitié gauche) -----

  private moveDown(e: PointerEvent): void {
    if (this.moveId !== -1) return; // un seul doigt à la fois sur le joystick
    this.moveId = e.pointerId;
    this.moveX = e.clientX;
    this.moveY = e.clientY;
    this.moveZone.setPointerCapture(e.pointerId);
    this.joy.style.left = `${e.clientX}px`; // le joystick apparaît sous le pouce
    this.joy.style.top = `${e.clientY}px`;
    this.joy.classList.add('on');
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  private moveMove(e: PointerEvent): void {
    if (e.pointerId !== this.moveId) return;
    const j = joystick(e.clientX - this.moveX, e.clientY - this.moveY);
    this.controls.touchMove = { forward: j.forward, right: j.right };
    this.joyFull = j.full;
    this.applyRun();
    this.knob.style.transform = `translate(${j.knobX}px, ${j.knobY}px)`;
  }

  private moveEnd(e: PointerEvent): void {
    if (e.pointerId !== this.moveId) return;
    this.moveId = -1;
    this.joy.classList.remove('on');
    this.controls.touchMove = { forward: 0, right: 0 };
    this.joyFull = false;
    this.applyRun();
  }

  // ----- Regard (moitié droite) -----

  private lookDown(e: PointerEvent): void {
    if (this.lookId !== -1) return;
    this.lookId = e.pointerId;
    this.lookX = e.clientX;
    this.lookY = e.clientY;
    this.lookZone.setPointerCapture(e.pointerId);
  }

  private lookMove(e: PointerEvent): void {
    if (e.pointerId !== this.lookId) return;
    const [dYaw, dPitch] = touchLookDelta(e.clientX - this.lookX, e.clientY - this.lookY, this.controls.sensitivity);
    this.controls.look(dYaw, dPitch);
    this.lookX = e.clientX;
    this.lookY = e.clientY;
  }

  private lookEnd(e: PointerEvent): void {
    if (e.pointerId === this.lookId) this.lookId = -1;
  }
}
