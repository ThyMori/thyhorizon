// Les bruits de l'eau douce (1.37) : ruisseau qui babille, rivière qui gronde, lac qui clapote.
// Logique pure : `waterAround` regarde l'eau autour du joueur, `waterMix` en tire le niveau de chaque couche sonore.
// Le moteur audio (src/audio/ambient.ts) ne fait que suivre ces valeurs.

import { clamp, smoothstep } from './math';

// Ce que le joueur « perçoit » de l'eau autour de lui.
export interface WaterAround {
  dist: number; // distance à l'eau douce la plus proche (m), Infinity s'il n'y en a pas dans la portée
  slope: number; // pente de la surface de l'eau près de là (m par m) : ~0 dans un lac, plus forte dans un torrent
  size: number; // 0 à 1 : part de l'eau dans les environs proches (fin ruisseau → grande rivière ou lac)
}

// Aucune eau douce alentour.
export const NO_WATER: WaterAround = { dist: Infinity, slope: 0, size: 0 };

// Portée d'écoute de l'eau (m).
export const WATER_HEARING = 45;

// Les niveaux sonores de l'eau douce.
export interface WaterMix {
  babble: { gain: number; freq: number }; // gargouillis aigu (ruisseau) : niveau, fréquence centrale (Hz)
  rush: number; // grondement grave (grosse rivière)
  lap: number; // clapotis lent (lac, eau calme)
}

export const SILENT_WATER: WaterMix = { babble: { gain: 0, freq: 1200 }, rush: 0, lap: 0 };

// Regarde l'eau autour de (x, z) : `depthAt` = profondeur de l'eau douce (0 = à sec), `surfAt` = hauteur de l'eau (NaN = pas d'eau ni de rive).
export function waterAround(depthAt: (x: number, z: number) => number, surfAt: (x: number, z: number) => number, x: number, z: number): WaterAround {
  const radii = [0, 2, 4, 8, 16, 30, WATER_HEARING]; // anneaux de recherche
  let best = Infinity; // distance de l'eau la plus proche
  let bx = x; // point d'eau le plus proche
  let bz = z;
  let wet = 0; // échantillons mouillés à moins de 16 m
  let total = 0; // échantillons à moins de 16 m
  for (const r of radii) {
    const n = r === 0 ? 1 : 8; // un seul point au centre, huit directions ailleurs
    for (let k = 0; k < n; k++) {
      const a = (k / 8) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const isWet = depthAt(px, pz) > 0.05;
      if (r <= 16) {
        total++;
        if (isWet) wet++;
      }
      if (isWet && r < best) {
        best = r;
        bx = px;
        bz = pz;
      }
    }
  }
  if (!Number.isFinite(best)) return NO_WATER;
  // Pente de la surface autour du point d'eau le plus proche (différences sur 6 m, seulement là où il y a une surface).
  const s = (px: number, pz: number): number => surfAt(px, pz);
  const sx1 = s(bx + 3, bz), sx0 = s(bx - 3, bz), sz1 = s(bx, bz + 3), sz0 = s(bx, bz - 3);
  const dx = Number.isNaN(sx1) || Number.isNaN(sx0) ? 0 : (sx1 - sx0) / 6;
  const dz = Number.isNaN(sz1) || Number.isNaN(sz0) ? 0 : (sz1 - sz0) / 6;
  return { dist: best, slope: Math.hypot(dx, dz), size: total > 0 ? clamp(wet / total / 0.6, 0, 1) : 0 };
}

// Le mixage de l'eau douce. `muted` = on ne l'entend pas (sous l'eau, etc.), `rain` couvre un peu les petits bruits.
export function waterMix(w: WaterAround, rain = 0): WaterMix {
  if (!Number.isFinite(w.dist)) return SILENT_WATER;
  const near = 1 - smoothstep(1, WATER_HEARING, w.dist); // 1 au bord, 0 à la limite de portée
  const p = near * near; // le son décroît vite avec la distance
  const flow = smoothstep(0.0004, 0.02, w.slope); // 0 = eau calme (lac), 1 = eau vive
  const cover = 1 - 0.4 * clamp(rain, 0, 1); // la pluie couvre un peu
  const size = clamp(w.size, 0, 1);
  return {
    babble: { gain: 0.34 * p * flow * (0.45 + 0.55 * (1 - 0.5 * size)) * cover, freq: 900 + 1500 * flow },
    rush: 0.3 * p * flow * (0.2 + 0.8 * size) * cover,
    lap: 0.16 * p * (1 - flow) * (0.3 + 0.7 * size) * cover,
  };
}
