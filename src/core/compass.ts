// La boussole que le joueur tient à la main. Logique pure : on calcule où est le nord sur le cadran, avec l'inertie d'une vraie rose.
// Repères : le cap (bearing) se compte dans le sens horaire depuis le nord (0 = nord, π/2 = est). Le yaw du jeu tourne dans l'autre sens.

const TAU = Math.PI * 2;
const W0 = 6; // raideur de la rose (rad/s) : plus c'est grand, plus elle se cale vite
const ZETA = 0.55; // amortissement : < 1, la rose dépasse un peu sa position puis se pose, comme dans un liquide

// Ramène un angle entre −π et π.
export const wrapPi = (a: number): number => a - TAU * Math.floor((a + Math.PI) / TAU);

// Ramène un angle entre 0 et 2π.
export const wrapTau = (a: number): number => a - TAU * Math.floor(a / TAU);

// Le cap compas (sens horaire depuis le nord) quand on regarde dans la direction `yaw` du jeu (yaw 0 = nord, yaw π/2 = ouest).
export const bearingFromYaw = (yaw: number): number => wrapTau(-yaw);

// État de la rose : `card` = angle du nord par rapport à l'avant du cadran (rad, sens horaire vu de dessus, 0 = le nord est devant) ; `vel` = sa vitesse.
export interface CompassState {
  card: number;
  vel: number;
}

// Rose posée sur le cap donné (au départ ou après une téléportation).
export const newCompass = (bearing = 0): CompassState => ({ card: wrapPi(-bearing), vel: 0 });

// Fait avancer la rose de `dt` secondes. `disturbance` = petit écart (rad) dû aux secousses de la marche.
export function stepCompass(s: CompassState, bearing: number, dt: number, disturbance = 0): CompassState {
  let card = s.card;
  let vel = s.vel;
  const target = -bearing + disturbance; // le nord est à l'opposé du cap, par rapport à l'avant
  let left = Math.min(Math.max(dt, 0), 0.25); // jamais plus d'un quart de seconde d'un coup (un à-coup d'image ne doit pas affoler la rose)
  while (left > 1e-9) {
    const h = Math.min(left, 1 / 120); // petits pas : le calcul reste stable
    left -= h;
    const err = wrapPi(target - card); // chemin le plus court vers la cible
    vel += (W0 * W0 * err - 2 * ZETA * W0 * vel) * h; // ressort amorti
    card = wrapPi(card + vel * h);
  }
  return { card, vel };
}

// Cap lu sur la boussole, en degrés entiers de 0 à 359.
export const headingDegrees = (bearing: number): number => Math.round((wrapTau(bearing) * 180) / Math.PI) % 360;

const NAMES = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'] as const; // O = ouest

// Nom de la direction (16 secteurs).
export const cardinal16 = (bearing: number): string => NAMES[Math.round(wrapTau(bearing) / (TAU / 16)) % 16]!;

// Texte lisible : « NE · 047° ».
export const compassText = (bearing: number): string => `${cardinal16(bearing)} · ${String(headingDegrees(bearing)).padStart(3, '0')}°`;
