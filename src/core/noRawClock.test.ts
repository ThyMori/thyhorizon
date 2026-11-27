// Garde-fou de la règle « une seule horloge » (1.45) : aucun fichier du jeu, à part core/worldClock.ts, ne lit l'heure de l'ordinateur.
// On cherche `Date.now(` et `new Date()` (sans argument) dans tout src/. `new Date(valeur)` reste permis : c'est du calcul de calendrier,
// pas une lecture de l'heure. `performance.now()` est un chronomètre d'image, pas une heure : permis aussi.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Fichiers autorisés à lire l'heure réelle, et pourquoi.
const ALLOWED = new Map<string, string>([
  ['core/worldClock.ts', 'c\'est LA source'],
  ['pwa/install.ts', 'rappel d\'installation : durées réelles sur l\'appareil, sans lien avec le monde'],
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
  }
  return out;
}

describe('une seule horloge', () => {
  const root = join(process.cwd(), 'src');
  const files = sourceFiles(root);

  it('trouve bien les fichiers du jeu (le test ne tourne pas à vide)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('personne d\'autre que l\'horloge du monde ne lit l\'heure de l\'ordinateur', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = f.slice(root.length + 1).replaceAll('\\', '/');
      if (ALLOWED.has(rel)) continue;
      const code = readFileSync(f, 'utf-8')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, '')) // les commentaires peuvent citer ces mots
        .join('\n');
      if (/Date\.now\s*\(/.test(code) || /new Date\s*\(\s*\)/.test(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]); // la liste doit être vide : sinon, passer par worldClock
  });
});
