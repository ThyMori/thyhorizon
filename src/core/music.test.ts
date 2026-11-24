// Tests de la musique d'ambiance : bonnes gammes selon le moment, accords dans la gamme, silences, bornes.
import { describe, expect, it } from 'vitest';
import { MusicInput, SCALES, buildChord, degreeNote, musicMood, newMusicState, rootFor, stepMusic } from './music';
import { mulberry32 } from './noise';

const BASE: MusicInput = { sunElevation: 40, hours: 13, day: 100, cloud: 0.1, rain: 0, fog: 0, wind: 3, onWater: false, volume: 0.5, active: true };

describe('humeur', () => {
  it('gamme selon le moment', () => {
    expect(musicMood(BASE).scale).toBe('major');
    expect(musicMood({ ...BASE, sunElevation: 4, hours: 7 }).scale).toBe('lydian'); // aube
    expect(musicMood({ ...BASE, sunElevation: 4, hours: 19 }).scale).toBe('mixolydian'); // soir
    expect(musicMood({ ...BASE, sunElevation: -30, hours: 1 }).scale).toBe('aeolian'); // nuit
    expect(musicMood({ ...BASE, cloud: 0.8 }).scale).toBe('dorian'); // gris
    expect(musicMood({ ...BASE, rain: 0.4 }).scale).toBe('dorian');
  });
  it('silence dans la tempête, dans les menus et à volume 0', () => {
    expect(musicMood({ ...BASE, wind: 20 }).gain).toBe(0);
    expect(musicMood({ ...BASE, rain: 0.9 }).gain).toBe(0);
    expect(musicMood({ ...BASE, active: false }).gain).toBe(0);
    expect(musicMood({ ...BASE, volume: 0 }).gain).toBe(0);
    expect(musicMood(BASE).gain).toBeGreaterThan(0);
  });
  it('le timbre est plus clair en plein jour dégagé que la nuit ou dans la brume', () => {
    expect(musicMood(BASE).brightness).toBeGreaterThan(musicMood({ ...BASE, sunElevation: -30 }).brightness);
    expect(musicMood(BASE).brightness).toBeGreaterThan(musicMood({ ...BASE, fog: 0.9, cloud: 0.9 }).brightness);
  });
  it('la tonalité est stable pendant plusieurs heures et reste dans la plage grave', () => {
    expect(rootFor(100, 12.1)).toBe(rootFor(100, 12.9));
    for (let d = 1; d < 365; d += 7) for (let h = 0; h < 24; h += 3) {
      const r = rootFor(d, h);
      expect(r).toBeGreaterThanOrEqual(36);
      expect(r).toBeLessThanOrEqual(47);
    }
  });
});

describe('accords', () => {
  const mood = { ...musicMood(BASE), root: 38 };
  it('toutes les notes appartiennent à la gamme', () => {
    const rnd = mulberry32(5);
    for (let deg = 0; deg < 7; deg++) {
      const c = buildChord(mood, deg, rnd);
      for (const n of [...c.notes, c.bass]) expect(SCALES[mood.scale]).toContain((((n - mood.root) % 12) + 12) % 12);
    }
  });
  it('3 ou 4 voix serrées, en ordre croissant, dans une plage douce', () => {
    const rnd = mulberry32(9);
    for (let k = 0; k < 40; k++) {
      const c = buildChord(mood, k % 7, rnd);
      expect(c.notes.length).toBe(4);
      expect([...c.notes].sort((a, b) => a - b)).toEqual(c.notes);
      expect(c.notes[3]! - c.notes[0]!).toBeLessThanOrEqual(19);
      expect(c.notes[0]!).toBeGreaterThanOrEqual(45);
      expect(c.notes[3]!).toBeLessThan(80);
      expect(c.length).toBeGreaterThanOrEqual(14);
      expect(c.length).toBeLessThan(26.1);
      for (const b of c.bells) {
        expect(b.at).toBeGreaterThanOrEqual(0);
        expect(b.at).toBeLessThan(c.length);
      }
    }
  });
  it('degreeNote monte d’une octave après le septième degré', () => expect(degreeNote(60, 'major', 7)).toBe(72));
});

describe('déroulement : jouer puis se taire', () => {
  it('alterne des moments de musique (quelques accords) et de longs silences', () => {
    const rnd = mulberry32(3);
    const s = newMusicState(rnd);
    const mood = musicMood(BASE);
    let chords = 0;
    let t = 0;
    const times: number[] = [];
    while (t < 3600) {
      if (stepMusic(s, 1, mood, rnd)) { chords++; times.push(t); }
      t++;
    }
    expect(chords).toBeGreaterThan(10);
    expect(chords).toBeLessThan(120); // pas en continu : beaucoup de silences
    const playingShare = (chords * 20) / 3600; // ≈ part du temps avec une nappe
    expect(playingShare).toBeGreaterThan(0.15);
    expect(playingShare).toBeLessThan(0.9);
    expect(times[0]!).toBeLessThan(40); // la première nappe arrive vite
  });
  it('se tait quand le monde devient trop bruyant, sans nouvel accord', () => {
    const rnd = mulberry32(8);
    const s = newMusicState(rnd);
    const calm = musicMood(BASE);
    const storm = musicMood({ ...BASE, wind: 22 });
    let t = 0;
    while (t < 200 && !stepMusic(s, 1, calm, rnd)) t++;
    let after = 0;
    for (let k = 0; k < 600; k++) if (stepMusic(s, 1, storm, rnd)) after++;
    expect(after).toBe(0);
  });
  it('le dernier accord d’un moment revient à la tonique', () => {
    const rnd = mulberry32(21);
    const s = newMusicState(rnd);
    const mood = musicMood(BASE);
    const degrees: number[] = [];
    for (let t = 0; t < 1200; t++) {
      const was = s.chordsLeft;
      const c = stepMusic(s, 1, mood, rnd);
      if (c && s.chordsLeft === 0 && was === 1) degrees.push(s.degree);
    }
    expect(degrees.length).toBeGreaterThan(0);
    for (const d of degrees) expect(d).toBe(0);
  });
});
