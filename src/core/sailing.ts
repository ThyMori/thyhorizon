// La physique du voilier (logique pure, sans DOM ni rendu). Les unités sont celles du système international
// (mètres, secondes, newtons, radians) ; 1 m du jeu = 1 m réel.
//
// Repère du bateau : « avant » (f) et « tribord » (r, la droite quand on regarde vers l'avant).
// Cap (yaw) : comme partout dans le jeu, 0 = nord, π/2 = ouest ; l'avant du bateau pointe vers (−sin yaw, −cos yaw) en (x, z).
// Les rotations « à tribord » sont positives : ω > 0 = le bateau tourne à droite (donc son cap yaw diminue).
//
// Les ingrédients, du plus important au plus fin :
//  • Vent apparent = vent vrai − vitesse du bateau. La voile est une aile : portance + traînée selon l'angle d'attaque (décrochage compris).
//  • La voile ne peut pas faire plus que l'écoute (la corde) ne la laisse : l'angle de la bôme = min(écoute, angle du vent).
//  • La quille est une aile verticale : elle s'oppose à la dérive (le bateau dérive un peu, jamais zéro).
//  • La coque résiste (frottement + vagues, qui montent très vite près de la « vitesse de coque »).
//  • La gîte : couple de la voile contre couple de redressement ; la gîte donne de la barre au vent (« ardent »).
//  • Le safran (la gouverne) est une petite aile : il ne dirige que si l'eau passe dessus (pas de vitesse = pas de barre).

import { clamp, lerp, smoothstep } from './math';
import type { Wind } from './wind';
import { windVelocity } from './wind';

const RHO_AIR = 1.225; // masse volumique de l'air (kg/m³)
const RHO_WATER = 1025; // masse volumique de l'eau de mer (kg/m³)
const G = 9.81; // pesanteur (m/s²)
const DEG = Math.PI / 180; // degrés → radians

// Les caractéristiques d'un bateau. D'autres bateaux viendront plus tard : il suffira d'une autre fiche.
export interface BoatSpec {
  name: string; // nom affiché
  length: number; // longueur hors tout (m)
  beam: number; // largeur (m)
  waterline: number; // longueur à la flottaison (m) : fixe la vitesse de coque
  mass: number; // masse (kg)
  sailArea: number; // surface de voile (m²) : grand-voile + foc
  mainArea: number; // surface de la grand-voile pleine (m²)
  jibArea: number; // surface du foc déroulé (m²)
  mainCeX: number; // position avant/arrière du centre de voilure de la grand-voile pleine (m)
  jibCeX: number; // idem pour le foc
  mainCeHeight: number; // hauteur du centre de voilure de la grand-voile pleine (m)
  jibCeHeight: number; // idem pour le foc
  ceHeight: number; // hauteur du centre de voilure au-dessus du centre de dérive (m) : bras de levier de la gîte
  ceX: number; // position avant/arrière du centre de voilure (m, + vers l'avant)
  gm: number; // hauteur métacentrique (m) : la raideur du bateau à la gîte
  draft: number; // tirant d'eau (m)
  keelX: number; // position de la quille (m)
  keelArea: number; // surface de la quille (m²)
  keelSpan: number; // envergure de la quille (m)
  rudderX: number; // position du safran (m, négatif = arrière)
  rudderArea: number; // surface du safran (m²)
  rudderMax: number; // braquage maximal du safran (rad)
  yawInertia: number; // inertie en lacet, eau entraînée comprise (kg·m²)
  rollInertia: number; // inertie en roulis (kg·m²)
  eyeU: number; // position avant/arrière des yeux du barreur (m)
  eyeHeight: number; // hauteur des yeux au-dessus de la flottaison (m)
}

