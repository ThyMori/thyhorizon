// Gestionnaire de tuiles : fait apparaître le monde autour du joueur et l'efface derrière lui.
// Les calculs lourds se font dans des workers ; ici on ne fait que créer/supprimer les objets 3D.

import * as THREE from 'three';
import { CHUNK_SIZE, ChunkData, chunkKey, lodForDistance } from '../core/chunk';
import type { WorkerRequest, WorkerResponse } from './chunkWorker';

// Une tuile connue du gestionnaire.
interface Entry {
  cx: number; // indice de tuile en x
  cz: number; // indice de tuile en z
  mesh: THREE.Mesh | null; // objet 3D affiché (null tant que rien n'est arrivé)
  lod: number; // niveau de détail du mesh affiché
  requested: number | null; // niveau de détail en cours de calcul (null = rien en cours)
}

// Une tuile souhaitée autour du joueur.
interface Wanted {
  cx: number;
  cz: number;
  lod: number;
  dist: number; // distance au joueur en tuiles
  key: string;
}

export class ChunkManager {
  private readonly workers: Worker[] = []; // les ouvriers de calcul
  private readonly entries = new Map<string, Entry>(); // toutes les tuiles connues
  private readonly wantedLod = new Map<string, number>(); // niveau de détail souhaité pour chaque tuile voulue
  private readonly failed = new Set<string>(); // tuiles dont le calcul a échoué (on ne réessaie pas)
  private readonly ready: ChunkData[] = []; // tuiles calculées, en attente d'être affichées
  private wanted: Wanted[] = []; // tuiles voulues, triées de la plus proche à la plus lointaine
  private inflight = 0; // nombre de calculs en cours
  private readonly maxInflight: number; // nombre maximal de calculs simultanés
  private nextWorker = 0; // prochain ouvrier à solliciter (tourniquet)
  private lastCx = Number.NaN; // dernière tuile du joueur en x
  private lastCz = Number.NaN; // dernière tuile du joueur en z
  private lastRadius = -1; // dernier rayon demandé
  private errorReported = false; // l'erreur a-t-elle déjà été signalée ?

