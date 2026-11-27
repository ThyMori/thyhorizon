// Le critère de l'étape 1 de la feuille de route : une marque posée dans le monde est retrouvée après fermeture, export et import.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { hashSeed } from '../core/noise';
import { loadRealRelief } from '../core/relief.testutil';
import { DEFAULT_SEED, SaveData, defaultSave } from '../core/save';
import { buildSaveFile, parseSaveFile, serializeSaveFile } from '../core/saveFile';
import { createTerrain } from '../core/terrain';
import { EditStore } from '../core/worldEdits';
import { memoryPersistence, openEditsDb } from './editsDb';
import { applyImport } from './importSave';

const terrain = createTerrain(hashSeed(DEFAULT_SEED), loadRealRelief());

describe('exporter puis importer', () => {
  it('un cairn posé est retrouvé après fermeture, export et import dans un navigateur vide', async () => {
    // --- Partie 1 : on pose un cairn, il est enregistré, puis on exporte ---
    const dbA = await openEditsDb('partie-a', new IDBFactory());
    const storeA = new EditStore();
    storeA.onChange((c) => void (c.added && dbA.put(c.added)));
    const base = defaultSave(terrain, DEFAULT_SEED);
    const cairn = storeA.add('cairn', base.x + 7, base.z + 3, 0.8, 1.7e12, () => 0.5, 'moi')!;
    await new Promise((r) => setTimeout(r, 20)); // laisse l'écriture finir
    const fileText = serializeSaveFile(buildSaveFile({ ...base, savedAt: 1.7e12 }, storeA.all(), '1.45.0', 1.71e12));

    // --- « Fermeture » : on perd tout (nouvel IndexedDB vide, nouveau stockage de position) ---
    const dbB = await openEditsDb('partie-b', new IDBFactory());
    expect(await dbB.loadAll()).toEqual([]); // le navigateur est vide
    let written: SaveData | null = null;

    // --- Import ---
    const parsed = parseSaveFile(fileText, terrain, DEFAULT_SEED);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await applyImport(dbB, parsed.edits, parsed.save, (s) => (written = s));

    // --- Rouverture : le jeu relit le stockage ---
    const storeB = new EditStore();
    storeB.load(await dbB.loadAll());
    expect(storeB.size).toBe(1);
    const back = storeB.nearest(base.x + 7, base.z + 3, 0.1, 'cairn');
    expect(back).toEqual(cairn); // même identifiant, même place, même date, même auteur
    expect(written).toEqual({ ...base, savedAt: 1.7e12 });
  });

  it('remplace l\'ancienne partie : les constructions qui n\'étaient pas dans le fichier disparaissent', async () => {
    const db = await openEditsDb('remplace', new IDBFactory());
    await db.put({ id: 'ancien' });
    await applyImport(db, [], defaultSave(terrain, DEFAULT_SEED), () => undefined);
    expect(await db.loadAll()).toEqual([]);
  });

  it('refuse d\'importer sans stockage durable (rien ne survivrait au rechargement) et n\'écrit pas la position', async () => {
    let wrote = false;
    await expect(applyImport(memoryPersistence(), [], defaultSave(terrain, DEFAULT_SEED), () => (wrote = true))).rejects.toThrow();
    expect(wrote).toBe(false);
  });

  it('si l\'écriture des constructions échoue, la position n\'est pas écrite', async () => {
    const broken = { ...memoryPersistence(), persistent: true, put: async () => Promise.reject(new Error('disque plein')) };
    let wrote = false;
    const base = defaultSave(terrain, DEFAULT_SEED);
    const store = new EditStore();
    store.add('cairn', base.x + 1, base.z + 1, 0, 1, () => 0.1);
    await expect(applyImport(broken, store.all(), base, () => (wrote = true))).rejects.toThrow('disque plein');
    expect(wrote).toBe(false);
  });

  it('clear() vide aussi la mémoire de repli', async () => {
    const m = memoryPersistence();
    await m.put({ id: 'a' });
    await m.clear();
    expect(await m.loadAll()).toEqual([]);
  });
});
