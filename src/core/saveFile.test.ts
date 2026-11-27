// Tests du fichier de sauvegarde : aller-retour, fichiers abîmés ou trafiqués, autre monde, monde plus récent.
import { describe, expect, it } from 'vitest';
import { loadRealRelief } from './relief.testutil';
import { hashSeed } from './noise';
import { DEFAULT_SEED, defaultSave } from './save';
import { MAX_SAVE_FILE_CHARS, SAVE_FILE_FORMAT, SAVE_FILE_VERSION, buildSaveFile, parseSaveFile, saveFileName, serializeSaveFile } from './saveFile';
import { createTerrain } from './terrain';
import { EditStore, PLAYER_AUTHOR } from './worldEdits';

const terrain = createTerrain(hashSeed(DEFAULT_SEED), loadRealRelief());
const save = { ...defaultSave(terrain, DEFAULT_SEED), savedAt: 1.7e12 };
const store = new EditStore();
store.add('cairn', save.x + 5, save.z + 5, 0.5, 1.7e12, () => 0.25);
store.add('cairn', save.x + 9, save.z + 2, 1.5, 1.7e12 + 1000, () => 0.75);
const good = serializeSaveFile(buildSaveFile(save, store.all(), '1.45.0', 1.71e12));
const asObject = (): Record<string, unknown> => JSON.parse(good) as Record<string, unknown>;

describe('fichier de sauvegarde', () => {
  it('fait l\'aller-retour : position et constructions reviennent à l\'identique', () => {
    const r = parseSaveFile(good, terrain, DEFAULT_SEED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save).toEqual(save);
    expect(r.edits).toEqual(store.all());
    expect(r.skipped).toBe(0);
    expect(r.newerWorld).toBe(false);
    expect(r.gameVersion).toBe('1.45.0');
    expect(r.exportedAt).toBe(1.71e12);
  });

  it('le contenu porte le format, sa version et l\'auteur de chaque construction', () => {
    const f = asObject();
    expect(f.format).toBe(SAVE_FILE_FORMAT);
    expect(f.formatVersion).toBe(SAVE_FILE_VERSION);
    expect((f.edits as { author: string }[]).every((e) => e.author === PLAYER_AUTHOR)).toBe(true);
  });

  it('propose un nom de fichier daté', () => {
    expect(saveFileName(Date.UTC(2026, 10, 27, 23, 59))).toBe('thyhorizon-2026-11-27.json');
  });

  it('refuse un texte vide, illisible, ou qui n\'est pas une sauvegarde', () => {
    for (const bad of ['', 'pas du json', '42', 'null', '[]', '{"format":"autre"}']) {
      const r = parseSaveFile(bad, terrain, DEFAULT_SEED);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10); // une phrase à afficher
    }
  });

  it('refuse un fichier trop gros sans le lire', () => {
    const r = parseSaveFile('x'.repeat(MAX_SAVE_FILE_CHARS + 1), terrain, DEFAULT_SEED);
    expect(r.ok).toBe(false);
  });

  it('refuse un format plus récent que le jeu, et un format abîmé', () => {
    const newer = { ...asObject(), formatVersion: SAVE_FILE_VERSION + 1 };
    const r = parseSaveFile(JSON.stringify(newer), terrain, DEFAULT_SEED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('plus récente');
    expect(parseSaveFile(JSON.stringify({ ...asObject(), formatVersion: 'x' }), terrain, DEFAULT_SEED).ok).toBe(false);
    expect(parseSaveFile(JSON.stringify({ ...asObject(), save: null }), terrain, DEFAULT_SEED).ok).toBe(false);
  });

  it('refuse une sauvegarde d\'un autre monde (autre graine)', () => {
    const other = { ...asObject(), save: { ...save, seed: 'autre' } };
    const r = parseSaveFile(JSON.stringify(other), terrain, DEFAULT_SEED);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('autre monde');
  });

  it('ignore les constructions inutilisables ou en double, et les compte', () => {
    const f = asObject();
    const first = (f.edits as unknown[])[0];
    f.edits = [first, first, { id: '', type: 'cairn', x: 1, z: 1 }, { id: 'z', type: 'palais', x: 1, z: 1 }, 'n\'importe quoi', null, ...(f.edits as unknown[]).slice(1)];
    const r = parseSaveFile(JSON.stringify(f), terrain, DEFAULT_SEED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.edits.length).toBe(2); // les deux vraies
    expect(r.skipped).toBe(5); // le doublon, les deux invalides, la chaîne et null
  });

  it('un fichier sans liste de constructions donne un monde vide, pas une erreur', () => {
    const f = asObject();
    delete f.edits;
    const r = parseSaveFile(JSON.stringify(f), terrain, DEFAULT_SEED);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.edits).toEqual([]);
  });

  it('signale un monde plus récent que ce jeu (il s\'ouvrira en lecture seule)', () => {
    const f = asObject();
    (f.save as { worldVersion: number }).worldVersion = 999;
    const r = parseSaveFile(JSON.stringify(f), terrain, DEFAULT_SEED);
    expect(r.ok && r.newerWorld).toBe(true);
  });

  it('remet un départ valide si la position du fichier est en pleine mer, et garde les constructions', () => {
    const f = asObject();
    (f.save as { x: number; z: number }).x = 0;
    (f.save as { x: number; z: number }).z = save.z - 6000;
    const r = parseSaveFile(JSON.stringify(f), terrain, DEFAULT_SEED);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.x).toBe(defaultSave(terrain, DEFAULT_SEED).x);
    expect(r.edits.length).toBe(2);
  });

  it('une construction sans auteur (ancienne sauvegarde) reçoit « moi »', () => {
    const f = asObject();
    for (const e of f.edits as Record<string, unknown>[]) delete e.author;
    const r = parseSaveFile(JSON.stringify(f), terrain, DEFAULT_SEED);
    expect(r.ok && r.edits.every((e) => e.author === PLAYER_AUTHOR)).toBe(true);
  });
});
