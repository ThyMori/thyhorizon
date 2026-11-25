// Carte du monde (touche M) : on glisse pour se déplacer, la molette zoome, un clic choisit un lieu, « Y aller » s'y rend.
// La carte est dessinée une fois (relief réel + couleurs du climat) dans une image hors écran, puis simplement affichée selon la vue.

import type { Climate } from '../core/climate';
import { formatCoords } from '../core/format';
import type { Cities } from '../core/cities';
import { cityMinPop, coordDigits, DETAIL_MIN_SCALE, renderDetailRows, latLonToScreen, MapView, minScale, panBy, renderMapRows, renderNightRows, screenToLatLon, subsolarPoint, zoomAt, clampView } from '../core/worldmap';
import type { Relief } from '../core/relief';
import { byId } from './dom';

const MAP_W = 1080; // largeur de l'image du monde (1/3° par pixel)
const MAP_H = MAP_W / 2;

export interface WorldMapDeps {
  relief: Relief;
  climate: Climate;
  cities: Cities; // les villes réelles (points et noms sur la carte)
  getPlayer: () => { lat: number; lon: number }; // où est le joueur
  getTime: () => { hours: number; day: number }; // heure solaire de Lannion et jour de l'année du jeu
  groundAt: (lat: number, lon: number) => number; // altitude du terrain du jeu (m) : sert à la couche de détail et à l'arrivée précise
  onGo: (lat: number, lon: number, city: number | null) => void; // voyage demandé (city = numéro de la ville choisie, s'il y en a une)
}

export class WorldMap {
  private readonly canvas = byId<HTMLCanvasElement>('map-canvas');
  private readonly ctx = this.canvas.getContext('2d')!;
  private readonly info = byId('map-info');
  private readonly goBtn = byId<HTMLButtonElement>('map-go');
  private readonly image = document.createElement('canvas'); // le monde entier, dessiné une fois
  private readonly night = document.createElement('canvas'); // l'ombre de la nuit (1° par pixel), refaite à chaque ouverture
  private showNight = true; // ombre affichée ?
  private sun = { lat: 0, lon: 0 }; // où le soleil est au zénith
  private ready = false; // l'image est-elle terminée ?
  private building = false;
  private view: MapView = { lat: 20, lon: 0, scale: 1 };
  private target: { lat: number; lon: number } | null = null; // lieu choisi
  private targetCity: number | null = null; // ville choisie (si le clic était sur une ville)
  private readonly detail = document.createElement('canvas'); // le terrain du jeu, en gros plan
  private detailView: { view: MapView; w: number; h: number; step: number } | null = null; // vue pour laquelle il a été calculé
  private detailGen = 0; // numéro du calcul en cours (un nouveau calcul annule l'ancien)
  private detailTimer = 0;
  private dragging = false;
  private moved = 0; // distance parcourue pendant l'appui (pour distinguer clic et glissement)
  private lastX = 0;
  private lastY = 0;
  private width = 1; // taille du canevas en pixels d'écran
  private height = 1;
  private dpr = 1; // densité de pixels

