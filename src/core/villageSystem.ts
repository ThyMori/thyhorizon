// Tous les villages du monde, à la demande : trouve les villes proches, calcule leur position (recalée sur la terre ferme) et leur plan, avec un cache.
// Sert à trois choses : dessiner les villages, enlever les arbres dedans, empêcher de traverser les murs. Logique pure.

import { Cities } from './cities';
import { CLEAR_MARGIN, CityInfo, MAX_SNAP, House, Village, findAnchor, layoutVillage, pushOutOfHouses, villageSize } from './village';
import type { Terrain } from './terrain';

const SEARCH_EXTRA = MAX_SNAP + 400; // une ville peut être déplacée jusqu'à MAX_SNAP de sa position réelle

// Un disque dégagé : les arbres n'y poussent pas.
export interface Clearing {
  x: number;
  z: number;
  r: number;
}

export class VillageSystem {
  private readonly anchors = new Map<number, { x: number; z: number } | null>(); // centre recalé de chaque ville (null = ignorée)
  private readonly villages = new Map<number, Village | null>(); // plans déjà calculés
  private reserved: ((x: number, z: number, r: number) => boolean) | null = null; // « cet endroit est déjà construit par le joueur »
  private version = 0; // change quand les plans sont invalidés

  constructor(private readonly cities: Cities, private readonly terrain: Terrain) {}

  get stamp(): number {
    return this.version; // les affichages comparent ce numéro pour savoir s'ils doivent se refaire
  }

  // Indique les endroits que le joueur a déjà construits : une maison n'est jamais posée dessus.
  setReserved(fn: ((x: number, z: number, r: number) => boolean) | null): void {
    this.reserved = fn;
    this.villages.clear();
    this.version++;
  }

  private info(i: number): CityInfo {
    return { id: i, name: this.cities.name(i), pop: this.cities.pop[i]!, lat: this.cities.lat[i]!, lon: this.cities.lon[i]!, x: this.cities.x[i]!, z: this.cities.z[i]! };
  }

  // Centre recalé de la ville i (ou null si elle est introuvable à terre).
  anchor(i: number): { x: number; z: number } | null {
    if (this.anchors.has(i)) return this.anchors.get(i)!;
    const a = findAnchor(this.terrain, this.cities.x[i]!, this.cities.z[i]!);
    this.anchors.set(i, a);
    return a;
  }

  // Le village complet de la ville i.
  village(i: number): Village | null {
    if (this.villages.has(i)) return this.villages.get(i)!;
    const a = this.anchor(i);
    let v: Village | null = null;
    if (a) {
      v = layoutVillage(this.info(i), a, this.terrain);
      const reserved = this.reserved;
      if (reserved) v.houses = v.houses.filter((h) => !reserved(h.x, h.z, 0.5 * Math.hypot(h.w, h.d) + 1)); // pas de maison sur une construction du joueur
    }
    this.villages.set(i, v);
    return v;
  }

  // Les villes dont le village peut toucher le disque (x, z, r).
  private candidates(x: number, z: number, r: number): number[] {
    return this.cities.nearby(x, z, r + SEARCH_EXTRA);
  }

  // Les disques dégagés qui touchent le disque (x, z, r) : simple et rapide, sans calculer les maisons.
  clearings(x: number, z: number, r: number): Clearing[] {
    const out: Clearing[] = [];
    for (const i of this.candidates(x, z, r)) {
      const a = this.anchor(i);
      if (!a) continue;
      const cr = villageSize(this.cities.pop[i]!).radius + CLEAR_MARGIN + 12; // + les panneaux, au bout de la rue
      if (Math.hypot(a.x - x, a.z - z) < cr + r) out.push({ x: a.x, z: a.z, r: cr });
    }
    return out;
  }

  // Fonction « cet endroit est-il dégagé ? » pour une tuile (null s'il n'y a aucun village près : les arbres sont alors inchangés).
  blockerForChunk(cx: number, cz: number, size: number): ((x: number, z: number) => boolean) | null {
    const half = size / 2;
    const list = this.clearings(cx * size + half, cz * size + half, half * 1.5);
    if (list.length === 0) return null;
    return (x, z) => list.some((d) => (x - d.x) ** 2 + (z - d.z) ** 2 < d.r * d.r);
  }

  // Les villages qui touchent le disque (x, z, r), plans complets.
  near(x: number, z: number, r: number): Village[] {
    const out: Village[] = [];
    for (const c of this.clearings(x, z, r)) {
      for (const i of this.candidates(c.x, c.z, 1)) {
        const a = this.anchor(i);
        if (!a || a.x !== c.x || a.z !== c.z) continue;
        const v = this.village(i);
        if (v) out.push(v);
      }
    }
    return out;
  }

  // Maisons proches de (x, z) (pour les collisions).
  housesNear(x: number, z: number, r: number): House[] {
    const out: House[] = [];
    for (const v of this.near(x, z, r)) for (const h of v.houses) if (Math.abs(h.x - x) < r + 12 && Math.abs(h.z - z) < r + 12) out.push(h);
    return out;
  }

  // Corrige une position pour qu'elle ne soit pas dans une maison.
  resolve(x: number, z: number, radius: number): { x: number; z: number; hit: boolean } {
    return pushOutOfHouses(this.housesNear(x, z, 6), x, z, radius);
  }
}
