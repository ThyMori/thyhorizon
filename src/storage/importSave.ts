// Applique une sauvegarde importée : remplace les modifications du monde dans le stockage durable, puis la position.
// L'ordre compte : on écrit d'abord les modifications, et la position en dernier. Si quelque chose échoue en route,
// la position ancienne reste celle du stockage et l'erreur remonte (rien n'est dit « importé » à tort).

import { SaveData } from '../core/save';
import { WorldEdit } from '../core/worldEdits';
import { EditsPersistence } from './editsDb';

export async function applyImport(db: EditsPersistence, edits: WorldEdit[], save: SaveData, writeSave: (s: SaveData) => void): Promise<void> {
  if (!db.persistent) throw new Error('Le stockage du navigateur est indisponible : l\'import ne survivrait pas au rechargement.');
  await db.clear(); // on remplace : l'ancienne partie disparaît
  for (const e of edits) await db.put(e); // une par une : une erreur s'arrête ici, avant d'écrire la position
  writeSave(save);
}
