// Tests des bruits du bateau : silence loin du bateau, voile qui claque seulement quand elle faseye, craquements selon la mer, pas selon la marche.
import { describe, expect, it } from 'vitest';
import { BoatSoundInput, SILENT_BOAT, STRIDE, boatSoundMix } from './boatSound';

const CALM: BoatSoundInput = { aboard: true, walking: false, walkSpeed: 0, luff: 0, mainUp: 1, jibOut: 1, aws: 6, heelDeg: 0, heelRate: 0, boatSpeed: 0, seaHs: 0.1, rain: 0 };

describe('bruits du bateau', () => {
  it('rien du tout loin du bateau', () => expect(boatSoundMix({ ...CALM, aboard: false, luff: 1 })).toEqual(SILENT_BOAT));
  it('la voile ne claque que si elle faseye, est dehors et qu’il y a du vent', () => {
    expect(boatSoundMix(CALM).flap.rate).toBe(0); // voile bien réglée
    const f = boatSoundMix({ ...CALM, luff: 1 }).flap;
    expect(f.rate).toBeGreaterThan(1);
    expect(boatSoundMix({ ...CALM, luff: 1, mainUp: 0, jibOut: 0 }).flap.rate).toBe(0); // voiles affalées
    expect(boatSoundMix({ ...CALM, luff: 1, aws: 0.3 }).flap.rate).toBe(0); // pas de vent
    expect(boatSoundMix({ ...CALM, luff: 1, aws: 14 }).flap.level).toBeGreaterThan(f.level); // plus fort quand il souffle
    expect(boatSoundMix({ ...CALM, luff: 1, aws: 14 }).flap.rate).toBeGreaterThan(f.rate);
  });
  it('le bateau craque plus par mer formée et quand il gîte, un peu même au calme', () => {
    const calm = boatSoundMix({ ...CALM, seaHs: 0 }).creak;
    expect(calm.rate).toBeGreaterThan(0);
    expect(calm.rate).toBeLessThan(0.1);
    const rough = boatSoundMix({ ...CALM, seaHs: 3, heelDeg: 20, heelRate: 0.1, boatSpeed: 4 }).creak;
    expect(rough.rate).toBeGreaterThan(calm.rate * 4);
    expect(rough.level).toBeGreaterThan(calm.level);
    expect(rough.rate).toBeLessThanOrEqual(0.7);
  });
  it('les pas : cadence selon la vitesse, rien à l’arrêt ni à la barre', () => {
    expect(boatSoundMix({ ...CALM, walking: true, walkSpeed: 0 }).step.rate).toBe(0);
    expect(boatSoundMix({ ...CALM, walking: false, walkSpeed: 1.5 }).step.rate).toBe(0);
    const s = boatSoundMix({ ...CALM, walking: true, walkSpeed: 1.5 }).step;
    expect(s.rate).toBeCloseTo(1.5 / STRIDE, 5);
    expect(boatSoundMix({ ...CALM, walking: true, walkSpeed: 3 }).step.rate).toBeGreaterThan(s.rate);
    expect(boatSoundMix({ ...CALM, walking: true, walkSpeed: 1.5, rain: 0.8 }).step.wet).toBeGreaterThan(0.5);
    expect(s.wet).toBe(0);
  });
  it('toutes les valeurs restent dans leurs bornes', () => {
    const m = boatSoundMix({ ...CALM, walking: true, walkSpeed: 50, luff: 5, aws: 90, heelDeg: -80, heelRate: -9, boatSpeed: 40, seaHs: 20, rain: 5 });
    for (const v of [m.flap.rate, m.flap.level, m.creak.rate, m.creak.level, m.step.rate, m.step.level, m.step.wet]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect(m.creak.level).toBeLessThanOrEqual(1);
    expect(m.step.rate).toBeLessThanOrEqual(4);
  });
});
