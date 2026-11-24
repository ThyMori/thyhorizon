// Tests du numéro de version du monde.
import { describe, expect, it } from 'vitest';
import { WORLD_VERSION, readWorldVersion, worldVersionStatus } from './worldVersion';

describe('version du monde', () => {
  it('une sauvegarde sans numéro est de version 1', () => {
    expect(readWorldVersion({})).toBe(1);
    expect(readWorldVersion(null)).toBe(1);
    expect(readWorldVersion('x')).toBe(1);
  });
  it('lit un numéro valide et refuse les valeurs absurdes', () => {
    expect(readWorldVersion({ worldVersion: 3 })).toBe(3);
    for (const bad of [0, -2, 1.5, NaN, Infinity, '2', 5000, null]) expect(readWorldVersion({ worldVersion: bad })).toBe(1);
  });
  it('compare au monde du code', () => {
    expect(worldVersionStatus(WORLD_VERSION)).toBe('ok');
    expect(worldVersionStatus(WORLD_VERSION + 1)).toBe('future');
    if (WORLD_VERSION > 1) expect(worldVersionStatus(WORLD_VERSION - 1)).toBe('older');
  });
});
