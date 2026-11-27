// Le fichier de sauvegarde (1.45) : exporter sa partie dans un fichier, la rouvrir plus tard ou ailleurs. Logique pure.
// Le navigateur peut vider son stockage : le fichier est la copie de secours. Tout ce qu'on lit dans un fichier passe par les mêmes
// nettoyages que le stockage (`sanitizeSave`, `sanitizeEdit`) : un fichier abîmé ou trafiqué ne peut pas casser le jeu.

import { SaveData, readSavedSeed, sanitizeSave } from './save';
import { Terrain } from './terrain';
import { MAX_EDITS, WorldEdit, sanitizeEdit } from './worldEdits';
import { readWorldVersion, worldVersionStatus } from './worldVersion';

export const SAVE_FILE_FORMAT = 'thyhorizon-save'; // reconnaît un fichier du jeu
export const SAVE_FILE_VERSION = 1; // version du FORMAT du fichier (monte si on change sa structure)
export const MAX_SAVE_FILE_CHARS = 20_000_000; // au-delà, on refuse de lire (20 000 constructions tiennent largement)

export interface SaveFile {
  format: typeof SAVE_FILE_FORMAT;
  formatVersion: number;
  exportedAt: number; // instant de l'export (ms, horloge du monde)
  gameVersion: string; // version du jeu qui a écrit le fichier (pour s'y retrouver)
  save: SaveData; // où l'on était
  edits: WorldEdit[]; // ce que le joueur a posé dans le monde
}

// Assemble le contenu d'un fichier de sauvegarde.
export function buildSaveFile(save: SaveData, edits: WorldEdit[], gameVersion: string, nowMs: number): SaveFile {
  return { format: SAVE_FILE_FORMAT, formatVersion: SAVE_FILE_VERSION, exportedAt: nowMs, gameVersion, save, edits };
}

// Le texte à écrire dans le fichier.
export const serializeSaveFile = (file: SaveFile): string => JSON.stringify(file);

// Nom de fichier proposé : thyhorizon-2026-11-27.json (date UTC de l'export).
export function saveFileName(nowMs: number): string {
  return `thyhorizon-${new Date(nowMs).toISOString().slice(0, 10)}.json`;
}

export type ParsedSaveFile =
  | { ok: true; save: SaveData; edits: WorldEdit[]; skipped: number; newerWorld: boolean; gameVersion: string; exportedAt: number }
  | { ok: false; error: string }; // error = phrase en français, prête à être affichée

// Lit un fichier de sauvegarde. `seed` = la graine du monde en cours : un fichier d'un autre monde est refusé.
export function parseSaveFile(text: string, terrain: Terrain, seed: string): ParsedSaveFile {
  if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'Le fichier est vide.' };
  if (text.length > MAX_SAVE_FILE_CHARS) return { ok: false, error: 'Le fichier est trop gros pour être une sauvegarde de ThyHorizon.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Ce fichier n\'est pas une sauvegarde de ThyHorizon (il n\'est pas lisible).' };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Ce fichier n\'est pas une sauvegarde de ThyHorizon.' };
  const r = raw as Record<string, unknown>;
  if (r.format !== SAVE_FILE_FORMAT) return { ok: false, error: 'Ce fichier n\'est pas une sauvegarde de ThyHorizon.' };
  if (typeof r.formatVersion !== 'number' || !Number.isInteger(r.formatVersion) || r.formatVersion < 1) return { ok: false, error: 'Ce fichier de sauvegarde est abîmé.' };
  if (r.formatVersion > SAVE_FILE_VERSION) return { ok: false, error: 'Ce fichier a été écrit par une version plus récente du jeu : mets le jeu à jour avant de l\'importer.' };
  if (typeof r.save !== 'object' || r.save === null) return { ok: false, error: 'Ce fichier de sauvegarde est abîmé (il manque la position).' };
  if (readSavedSeed(r.save) !== seed) return { ok: false, error: 'Cette sauvegarde vient d\'un autre monde (une autre graine) : elle ne peut pas être ouverte ici.' };
  const save = sanitizeSave(r.save, terrain, seed); // position valable, sinon départ sur la plage
  const rawEdits = Array.isArray(r.edits) ? r.edits : [];
  const edits: WorldEdit[] = [];
  const seen = new Set<string>();
  let skipped = 0; // entrées inutilisables, en double ou au-delà du plafond
  for (const item of rawEdits) {
    const e = sanitizeEdit(item);
    if (!e || seen.has(e.id) || edits.length >= MAX_EDITS) {
      skipped++;
      continue;
    }
    seen.add(e.id);
    edits.push(e);
  }
  return {
    ok: true,
    save,
    edits,
    skipped,
    newerWorld: worldVersionStatus(readWorldVersion(r.save)) === 'future', // faite avec un monde plus récent : lecture seule après l'import
    gameVersion: typeof r.gameVersion === 'string' ? r.gameVersion.slice(0, 20) : '?',
    exportedAt: typeof r.exportedAt === 'number' && Number.isFinite(r.exportedAt) ? r.exportedAt : 0,
  };
}
