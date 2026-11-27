// Les modifications du monde faites par le joueur (pour l'instant : des cairns ; plus tard : sa maison, des objets…). Logique pure.
// Elles ne sont PAS dans le calcul du monde : on les garde à part et on les pose par-dessus le monde calculé. Chaque modification
// note la version du monde sur laquelle elle a été faite (voir worldVersion.ts).

import { clamp } from './math';
import { PLANT_SPECIES, PlantSpecies } from './plants';
import { WORLD_VERSION } from './worldVersion';

export type EditType = 'cairn' | 'plant';
export const EDIT_TYPES: readonly EditType[] = ['cairn', 'plant'];
export const PLAYER_AUTHOR = 'moi'; // auteur par défaut : le joueur de cet ordinateur (le partage avec d'autres joueurs viendra plus tard)
export const MAX_EDITS = 20000; // plafond : un navigateur n'a pas un stockage infini

export interface WorldEdit {
  id: string; // identifiant unique
  type: EditType;
  x: number; // position dans le monde (m)
  z: number;
  yaw: number; // orientation (rad)
  t: number; // date de création (ms, horloge du monde)
  species?: PlantSpecies; // seulement pour une plante : son espèce (sa date de plantation est `t`)
  author: string; // qui l'a posé (`PLAYER_AUTHOR` ici ; ancienne modification sans auteur = « moi »)
  worldVersion: number; // version du monde sur laquelle c'est posé
}

// Nouvel identifiant : date + hasard (jamais deux fois le même).
export const newEditId = (nowMs: number, rnd: () => number = Math.random): string => `e${Math.floor(nowMs).toString(36)}${Math.floor(rnd() * 1e9).toString(36)}`;

// Nettoie une modification lue du stockage (null si inutilisable). On ne fait jamais confiance à ce qu'on relit.
export function sanitizeEdit(raw: unknown): WorldEdit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const x = num(r.x);
  const z = num(r.z);
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 60) return null;
  if (!EDIT_TYPES.includes(r.type as EditType)) return null;
  if (x === null || z === null || Math.abs(x) > 1e8 || Math.abs(z) > 1e8) return null;
  const wv = num(r.worldVersion);
  const species = PLANT_SPECIES.includes(r.species as PlantSpecies) ? (r.species as PlantSpecies) : undefined;
  if (r.type === 'plant' && !species) return null; // une plante sans espèce connue est inutilisable
  return {
    id: r.id,
    type: r.type as EditType,
    x,
    z,
    yaw: num(r.yaw) ?? 0,
    t: clamp(num(r.t) ?? 0, 0, 8.64e15),
    ...(r.type === 'plant' ? { species } : {}), // l'espèce n'existe que pour une plante
    author: typeof r.author === 'string' && r.author.length > 0 && r.author.length <= 40 ? r.author : PLAYER_AUTHOR,
    worldVersion: wv !== null && Number.isInteger(wv) && wv >= 1 ? wv : 1,
  };
}

// Distance au carré entre deux points.
const d2 = (ax: number, az: number, bx: number, bz: number): number => (ax - bx) ** 2 + (az - bz) ** 2;

// La liste des modifications en mémoire. Les changements sont signalés à l'extérieur (pour les enregistrer et les dessiner).
export class EditStore {
  private readonly items = new Map<string, WorldEdit>();
  private listeners: Array<(change: { added?: WorldEdit; removed?: WorldEdit }) => void> = [];

  // Remplace tout le contenu (au chargement) : les entrées invalides sont ignorées, les doublons aussi.
  load(rawList: unknown[]): number {
    this.items.clear();
    for (const raw of rawList) {
      const e = sanitizeEdit(raw);
      if (e && this.items.size < MAX_EDITS) this.items.set(e.id, e);
    }
    return this.items.size;
  }

  // Ajoute une modification ; renvoie false si le plafond est atteint.
  add(type: EditType, x: number, z: number, yaw: number, nowMs: number, rnd?: () => number, author: string = PLAYER_AUTHOR, species?: PlantSpecies): WorldEdit | null {
    if (this.items.size >= MAX_EDITS) return null;
    const e: WorldEdit = { id: newEditId(nowMs, rnd), type, x, z, yaw, t: nowMs, author, worldVersion: WORLD_VERSION, ...(type === 'plant' && species ? { species } : {}) };
    this.items.set(e.id, e);
    for (const l of this.listeners) l({ added: e });
    return e;
  }

  remove(id: string): WorldEdit | null {
    const e = this.items.get(id);
    if (!e) return null;
    this.items.delete(id);
    for (const l of this.listeners) l({ removed: e });
    return e;
  }

  get size(): number {
    return this.items.size;
  }

  all(): WorldEdit[] {
    return [...this.items.values()];
  }

  // Les modifications à moins de `radius` mètres de (x, z).
  near(x: number, z: number, radius: number): WorldEdit[] {
    const r2 = radius * radius;
    return this.all().filter((e) => d2(e.x, e.z, x, z) <= r2);
  }

  // La plus proche, dans le rayon donné (ou null), éventuellement d'un type précis.
  nearest(x: number, z: number, radius: number, type?: EditType): WorldEdit | null {
    let best: WorldEdit | null = null;
    let bd = radius * radius;
    for (const e of this.items.values()) {
      if (type && e.type !== type) continue;
      const d = d2(e.x, e.z, x, z);
      if (d <= bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  onChange(cb: (change: { added?: WorldEdit; removed?: WorldEdit }) => void): void {
    this.listeners.push(cb);
  }
}
