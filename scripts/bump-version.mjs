// Script de version : met à jour d'un coup package.json, src/version.ts, public/sw.js (service worker) et CHANGELOG.md.
// Usage : npm run bump -- patch|minor|major "Description de la livraison"
//         npm run version:check   (vérifie que les quatre fichiers sont cohérents)
import { readFileSync, writeFileSync } from 'node:fs'; // lecture / écriture de fichiers

const PKG = 'package.json'; // fichier npm
const VER = 'src/version.ts'; // version affichée dans le jeu
const SW = 'public/sw.js'; // service worker : son numéro change à chaque version, ce qui déclenche la mise à jour chez les utilisateurs
const LOG = 'CHANGELOG.md'; // journal des versions

const pkg = JSON.parse(readFileSync(PKG, 'utf8')); // contenu de package.json
const fromTs = /VERSION = '(\d+\.\d+\.\d+)'/.exec(readFileSync(VER, 'utf8'))?.[1]; // version lue dans version.ts
const fromSw = /const VERSION = "(\d+\.\d+\.\d+)"/.exec(readFileSync(SW, 'utf8'))?.[1]; // version lue dans sw.js
const fromLog = /^## (\d+\.\d+\.\d+)/m.exec(existsLog() ? readFileSync(LOG, 'utf8') : '')?.[1]; // dernière version du journal

// Lit le journal s'il existe.
function existsLog() {
  try { readFileSync(LOG); return true; } catch { return false; }
}

const args = process.argv.slice(2);

if (args[0] === '--check') {
  // Mode contrôle : les numéros doivent être identiques (le journal peut être vide avant la 1re version).
  const ok = pkg.version === fromTs && pkg.version === fromSw && (fromLog === undefined || fromLog === pkg.version);
  console.log(ok ? `Versions cohérentes : ${pkg.version}` : `INCOHÉRENT : package.json=${pkg.version}, version.ts=${fromTs}, sw.js=${fromSw}, CHANGELOG=${fromLog}`);
  process.exit(ok ? 0 : 1);
}

const level = args[0]; // patch, minor ou major
const note = args.slice(1).join(' ').trim(); // description
if (!['patch', 'minor', 'major'].includes(level) || !note) {
  console.error('Usage : npm run bump -- patch|minor|major "Description"');
  process.exit(1);
}

let [x, y, z] = pkg.version.split('.').map(Number); // x.y.z actuel
if (level === 'major') { x += 1; y = 0; z = 0; } // changement majeur
else if (level === 'minor') { y += 1; z = 0; } // nouvelle fonction
else { z += 1; } // correction
const next = `${x}.${y}.${z}`; // nouvelle version

pkg.version = next; // mise à jour de package.json
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
writeFileSync(VER, readFileSync(VER, 'utf8').replace(/VERSION = '[^']*'/, `VERSION = '${next}'`)); // mise à jour de version.ts
writeFileSync(SW, readFileSync(SW, 'utf8').replace(/const VERSION = "[^"]*"/, `const VERSION = "${next}"`)); // mise à jour du service worker

const date = new Date().toISOString().slice(0, 10); // date du jour
const old = existsLog() ? readFileSync(LOG, 'utf8').replace(/^# Journal des versions\n+/, '') : ''; // anciennes entrées
writeFileSync(LOG, `# Journal des versions\n\n## ${next} — ${date}\n\n${note}\n\n${old}`); // nouvelle entrée en tête
console.log(`Version ${next} (${level})`);
