// Fabrique src/data/stars.json à partir du catalogue d'étoiles du paquet npm « d3-celestial » (données Hipparcos, licence BSD-3).
// Usage : node scripts/build-stars.mjs chemin/vers/stars.6.json
// Résultat : une liste compacte [ascension droite (°), déclinaison (°), magnitude, indice de couleur B-V] par étoile.
import { readFileSync, writeFileSync } from 'node:fs'; // lecture / écriture de fichiers

const input = process.argv[2]; // fichier source
if (!input) {
  console.error('Usage : node scripts/build-stars.mjs chemin/vers/stars.6.json');
  process.exit(1);
}
const features = JSON.parse(readFileSync(input, 'utf8')).features; // une entrée par étoile
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d; // arrondi à d décimales (fichier plus léger)
const stars = features
  .map((f) => {
    const [lon, dec] = f.geometry.coordinates; // le catalogue donne l'ascension droite en −180..180
    const bv = Number.parseFloat(f.properties.bv); // indice de couleur (peut être vide)
    return [round((lon + 360) % 360, 3), round(dec, 3), round(f.properties.mag, 2), Number.isFinite(bv) ? round(bv, 2) : 0.6]; // sans couleur : blanc-jaune du Soleil
  })
  .sort((a, b) => a[2] - b[2]); // les plus brillantes d'abord
writeFileSync('src/data/stars.json', JSON.stringify({ source: 'Hipparcos via d3-celestial (BSD-3-Clause)', fields: ['ra_deg', 'dec_deg', 'mag', 'bv'], stars }) + '\n');
console.log(`${stars.length} étoiles écrites dans src/data/stars.json`);
