// Fabrique src/data/constellations.json : les traits qui relient les étoiles des 89 constellations (paquet npm « d3-celestial », licence BSD-3).
// Usage : node scripts/build-constellations.mjs chemin/vers/constellations.lines.json
// Résultat : une liste de segments [ascension droite 1 (°), déclinaison 1 (°), ascension droite 2 (°), déclinaison 2 (°)].
import { readFileSync, writeFileSync } from 'node:fs'; // lecture / écriture de fichiers

const input = process.argv[2]; // fichier source
if (!input) {
  console.error('Usage : node scripts/build-constellations.mjs chemin/vers/constellations.lines.json');
  process.exit(1);
}
const round = (v) => Math.round(v * 100) / 100; // arrondi à 2 décimales (fichier plus léger)
const ra = (lon) => round((lon + 360) % 360); // le catalogue donne l'ascension droite en −180..180
const segments = [];
for (const feature of JSON.parse(readFileSync(input, 'utf8')).features) {
  for (const line of feature.geometry.coordinates) {
    for (let i = 0; i + 1 < line.length; i++) segments.push([ra(line[i][0]), round(line[i][1]), ra(line[i + 1][0]), round(line[i + 1][1])]); // un trait par paire de points consécutifs
  }
}
writeFileSync('src/data/constellations.json', JSON.stringify({ source: 'd3-celestial (BSD-3-Clause), Olaf Frohn', fields: ['ra1_deg', 'dec1_deg', 'ra2_deg', 'dec2_deg'], segments }) + '\n');
console.log(`${segments.length} traits écrits dans src/data/constellations.json`);
