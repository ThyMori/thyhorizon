// Tests des réglages et de la sauvegarde : jamais de valeur aberrante, jamais de partie perdue pour rien.
import { describe, expect, it } from 'vitest';
import { hashSeed } from './noise';
import { DEFAULT_SEED, defaultSave, readSavedSeed, sanitizeSave } from './save';
import { DEFAULT_SETTINGS, LIMITS, PRESETS, applyPreset, detectQuality, sanitizeSettings } from './settings';
import { createTerrain } from './terrain';
import { loadRealRelief } from './relief.testutil';

describe('sanitizeSettings', () => {
  it('redonne les valeurs par défaut pour tout ce qui est illisible', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('abc')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ viewDistance: 'beaucoup' })).toEqual(DEFAULT_SETTINGS);
  });
  it('borne les valeurs hors limites', () => {
    const s = sanitizeSettings({ viewDistance: 9999, resolution: 0, mouseSensitivity: 50, shadowSize: 99999 });
    expect(s.viewDistance).toBe(LIMITS.viewDistance.max);
    expect(s.resolution).toBe(LIMITS.resolution.min);
    expect(s.mouseSensitivity).toBe(LIMITS.mouseSensitivity.max);
    expect(s.shadowSize).toBe(2048);
  });
  it('garde les valeurs valides', () => {
    const s = sanitizeSettings({ viewDistance: 15, shadows: false, showFps: false });
    expect(s.viewDistance).toBe(15);
    expect(s.shadows).toBe(false);
    expect(s.showFps).toBe(false);
  });
  it('garde le réglage des constellations hors des préréglages', () => {
    expect(DEFAULT_SETTINGS.constellations).toBe(false);
    expect(sanitizeSettings({ constellations: true }).constellations).toBe(true);
    expect(sanitizeSettings({ constellations: 'oui' }).constellations).toBe(false);
    expect(detectQuality({ ...DEFAULT_SETTINGS, constellations: true })).toBe('balanced');
  });
  it('affiche les instruments par défaut et valide le réglage', () => {
    expect(DEFAULT_SETTINGS.soundVolume).toBe(0.6);
    expect(sanitizeSettings({ soundVolume: 7 }).soundVolume).toBe(1);
    expect(sanitizeSettings({ soundVolume: -1 }).soundVolume).toBe(0);
    expect(sanitizeSettings({ soundVolume: 'fort' }).soundVolume).toBe(0.6);
    expect(DEFAULT_SETTINGS.musicVolume).toBe(0.5);
    expect(sanitizeSettings({ musicVolume: 9 }).musicVolume).toBe(1);
    expect(sanitizeSettings({ musicVolume: 'x' }).musicVolume).toBe(0.5);
    expect(DEFAULT_SETTINGS.realWeather).toBe(false); // la météo réelle est désactivée par défaut
    expect(sanitizeSettings({ realWeather: 'oui' }).realWeather).toBe(false);
    expect(sanitizeSettings({ realWeather: true }).realWeather).toBe(true);
    expect(DEFAULT_SETTINGS.showHands).toBe(true);
    expect(sanitizeSettings({ showHands: false }).showHands).toBe(false);
    expect(sanitizeSettings({ showHands: 3 }).showHands).toBe(true);
    expect(DEFAULT_SETTINGS.showInstruments).toBe(true);
    expect(sanitizeSettings({ showInstruments: false }).showInstruments).toBe(false);
    expect(sanitizeSettings({ showInstruments: 'non' }).showInstruments).toBe(true);
  });
  it('n\'a plus de réglage de temps : le jeu est toujours en temps réel (1.45)', () => {
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('realTime');
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('dayLengthMinutes');
    expect(Object.keys(DEFAULT_SETTINGS)).not.toContain('daysPass');
    expect(Object.keys(sanitizeSettings({ realTime: true, dayLengthMinutes: 10, daysPass: false }))).not.toContain('realTime'); // un vieux réglage est ignoré
  });
  it('ne plante pas sur NaN ni Infinity', () => {
    expect(sanitizeSettings({ viewDistance: NaN, resolution: Infinity }).viewDistance).toBe(DEFAULT_SETTINGS.viewDistance);
  });
});

describe('préréglages', () => {
  it('appliquent leurs valeurs et sont reconnus', () => {
    for (const q of ['eco', 'balanced', 'beautiful'] as const) {
      const s = applyPreset(DEFAULT_SETTINGS, q);
      expect(s.viewDistance).toBe(PRESETS[q].viewDistance);
      expect(detectQuality(s)).toBe(q);
    }
  });
  it('passent en personnalisé dès qu\'un réglage de qualité est modifié', () => {
    expect(detectQuality({ ...DEFAULT_SETTINGS, viewDistance: 13 })).toBe('custom');
  });
});

