// La musique d'ambiance : des nappes douces et lentes, générées au fil du temps. Aucune mélodie à retenir : quelques accords tenus,
// parfois une note claire qui tinte, puis de longs silences. Logique pure : humeur selon l'heure et la météo, choix des accords.
// Le moteur audio (src/audio/music.ts) ne fait que jouer ce qu'on lui demande ici.

import { clamp, smoothstep } from './math';

// Gammes (demi-tons depuis la tonique).
export const SCALES = {
  lydian: [0, 2, 4, 6, 7, 9, 11], // lumineuse, rêveuse : l'aube
  major: [0, 2, 4, 5, 7, 9, 11], // franche et douce : le jour clair
  mixolydian: [0, 2, 4, 5, 7, 9, 10], // chaude, un peu mélancolique : le soir
  dorian: [0, 2, 3, 5, 7, 9, 10], // sobre, grise : ciel couvert, brume, pluie
  aeolian: [0, 2, 3, 5, 7, 8, 10], // sombre et calme : la nuit
} as const;
export type ScaleName = keyof typeof SCALES;

// Ce que le monde dit à la musique.
export interface MusicInput {
  sunElevation: number; // hauteur du soleil (°)
  hours: number; // heure solaire (0 à 24)
  day: number; // jour de l'année
  cloud: number; // couverture nuageuse (0 à 1)
  rain: number; // pluie (0 à 1)
  fog: number; // brouillard (0 à 1)
  wind: number; // vent ressenti (m/s)
  onWater: boolean; // à bord d'un bateau ?
  volume: number; // volume de la musique choisi dans les réglages (0 à 1)
  active: boolean; // joue-t-on (souris capturée) ? Sinon la musique se tait
}

// L'humeur : niveau, tonalité, gamme, clarté du timbre.
export interface MusicMood {
  gain: number; // niveau de la musique (0 = silence), déjà multiplié par le volume choisi
  root: number; // tonique (numéro de note MIDI, grave : 36 à 47)
  scale: ScaleName; // gamme
  brightness: number; // 0 (sourd) à 1 (clair) : ouverture du filtre
}

const ROOTS = [38, 43, 45, 36, 41, 40, 47]; // ré, sol, la, do, fa, mi, si : des tonalités ouvertes et calmes

// Tonalité du moment : change environ toutes les trois heures de jeu, jamais au milieu d'une nappe (le moteur ne la relit qu'à chaque accord).
export function rootFor(day: number, hours: number): number {
  const block = Math.floor(day * 8 + hours / 3);
  return ROOTS[((Math.imul(block, 2654435761) >>> 0) >>> 7) % ROOTS.length]!;
}

export function musicMood(i: MusicInput): MusicMood {
  const vol = clamp(i.volume, 0, 1);
  const e = i.sunElevation;
  const stormy = i.wind > 16 || i.rain > 0.8; // pendant la tempête, le bruit du monde suffit : pas de musique
  const night = 1 - smoothstep(-8, -2, e);
  const dawn = e > -8 && e < 14 && i.hours < 12;
  const dusk = e > -8 && e < 14 && i.hours >= 12;
  const grey = i.cloud > 0.55 || i.rain > 0.15 || i.fog > 0.3;
  let scale: ScaleName = 'major';
  if (night > 0.6) scale = 'aeolian';
  else if (grey) scale = 'dorian';
  else if (dawn) scale = 'lydian';
  else if (dusk) scale = 'mixolydian';
  const calm = 1 - smoothstep(9, 15, i.wind); // moins de musique quand le vent monte
  const level = (0.5 + 0.2 * night + (i.onWater ? 0.1 : 0)) * (1 - 0.5 * i.rain) * calm;
  const brightness = clamp(0.25 + 0.5 * smoothstep(-6, 20, e) + 0.25 * (1 - i.cloud) - 0.25 * i.fog, 0, 1);
  return {
    gain: !i.active || stormy ? 0 : level * vol * vol,
    root: rootFor(i.day, i.hours),
    scale,
    brightness,
  };
}

// ---------- Les accords ----------

// Note MIDI du degré `deg` (0 = tonique, peut dépasser 6 : on monte d'octave) d'une gamme sur une tonique.
export function degreeNote(root: number, scale: ScaleName, deg: number): number {
  const s = SCALES[scale];
  const oct = Math.floor(deg / s.length);
  return root + s[((deg % s.length) + s.length) % s.length]! + 12 * oct;
}