// Le premier bateau : un voilier de croisière de 9,5 m (type First 30 / Sun Odyssey 30).
export const CRUISER: BoatSpec = {
  name: 'Voilier de croisière 9,5 m',
  length: 9.5,
  beam: 3.2,
  waterline: 8.2,
  mass: 4800,
  sailArea: 48,
  mainArea: 27,
  jibArea: 21,
  mainCeX: -1.2, // la grand-voile est derrière le centre de dérive…
  jibCeX: 1.3, // …le foc devant : leur équilibre donne la barre (sans foc, le bateau « lofe »)
  mainCeHeight: 5.5,
  jibCeHeight: 4.3,
  ceHeight: 5,
  ceX: -0.1,
  gm: 0.6,
  draft: 1.6,
  keelX: 0.2,
  keelArea: 1.5,
  keelSpan: 1.5,
  rudderX: -4,
  rudderArea: 0.35,
  rudderMax: 0.52,
  yawInertia: 4e4,
  rollInertia: 1.2e4,
  eyeU: -3.75,
  eyeHeight: 2.2,
};

// L'état du bateau à un instant.
export interface Vec2 {
  x: number;
  z: number;
}
export const NO_CURRENT: Vec2 = { x: 0, z: 0 }; // pas de courant

export interface BoatState {
  x: number; // position dans le monde, est-ouest (m)
  z: number; // position nord-sud (m)
  yaw: number; // cap, comme le regard du joueur (0 = nord, π/2 = ouest)
  u: number; // vitesse vers l'avant (m/s)
  v: number; // vitesse vers tribord = dérive (m/s)
  omega: number; // vitesse de rotation, positive à tribord (rad/s)
  heel: number; // gîte (rad), positive = penché à tribord
  heelRate: number; // vitesse de gîte (rad/s)
  rudder: number; // braquage de la barre (rad), positif = le bateau tourne à tribord
  sheet: number; // écoute : 0 = bordée à bloc, 1 = complètement choquée
  boom: number; // angle visible de la bôme (rad), positif = vers tribord
  pilotInt: number; // mémoire du pilote automatique (terme intégral)
  mainTarget: 0 | 1; // grand-voile demandée : 1 = hissée, 0 = affalée
  mainUp: number; // hauteur hissée de la grand-voile, 0 (affalée sur la bôme) à 1 (en tête de mât)
  reef: number; // ris pris (0 à 3), cible
  reefLevel: number; // ris pris, en cours de manœuvre (continu)
  jibTarget: 0 | 1; // foc demandé : 1 = déroulé, 0 = roulé
  jibOut: number; // part du foc déroulée (0 = roulé sur l'étai, 1 = plein)
  luff: number; // 0 à 1 : la voile faseye (bat) d'autant plus que c'est proche de 1
  aground: boolean; // le bateau touche le fond ?
  side: 1 | -1; // côté d'où vient le vent apparent (1 = tribord)
  event: 'tack' | 'gybe' | null; // dernier événement (virement ou empannage), à vider par le jeu
}

// Les commandes du joueur : la barre et l'écoute, de -1 à 1.
export interface BoatInput {
  helm: number; // -1 = barre à gauche (le bateau tourne à bâbord), +1 = à droite
  trim: number; // +1 = choquer (relâcher), -1 = border (tirer)
  center: boolean; // remettre la barre au milieu
  toggleMain?: boolean; // appui : hisser ou affaler la grand-voile
  toggleJib?: boolean; // appui : dérouler ou rouler le foc
  reef?: -1 | 0 | 1; // appui : +1 prendre un ris, −1 larguer un ris
}

export const MAX_REEFS = 3; // nombre de ris de la grand-voile
export const REEF_HEIGHTS = [1, 0.76, 0.56, 0.4] as const; // hauteur utile de la grand-voile selon le nombre de ris
const HOIST_RATE = 1 / 18; // hisser : environ 18 s au winch
const LOWER_RATE = 1 / 7; // affaler : environ 7 s
const REEF_RATE = 1 / 4; // un ris : environ 4 s
const JIB_RATE = 1 / 7; // dérouler ou rouler le foc : environ 7 s

export const SHEET_MIN_ANGLE = 4 * DEG; // angle de la bôme avec l'écoute bordée à bloc
export const SHEET_MAX_ANGLE = 86 * DEG; // angle de la bôme avec l'écoute toute choquée

