// Le moteur de la musique d'ambiance : des nappes douces synthétisées (Web Audio), aucun fichier son.
// Ce fichier ne décide de rien : src/core/music.ts choisit l'humeur et les accords, ici on les joue.

import { ChordEvent, MusicMood, MusicState, newMusicState, stepMusic } from '../core/music';

const midiToHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12); // note MIDI → fréquence (Hz)
const SMOOTH = 3; // lissage des changements de niveau et de timbre (s) : jamais de saut

export class MusicEngine {
  private readonly master: GainNode; // niveau général de la musique
  private readonly tone: BiquadFilterNode; // filtre qui adoucit ou éclaircit le timbre
  private readonly bus: GainNode; // entrée commune des voix
  private readonly space: GainNode; // départ vers l'écho (grand espace)
  private mood: MusicMood = { gain: 0, root: 38, scale: 'major', brightness: 0.5 };
  private readonly state: MusicState;
  private immediate = false; // changements immédiats (essais hors ligne)

  constructor(private readonly ctx: BaseAudioContext, destination: AudioNode = ctx.destination, private readonly rnd: () => number = Math.random) {
    this.state = newMusicState(rnd);
    this.master = ctx.createGain(); // niveau final
    this.master.gain.value = 0; // on démarre en silence
    this.tone = ctx.createBiquadFilter(); // filtre passe-bas
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 900;
    this.tone.Q.value = 0.3;
    this.bus = ctx.createGain(); // somme des voix
    this.bus.gain.value = 1;
    this.bus.connect(this.tone).connect(this.master).connect(destination);
    // Écho long et sombre : donne l'impression d'une grande salle ou d'un horizon ouvert.
    this.space = ctx.createGain();
    this.space.gain.value = 0.55;
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.61;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1500;
    const fb = ctx.createGain();
    fb.gain.value = 0.5;
    this.space.connect(delay).connect(damp).connect(fb).connect(delay); // boucle de retour
    damp.connect(this.master);
  }

  // Essais hors ligne : tout est appliqué tout de suite.
  setImmediate(v: boolean): void {
    this.immediate = v;
  }

  // Nouvelle humeur (quelques fois par seconde).
  apply(mood: MusicMood): void {
    this.mood = mood;
    const t = this.ctx.currentTime;
    const cutoff = 450 + 1900 * mood.brightness; // sourd (450 Hz) à clair (2350 Hz)
    if (this.immediate) {
      this.master.gain.value = mood.gain * 0.5;
      this.tone.frequency.value = cutoff;
      return;
    }
    this.master.gain.setTargetAtTime(mood.gain * 0.5, t, SMOOTH);
    this.tone.frequency.setTargetAtTime(cutoff, t, SMOOTH);
  }

  // À appeler à chaque image : fait avancer le déroulement et joue un nouvel accord quand il arrive.
  tick(dt: number): void {
    const chord = stepMusic(this.state, dt, this.mood, this.rnd);
    if (chord) this.play(chord, this.ctx.currentTime + 0.05);
  }

  // Joue un accord à l'instant `at` : voix lentes qui montent puis s'éteignent, basse, notes claires.
  play(chord: ChordEvent, at: number): void {
    const attack = 4 + this.rnd() * 2; // montée lente
    const release = 6 + this.rnd() * 3; // extinction lente
    chord.notes.forEach((n, k) => this.voice(midiToHz(n), at, chord.length, attack, release, 0.07 - k * 0.008, k % 2 === 0 ? -0.5 : 0.5));
    this.voice(midiToHz(chord.bass), at, chord.length, attack + 1, release, 0.1, 0); // basse très douce
    for (const b of chord.bells) this.bell(midiToHz(b.note), at + b.at, (this.rnd() - 0.5) * 1.2);
  }

  // Une voix : deux oscillateurs très légèrement désaccordés (effet « chœur »), enveloppe lente.
  private voice(freq: number, at: number, length: number, attack: number, release: number, level: number, pan: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + attack);
    g.gain.setValueAtTime(level, at + Math.max(attack, length - 1));
    g.gain.linearRampToValueAtTime(0, at + length + release);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(this.bus);
    for (const cents of [-6, 7]) {
      const o = this.ctx.createOscillator();
      o.type = freq < 90 ? 'sine' : 'triangle'; // les basses restent pures
      o.frequency.value = freq;
      o.detune.value = cents;
      o.connect(g);
      o.start(at);
      o.stop(at + length + release + 0.2);
    }
  }

  // Une note claire isolée : sinusoïde avec une harmonique douce, attaque tendre, longue résonance, envoyée dans l'écho.
  private bell(freq: number, at: number, pan: number): void {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.05, at + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 7);
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p);
    p.connect(this.bus);
    p.connect(this.space);
    for (const [mult, lvl] of [[1, 1], [2, 0.25]] as const) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * mult;
      const l = this.ctx.createGain();
      l.gain.value = lvl;
      o.connect(l).connect(g);
      o.start(at);
      o.stop(at + 7.2);
    }
  }
}