// Degrés vers lesquels on glisse depuis un accord (marche aléatoire douce : pas de cadence « qui conclut »).
const NEXT: Record<number, number[]> = { 0: [3, 5, 4, 1], 1: [4, 0, 3], 2: [5, 3, 0], 3: [0, 4, 5], 4: [0, 5, 3], 5: [3, 1, 0, 4], 6: [0, 4] };

export interface ChordEvent {
  notes: number[]; // notes MIDI de l'accord (3 ou 4 voix), de la plus grave à la plus aiguë
  bass: number; // basse (une octave sous la fondamentale)
  length: number; // durée de l'accord (s)
  bells: { at: number; note: number }[]; // notes claires isolées (instant en s depuis le début de l'accord)
}

// Construit un accord sur un degré : fondamentale, tierce, quinte (+ neuvième ou septième au hasard), serrés dans environ une octave et demie.
export function buildChord(mood: MusicMood, degree: number, rnd: () => number): ChordEvent {
  const { root, scale } = mood;
  const fund = degreeNote(root + 12, scale, degree); // fondamentale, vers le do 3 – ré 4
  const picks = [degree + 2, degree + 4, rnd() < 0.5 ? degree + 6 : degree + 8]; // tierce, quinte, septième ou neuvième
  const notes = [fund, ...picks.map((d) => degreeNote(root + 12, scale, d))];
  const voiced = notes.map((n, k) => (k === 0 ? n : n > fund + 17 ? n - 12 : n)).sort((a, b) => a - b); // voix serrées
  const length = 14 + rnd() * 12;
  const bells: { at: number; note: number }[] = [];
  const nBells = rnd() < 0.65 ? 1 + Math.floor(rnd() * 3) : 0;
  const pent = [0, 1, 2, 4, 5]; // degrés « sûrs » (sans la 4ᵉ et la 7ᵉ) pour que les notes claires sonnent bien avec tout accord
  for (let b = 0; b < nBells; b++) bells.push({ at: 3 + rnd() * (length - 6), note: degreeNote(root + 36, scale, pent[Math.floor(rnd() * pent.length)]! + 7 * Math.floor(rnd() * 2)) });
  bells.sort((a, b) => a.at - b.at);
  return { notes: voiced, bass: fund - 12, length, bells };
}

// ---------- Le déroulement : jouer un moment, se taire un moment ----------

export interface MusicState {
  phase: 'rest' | 'play'; // en train de jouer, ou au repos
  timer: number; // temps restant au repos (s)
  chordsLeft: number; // accords restant à jouer dans ce moment
  chordTimer: number; // temps avant le prochain accord (s)
  degree: number; // degré de l'accord en cours
}

export const newMusicState = (rnd: () => number): MusicState => ({ phase: 'rest', timer: 12 + rnd() * 18, chordsLeft: 0, chordTimer: 0, degree: 0 });

// Fait avancer le temps de `dt` secondes. Renvoie un accord à jouer maintenant, ou null.
export function stepMusic(s: MusicState, dt: number, mood: MusicMood, rnd: () => number): ChordEvent | null {
  if (mood.gain < 0.005) {
    if (s.phase === 'play') {
      s.phase = 'rest'; // le monde devient trop bruyant (ou on quitte le jeu) : on s'arrête, les dernières notes s'éteignent seules
      s.timer = 20 + rnd() * 20;
    }
    s.timer = Math.max(s.timer - dt, 8); // on reprend sans attendre trop longtemps
    return null;
  }
  if (s.phase === 'rest') {
    s.timer -= dt;
    if (s.timer > 0) return null;
    s.phase = 'play';
    s.chordsLeft = 4 + Math.floor(rnd() * 5); // un moment de quatre à huit accords (≈ 1 min 30 à 3 min)
    s.chordTimer = 0;
    s.degree = 0;
  }
  s.chordTimer -= dt;
  if (s.chordTimer > 0) return null;
  if (s.chordsLeft <= 0) {
    s.phase = 'rest';
    s.timer = 60 + rnd() * 100; // puis un long silence
    return null;
  }
  s.chordsLeft--;
  const options = NEXT[s.degree] ?? [0];
  s.degree = s.chordsLeft === 0 ? 0 : options[Math.floor(rnd() * options.length)]!; // le dernier accord revient au calme (tonique)
  const chord = buildChord(mood, s.degree, rnd);
  s.chordTimer = chord.length - 3; // le suivant commence un peu avant la fin (fondu enchaîné)
  return chord;
}
