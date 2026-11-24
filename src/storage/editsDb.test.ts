// Tests de l'enregistrement des modifications : aller-retour, suppression, persistance entre deux ouvertures, repli mémoire.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { memoryPersistence, openEditsDb } from './editsDb';

describe('IndexedDB', () => {
  it('garde, relit et supprime', async () => {
    const f = new IDBFactory();
    const db = await openEditsDb('t1', f);
    expect(db.persistent).toBe(true);
    await db.put({ id: 'a', x: 1 } as { id: string });
    await db.put({ id: 'b', x: 2 } as { id: string });
    await db.put({ id: 'a', x: 3 } as { id: string }); // remplace
    const all = (await db.loadAll()) as { id: string; x: number }[];
    expect(all.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(all.find((e) => e.id === 'a')!.x).toBe(3);
    await db.delete('a');
    expect(((await db.loadAll()) as { id: string }[]).map((e) => e.id)).toEqual(['b']);
  });
  it('les données survivent à une nouvelle ouverture (comme un rechargement de page)', async () => {
    const f = new IDBFactory();
    const first = await openEditsDb('t2', f);
    await first.put({ id: 'keep' });
    const second = await openEditsDb('t2', f);
    expect(((await second.loadAll()) as { id: string }[])[0]!.id).toBe('keep');
  });
  it('sans IndexedDB : repli en mémoire, non durable, sans exception', async () => {
    const db = await openEditsDb('t3', null);
    expect(db.persistent).toBe(false);
    await db.put({ id: 'z' });
    expect(await db.loadAll()).toHaveLength(1);
  });
  it('si l\'ouverture échoue : repli en mémoire', async () => {
    const broken = { open: () => { throw new Error('refusé'); } } as unknown as IDBFactory;
    const db = await openEditsDb('t4', broken);
    expect(db.persistent).toBe(false);
  });
  it('le repli mémoire fonctionne seul', async () => {
    const m = memoryPersistence();
    await m.put({ id: '1' });
    await m.delete('1');
    expect(await m.loadAll()).toEqual([]);
  });
});