// Angle (rad) auquel l'écoute (0..1) autorise la bôme à s'ouvrir.
export const sheetAngle = (sheet: number): number => lerp(SHEET_MIN_ANGLE, SHEET_MAX_ANGLE, clamp(sheet, 0, 1));

// Ramène un angle entre -π et π.
export const wrapPi = (a: number): number => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// Crée un bateau à l'arrêt, voile à moitié choquée.
export function createBoat(x: number, z: number, yaw: number): BoatState {
  return { x, z, yaw, u: 0, v: 0, omega: 0, heel: 0, heelRate: 0, rudder: 0, sheet: 0.55, boom: 0, pilotInt: 0, mainTarget: 1, mainUp: 1, reef: 0, reefLevel: 0, jibTarget: 1, jibOut: 1, luff: 0, aground: false, side: 1, event: null };
}

// Hauteur utile de la grand-voile (0 à 1) : hissée ET réduite par les ris. Interpolée entre deux ris pendant la manœuvre.
export function mainHeight(s: BoatState): number {
  const i = clamp(Math.floor(s.reefLevel), 0, MAX_REEFS - 1);
  const t = clamp(s.reefLevel - i, 0, 1);
  return s.mainUp * lerp(REEF_HEIGHTS[i]!, REEF_HEIGHTS[i + 1]!, t);
}

// Le plan de voilure du moment : surface, position avant/arrière et hauteur du centre de voilure.
export function sailPlan(s: BoatState, spec: BoatSpec): { area: number; ceX: number; ceHeight: number; main: number; jib: number } {
  const h = mainHeight(s);
  const am = spec.mainArea * h; // la surface de la grand-voile suit sa hauteur
  const aj = spec.jibArea * s.jibOut;
  const area = am + aj;
  if (area < 0.5) return { area, ceX: 0, ceHeight: 2, main: am, jib: aj }; // plus de voile : aucune poussée
  const cmH = 1.2 + (spec.mainCeHeight - 1.2) * h; // le centre de la grand-voile descend quand on la réduit
  return {
    area,
    ceX: (am * spec.mainCeX + aj * spec.jibCeX) / area,
    ceHeight: (am * cmH + aj * spec.jibCeHeight) / area,
    main: am,
    jib: aj,
  };
}

// Vecteurs unitaires du bateau dans le monde (x vers l'est, z vers le sud).
export const forwardOf = (yaw: number): { x: number; z: number } => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
export const starboardOf = (yaw: number): { x: number; z: number } => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });

// Le vent tel que le ressent le bateau en mouvement.
export interface ApparentWind {
  speed: number; // vitesse du vent apparent (m/s)
  angle: number; // angle depuis l'avant (rad) : + = vient de tribord, 0 = de face, ±π = de l'arrière
  f: number; // composante de l'air relatif, vers l'avant
  r: number; // composante de l'air relatif, vers tribord
}

export function apparentWind(s: BoatState, wind: Wind): ApparentWind {
  const w = windVelocity(wind); // vent vrai : où il souffle
  const f = forwardOf(s.yaw);
  const r = starboardOf(s.yaw);
  const bx = s.u * f.x + s.v * r.x; // vitesse du bateau dans le monde
  const bz = s.u * f.z + s.v * r.z;
  const ax = w.x - bx; // air relatif au bateau : vent − bateau
  const az = w.z - bz;
  const af = ax * f.x + az * f.z; // composante avant
  const ar = ax * r.x + az * r.z; // composante tribord
  return { speed: Math.hypot(af, ar), angle: Math.atan2(-ar, -af), f: af, r: ar };
}

