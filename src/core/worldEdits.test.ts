// Tests des modifications du monde : nettoyage, ajout, retrait, recherche du plus proche, plafond.
import { describe, expect, it } from 'vitest';
import { EditStore, MAX_EDITS, newEditId, sanitizeEdit } from './worldEdits';
import { WORLD_VERSION } from './worldVersion';

const good = { id: 'a1', type: 'cairn', x: 10, z: -5, yaw: 1, t: 1000, worldVersion: 1 };

describe('nettoyage', () => {
  it('garde une entrée valide', () => expect(sanitizeEdit(good)).toEqual(good));
  it('refuse les entrées abîmées', () => {
    for (const bad of [null, 5, 'x', {}, { ...good, id: '' }, { ...good, id: 'x'.repeat(80) }, { ...good, type: 'mine' }, { ...good, x: NaN }, { ...good, z: 'a' }, { ...good, x: 1e12 }]) {
      expect(sanitizeEdit(bad)).toBeNull();
    }
  });
  it('complète les champs facultatifs', () => {
    const e = sanitizeEdit({ id: 'a', type: 'cairn', x: 1, z: 2 })!;
    expect(e.yaw).toBe(0);
    expect(e.worldVersion).toBe(1);
  });
  it('les identifiants ne se répètent pas', () => {
    const ids = new Set(Array.from({ length: 500 }, (_, k) => newEditId(1700000000000 + (k % 3))));
    expect(ids.size).toBe(500);
  });
});

describe('liste', () => {
  it('ajoute, signale, retire', () => {
    const s = new EditStore();
    const seen: string[] = [];
    s.onChange((c) => seen.push(c.added ? `+${c.added.id}` : `-${c.removed!.id}`));
    const e = s.add('cairn', 5, 6, 0.5, 123456)!;
    expect(e.worldVersion).toBe(WORLD_VERSION);
    expect(s.size).toBe(1);
    expect(s.remove(e.id)).toEqual(e);
    expect(s.remove(e.id)).toBeNull();
    expect(seen).toEqual([`+${e.id}`, `-${e.id}`]);
  });
  it('charge en ignorant l\'invalide et les doublons', () => {
    const s = new EditStore();
    expect(s.load([good, good, { bad: true }, null, { ...good, id: 'b2', x: 3 }])).toBe(2);
    expect(s.all().map((e) => e.id).sort()).toEqual(['a1', 'b2']);
  });
  it('trouve ce qui est autour, et le plus proche', () => {
    const s = new EditStore();
    s.load([{ ...good, id: 'p', x: 0, z: 0 }, { ...good, id: 'q', x: 2, z: 0 }, { ...good, id: 'r', x: 100, z: 0 }]);
    expect(s.near(0, 0, 5).map((e) => e.id).sort()).toEqual(['p', 'q']);
    expect(s.nearest(1.5, 0, 5)!.id).toBe('q');
    expect(s.nearest(50, 50, 5)).toBeNull();
  });
  it('respecte le plafond', () => {
    const s = new EditStore();
    s.load(Array.from({ length: MAX_EDITS + 5 }, (_, k) => ({ ...good, id: `i${k}`, x: k })));
    expect(s.size).toBe(MAX_EDITS);
    expect(s.add('cairn', 0, 0, 0, 1)).toBeNull();
  });
});
