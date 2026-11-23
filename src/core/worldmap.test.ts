// Tests de la carte du monde : projection, zoom, couleurs, recherche de terre.
import { describe, expect, it } from 'vitest';
import { realClimate } from '../world/climateData';
import { sunPosition } from './geo';
import { MAX_SCALE, nightAlpha, NIGHT_ALPHA, renderNightRows, subsolarPoint, sunElevationAt, MapView, clampView, latLonToScreen, mapColor, minScale, panBy, renderMapRows, screenToLatLon, snapToLand, wrapLon, zoomAt } from './worldmap';
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

describe('jour et nuit', () => {
  it('place le soleil au sud de Lannion à midi solaire', () => {
    const sub = subsolarPoint(12, 172);
    expect(sub.lon).toBeCloseTo(-3.46, 5);
    expect(sub.lat).toBeGreaterThan(20); // solstice de juin
  });
  it('le point subsolaire a le soleil au zénith et le point opposé en pleine nuit', () => {
    const sub = subsolarPoint(15, 80);
    expect(sunElevationAt(sub.lat, sub.lon, sub)).toBeCloseTo(90, 3);
    expect(sunElevationAt(-sub.lat, sub.lon + 180, sub)).toBeCloseTo(-90, 3);
  });
  it('donne la même hauteur de soleil que le ciel du jeu à Lannion', () => {
    for (const [hours, day] of [[9, 100], [15.5, 200], [20, 330]] as const) {
      const game = sunPosition(48.73, day, hours).elevationDeg;
      expect(sunElevationAt(48.73, -3.46, subsolarPoint(hours, day))).toBeCloseTo(game, 1);
    }
  });
  it('donne la même hauteur de soleil que le ciel du jeu ailleurs (heure solaire locale)', () => {
    const lon = 100; // en Asie : l'heure solaire locale avance de 15° par heure vers l'est
    const local = 12 + (lon - -3.46) / 15; // quand il est 12 h à Lannion
    const game = sunPosition(30, 172, local % 24).elevationDeg;
    expect(sunElevationAt(30, lon, subsolarPoint(12, 172))).toBeCloseTo(game, 1);
  });
  it('assombrit la nuit, pas le jour, en douceur', () => {
    expect(nightAlpha(30)).toBe(0);
    expect(nightAlpha(-30)).toBeCloseTo(NIGHT_ALPHA);
    expect(nightAlpha(-1)).toBeGreaterThan(0);
    expect(nightAlpha(-1)).toBeLessThan(NIGHT_ALPHA);
  });
  it('dessine l\'ombre sur toute la carte', () => {
    const w = 72;
    const out = new Uint8ClampedArray(w * (w / 2) * 4);
    renderNightRows(out, w, subsolarPoint(12, 80));
    let dark = 0;
    let light = 0;
    for (let k = 3; k < out.length; k += 4) out[k] > 100 ? dark++ : out[k] === 0 ? light++ : 0;
    expect(dark).toBeGreaterThan(300);
    expect(light).toBeGreaterThan(300);
  });
});