// Portance et traînée de la voile selon l'angle d'attaque (rad) : monte jusqu'au décrochage (~18°) puis chute.
export function sailCoefficients(alpha: number): { cl: number; cd: number } {
  const a = Math.abs(alpha); // l'angle d'attaque est toujours positif ici
  const stall = 18 * DEG; // angle de décrochage
  const pre = Math.min(a, stall); // partie avant décrochage
  const clPre = 4.2 * pre; // pente de portance (aile de faible allongement)
  const cdPre = 0.09 + (clPre * clPre) / (Math.PI * 3); // traînée de profil (voile, mât, gréement) + traînée induite
  if (a <= stall) return { cl: clPre, cd: cdPre };
  const aa = a > Math.PI / 2 ? Math.PI - a : a; // au-delà de 90° la voile prend le vent à l'envers : on replie
  const clFlat = 0.75 * Math.sin(2 * aa); // plaque plane : portance
  const cdFlat = 0.09 + 1.5 * Math.sin(aa) ** 2; // plaque plane : traînée
  const t = smoothstep(stall, stall + 10 * DEG, a); // transition douce vers le décrochage complet
  const back = a > Math.PI / 2 ? 0.35 : 1; // voile à l'envers : peu de force
  return { cl: lerp(clPre, clFlat, t) * back, cd: lerp(cdPre, cdFlat, t) };
}

// Résistance de la coque (N) à la vitesse u : frottement + vagues (qui explosent près de la vitesse de coque).
export function hullResistance(spec: BoatSpec, speed: number): number {
  const sp = Math.abs(speed);
  const friction = 40 * sp * sp; // frottement de la carène et des appendices
  const froude = sp / Math.sqrt(G * spec.waterline); // nombre de Froude : vitesse comparée à la longueur
  const waves = 1900 * Math.pow(froude / 0.4, 4); // résistance de vagues
  return friction + waves;
}

// Bras de redressement (m) : rappelle le bateau vers la verticale ; s'annule vers 126° (chavirage non simulé).
export function rightingArm(spec: BoatSpec, heel: number): number {
  const h = clamp(heel, -2.2, 2.2);
  return spec.gm * Math.sin(h) * (1 - (h / 2.2) ** 2);
}

const SUB_STEP = 1 / 60; // pas de calcul fixe (s) : stable et indépendant du nombre d'images par seconde
const RUDDER_RATE = 0.9; // vitesse de braquage de la barre (rad/s)
const RUDDER_RETURN = 0.45; // retour de la barre au milieu quand on lâche (rad/s)
const SHEET_RATE = 0.3; // vitesse de l'écoute (fraction par seconde)
const BOOM_RATE = 2.2; // vitesse maximale de balayage visible de la bôme (rad/s)

// Fait avancer le bateau de dt secondes. depthAt(x, z) donne la profondeur d'eau (m, négative à terre).
export function stepBoat(s: BoatState, spec: BoatSpec, wind: Wind, input: BoatInput, dt: number, depthAt: (x: number, z: number) => number, current: Vec2 = NO_CURRENT): void {
  // Les appuis (une seule fois par image) : hisser/affaler, dérouler/rouler, ris.
  if (input.toggleMain) s.mainTarget = s.mainTarget === 1 ? 0 : 1;
  if (input.toggleJib) s.jibTarget = s.jibTarget === 1 ? 0 : 1;
  if (input.reef) s.reef = clamp(s.reef + input.reef, 0, MAX_REEFS);
  let left = Math.min(dt, 0.25); // on borne : pas de bond après une longue pause
  while (left > 1e-6) {
    const h = Math.min(SUB_STEP, left);
    stepOnce(s, spec, wind, input, h, depthAt, current);
    left -= h;
  }
}

