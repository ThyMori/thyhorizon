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
    const s = sanitizeSettings({ viewDistance: 9999, resolution: 0, mouseSensitivity: 50, dayLengthMinutes: 7, shadowSize: 99999 });
    expect(s.viewDistance).toBe(LIMITS.viewDistance.max);
    expect(s.resolution).toBe(LIMITS.resolution.min);
    expect(s.mouseSensitivity).toBe(LIMITS.mouseSensitivity.max);
    expect(s.dayLengthMinutes).toBe(DEFAULT_SETTINGS.dayLengthMinutes); // 7 n'est pas un choix proposé
    expect(s.shadowSize).toBe(2048);
  });
  it('garde les valeurs valides', () => {
    const s = sanitizeSettings({ viewDistance: 15, shadows: false, showFps: false, dayLengthMinutes: 0 });
    expect(s.viewDistance).toBe(15);
    expect(s.shadows).toBe(false);
    expect(s.showFps).toBe(false);
    expect(s.dayLengthMinutes).toBe(0);
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
  const TODAY = 327; // 23 novembre
  const base = defaultSave(terrain, DEFAULT_SEED, TODAY);

  it('part d\'un départ valide sur la terre', () => {
    expect(base.day).toBe(TODAY);
    expect(base.hours).toBeCloseTo(15.3, 1); // une heure avant le coucher (≈ 16 h 18 solaire le 23 novembre à Lannion)
    expect(terrain.heightAt(base.x, base.z)).toBeGreaterThan(1);
  });
  it('reprend une sauvegarde valide telle quelle', () => {
    const s = sanitizeSave({ ...base, x: base.x + 50, z: base.z + 20, hours: 9.5, yaw: 1 }, terrain, DEFAULT_SEED, TODAY);
    expect(s.x).toBe(base.x + 50);
    expect(s.hours).toBe(9.5);
    expect(s.yaw).toBe(1);
  });
  it('revient au départ si la position est en eau profonde', () => {
    const s = sanitizeSave({ ...base, x: 0, z: base.z - 6000 }, terrain, DEFAULT_SEED, TODAY);
    expect(s.x).toBe(base.x);
    expect(s.z).toBe(base.z);
  });
  it('ignore une sauvegarde de l\'ancien monde inventé (version 1) : sa position n\'a plus de sens', () => {
    const s = sanitizeSave({ ...base, version: 1, x: base.x + 500, z: base.z + 500 }, terrain, DEFAULT_SEED, TODAY);
    expect(s.x).toBe(base.x);
    expect(s.z).toBe(base.z);
  });
  it('revient au départ si les données sont abîmées', () => {
    expect(sanitizeSave(null, terrain, DEFAULT_SEED, TODAY).x).toBe(base.x);
    expect(sanitizeSave({ x: 'a', z: NaN }, terrain, DEFAULT_SEED, TODAY).x).toBe(base.x);
    expect(sanitizeSave({ ...base, x: 1e12 }, terrain, DEFAULT_SEED, TODAY).x).toBe(base.x);
  });
  it('ignore une sauvegarde d\'un autre monde', () => {
    expect(sanitizeSave({ ...base, seed: 'autre', x: base.x + 99 }, terrain, DEFAULT_SEED, TODAY).x).toBe(base.x);
  });
  it('lit la graine ou retombe sur celle par défaut', () => {
    expect(readSavedSeed({ seed: 'abc' })).toBe('abc');
    expect(readSavedSeed({ seed: 12 })).toBe(DEFAULT_SEED);
    expect(readSavedSeed(undefined)).toBe(DEFAULT_SEED);
  });
  it('normalise le jour de l\'année et reprend la date du jour pour une vieille sauvegarde', () => {
    expect(sanitizeSave({ ...base, day: 400 }, terrain, DEFAULT_SEED, TODAY).day).toBe(35);
    const { day: _day, ...old } = base; // sauvegarde de la version 1.1, sans date
    expect(sanitizeSave(old, terrain, DEFAULT_SEED, 100).day).toBe(100);
  });
  it('normalise l\'heure et borne le regard', () => {
    const s = sanitizeSave({ ...base, hours: 49, pitch: 9 }, terrain, DEFAULT_SEED, TODAY);
    expect(s.hours).toBeCloseTo(1);
    expect(s.pitch).toBe(1.5);
  });
});

describe('réglage « les jours passent »', () => {
  it('est actif par défaut, respecte false et ignore une valeur invalide', () => {
    expect(sanitizeSettings({}).daysPass).toBe(true);
    expect(sanitizeSettings({ daysPass: false }).daysPass).toBe(false);
    expect(sanitizeSettings({ daysPass: 'non' }).daysPass).toBe(true);
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
