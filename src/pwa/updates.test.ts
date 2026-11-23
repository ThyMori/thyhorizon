// Tests de la surveillance des mises à jour, avec de faux objets du navigateur.
import { describe, expect, it, vi } from 'vitest';
import { watchUpdates } from './updates';

// Faux « événements » : une petite boîte où l'on enregistre et déclenche des écouteurs.
class Bus {
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, l: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(l);
  }
  removeEventListener(type: string, l: () => void): void {
    this.listeners.get(type)?.delete(l);
  }
  fire(type: string): void {
    this.listeners.get(type)?.forEach((l) => l());
  }
  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function setup(controller: unknown) {
  const update = vi.fn(async () => {});
  const sw = Object.assign(new Bus(), { controller, ready: Promise.resolve({ update }) });
  const doc = Object.assign(new Bus(), { visibilityState: 'visible' });
  const win = new Bus();
  const onUpdate = vi.fn();
  const watcher = watchUpdates({ sw, onUpdate, doc, win, intervalMs: 1000 });
  return { sw, doc, win, onUpdate, update, watcher };
}

describe('watchUpdates', () => {
  it('ne prévient pas à la toute première installation', async () => {
    const t = setup(null);
    t.sw.fire('controllerchange');
    expect(t.onUpdate).not.toHaveBeenCalled();
    t.sw.fire('controllerchange'); // un changement ultérieur est une vraie mise à jour
    expect(t.onUpdate).toHaveBeenCalledTimes(1);
    t.watcher.stop();
  });
  it('prévient quand une nouvelle version prend la main', () => {
    const t = setup({});
    t.sw.fire('controllerchange');
    expect(t.onUpdate).toHaveBeenCalledTimes(1);
    t.watcher.stop();
  });
  it('vérifie au retour au premier plan et quand le réseau revient, pas en arrière-plan', async () => {
    const t = setup({});
    await Promise.resolve(); // laisse « ready » se résoudre
    await Promise.resolve();
    t.doc.fire('visibilitychange');
    t.win.fire('online');
    await Promise.resolve();
    expect(t.update).toHaveBeenCalledTimes(2);
    t.doc.visibilityState = 'hidden';
    t.doc.fire('visibilitychange');
    expect(t.update).toHaveBeenCalledTimes(2);
    t.watcher.stop();
  });
  it('« checkNow » demande la vérification, et ne plante pas si elle échoue', async () => {
    const t = setup({});
    await Promise.resolve();
    await Promise.resolve();
    await t.watcher.checkNow();
    expect(t.update).toHaveBeenCalledTimes(1);
    t.update.mockRejectedValueOnce(new Error('hors ligne'));
    await expect(t.watcher.checkNow()).resolves.toBeUndefined();
    t.watcher.stop();
  });
  it('retire tous ses écouteurs à l\'arrêt', () => {
    const t = setup({});
    t.watcher.stop();
    expect(t.sw.count('controllerchange')).toBe(0);
    expect(t.doc.count('visibilitychange')).toBe(0);
    expect(t.win.count('online')).toBe(0);
  });
  it('ne fait rien sans service worker', async () => {
    const w = watchUpdates({ sw: null, onUpdate: vi.fn(), doc: new Bus() as never, win: new Bus() as never });
    await expect(w.checkNow()).resolves.toBeUndefined();
    w.stop();
  });
});