function stepOnce(s: BoatState, spec: BoatSpec, wind: Wind, input: BoatInput, dt: number, depthAt: (x: number, z: number) => number, current: Vec2): void {
  // --- Commandes ---
  const rudMax = spec.rudderMax;
  if (input.center) s.rudder = moveToward(s.rudder, 0, RUDDER_RATE * 2 * dt);
  else if (input.helm !== 0) s.rudder = moveToward(s.rudder, input.helm * rudMax, RUDDER_RATE * dt);
  else s.rudder = moveToward(s.rudder, 0, RUDDER_RETURN * dt);
  s.sheet = clamp(s.sheet + input.trim * SHEET_RATE * dt, 0, 1);

  // --- Manœuvres de voiles (lentes : on ne hisse pas une voile en une seconde) ---
  s.mainUp = moveToward(s.mainUp, s.mainTarget, (s.mainTarget === 1 ? HOIST_RATE : LOWER_RATE) * dt);
  s.reefLevel = moveToward(s.reefLevel, s.reef, REEF_RATE * dt);
  s.jibOut = moveToward(s.jibOut, s.jibTarget, JIB_RATE * dt);
  const plan = sailPlan(s, spec);

  // --- Vent apparent et voile ---
  const aw = apparentWind(s, wind);
  const side: 1 | -1 = aw.angle >= 0 ? 1 : -1; // côté d'où vient le vent
  if (side !== s.side && aw.speed > 1 && Math.abs(s.u) > 0.8) s.event = Math.abs(aw.angle) < Math.PI / 2 ? 'tack' : 'gybe'; // la bôme change de bord
  s.side = side;
  const awaAbs = Math.abs(aw.angle);
  const sigma = sheetAngle(s.sheet); // ouverture permise par l'écoute
  const boomAngle = Math.min(sigma, awaAbs); // la voile se met dans le vent si l'écoute le permet
  const alpha = awaAbs - boomAngle; // angle d'attaque
  const luffing = sigma > awaAbs + 3 * DEG; // la voile faseye : l'écoute est trop choquée pour ce vent
  s.luff = lerp(s.luff, luffing ? 1 : 0, Math.min(1, dt * 6));
  const { cl, cd } = sailCoefficients(alpha);
  const q = 0.5 * RHO_AIR * aw.speed * aw.speed; // pression dynamique du vent apparent
  const heelFactor = Math.cos(s.heel); // la gîte réduit la surface utile
  let sailF = 0; // force de la voile vers l'avant (N)
  let sailR = 0; // force de la voile vers tribord (N)
  if (aw.speed > 0.05) {
    const df = aw.f / aw.speed; // sens de l'écoulement (unitaire), avant
    const dr = (aw.r / aw.speed) * side; // idem tribord, dans le repère « miroir » où le vent vient de tribord
    const liftF = -dr; // la portance est perpendiculaire à l'écoulement…
    const liftR = df; // …du côté de la voile
    const fPrime = q * plan.area * heelFactor * (cl * liftF + cd * df);
    const rPrime = q * plan.area * heelFactor * (cl * liftR + cd * dr);
    sailF = fPrime;
    sailR = rPrime * side; // on revient au vrai repère
  }

  // --- Coque, quille, safran ---
  const speedAbs = Math.abs(s.u);
  const heelResist = 1 + 1.5 * s.heel * s.heel; // la gîte augmente la résistance
  const resistance = hullResistance(spec, s.u) * heelResist * Math.sign(s.u); // opposée au mouvement
  const vKeel = s.v + s.omega * spec.keelX; // dérive au niveau de la quille
  const alphaKeel = clamp(vKeel / Math.max(speedAbs, 0.3), -0.3, 0.3); // angle d'attaque de la quille (limité : décrochage)
  const keelLift = -0.5 * RHO_WATER * spec.keelArea * 3 * speedAbs * speedAbs * alphaKeel * heelFactor; // force latérale de la quille
  const hullSway = -4000 * vKeel * Math.abs(vKeel) - 600 * vKeel; // résistance de la coque à la dérive
  const keelY = keelLift + hullSway; // force latérale totale de la carène
  const qWater = 0.5 * RHO_WATER * Math.max(s.u * s.u, 0.5);
  const induced = (keelLift * keelLift) / (Math.PI * qWater * spec.keelSpan * spec.keelSpan * 0.8); // traînée induite par la dérive
  const vRudder = s.v + s.omega * spec.rudderX; // vitesse latérale du safran
  const flowSign = s.u >= 0 ? 1 : -1; // en marche arrière, l'effet de la barre s'inverse
  const alphaRudder = clamp(s.rudder * flowSign + Math.atan2(vRudder, Math.max(speedAbs, 0.5)), -0.45, 0.45); // angle d'attaque du safran
  const kRudder = 0.5 * RHO_WATER * spec.rudderArea * 3 * s.u * s.u; // raideur du safran : proportionnelle à la vitesse²
  const rudderY = -kRudder * alphaRudder; // force latérale du safran (tribord positif)

  // --- Équations du mouvement (repère du bateau) ---
  const m = spec.mass * 1.08; // masse + eau entraînée à l'avant
  const my = spec.mass * 1.6; // masse + eau entraînée sur le côté (plus grande)
  const forceF = sailF - resistance - induced * Math.sign(s.u || 1);
  const forceR = sailR + keelY + rudderY;
  const yCe = plan.ceHeight * Math.sin(s.heel); // décalage latéral de la voile quand le bateau gîte
  const yawMoment =
    plan.ceX * sailR + // voile devant ou derrière le centre de dérive
    spec.keelX * keelY + // quille
    spec.rudderX * rudderY + // safran
    -yCe * sailF - // gîte : la poussée est décalée sous le vent, donc le bateau « lofe » (barre au vent)
    (2500 * speedAbs + 1500) * s.omega - // amortissement de la coque
    8000 * Math.abs(s.omega) * s.omega;
  s.u += (forceF / m + s.v * s.omega) * dt;
  s.v += (forceR / my - s.u * s.omega) * dt;
  s.omega += (yawMoment / spec.yawInertia) * dt;

  // --- Gîte ---
  const heelMoment = sailR * plan.ceHeight; // la voile pousse en haut : couple de gîte
  const rightMoment = -spec.mass * G * rightingArm(spec, s.heel); // le poids de la quille redresse
  const heelDamping = -16000 * s.heelRate; // la carène freine le roulis
  s.heelRate += ((heelMoment + rightMoment + heelDamping) / spec.rollInertia) * dt;
  s.heel = clamp(s.heel + s.heelRate * dt, -1.4, 1.4);

  // --- Déplacement dans le monde, avec contrôle du fond ---
  s.yaw += -s.omega * dt; // tourner à tribord = le cap (yaw) diminue
  const f = forwardOf(s.yaw);
  const r = starboardOf(s.yaw);
  const nx = s.x + (s.u * f.x + s.v * r.x + current.x) * dt; // vitesse dans l'eau + courant
  const nz = s.z + (s.u * f.z + s.v * r.z + current.z) * dt;
  const now = minDepth(spec, depthAt, nx, nz, f);
  const before = minDepth(spec, depthAt, s.x, s.z, f);
  if (now < spec.draft && now < before) {
    s.aground = true; // on touche : on ne peut pas aller vers moins profond
    s.u *= 0.2;
    s.v *= 0.2;
    s.omega *= 0.5;
  } else {
    s.aground = now < spec.draft + 0.3; // à la limite de la touche
    s.x = nx;
    s.z = nz;
  }

  // --- Bôme visible : suit l'angle voulu, avec une vitesse limitée (un empannage prend un moment) ---
  const boomTarget = -side * boomAngle; // la bôme est sous le vent
  s.boom = moveToward(s.boom, boomTarget, BOOM_RATE * dt);
}

