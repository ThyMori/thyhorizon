// Le moteur d'ambiance sonore : tout est SYNTHÉTISÉ par le navigateur (Web Audio), aucun fichier son à charger.
// Une seule source de bruit bouclée, filtrée de différentes façons : vent, pluie, houle, déferlement, eau le long de la coque.
// Ce fichier ne décide de rien : il suit les niveaux calculés par src/core/soundMix.ts.

import { SoundMix } from '../core/soundMix';

const NOISE_SECONDS = 6; // durée du bruit bouclé (assez long pour qu'on n'entende pas la boucle)
const SMOOTH = 1.4; // temps de lissage des changements de niveau (s) : jamais de coupure brutale

export class Ambient {
  private readonly master: GainNode;
  private readonly noise: AudioBuffer;
  private readonly param: Record<string, AudioParam> = {}; // les réglages qu'on fait évoluer
  private nextPlip = 0; // instant de la prochaine goutte isolée
  private plipRate = 0; // gouttes isolées par seconde
  private immediate = false; // changements immédiats (essais hors ligne)

  constructor(private readonly ctx: BaseAudioContext, destination: AudioNode = ctx.destination, private readonly rnd: () => number = Math.random) {
    this.noise = this.makeNoise();
    // Un compresseur très doux protège les oreilles si plusieurs couches montent ensemble.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(destination);
    this.buildWind();
    this.buildRain();
    this.buildSea();
    this.buildHull();
  }

  // Bruit rose (plus doux que le bruit blanc) : somme filtrée de bruit blanc (approximation de Paul Kellet).
  private makeNoise(): AudioBuffer {
    const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * NOISE_SECONDS), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < d.length; i++) {
      const white = this.rnd() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
    return buf;
  }

  // Une lecture du bruit, démarrée à un endroit différent à chaque fois (les couches ne sont pas corrélées).
  private source(): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(0, this.rnd() * NOISE_SECONDS);
    return s;
  }

  // Un oscillateur lent (LFO) qui module un paramètre : `depth` en unités du paramètre, `rate` en Hz.
  private lfo(target: AudioParam, rate: number, depth: number, name?: string): GainNode {
    const o = this.ctx.createOscillator();
    o.frequency.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start(0);
    if (name) this.param[name] = g.gain; // la profondeur peut ensuite évoluer
    return g;
  }

  private layer(name: string, filter: BiquadFilterNode): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = 0;
    this.source().connect(filter).connect(g).connect(this.master);
    this.param[name] = g.gain;
    return g;
  }

  // Vent : bruit passe-bande dont la fréquence et le niveau ondulent lentement (rafales) ; plus un sifflement aigu dans le gréement.
  private buildWind(): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.6;
    f.frequency.value = 400;
    this.param.windFreq = f.frequency;
    this.layer('wind', f);
    this.lfo(f.frequency, 0.11, 90); // le timbre monte et descend avec les rafales
    this.lfo(f.frequency, 0.27, 40);
    const whistle = this.ctx.createBiquadFilter();
    whistle.type = 'bandpass';
    whistle.Q.value = 9;
    whistle.frequency.value = 1700;
    this.layer('rig', whistle);
    this.lfo(whistle.frequency, 0.17, 220); // le sifflement glisse
  }

  // Pluie : chuintement aigu continu + corps grave ; les gouttes isolées sont planifiées dans update().
  private buildRain(): void {
    const hiss = this.ctx.createBiquadFilter();
    hiss.type = 'highpass';
    hiss.frequency.value = 2200;
    this.layer('rainHiss', hiss);
    const body = this.ctx.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = 750;
    body.Q.value = 0.5;
    this.layer('rainBody', body);
  }

  // Houle (clapotis, vagues au large) et déferlement au rivage : bruit grave dont le niveau respire au rythme des vagues.
  private buildSea(): void {
    const sw = this.ctx.createBiquadFilter();
    sw.type = 'lowpass';
    sw.frequency.value = 520;
    sw.Q.value = 0.7;
    const swG = this.layer('swell', sw);
    this.lfo(swG.gain, 0.118, 0, 'swellLfo'); // période ≈ 8,5 s ; la profondeur est fixée par le mixage
    this.lfo(swG.gain, 0.157, 0, 'swellLfo2'); // une seconde houle, plus rapide (6,4 s) : le motif ne se répète jamais
    const su = this.ctx.createBiquadFilter();
    su.type = 'bandpass';
    su.frequency.value = 1400;
    su.Q.value = 0.45;
    const suG = this.layer('surf', su);
    this.lfo(suG.gain, 0.13, 0, 'surfLfo'); // la vague monte, déferle, se retire (≈ 7,7 s)
    this.lfo(suG.gain, 0.083, 0, 'surfLfo2');
  }

  // Eau qui file le long de la coque.
  private buildHull(): void {
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 800;
    f.Q.value = 0.9;
    this.param.hullFreq = f.frequency;
    this.layer('hull', f);
  }

  private set(name: string, value: number): void {
    const p = this.param[name];
    if (!p) return;
    if (this.immediate) p.setValueAtTime(value, this.ctx.currentTime);
    else p.setTargetAtTime(value, this.ctx.currentTime, SMOOTH);
  }

  // Applique un mixage (appelé quelques fois par seconde). immediate = sans lissage (essais).
  apply(mix: SoundMix, immediate = false): void {
    this.immediate = immediate;
    this.set('master', mix.master);
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    if (immediate) this.master.gain.setValueAtTime(mix.master, this.ctx.currentTime);
    else this.master.gain.setTargetAtTime(mix.master, this.ctx.currentTime, 0.6);
    this.set('wind', mix.wind.gain);
    this.set('windFreq', mix.wind.freq);
    this.set('rig', mix.rig);
    this.set('rainHiss', mix.rain.hiss);
    this.set('rainBody', mix.rain.body);
    // La houle « respire » : le niveau de base est abaissé et la profondeur des deux LFO le fait osciller entre creux et crête.
    const sw = mix.swell;
    this.set('swell', sw.gain * (1 - sw.depth * 0.5));
    this.set('swellLfo', sw.gain * sw.depth * 0.5);
    this.set('swellLfo2', sw.gain * sw.depth * 0.25);
    const su = mix.surf;
    this.set('surf', su.gain * (1 - su.depth * 0.5));
    this.set('surfLfo', su.gain * su.depth * 0.5);
    this.set('surfLfo2', su.gain * su.depth * 0.3);
    this.set('hull', mix.hull.gain);
    this.set('hullFreq', mix.hull.freq);
    this.plipRate = mix.rain.plips;
  }

  // Gouttes isolées de la pluie (petits « plic » clairs) : à appeler à chaque image avec le temps écoulé.
  tick(dt: number): void {
    if (this.plipRate <= 0 || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (this.nextPlip < now) this.nextPlip = now;
    while (this.nextPlip < now + Math.max(dt, 0.05) + 0.05) { // on planifie un peu à l'avance
      this.plip(this.nextPlip, 0.02 + this.rnd() * 0.04);
      this.nextPlip += -Math.log(1 - this.rnd()) / this.plipRate; // intervalles aléatoires (loi de Poisson)
    }
  }

  // Une goutte : un petit son sinusoïdal qui chute vite en hauteur et en niveau.
  private plip(at: number, level: number): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f0 = 1400 + this.rnd() * 2600;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, at + 0.05);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    o.connect(g).connect(this.master);
    o.start(at);
    o.stop(at + 0.08);
  }
}
