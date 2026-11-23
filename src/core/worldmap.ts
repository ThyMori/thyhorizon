// La carte du monde (touche M) : projection, zoom, déplacement, couleurs, recherche de la terre la plus proche.
// Logique pure : le dessin à l'écran est dans ui/worldMap.ts.
// Projection « équirectangulaire » : la longitude et la latitude vont directement en x et y (1° = le même nombre de pixels dans les deux sens).

import type { Climate } from './climate';
import { START_LON, declinationDeg } from './geo';
import { terrainColor } from './palette';
import { clamp } from './math';
import type { Relief } from './relief';

// Ce qu'on voit de la carte : le centre (en degrés) et le zoom (en pixels d'écran par degré).
export interface MapView {
  lat: number;
  lon: number;
  scale: number;
}

export const MAX_SCALE = 40; // zoom maximal : 40 pixels par degré (≈ 2,8 km par pixel)

// Ramène une longitude dans −180 … 180.
export const wrapLon = (lon: number): number => ((((lon + 180) % 360) + 360) % 360) - 180;

// Zoom minimal : le monde entier tient dans la largeur.
export const minScale = (width: number): number => width / 360;

// Corrige une vue : zoom borné, longitude ramenée dans −180 … 180, latitude pour ne pas sortir du monde.
export function clampView(view: MapView, width: number, height: number): MapView {
  const scale = clamp(view.scale, minScale(width), MAX_SCALE);
  const halfLat = height / (2 * scale); // demi-hauteur visible, en degrés
  const lat = halfLat >= 90 ? 0 : clamp(view.lat, -90 + halfLat, 90 - halfLat); // monde plus petit que l'écran : centré
  return { lat, lon: wrapLon(view.lon), scale };
}

// Point de l'écran (pixels) → latitude / longitude.
export function screenToLatLon(view: MapView, width: number, height: number, sx: number, sy: number): { lat: number; lon: number } {
  return {
    lat: clamp(view.lat - (sy - height / 2) / view.scale, -90, 90),
    lon: wrapLon(view.lon + (sx - width / 2) / view.scale),
  };
}

// Latitude / longitude → point de l'écran. La longitude est prise sur la copie du monde la plus proche du centre.
export function latLonToScreen(view: MapView, width: number, height: number, lat: number, lon: number): { x: number; y: number } {
  const dLon = wrapLon(lon - view.lon); // écart le plus court, de −180 à 180
  return { x: width / 2 + dLon * view.scale, y: height / 2 - (lat - view.lat) * view.scale };
}

// Zoom autour d'un point de l'écran : le lieu sous le curseur reste sous le curseur.
export function zoomAt(view: MapView, width: number, height: number, sx: number, sy: number, factor: number): MapView {
  const before = screenToLatLon(view, width, height, sx, sy);
  const scale = clamp(view.scale * factor, minScale(width), MAX_SCALE);
  const lon = before.lon - (sx - width / 2) / scale; // nouveau centre pour garder le même point sous le curseur
  const lat = before.lat + (sy - height / 2) / scale;
  return clampView({ lat, lon, scale }, width, height);
}

// Glissement de la carte de (dx, dy) pixels.
export function panBy(view: MapView, width: number, height: number, dx: number, dy: number): MapView {
  return clampView({ lat: view.lat + dy / view.scale, lon: view.lon - dx / view.scale, scale: view.scale }, width, height);
}

// Linéaire → sRGB (0 à 255), pour le dessin.
const toByte = (c: number): number => Math.round(255 * clamp(c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055, 0, 1));

// Couleur d'un point de la carte : mer bleue, terre aux couleurs du climat (comme dans le jeu), relief ombré.
// shade : 1 = neutre, > 1 éclairé, < 1 dans l'ombre.
export function mapColor(h: number, biome: Parameters<typeof terrainColor>[3], shade: number): [number, number, number] {
  if (h < 0) {
    const depth = clamp(-h / 200, 0, 1); // le relief réel est plafonné à −200 m : la mer varie peu
    return [Math.round(58 - 30 * depth), Math.round(104 - 42 * depth), Math.round(140 - 40 * depth)];
  }
  const c = terrainColor(Math.max(h, 8), 1, 0, biome); // sol : couleurs du jeu (hors plage)
  return [toByte(c[0] * shade), toByte(c[1] * shade), toByte(c[2] * shade)];
}