// Profondeur minimale sous la coque (étrave, milieu, étambot) : c'est elle qui compte pour toucher.
export function minDepth(spec: BoatSpec, depthAt: (x: number, z: number) => number, x: number, z: number, f: { x: number; z: number }): number {
  const half = spec.length / 2 - 0.5; // l'étrave et l'étambot, un peu en retrait des extrémités
  return Math.min(depthAt(x + f.x * half, z + f.z * half), depthAt(x, z), depthAt(x - f.x * half, z - f.z * half));
}

function moveToward(value: number, target: number, maxDelta: number): number {
  return Math.abs(target - value) <= maxDelta ? target : value + Math.sign(target - value) * maxDelta;
}

// Allure : le nom de l'angle du vent vrai (valeur absolue, en radians) par rapport au bateau.
export function pointOfSail(twaAbs: number): string {
  const d = twaAbs / DEG;
  if (d < 35) return 'face au vent';
  if (d < 60) return 'au près';
  if (d < 80) return 'près large';
  if (d < 110) return 'au travers';
  if (d < 150) return 'au largue';
  if (d < 170) return 'au grand largue';
  return 'vent arrière';
}

// Cap de départ à la mise à l'eau : le bateau ne démarre jamais « dans le vent » (il resterait planté).
// On garde le cap voulu s'il est à plus de 60° du vent, sinon on s'écarte à 75° du côté le plus proche.
export function startHeading(yaw: number, wind: Wind): number {
  const bearing = -yaw; // cap en compas (sens horaire depuis le nord)
  const twa = wrapPi(wind.from - bearing); // angle du vent vrai : + = tribord
  if (Math.abs(twa) >= 60 * DEG) return yaw;
  const side = twa >= 0 ? 1 : -1;
  const newBearing = wind.from - side * 75 * DEG; // cap qui met le vent à 75° du bon côté
  return -newBearing;
}