  constructor(
    private readonly scene: THREE.Scene, // la scène où ajouter les tuiles
    private readonly material: THREE.Material, // matériau commun à toutes les tuiles
    seed: number, // graine du monde
    private readonly onError: (message: string) => void, // appelé en cas de problème (une seule fois)
  ) {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4; // cœurs du processeur
    const count = Math.max(1, Math.min(3, cores - 2)); // on laisse de la place à l'affichage
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' }); // un ouvrier
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleResponse(event.data); // réception d'une tuile
      worker.onerror = (event) => this.reportError(event.message || 'Erreur dans le worker de terrain'); // plantage de l'ouvrier
      worker.postMessage({ type: 'init', seed } satisfies WorkerRequest); // on lui donne la graine
      this.workers.push(worker);
    }
    this.maxInflight = count * 2; // chaque ouvrier a une file de 2 tuiles
  }

  // Appelé à chaque image : met à jour les tuiles voulues, lance les calculs, affiche celles qui sont prêtes.
  update(px: number, pz: number, radius: number): void {
    const cx = Math.floor(px / CHUNK_SIZE); // tuile du joueur
    const cz = Math.floor(pz / CHUNK_SIZE);
    if (cx !== this.lastCx || cz !== this.lastCz || radius !== this.lastRadius) {
      this.lastCx = cx; // mémorise pour ne recalculer que si nécessaire
      this.lastCz = cz;
      this.lastRadius = radius;
      this.rebuildWanted(cx, cz, radius); // nouvelle liste de tuiles voulues
    }
    this.pump(); // lance des calculs si de la place est libre
    this.installReady(3); // affiche au plus 3 tuiles par image (évite les à-coups)
  }

  // Y a-t-il de quoi afficher autour de ce point ? Sert à l'écran « le monde se forme ».
  isReadyAround(px: number, pz: number, radiusChunks: number): boolean {
    const cx = Math.floor(px / CHUNK_SIZE);
    const cz = Math.floor(pz / CHUNK_SIZE);
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
      for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
        if (!this.entries.get(chunkKey(cx + dx, cz + dz))?.mesh) return false; // une tuile manque
      }
    }
    return true;
  }

  // Chiffres pour le compteur d'images.
  stats(): { tiles: number; pending: number } {
    let tiles = 0;
    for (const e of this.entries.values()) if (e.mesh) tiles++; // tuiles affichées
    return { tiles, pending: this.inflight + this.ready.length }; // tuiles en cours de calcul ou d'affichage
  }

  // Libère tout (workers et mémoire graphique).
  dispose(): void {
    for (const w of this.workers) w.terminate(); // arrête les ouvriers
    for (const e of this.entries.values()) this.removeMesh(e); // supprime les objets 3D
    this.entries.clear();
  }

  // Établit la liste des tuiles à afficher dans le rayon, et supprime celles qui sont devenues trop loin.
  private rebuildWanted(cx: number, cz: number, radius: number): void {
    const wanted: Wanted[] = [];
    this.wantedLod.clear();
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.hypot(dx, dz); // distance en tuiles
        if (dist > radius) continue; // hors du disque
        const w: Wanted = { cx: cx + dx, cz: cz + dz, lod: lodForDistance(dist), dist, key: chunkKey(cx + dx, cz + dz) };
        wanted.push(w);
        this.wantedLod.set(w.key, w.lod);
      }
    }
    wanted.sort((a, b) => a.dist - b.dist); // les plus proches d'abord
    this.wanted = wanted;
    for (const [key, e] of this.entries) {
      if (this.wantedLod.has(key)) continue; // encore voulue
      if (Math.hypot(e.cx - cx, e.cz - cz) <= radius + 2) continue; // petite marge pour éviter les va-et-vient
      this.removeMesh(e); // trop loin : on libère
      this.entries.delete(key);
    }
  }

  // Envoie des demandes de calcul aux ouvriers, tuiles les plus proches en premier.
  private pump(): void {
    for (const w of this.wanted) {
      if (this.inflight >= this.maxInflight) return; // les ouvriers sont occupés
      let e = this.entries.get(w.key);
      if (!e) {
        e = { cx: w.cx, cz: w.cz, mesh: null, lod: -1, requested: null }; // première fois qu'on voit cette tuile
        this.entries.set(w.key, e);
      }
      if (e.mesh && e.lod === w.lod) continue; // déjà au bon détail
      if (e.requested === w.lod) continue; // déjà en cours de calcul
      if (this.failed.has(`${w.key}@${w.lod}`)) continue; // a échoué : on n'insiste pas
      e.requested = w.lod; // on note la demande
      this.inflight++;
      const worker = this.workers[this.nextWorker]!; // ouvrier suivant
      this.nextWorker = (this.nextWorker + 1) % this.workers.length;
      worker.postMessage({ type: 'build', cx: w.cx, cz: w.cz, lod: w.lod } satisfies WorkerRequest);
    }
  }

  // Réception d'une réponse d'un ouvrier.
  private handleResponse(res: WorkerResponse): void {
    this.inflight = Math.max(0, this.inflight - 1); // un calcul de moins en cours
    if (res.ok) {
      this.ready.push(res.data); // sera affichée à la prochaine image
      return;
    }
    const key = chunkKey(res.cx, res.cz);
    this.failed.add(`${key}@${res.lod}`); // on ne réessaie pas indéfiniment
    const e = this.entries.get(key);
    if (e) e.requested = null;
    this.reportError(res.message);
  }

  // Transforme des tuiles calculées en objets 3D affichés.
  private installReady(maxPerFrame: number): void {
    let installed = 0;
    while (this.ready.length > 0 && installed < maxPerFrame) {
      const d = this.ready.shift()!; // prochaine tuile prête
      const key = chunkKey(d.cx, d.cz);
      const e = this.entries.get(key);
      if (e && e.requested === d.lod) e.requested = null; // ce calcul-là est terminé (un autre niveau peut être en cours)
      if (!e || this.wantedLod.get(key) !== d.lod) continue; // plus voulue, ou plus à ce détail : on jette
      const mesh = this.createMesh(d); // fabrique l'objet 3D
      if (e.mesh) this.removeMesh(e); // remplace l'ancien niveau de détail d'un seul coup (pas de trou)
      e.mesh = mesh;
      e.lod = d.lod;
      this.scene.add(mesh);
      installed++;
    }
  }

  // Fabrique l'objet 3D d'une tuile.
  private createMesh(d: ChunkData): THREE.Mesh {
    const g = new THREE.BufferGeometry(); // la géométrie
    g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3)); // positions locales
    g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3)); // normales
    g.setAttribute('color', new THREE.BufferAttribute(d.colors, 3)); // couleurs
    g.setIndex(new THREE.BufferAttribute(d.indices, 1)); // triangles
    const half = CHUNK_SIZE / 2; // demi-côté
    const hy = (d.maxY - d.minY) / 2; // demi-hauteur
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(half, (d.minY + d.maxY) / 2, half), Math.sqrt(2 * half * half + hy * hy) + 1); // sphère englobante (évite un calcul coûteux)
    const mesh = new THREE.Mesh(g, this.material);
    mesh.position.set(d.cx * CHUNK_SIZE, 0, d.cz * CHUNK_SIZE); // placé dans le monde
    mesh.matrixAutoUpdate = false; // la tuile ne bouge jamais
    mesh.updateMatrix();
    mesh.castShadow = d.lod <= 1; // seules les tuiles proches projettent des ombres
    mesh.receiveShadow = true; // toutes en reçoivent
    return mesh;
  }

  // Retire l'objet 3D d'une tuile et libère sa mémoire.
  private removeMesh(e: Entry): void {
    if (!e.mesh) return;
    this.scene.remove(e.mesh);
    e.mesh.geometry.dispose(); // libère la mémoire de la carte graphique
    e.mesh = null;
    e.lod = -1;
  }

  // Signale un problème une seule fois.
  private reportError(message: string): void {
    if (this.errorReported) return;
    this.errorReported = true;
    this.onError(message);
  }
}
