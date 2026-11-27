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
  private readonly air: GainNode; // départ vers l'« air » : petit écho de forêt pour les cris d'animaux
  private readonly rates: Record<string, number> = { birds: 0, gulls: 0, frogs: 0, owl: 0, flap: 0, creak: 0 }; // rythmes des cris (par seconde)
  private readonly next: Record<string, number> = {}; // instant du prochain cri de chaque espèce
  private stepRate = 0; // pas par seconde (0 = on ne marche pas)
  private stepLevel = 0; // niveau des pas
  private stepWet = 0; // pont mouillé (0 à 1)
  private nextStep = 0; // instant du prochain pas
  private stepFoot = 0; // pied gauche (0) ou droit (1)
  private flapLevel = 0; // niveau des claquements de voile
  private creakLevel = 0; // niveau des craquements
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
    this.buildFreshWater();
    this.air = this.buildAir();
    this.buildLife();
  }

  // Un petit écho doux (0,23 s) filtré : donne de l'espace aux cris, comme dans une clairière. Renvoie l'entrée du départ.
  private buildAir(): GainNode {
    const input = this.ctx.createGain();
    input.gain.value = 0.5;
    const delay = this.ctx.createDelay(1);
    delay.delayTime.value = 0.23;
    const tone = this.ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.32;
    input.connect(delay).connect(tone).connect(fb).connect(delay); // boucle de retour
    tone.connect(this.master);
    return input;
  }

  // Bruits continus de la vie : grillons (3 voix), cigales, feuillage.
  private buildLife(): void {
    // Grillons : chaque voix = une note aiguë hachée très vite (stridulation), par groupes de quelques secondes.
    const bus = this.ctx.createGain();
    bus.gain.value = 0;
    bus.connect(this.master);
    this.param.crickets = bus.gain;
    [4200, 4650, 5150].forEach((f, k) => {
      const o = this.ctx.createOscillator();
      o.frequency.value = f;
      const pulse = this.ctx.createGain(); // hachage rapide
      const gate = this.ctx.createGain(); // groupes : on chante, on se tait
      pulse.gain.value = 0;
      gate.gain.value = 0;
      const level = this.ctx.createGain(); // une voix reste discrète : trois voix ensemble ne dépassent pas le niveau voulu
      level.gain.value = 0.3;
      o.connect(pulse).connect(gate).connect(level).connect(bus);
      o.start(0);
      this.mod(pulse.gain, 26 + k * 4, 0.5, 0.5, `cricketPulse${k}`); // 0 à 1 à ~30 Hz
      this.mod(gate.gain, 0.55 + k * 0.17, 0.5, 0.5); // 0 à 1 à ~0,6 Hz (chant par phrases)
    });
    // Cigales : bruit étroit vers 5 kHz haché à ~90 Hz, avec un gonflement lent.
    const cic = this.ctx.createBiquadFilter();
    cic.type = 'bandpass';
    cic.frequency.value = 5200;
    cic.Q.value = 5;
    const am = this.ctx.createGain(); // hachage à ~90 Hz : le bruit « grésille » comme une cigale
    am.gain.value = 0;
    this.mod(am.gain, 88, 0.45, 0.55);
    const cg = this.ctx.createGain();
    cg.gain.value = 0;
    this.source().connect(cic).connect(am).connect(cg).connect(this.master);
    this.param.cicada = cg.gain;
    // Feuillage : souffle moyen-aigu dans les arbres, plus grave pour les conifères.
    const fo = this.ctx.createBiquadFilter();
    fo.type = 'bandpass';
    fo.Q.value = 0.45;
    fo.frequency.value = 3000;
    this.param.foliageFreq = fo.frequency;
    this.layer('foliage', fo);
    this.lfo(fo.frequency, 0.21, 300);
  }

  // Un oscillateur lent qui fait osciller un paramètre : valeur = offset (constante) + oscillation d'amplitude `depth`.
  private mod(target: AudioParam, rate: number, depth: number, offset: number, name?: string): void {
    const o = this.ctx.createOscillator();
    o.frequency.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start(0);
    const c = this.ctx.createConstantSource();
    c.offset.value = offset;
    c.connect(target);
    c.start(0);
    if (name) this.param[name] = o.frequency;
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

  // Eau douce : gargouillis (bruit moyen-aigu dont le niveau bouillonne), grondement grave, clapotis lent.
  private buildFreshWater(): void {
    const bb = this.ctx.createBiquadFilter();
    bb.type = 'bandpass';
    bb.frequency.value = 1200;
    bb.Q.value = 1.2;
    this.param.babbleFreq = bb.frequency;
    const bbG = this.layer('babble', bb);
    this.lfo(bb.frequency, 3.1, 350); // la note du gargouillis tremble
    this.lfo(bb.frequency, 5.3, 250);
    this.lfo(bbG.gain, 7.3, 0, 'babbleLfo'); // le niveau bouillonne (la profondeur suit le niveau)
    this.lfo(bbG.gain, 11.1, 0, 'babbleLfo2');
    const ru = this.ctx.createBiquadFilter();
    ru.type = 'lowpass';
    ru.frequency.value = 340;
    ru.Q.value = 0.6;
    const ruG = this.layer('rush', ru);
    this.lfo(ruG.gain, 0.35, 0, 'rushLfo'); // le grondement respire doucement
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 700;
    lp.Q.value = 0.8;
    const lpG = this.layer('lap', lp);
    this.lfo(lpG.gain, 0.45, 0, 'lapLfo'); // petit clapotis lent
    this.lfo(lpG.gain, 0.71, 0, 'lapLfo2');
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
    const wt = mix.water;
    this.set('babble', wt.babble.gain * 0.7); // le niveau de base laisse la place à l'oscillation
    this.set('babbleFreq', wt.babble.freq);
    this.set('babbleLfo', wt.babble.gain * 0.3);
    this.set('babbleLfo2', wt.babble.gain * 0.2);
    this.set('rush', wt.rush * 0.85);
    this.set('rushLfo', wt.rush * 0.15);
    this.set('lap', wt.lap * 0.6);
    this.set('lapLfo', wt.lap * 0.3);
    this.set('lapLfo2', wt.lap * 0.2);
    this.set('hull', mix.hull.gain);
    this.set('hullFreq', mix.hull.freq);
    this.plipRate = mix.rain.plips;
    // Vie sauvage : niveaux continus, rythmes des cris.
    const l = mix.life;
    this.set('crickets', l.crickets.gain);
    for (let k = 0; k < 3; k++) this.set(`cricketPulse${k}`, (26 + k * 4) * l.crickets.pulse);
    this.set('cicada', l.cicadas);
    this.set('foliage', l.foliage.gain);
    this.set('foliageFreq', l.foliage.freq);
    this.rates.birds = l.birds;
    this.rates.gulls = l.gulls;
    this.rates.frogs = l.frogs;
    this.rates.owl = l.owl;
    // Bruits du bateau.
    const b = mix.boat;
    this.rates.flap = b.flap.rate;
    this.flapLevel = b.flap.level;
    this.rates.creak = b.creak.rate;
    this.creakLevel = b.creak.level;
    this.stepRate = b.step.rate;
    this.stepLevel = b.step.level;
    this.stepWet = b.step.wet;
  }

  // Gouttes isolées de la pluie (petits « plic » clairs) : à appeler à chaque image avec le temps écoulé.
  tick(dt: number): void {
    if (this.ctx.state !== 'running') return;
    this.run(this.ctx.currentTime, Math.max(dt, 0.05) + 0.1);
  }

  // Pour les essais hors ligne : planifie d'un coup tous les cris des `seconds` prochaines secondes.
  renderCalls(seconds: number): void {
    this.run(0, seconds);
  }

  // Planifie les cris (et gouttes) qui tombent entre `now` et `now + ahead`.
  private run(now: number, ahead: number): void {
    this.schedule('birds', now, ahead, (t) => this.birdCall(t));
    this.schedule('gulls', now, ahead, (t) => this.gullCall(t));
    this.schedule('frogs', now, ahead, (t) => this.frogCall(t));
    this.schedule('owl', now, ahead, (t) => this.owlCall(t));
    this.schedule('flap', now, ahead, (t) => this.flapCall(t));
    this.schedule('creak', now, ahead, (t) => this.creakCall(t));
    this.runSteps(now, ahead);
    if (this.plipRate <= 0) return;
    if (this.nextPlip < now) this.nextPlip = now;
    while (this.nextPlip < now + ahead) {
      this.plip(this.nextPlip, 0.02 + this.rnd() * 0.04);
      this.nextPlip += -Math.log(1 - this.rnd()) / this.plipRate; // intervalles aléatoires (loi de Poisson)
    }
  }

  // Pas réguliers (et non au hasard) : un pas tous les 1/stepRate secondes, pied gauche puis pied droit.
  private runSteps(now: number, ahead: number): void {
    if (this.stepRate <= 0.01) {
      this.nextStep = 0; // on s'est arrêté : le prochain pas partira dès la reprise
      return;
    }
    if (this.nextStep < now) this.nextStep = now + 0.02;
    while (this.nextStep < now + ahead) {
      this.stepCall(this.nextStep);
      this.nextStep += (1 / this.stepRate) * (0.96 + this.rnd() * 0.08); // légère irrégularité humaine
    }
  }

  // Planifie les cris d'une espèce : intervalles aléatoires (loi de Poisson) autour du rythme demandé.
  private schedule(name: string, now: number, ahead: number, call: (at: number) => void): void {
    const rate = this.rates[name] ?? 0;
    if (rate <= 0.001) {
      delete this.next[name]; // plus d'activité : le prochain cri sera tiré à zéro quand elle reprendra
      return;
    }
    const gap = (): number => -Math.log(1 - this.rnd()) / rate;
    if (this.next[name] === undefined) this.next[name] = now + gap(); // reprise : pas de cri instantané
    while (this.next[name]! < now + ahead) {
      call(Math.max(this.next[name]!, now));
      this.next[name]! += gap();
    }
  }

  // Une note : sinusoïde qui glisse de f0 à f1 en `dur` secondes, avec attaque courte et extinction douce (vibrato léger possible).
  private tone(at: number, f0: number, f1: number, dur: number, level: number, dest: AudioNode, vibrato = 0): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + dur);
    if (vibrato > 0) {
      const v = this.ctx.createOscillator();
      const vg = this.ctx.createGain();
      v.frequency.value = 28 + this.rnd() * 10;
      vg.gain.value = f0 * vibrato;
      v.connect(vg).connect(o.frequency);
      v.start(at);
      v.stop(at + dur + 0.05);
    }
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + Math.min(0.012, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  // Sortie d'un cri : placé au hasard à gauche ou à droite, avec un départ vers l'écho de l'air.
  private spot(): AudioNode {
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = this.rnd() * 1.6 - 0.8;
    pan.connect(this.master);
    pan.connect(this.air);
    return pan;
  }

  // Un chant d'oiseau : sifflement en deux ou trois notes, trille rapide, ou petit gazouillis.
  private birdCall(at: number): void {
    const out = this.spot();
    const kind = this.rnd();
    const level = 0.02 + this.rnd() * 0.035; // proche ou lointain
    if (kind < 0.4) { // « ti-ou, ti-ou »
      const f = 2100 + this.rnd() * 1700;
      const n = 2 + Math.floor(this.rnd() * 2);
      for (let k = 0; k < n; k++) {
        this.tone(at + k * 0.2, f, f * 1.28, 0.11, level, out);
        this.tone(at + k * 0.2 + 0.1, f * 1.28, f * 0.9, 0.09, level * 0.8, out);
      }
    } else if (kind < 0.7) { // trille
      const f = 3000 + this.rnd() * 1600;
      const n = 8 + Math.floor(this.rnd() * 7);
      for (let k = 0; k < n; k++) this.tone(at + k * 0.045, f * (1 + (k % 2) * 0.06), f * 0.95, 0.032, level * 0.8, out);
    } else { // gazouillis
      const n = 5 + Math.floor(this.rnd() * 5);
      let t = at;
      for (let k = 0; k < n; k++) {
        const f = 2000 + this.rnd() * 3200;
        const d = 0.05 + this.rnd() * 0.07;
        this.tone(t, f, f * (0.8 + this.rnd() * 0.5), d, level, out);
        t += d + 0.03 + this.rnd() * 0.07;
      }
    }
  }

  // Un goéland : 2 à 4 « kiou » rauques (dent de scie filtrée qui monte puis retombe).
  private gullCall(at: number): void {
    const out = this.spot();
    const n = 2 + Math.floor(this.rnd() * 3);
    const f = 900 + this.rnd() * 300;
    for (let k = 0; k < n; k++) {
      const t = at + k * 0.52;
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.8, t);
      o.frequency.linearRampToValueAtTime(f * 1.6, t + 0.1);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.45);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1700;
      bp.Q.value = 1.6;
      const g = this.ctx.createGain();
      const lv = 0.05 * (1 - k * 0.12);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lv, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
      o.connect(bp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.5);
    }
  }

  // Un coassement : une série de petites impulsions graves (onde carrée filtrée).
  private frogCall(at: number): void {
    const out = this.spot();
    const n = 5 + Math.floor(this.rnd() * 8);
    const f = 240 + this.rnd() * 140;
    for (let k = 0; k < n; k++) {
      const t = at + k * (0.045 + this.rnd() * 0.01);
      const o = this.ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f * (1 + 0.15 * Math.sin(k)), t);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 850;
      bp.Q.value = 3.5;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.034);
      o.connect(bp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.04);
    }
  }

  // Une chouette : « hou… hou-ou » grave et doux, avec une octave faible.
  private owlCall(at: number): void {
    const out = this.spot();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(out);
    const f = 360 + this.rnd() * 50;
    this.tone(at, f * 1.1, f, 0.38, 0.05, lp);
    this.tone(at, f * 2.2, f * 2, 0.38, 0.012, lp);
    this.tone(at + 0.62, f * 0.92, f * 0.8, 0.75, 0.05, lp);
    this.tone(at + 0.62, f * 1.84, f * 1.6, 0.75, 0.01, lp);
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

  // Un claquement de voile : coup de toile sec (bruit filtré, attaque immédiate) suivi d'un petit rebond, avec un « bof » grave.
  private flapCall(at: number): void {
    const lvl = this.flapLevel * (0.6 + this.rnd() * 0.4); // chaque claquement a sa force
    const out = this.ctx.createStereoPanner();
    out.pan.value = this.rnd() * 0.5 - 0.25; // la voile est devant et au-dessus
    out.connect(this.master);
    const hits = 1 + Math.floor(this.rnd() * 3); // 1 à 3 coups rapprochés
    for (let k = 0; k < hits; k++) {
      const t = at + k * (0.07 + this.rnd() * 0.05);
      const l = lvl * Math.pow(0.65, k);
      this.burst(t, 0.09 + this.rnd() * 0.07, 600 + this.rnd() * 500, 0.8, l * 0.9, out); // la toile qui claque
      this.tone(t, 150, 70, 0.1, l * 0.35, out); // le coup sourd
    }
  }

  // Un craquement de bois : note grave en dents de scie, qui glisse, hachée par une vibration rapide (frottement), filtrée.
  private creakCall(at: number): void {
    const dur = 0.35 + this.rnd() * 0.7;
    const f0 = 150 + this.rnd() * 220;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.linearRampToValueAtTime(f0 * (0.8 + this.rnd() * 0.5), at + dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500 + this.rnd() * 500;
    bp.Q.value = 4;
    const g = this.ctx.createGain();
    const lvl = this.creakLevel * 0.13 * (0.6 + this.rnd() * 0.4);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(lvl, at + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, at + dur);
    const chop = this.ctx.createOscillator(); // le frottement saccadé
    chop.frequency.value = 18 + this.rnd() * 22;
    const chopG = this.ctx.createGain();
    chopG.gain.value = f0 * 0.12;
    chop.connect(chopG).connect(o.frequency);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = this.rnd() * 1.4 - 0.7;
    o.connect(bp).connect(g).connect(pan).connect(this.master);
    o.start(at);
    chop.start(at);
    o.stop(at + dur + 0.02);
    chop.stop(at + dur + 0.02);
  }

  // Un pas sur le pont en bois : « toc » sourd (bruit grave + note qui descend) ; mouillé : plus de chuintement. Gauche/droite alternés.
  private stepCall(at: number): void {
    const side = this.stepFoot === 0 ? -0.18 : 0.18;
    this.stepFoot = 1 - this.stepFoot;
    const out = this.ctx.createStereoPanner();
    out.pan.value = side;
    out.connect(this.master);
    const lvl = this.stepLevel * (0.85 + this.rnd() * 0.3);
    this.burst(at, 0.06, 380 + this.rnd() * 160, 0.7, lvl * 0.55, out); // le choc du pied
    this.tone(at, 120 + this.rnd() * 25, 62, 0.11, lvl * 0.5, out); // la résonance du pont
    if (this.stepWet > 0.05) this.burst(at + 0.015, 0.12, 2200, 0.8, lvl * 0.25 * this.stepWet, out); // éclaboussure sur le pont mouillé
  }

  // Un court souffle de bruit filtré (bande de fréquences), attaque immédiate puis extinction : base des claquements et des pas.
  private burst(at: number, dur: number, freq: number, q: number, level: number, dest: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(at, this.rnd() * (NOISE_SECONDS - 0.5)); // départ au hasard dans le bruit : deux coups ne sonnent jamais pareil
    src.stop(at + dur + 0.02);
  }
}