  constructor(private readonly deps: WorldMapDeps) {
    this.image.width = MAP_W;
    this.image.height = MAP_H;
    this.night.width = 360;
    this.night.height = 180;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.moved = 0;
      this.lastX = e.offsetX;
      this.lastY = e.offsetY;
    });
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => {
      if (this.dragging && this.moved < 6) this.pick(e.offsetX, e.offsetY); // presque pas bougé : c'est un clic
      this.dragging = false;
    });
    c.addEventListener('pointercancel', () => (this.dragging = false));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.view = zoomAt(this.view, this.width, this.height, e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0025)); // zoom autour du curseur
      this.draw();
    }, { passive: false });
    byId('map-zoom-in').addEventListener('click', () => this.zoomCenter(2));
    byId('map-zoom-out').addEventListener('click', () => this.zoomCenter(1 / 2));
    byId('map-here').addEventListener('click', () => this.centerOnPlayer());
    this.goBtn.addEventListener('click', () => this.go());
    const nightBtn = byId<HTMLButtonElement>('map-night');
    nightBtn.addEventListener('click', () => {
      this.showNight = !this.showNight; // jour / nuit : afficher ou cacher l'ombre
      nightBtn.setAttribute('aria-pressed', String(this.showNight));
      this.draw();
    });
    window.addEventListener('resize', () => {
      if (byId('dialog-map').hasAttribute('open')) this.resize();
    });
  }

  // À appeler à l'ouverture de la fenêtre : taille, vue centrée sur le joueur, fabrication de l'image si besoin.
  open(): void {
    this.target = null;
    this.targetCity = null;
    this.goBtn.disabled = true;
    this.updateNight();
    this.resize();
    this.centerOnPlayer();
    this.setInfo('Glisse pour te déplacer, molette pour zoomer (jusqu\'à ≈ 9 m par pixel), clique pour choisir un lieu.');
    if (!this.ready) this.build();
  }

  // Touche Entrée : voyage vers le lieu choisi (si la carte est ouverte).
  go(): void {
    if (this.target) this.deps.onGo(this.target.lat, this.target.lon, this.targetCity);
  }

  // Calcule l'ombre de la nuit pour l'heure et la date du jeu.
  private updateNight(): void {
    const { hours, day } = this.deps.getTime();
    this.sun = subsolarPoint(hours, day);
    const ctx = this.night.getContext('2d')!;
    const data = ctx.createImageData(360, 180);
    renderNightRows(data.data, 360, this.sun);
    ctx.putImageData(data, 0, 0);
  }

  private setInfo(text: string): void {
    this.info.textContent = text;
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = this.canvas.clientWidth || 800;
    this.height = this.canvas.clientHeight || 500;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.view = clampView({ ...this.view, scale: Math.max(this.view.scale, minScale(this.width)) }, this.width, this.height);
    this.draw();
  }

  private centerOnPlayer(): void {
    const p = this.deps.getPlayer();
    this.view = clampView({ lat: p.lat, lon: p.lon, scale: Math.max(minScale(this.width) * 2.5, 4) }, this.width, this.height);
    this.draw();
  }

  private zoomCenter(factor: number): void {
    this.view = zoomAt(this.view, this.width, this.height, this.width / 2, this.height / 2, factor);
    this.draw();
  }

  private onMove(e: PointerEvent): void {
    if (this.dragging) {
      const dx = e.offsetX - this.lastX;
      const dy = e.offsetY - this.lastY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      this.lastX = e.offsetX;
      this.lastY = e.offsetY;
      this.view = panBy(this.view, this.width, this.height, dx, dy);
      this.draw();
    } else {
      const p = screenToLatLon(this.view, this.width, this.height, e.offsetX, e.offsetY);
      if (!this.target) this.setInfo(formatCoords(p.lat, p.lon, coordDigits(this.view.scale))); // coordonnées sous le curseur
    }
  }

  // Les villes visibles à l'écran avec ce zoom, des plus grandes aux plus petites.
  private visibleCities(): { i: number; x: number; y: number }[] {
    const { cities } = this.deps;
    const { view, width, height } = this;
    const minPop = cityMinPop(view.scale);
    const out: { i: number; x: number; y: number }[] = [];
    for (let i = 0; i < cities.count; i++) {
      if (cities.pop[i]! < minPop) continue;
      const p = latLonToScreen(view, width, height, cities.lat[i]!, cities.lon[i]!);
      if (p.x < -10 || p.x > width + 10 || p.y < -10 || p.y > height + 10) continue;
      out.push({ i, x: p.x, y: p.y });
    }
    return out.sort((a, b) => cities.pop[b.i]! - cities.pop[a.i]!);
  }

  private pick(sx: number, sy: number): void {
    // Un clic tout près d'une ville choisit cette ville (et on arrive dans son village).
    let city: { i: number; d: number } | null = null;
    for (const c of this.visibleCities()) {
      const d = Math.hypot(c.x - sx, c.y - sy);
      if (d <= 10 && (!city || d < city.d)) city = { i: c.i, d };
    }
    const cities = this.deps.cities;
    this.targetCity = city ? city.i : null;
    this.target = city ? { lat: cities.lat[city.i]!, lon: cities.lon[city.i]! } : screenToLatLon(this.view, this.width, this.height, sx, sy);
    const deep = this.view.scale >= DETAIL_MIN_SCALE; // zoom assez fort : on se fie au terrain du jeu, pas à la grille floue
    const h = deep ? this.deps.groundAt(this.target.lat, this.target.lon) : this.deps.relief.heightAt(this.target.lat, this.target.lon);
    const label = city ? `${cities.name(city.i)} (${cities.pop[city.i]!.toLocaleString('fr-FR')} habitants) — ` : '';
    const where = formatCoords(this.target.lat, this.target.lon, coordDigits(this.view.scale));
    const alt = deep && !city ? (h >= 3 ? ` — altitude ${Math.round(h)} m : tu arriveras exactement ici` : ' — en mer ou sur la plage : tu seras posé sur la terre la plus proche') : !deep && h < 0 && !city ? ' — en mer : tu seras posé sur la côte la plus proche' : '';
    this.setInfo(`${label}${where}${alt}`);
    this.goBtn.disabled = false;
    this.draw();
  }

  // Dessine le monde entier dans l'image hors écran, par morceaux de lignes (l'écran reste réactif).
  private build(): void {
    if (this.building) return;
    this.building = true;
    const ictx = this.image.getContext('2d')!;
    const data = ictx.createImageData(MAP_W, MAP_H);
    let y = 0;
    const step = (): void => {
      const y1 = Math.min(MAP_H, y + 24);
      renderMapRows(data.data, MAP_W, MAP_H, y, y1, this.deps.relief, this.deps.climate);
      y = y1;
      if (y < MAP_H) {
        this.setInfo(`La carte se prépare… ${Math.round((100 * y) / MAP_H)} %`);
        window.setTimeout(step, 0);
      } else {
        ictx.putImageData(data, 0, 0);
        this.ready = true;
        this.building = false;
        this.setInfo('Glisse pour te déplacer, molette pour zoomer, clique pour choisir un lieu.');
        this.draw();
      }
    };
    step();
  }

  // La couche de détail (terrain du jeu), posée à sa place même si on a bougé depuis son calcul.
  private drawDetail(): void {
    const { ctx, width, height, view } = this;
    if (view.scale < DETAIL_MIN_SCALE) return;
    this.scheduleDetail();
    const d = this.detailView;
    if (!d) return;
    const tl = screenToLatLon(d.view, width, height, 0, 0); // coin haut-gauche de l'image (lat/lon)
    const br = screenToLatLon(d.view, width, height, d.w * d.step, d.h * d.step); // coin bas-droite
    const a = latLonToScreen(view, width, height, tl.lat, tl.lon);
    const b = latLonToScreen(view, width, height, br.lat, br.lon);
    if (b.x <= a.x || b.y <= a.y) return; // fenêtre incohérente (passage par la ligne de changement de date)
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.detail, a.x, a.y, b.x - a.x, b.y - a.y);
  }

  // Programme le calcul de la couche de détail quand la vue ne bouge plus.
  private scheduleDetail(): void {
    const d = this.detailView;
    const v = this.view;
    if (d && d.view.lat === v.lat && d.view.lon === v.lon && d.view.scale === v.scale && d.w * d.step >= this.width) return; // déjà à jour
    window.clearTimeout(this.detailTimer);
    this.detailTimer = window.setTimeout(() => this.startDetail(), 140);
  }

  // Calcule l'altitude du terrain du jeu sur toute la fenêtre (une case tous les 4 pixels), par morceaux pour garder l'écran réactif.
  private startDetail(): void {
    const gen = ++this.detailGen;
    const view = { ...this.view };
    const { width, height } = this;
    const step = view.scale >= 1000 ? 3 : 4; // case de 3 ou 4 pixels : plus fin quand on est très zoomé (côtes moins en escalier)
    const w = Math.ceil(width / step);
    const h = Math.ceil(height / step);
    const heights = new Float32Array(w * h);
    let y = 0;
    const work = (): void => {
      if (gen !== this.detailGen) return; // un calcul plus récent a pris le relais
      const t0 = performance.now(); // on travaille ~14 ms par passage : l'écran reste fluide, et on avance vite si le navigateur est libre
      while (y < h && (y === 0 || performance.now() - t0 < 14)) {
        for (let x = 0; x < w; x++) {
          const p = screenToLatLon(view, width, height, (x + 0.5) * step, (y + 0.5) * step);
          heights[y * w + x] = this.deps.groundAt(p.lat, p.lon);
        }
        y++;
      }
      if (y < h) {
        window.setTimeout(work, 0);
        return;
      }
      // Les altitudes sont prêtes : on colore.
      this.detail.width = w;
      this.detail.height = h;
      const dctx = this.detail.getContext('2d')!;
      const img = dctx.createImageData(w, h);
      const spacing = (111320 / view.scale) * step; // distance entre deux cases (m)
      renderDetailRows(img.data, heights, w, h, 0, h, spacing, (i, j) => {
        const p = screenToLatLon(view, width, height, (i + 0.5) * step, (j + 0.5) * step);
        return this.deps.climate.biomeAt(p.lat, p.lon);
      });
      dctx.putImageData(img, 0, 0);
      this.detailView = { view, w, h, step };
      this.draw();
    };
    work();
  }

  private draw(): void {
    const { ctx, width, height, view } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0d0f12';
    ctx.fillRect(0, 0, width, height);
    if (this.ready) {
      ctx.imageSmoothingEnabled = true;
      const w = 360 * view.scale;
      const y0 = height / 2 - (90 - view.lat) * view.scale;
      for (const k of [-1, 0, 1]) {
        const x0 = width / 2 + (-180 - view.lon + 360 * k) * view.scale; // trois copies côte à côte : le monde se referme sur lui-même
        if (x0 > width || x0 + w < 0) continue;
        ctx.drawImage(this.image, x0, y0, w, 180 * view.scale);
        if (this.showNight) ctx.drawImage(this.night, x0, y0, w, 180 * view.scale); // l'ombre de la nuit par-dessus
      }
      this.drawDetail();
    }
    // Quadrillage léger tous les 30°.
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lat = -60; lat <= 60; lat += 30) {
      const y = latLonToScreen(view, width, height, lat, 0).y;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const x = latLonToScreen(view, width, height, 0, lon).x;
      for (const dx of [-360 * view.scale, 0, 360 * view.scale]) {
        ctx.moveTo(x + dx, 0);
        ctx.lineTo(x + dx, height);
      }
    }
    ctx.stroke();
    // Les villes : un point, et le nom des plus grandes quand on a zoomé.
    if (this.ready) {
      const list = this.visibleCities();
      ctx.fillStyle = '#f2ead0';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1;
      for (const c of list) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, view.scale < 16 ? 2.2 : 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (view.scale >= 14) {
        ctx.font = '12px "Segoe UI", system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.75)';
        for (const c of list.slice(0, 70)) {
          const name = this.deps.cities.name(c.i);
          ctx.strokeText(name, c.x + 6, c.y);
          ctx.fillText(name, c.x + 6, c.y);
        }
      }
    }
    // Le joueur (rond ambre) et le lieu choisi (croix).
    const p = this.deps.getPlayer();
    const me = latLonToScreen(view, width, height, p.lat, p.lon);
    ctx.fillStyle = '#e8a24a';
    ctx.strokeStyle = '#1a1206';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(me.x, me.y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (this.showNight) {
      const s = latLonToScreen(view, width, height, this.sun.lat, this.sun.lon); // le soleil au zénith
      ctx.fillStyle = '#ffe58a';
      ctx.strokeStyle = '#7a5a00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (this.target) {
      const t = latLonToScreen(view, width, height, this.target.lat, this.target.lon);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(t.x - 9, t.y);
      ctx.lineTo(t.x + 9, t.y);
      ctx.moveTo(t.x, t.y - 9);
      ctx.lineTo(t.x, t.y + 9);
      ctx.stroke();
    }
  }
}