// Pilote automatique : donne l'ordre de barre (−1 à 1) pour tenir le cap voulu (yaw). Régulateur PID :
// il corrige l'écart de cap, freine la rotation (zéro zigzag) et apprend la « barre au vent » permanente du bateau (terme intégral).
export function autopilotHelm(s: BoatState, targetYaw: number, dt: number): number {
  const err = wrapPi(targetYaw - s.yaw); // écart de cap : > 0 = il faut que le yaw augmente (tourner à bâbord)
  s.pilotInt = clamp(s.pilotInt + err * dt, -0.8, 0.8); // mémoire de l'écart (bornée)
  return clamp(-(3.2 * err + 1.8 * s.omega + 0.7 * s.pilotInt), -1, 1);
}

// Réglage automatique de l'écoute (livré avec le pilote) : renvoie l'ordre d'écoute (−1 border … +1 choquer)
// qui amène la voile à son angle d'attaque idéal. Un bon régulateur de bateau moderne fait de même.
export function autoTrim(s: BoatState, wind: Wind): number {
  const aw = apparentWind(s, wind);
  const wanted = Math.abs(aw.angle) - TRIM_IDEAL; // angle de bôme voulu
  const target = clamp((wanted - SHEET_MIN_ANGLE) / (SHEET_MAX_ANGLE - SHEET_MIN_ANGLE), 0, 1); // écoute correspondante
  return clamp((target - s.sheet) * 6, -1, 1);
}

// Ce que montrent les penons (petits rubans cousus sur la grand-voile).
export interface PenonFlow {
  trim: number; // −1 = voile trop choquée (le penon du côté du vent se soulève), 0 = bien réglée, +1 = trop bordée (le penon sous le vent flotte, l'écoulement décroche)
  flow: number; // 0 à 1 : force du vent apparent ressenti (sans vent, les penons pendent)
}

export const TRIM_IDEAL = 9 * DEG; // angle d'attaque où les deux penons filent droit
export const TRIM_SPREAD = 7 * DEG; // écart à l'idéal qui donne un défaut complet

// Calcule l'écoulement de l'air sur la voile d'après l'angle d'attaque (vent apparent − bôme).
export function penonFlow(s: BoatState, wind: Wind): PenonFlow {
  const aw = apparentWind(s, wind);
  const alpha = Math.max(0, Math.abs(aw.angle) - Math.abs(s.boom)); // angle d'attaque de la voile
  let trim = clamp((alpha - TRIM_IDEAL) / TRIM_SPREAD, -1, 1); // sous l'idéal : trop choquée ; au-dessus : trop bordée
  trim = lerp(trim, -1, clamp(s.luff, 0, 1)); // une voile qui faseye est franchement trop choquée
  return { trim, flow: clamp(aw.speed / 3, 0, 1) };
}