// Dessine les lignes y0 … y1 (exclue) de la carte du monde entier (width × height, rapport 2:1) dans « out » (RGBA).
// Calculé par morceaux pour ne pas figer l'écran.
export function renderMapRows(out: Uint8ClampedArray, width: number, height: number, y0: number, y1: number, relief: Relief, climate: Climate): void {
  const degPerPx = 360 / width;
  for (let y = y0; y < y1; y++) {
    const lat = 90 - (y + 0.5) * degPerPx;
    for (let x = 0; x < width; x++) {
      const lon = -180 + (x + 0.5) * degPerPx;
      const h = relief.heightAt(lat, lon);
      let shade = 1;
      if (h >= 0) {
        // Lumière venue du nord-ouest : on compare avec les voisins est et sud (la mer compte pour 0).
        const hE = Math.max(0, relief.heightAt(lat, lon + degPerPx));
        const hS = Math.max(0, relief.heightAt(lat - degPerPx, lon));
        shade = clamp(1 + 0.00022 * (hE - h + (hS - h)), 0.65, 1.3);
      }
      const [r, g, b] = mapColor(h, h >= 0 ? climate.biomeAt(lat, lon) : undefined, shade);
      const k = (y * width + x) * 4;
      out[k] = r;
      out[k + 1] = g;
      out[k + 2] = b;
      out[k + 3] = 255;
    }
  }
  void height; // (la hauteur est width / 2 ; gardée dans la signature pour la lisibilité)
}

// Cherche la terre ferme la plus proche (hauteur réelle > 5 m) en cercles de plus en plus grands, jusqu'à 6°. Renvoie null si rien.
export function snapToLand(relief: Relief, lat: number, lon: number): { lat: number; lon: number; moved: boolean } | null {
  const isLand = (la: number, lo: number): boolean => relief.heightAt(la, lo) > 5;
  if (isLand(lat, lon)) return { lat, lon: wrapLon(lon), moved: false };
  const step = 0.1; // pas de recherche en degrés
  for (let r = step; r <= 6; r += step) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / step)); // points sur le cercle
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      const la = clamp(lat + r * Math.sin(a), -89.5, 89.5);
      const lo = lon + (r * Math.cos(a)) / Math.max(0.2, Math.cos((la * Math.PI) / 180)); // les degrés de longitude rétrécissent vers les pôles
      if (isLand(la, lo)) return { lat: la, lon: wrapLon(lo), moved: true };
    }
  }
  return null;
}

// ---------- Jour et nuit ----------

const DEG = Math.PI / 180;

// Point de la Terre où le soleil est au zénith (« point subsolaire ») à l'heure solaire de Lannion et au jour de l'année donnés.
// À 12 h solaire, le soleil est au sud de Lannion : il passe plus à l'ouest ensuite (15° par heure).
export function subsolarPoint(hours: number, day: number): { lat: number; lon: number } {
  return { lat: declinationDeg(day), lon: wrapLon(START_LON + (12 - hours) * 15) };
}

// Hauteur du soleil (degrés au-dessus de l'horizon) en un lieu, connaissant le point subsolaire.
export function sunElevationAt(lat: number, lon: number, sub: { lat: number; lon: number }): number {
  const h = (lon - sub.lon) * DEG; // angle horaire local
  const sin = Math.sin(lat * DEG) * Math.sin(sub.lat * DEG) + Math.cos(lat * DEG) * Math.cos(sub.lat * DEG) * Math.cos(h);
  return Math.asin(clamp(sin, -1, 1)) / DEG;
}

// Opacité de l'ombre de la nuit (0 = plein jour, NIGHT_ALPHA = nuit noire) : douce autour du lever et du coucher (crépuscule).
export const NIGHT_ALPHA = 0.62;
export function nightAlpha(elevationDeg: number): number {
  const t = clamp((elevationDeg - -8) / (6 - -8), 0, 1); // −8° et en dessous : nuit ; +6° et au-dessus : jour
  return NIGHT_ALPHA * (1 - t * t * (3 - 2 * t));
}

// Dessine l'ombre de la nuit sur le monde entier (width × width/2 pixels, RGBA : bleu nuit avec une opacité variable).
export function renderNightRows(out: Uint8ClampedArray, width: number, sub: { lat: number; lon: number }): void {
  const height = width / 2;
  const deg = 360 / width;
  for (let y = 0; y < height; y++) {
    const lat = 90 - (y + 0.5) * deg;
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      out[k] = 8;
      out[k + 1] = 12;
      out[k + 2] = 38;
      out[k + 3] = Math.round(255 * nightAlpha(sunElevationAt(lat, -180 + (x + 0.5) * deg, sub)));
    }
  }
}