describe('sauvegarde', () => {
  const terrain = createTerrain(hashSeed(DEFAULT_SEED), loadRealRelief());
  const base = defaultSave(terrain, DEFAULT_SEED);

  it('garde le numéro de version du monde de la sauvegarde (absent = 1)', () => {
    expect(sanitizeSave({ ...base }, terrain, DEFAULT_SEED).worldVersion).toBe(1);
    expect(sanitizeSave({ ...base, worldVersion: 7 }, terrain, DEFAULT_SEED).worldVersion).toBe(7);
    expect(sanitizeSave({ ...base, worldVersion: 'x' }, terrain, DEFAULT_SEED).worldVersion).toBe(1);
  });
  it('part d\'un départ valide sur la terre', () => {
    expect(base.savedAt).toBe(0); // jamais enregistrée
    expect(terrain.heightAt(base.x, base.z)).toBeGreaterThan(1);
  });
  it('reprend une sauvegarde valide telle quelle', () => {
    const s = sanitizeSave({ ...base, x: base.x + 50, z: base.z + 20, savedAt: 1.7e12, yaw: 1 }, terrain, DEFAULT_SEED);
    expect(s.x).toBe(base.x + 50);
    expect(s.savedAt).toBe(1.7e12);
    expect(s.yaw).toBe(1);
  });
  it('revient au départ si la position est en eau profonde', () => {
    const s = sanitizeSave({ ...base, x: 0, z: base.z - 6000 }, terrain, DEFAULT_SEED);
    expect(s.x).toBe(base.x);
    expect(s.z).toBe(base.z);
  });
  it('ignore une sauvegarde de l\'ancien monde inventé (version 1) : sa position n\'a plus de sens', () => {
    const s = sanitizeSave({ ...base, version: 1, x: base.x + 500, z: base.z + 500 }, terrain, DEFAULT_SEED);
    expect(s.x).toBe(base.x);
    expect(s.z).toBe(base.z);
  });
  it('revient au départ si les données sont abîmées', () => {
    expect(sanitizeSave(null, terrain, DEFAULT_SEED).x).toBe(base.x);
    expect(sanitizeSave({ x: 'a', z: NaN }, terrain, DEFAULT_SEED).x).toBe(base.x);
    expect(sanitizeSave({ ...base, x: 1e12 }, terrain, DEFAULT_SEED).x).toBe(base.x);
  });
  it('ignore une sauvegarde d\'un autre monde', () => {
    expect(sanitizeSave({ ...base, seed: 'autre', x: base.x + 99 }, terrain, DEFAULT_SEED).x).toBe(base.x);
  });
  it('lit la graine ou retombe sur celle par défaut', () => {
    expect(readSavedSeed({ seed: 'abc' })).toBe('abc');
    expect(readSavedSeed({ seed: 12 })).toBe(DEFAULT_SEED);
    expect(readSavedSeed(undefined)).toBe(DEFAULT_SEED);
  });
  it('lit la date d\'enregistrement et la borne ; une vieille sauvegarde sans date donne 0', () => {
    expect(sanitizeSave({ ...base, savedAt: -5 }, terrain, DEFAULT_SEED).savedAt).toBe(0);
    expect(sanitizeSave({ ...base, savedAt: 'x' }, terrain, DEFAULT_SEED).savedAt).toBe(0);
    const { savedAt: _savedAt, ...old } = base; // sauvegarde d'avant 1.45
    expect(sanitizeSave(old, terrain, DEFAULT_SEED).savedAt).toBe(0);
  });
  it('borne le regard', () => {
    const s = sanitizeSave({ ...base, pitch: 9 }, terrain, DEFAULT_SEED);
    expect(s.pitch).toBe(1.5);
  });
});


describe('bloom', () => {
  it('est coupé par défaut et seul le préréglage Beau l\'allume', () => {
    expect(DEFAULT_SETTINGS.bloom).toBe(false);
    expect(PRESETS.eco.bloom).toBe(false);
    expect(PRESETS.balanced.bloom).toBe(false);
    expect(PRESETS.beautiful.bloom).toBe(true);
  });
  it('est nettoyé à la lecture', () => {
    expect(sanitizeSettings({ bloom: true }).bloom).toBe(true);
    expect(sanitizeSettings({ bloom: 'oui' }).bloom).toBe(false);
  });
  it('rend la qualité « personnalisée » si on le change seul', () => {
    const s = applyPreset(DEFAULT_SETTINGS, 'beautiful');
    expect(detectQuality(s)).toBe('beautiful');
    expect(detectQuality({ ...s, bloom: false })).toBe('custom');
  });
});