// Ce qu'affichent les instruments.
export interface Readout {
  bearing: number; // cap compas, en degrés (0 à 360)
  speed: number; // vitesse dans l'eau (m/s)
  sog: number; // vitesse sur le fond (m/s) : vitesse dans l'eau + courant
  cog: number; // route sur le fond, en degrés (0 = nord, sens horaire)
  current: number; // force du courant (m/s)
  tws: number; // vitesse du vent vrai (m/s)
  twd: number; // direction d'où vient le vent vrai, en degrés
  twa: number; // angle du vent vrai (rad), + = tribord
  aws: number; // vitesse du vent apparent (m/s)
  awa: number; // angle du vent apparent (rad)
  heelDeg: number; // gîte en degrés (+ tribord)
  sheet: number; // 0..1
  rudderDeg: number; // braquage de barre en degrés (+ tribord)
  leewayDeg: number; // dérive en degrés
  point: string; // allure
  mainPct: number; // grand-voile hissée, en % (0 à 100)
  reef: number; // ris pris
  jibPct: number; // foc déroulé, en %
  pilot?: boolean; // le pilote automatique tient le cap (ajouté par le jeu)
  hint: string; // conseil court (vide si tout va bien)
}

export function readout(s: BoatState, wind: Wind, current: Vec2 = NO_CURRENT): Readout {
  const aw = apparentWind(s, wind);
  const bearing = (((-s.yaw / DEG) % 360) + 360) % 360;
  const twa = wrapPi(wind.from + s.yaw);
  const speed = Math.hypot(s.u, s.v);
  const fw = forwardOf(s.yaw);
  const rt = starboardOf(s.yaw);
  const gx = s.u * fw.x + s.v * rt.x + current.x; // vitesse sur le fond, repère du monde
  const gz = s.u * fw.z + s.v * rt.z + current.z;
  const sog = Math.hypot(gx, gz);
  const cog = sog > 0.15 ? ((Math.atan2(gx, -gz) / DEG) % 360 + 360) % 360 : bearing; // route fond (0 = nord, sens horaire)
  const awaAbs = Math.abs(aw.angle);
  const sigma = sheetAngle(s.sheet);
  const alpha = awaAbs - Math.min(sigma, awaAbs);
  let hint = '';
  if (s.aground) hint = 'Échoué : barre dans l’autre sens pour retrouver de l’eau.';
  else if (Math.abs(twa) < 35 * DEG && speed < 1.2) hint = 'Face au vent : le bateau ne peut pas avancer. Barre pour faire tomber l’étrave de côté.';
  else if (s.luff > 0.6 && Math.abs(twa) > 35 * DEG) hint = 'La voile faseye : borde (S) jusqu’à ce qu’elle se tende.';
  else if (alpha > 24 * DEG && awaAbs < 100 * DEG) hint = 'Voile décrochée : choque (Z) un peu.';
  else if (Math.abs(s.heel) > 28 * DEG) hint = s.reef < MAX_REEFS ? 'Trop de gîte : choque (Z), abats, ou prends un ris (X).' : 'Trop de gîte : choque (Z) ou abats (barre sous le vent).';
  else if (aw.speed > 11 && s.reef === 0 && s.mainUp > 0.9 && s.jibOut > 0.9) hint = 'Le vent monte : pense à prendre un ris (X) ou à rouler un peu de foc (U).';
  else if (s.mainTarget === 0 && s.jibTarget === 0 && speed < 0.5) hint = 'Plus de voile : Y hisse la grand-voile, U déroule le foc.';
  return {
    bearing,
    speed,
    sog,
    cog,
    current: Math.hypot(current.x, current.z),
    tws: wind.speed,
    twd: ((wind.from / DEG) % 360 + 360) % 360,
    twa,
    aws: aw.speed,
    awa: aw.angle,
    heelDeg: s.heel / DEG,
    sheet: s.sheet,
    rudderDeg: s.rudder / DEG,
    leewayDeg: Math.abs(s.u) > 0.3 ? Math.abs(Math.atan2(s.v, Math.abs(s.u))) / DEG : 0, // dérive : toujours positive (le côté se voit au vent)
    point: pointOfSail(Math.abs(twa)),
    mainPct: Math.round(s.mainUp * 100),
    reef: s.reef,
    jibPct: Math.round(s.jibOut * 100),
    hint,
  };
}
