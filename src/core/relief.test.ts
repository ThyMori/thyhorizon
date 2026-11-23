// Tests du relief réel : décodage du fichier, lecture bicubique, rugosité, et quelques repères connus de la Terre.
import { describe, expect, it } from 'vitest';
import { createRelief, decodeReliefDeltas, parseReliefHeader } from './relief';
import { fakeRelief, loadRealRelief } from './relief.testutil';

describe('en-tête et décodage', () => {
  it('refuse un fichier qui n\'est pas du relief', () => {
    expect(() => parseReliefHeader(new Uint8Array(20))).toThrow();
    expect(() => parseReliefHeader(new Uint8Array(3))).toThrow();
  });
  it('relit les valeurs depuis les différences', () => {
    const header = { width: 4, height: 4, metersPerUnit: 4 };
    const deltas = new Int16Array([1, 1, 1, 1, 0, 2, 0, -2, 5, 0, 0, 0, -3, -3, -3, -3]);
    const grid = decodeReliefDeltas(header, new Uint8Array(deltas.buffer));
    expect(Array.from(grid.data.slice(0, 4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(grid.data.slice(4, 8))).toEqual([0, 2, 2, 0]);
    expect(Array.from(grid.data.slice(12, 16))).toEqual([-3, -6, -9, -12]);
    expect(() => decodeReliefDeltas(header, new Uint8Array(10))).toThrow();
  });
});

describe('lecture à une latitude / longitude', () => {
  const flat = fakeRelief(() => 100);
  it('retrouve exactement la valeur d\'une case de la grille', () => {
    const r = fakeRelief((lat, lon) => lat + lon / 10); // 5° entre les cases
    expect(r.heightAt(45, 30)).toBeCloseTo(45 + 3, 3);
  });
  it('est constante sur un monde plat', () => {
    for (const [lat, lon] of [[0, 0], [48.7, -3.4], [-89, 359], [90, 10]] as const) expect(flat.heightAt(lat, lon)).toBeCloseTo(100, 6);
  });
  it('se referme sur elle-même en longitude', () => {
    const r = fakeRelief((_lat, lon) => Math.round(50 * Math.sin((lon * Math.PI) / 180)));
    expect(r.heightAt(10, -170)).toBeCloseTo(r.heightAt(10, 190), 6);
    expect(r.heightAt(10, 360.5)).toBeCloseTo(r.heightAt(10, 0.5), 6);
  });
  it('ne plante pas aux pôles ni très loin des bornes', () => {
    for (const lat of [90, -90, 120, -400]) expect(Number.isFinite(flat.heightAt(lat, 0))).toBe(true);
  });
  it('mesure la rugosité : nulle sur du plat, forte près d\'une marche', () => {
    const step = fakeRelief((_lat, lon) => (lon < 180 ? 0 : 1000));
    expect(flat.roughnessAt(10, 10)).toBe(0);
    expect(step.roughnessAt(10, 180)).toBeGreaterThan(500);
  });
  it('construit un relief à partir d\'une grille directement', () => {
    const r = createRelief({ width: 8, height: 5, metersPerUnit: 2, data: new Int16Array(40).fill(10) });
    expect(r.heightAt(0, 0)).toBeCloseTo(20, 6);
  });
});

describe('le vrai relief de la Terre', () => {
  const r = loadRealRelief();
  it('est de la bonne taille (10 minutes d\'arc)', () => {
    expect(r.grid.width).toBe(2160);
    expect(r.grid.height).toBe(1081);
  });
  it('place la mer au nord de Lannion et la terre au sud', () => {
    expect(r.heightAt(49.3, -3.46)).toBeLessThan(0); // Manche
    expect(r.heightAt(48.3, -3.46)).toBeGreaterThan(50); // Bretagne intérieure
  });
  it('connaît quelques repères', () => {
    expect(r.heightAt(28, 86)).toBeGreaterThan(3000); // plateau tibétain et Himalaya (valeurs moyennées sur ~18 km)
    expect(r.heightAt(0, -140)).toBeLessThanOrEqual(-190); // Pacifique profond (plafonné à −200 m)
    expect(r.heightAt(-85, 0)).toBeGreaterThan(500); // Antarctique
    expect(r.heightAt(35.5, 18)).toBeLessThan(0); // Méditerranée (mer Ionienne)
  });
  it('voit les Alpes plus rugueuses que la Beauce', () => {
    expect(r.roughnessAt(46, 7.5)).toBeGreaterThan(5 * r.roughnessAt(48, 1.5));
  });
});
