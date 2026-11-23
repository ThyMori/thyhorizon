// Tests de la carte du monde : projection, zoom, couleurs, recherche de terre.
import { describe, expect, it } from 'vitest';
import { realClimate } from '../world/climateData';
import { MAX_SCALE, MapView, clampView, latLonToScreen, mapColor, minScale, panBy, renderMapRows, screenToLatLon, snapToLand, wrapLon, zoomAt } from './worldmap';
import { fakeRelief, loadRealRelief } from './relief.testutil';

const W = 900;
const H = 500;
const view: MapView = { lat: 20, lon: 10, scale: 5 };

describe('projection', () => {
  it('ramène les longitudes dans −180 … 180', () => {
    expect(wrapLon(190)).toBeCloseTo(-170);
    expect(wrapLon(-190)).toBeCloseTo(170);
    expect(wrapLon(180)).toBeCloseTo(-180);
    expect(wrapLon(540)).toBeCloseTo(-180);
  });
  it('va de l\'écran au monde et retour', () => {
    const p = screenToLatLon(view, W, H, 300, 100);
    const s = latLonToScreen(view, W, H, p.lat, p.lon);
    expect(s.x).toBeCloseTo(300, 5);
    expect(s.y).toBeCloseTo(100, 5);
  });
  it('place le centre de la vue au centre de l\'écran', () => {
    const s = latLonToScreen(view, W, H, view.lat, view.lon);
    expect(s.x).toBeCloseTo(W / 2);
    expect(s.y).toBeCloseTo(H / 2);
  });
  it('prend le chemin le plus court à travers la ligne de changement de date', () => {
    const v: MapView = { lat: 0, lon: 175, scale: 10 };
    const s = latLonToScreen(v, W, H, 0, -175); // 10° à l'est du centre
    expect(s.x).toBeCloseTo(W / 2 + 100, 5);
  });
});

describe('zoom et déplacement', () => {
  it('garde le lieu sous le curseur en zoomant', () => {
    const before = screenToLatLon(view, W, H, 700, 150);
    const z = zoomAt(view, W, H, 700, 150, 2);
    const after = screenToLatLon(z, W, H, 700, 150);
    expect(z.scale).toBeCloseTo(10);
    expect(after.lat).toBeCloseTo(before.lat, 4);
    expect(after.lon).toBeCloseTo(before.lon, 4);
  });
  it('borne le zoom', () => {
    expect(zoomAt(view, W, H, 450, 250, 1e6).scale).toBe(MAX_SCALE);
    expect(zoomAt(view, W, H, 450, 250, 1e-6).scale).toBeCloseTo(minScale(W));
  });
  it('ne sort pas du monde en latitude, et boucle en longitude', () => {
    const up = panBy({ lat: 0, lon: 0, scale: 10 }, W, H, 0, 100000);
    expect(up.lat).toBeLessThanOrEqual(90);
    const far = panBy({ lat: 0, lon: 170, scale: 10 }, W, H, -500, 0);
    expect(far.lon).toBeGreaterThanOrEqual(-180);
    expect(far.lon).toBeLessThan(180);
  });
  it('centre le monde quand il est plus petit que l\'écran', () => {
    expect(clampView({ lat: 50, lon: 0, scale: minScale(W) }, W, 900).lat).toBe(0);
  });
});

describe('couleurs', () => {
  it('colore la mer en bleu et la terre selon le climat', () => {
    const sea = mapColor(-100, undefined, 1);
    expect(sea[2]).toBeGreaterThan(sea[0]);
    const desert = mapColor(300, realClimate.biomeAt(23, 12), 1);
    expect(desert[0]).toBeGreaterThan(desert[2]);
    const forest = mapColor(300, realClimate.biomeAt(0, 23), 1);
    expect(forest[1]).toBeGreaterThan(forest[0]);
  });
  it('dessine des lignes de la vraie carte sans trou', () => {
    const w = 120;
    const out = new Uint8ClampedArray(w * (w / 2) * 4);
    renderMapRows(out, w, w / 2, 0, w / 2, loadRealRelief(), realClimate);
    for (let k = 3; k < out.length; k += 4) expect(out[k]).toBe(255);
  });
});

describe('terre la plus proche', () => {
  const relief = loadRealRelief();
  it('ne bouge pas sur la terre ferme', () => {
    const r = snapToLand(relief, 48.5, 2.3)!; // Paris
    expect(r.moved).toBe(false);
  });
  it('ramène un point de l\'Atlantique sur une côte', () => {
    const r = snapToLand(relief, 40, -35)!; // au large des Açores
    expect(r.moved).toBe(true);
    expect(relief.heightAt(r.lat, r.lon)).toBeGreaterThan(5);
  });
  it('renvoie null quand il n\'y a aucune terre à moins de 6°', () => {
    expect(snapToLand(fakeRelief(() => -100), 0, 0)).toBeNull();
  });
});
