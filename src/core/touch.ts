// Logique pure des commandes tactiles : joystick virtuel et regard au doigt. Sans DOM, testable.

export const JOYSTICK_RADIUS = 56; // rayon du joystick, en pixels : à cette distance du point de départ, le joystick est à fond
export const JOYSTICK_DEADZONE = 0.12; // en dessous de 12 % de course, on ne bouge pas (évite les micro-mouvements du pouce)
export const RUN_THRESHOLD = 0.95; // joystick poussé à fond : on court (en plus du bouton Courir)
export const TOUCH_LOOK_SPEED = 0.0052; // radians par pixel de glissement, à sensibilité 1 (le doigt est moins précis que la souris)

// Résultat du joystick : intention de déplacement et position du bouton à dessiner.
export interface JoystickState {
  forward: number; // +1 = avancer (doigt vers le haut), -1 = reculer
  right: number; // +1 = pas de côté vers la droite
  knobX: number; // décalage du bouton à dessiner, en pixels (limité au rayon)
  knobY: number;
  full: boolean; // poussé à fond ?
}

// Transforme le décalage du doigt (dx, dy en pixels depuis son point de départ) en intention de déplacement.
export function joystick(dx: number, dy: number, radius = JOYSTICK_RADIUS, deadzone = JOYSTICK_DEADZONE): JoystickState {
  const len = Math.hypot(dx, dy); // distance du doigt à son point de départ
  const scale = len > radius ? radius / len : 1; // on ramène le bouton dans le cercle
  const knobX = dx * scale;
  const knobY = dy * scale;
  const amount = Math.min(1, len / radius); // course de 0 à 1
  if (amount < deadzone || len === 0) return { forward: 0, right: 0, knobX, knobY, full: false }; // zone morte
  const strength = (amount - deadzone) / (1 - deadzone); // la course utile repart de 0 après la zone morte
  return {
    forward: (-knobY / Math.max(len * scale, 1e-9)) * strength, // l'écran a y vers le bas : doigt en haut = avancer
    right: (knobX / Math.max(len * scale, 1e-9)) * strength,
    knobX,
    knobY,
    full: amount >= RUN_THRESHOLD,
  };
}

// Variation du regard pour un glissement du doigt (dx, dy en pixels) : doigt à droite = tourner à droite, doigt en haut = regarder en haut.
export const touchLookDelta = (dx: number, dy: number, sensitivity: number): [number, number] => [
  -dx * TOUCH_LOOK_SPEED * sensitivity, // cap : même sens que la souris
  -dy * TOUCH_LOOK_SPEED * sensitivity, // inclinaison : doigt vers le haut = regarder vers le haut
];

// Le doigt est-il posé sur la moitié gauche de l'écran (zone du joystick) ?
export const isLeftSide = (x: number, width: number): boolean => x < width / 2;
