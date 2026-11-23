// Fabrique src/data/climate.json : la classification climatique de Köppen-Geiger du monde, en grille de 0,5° (720 × 360).
// Source : cartes mondiales de Köppen-Geiger (Kottek et al. 2006, Rubel et al. 2017), copiées sans changement depuis le paquet npm « koppen-climate-lookup ».
// Usage : node scripts/build-climate.mjs chemin/vers/koppen.csv   (colonnes : Latitude,Longitude,KoppenClass ; terres seulement)
// Les cases de mer sont remplies avec la classe de la terre la plus proche (pour que les côtes aient un climat), puis la grille est compressée en séries (RLE).
import { readFileSync, writeFileSync } from 'node:fs'; // lecture / écriture de fichiers

const input = process.argv[2]; // fichier CSV source
if (!input) {
  console.error('Usage : node scripts/build-climate.mjs chemin/vers/koppen.csv');
  process.exit(1);
}
const W = 720; // colonnes : longitude −180° à 180° par 0,5°
const H = 360; // lignes : latitude 90° (nord, ligne 0) à −90° (sud) par 0,5°
const rows = readFileSync(input, 'utf8').trim().split('\n').slice(1).map((l) => l.split(',')); // lignes du CSV sans l'en-tête
const classes = [...new Set(rows.map((r) => r[2]))].sort(); // noms des classes, triés (leur numéro = leur place dans la liste)
const grid = new Int16Array(W * H).fill(-1); // −1 = mer (pas encore connu)
for (const [lat, lon, cls] of rows) {
  const j = Math.round((90 - Number(lat)) / 0.5 - 0.5); // ligne de la case
  const i = Math.round((Number(lon) + 180) / 0.5 - 0.5); // colonne de la case
  grid[j * W + i] = classes.indexOf(cls); // numéro de la classe
}
// Remplissage de la mer : on étend la terre case par case (vague) jusqu'à tout couvrir. La longitude se referme sur elle-même.
for (let pass = 0; pass < 200; pass++) {
  const next = grid.slice(); // copie : une vague ne se propage que d'une case à la fois
  let changed = 0; // cases remplies pendant cette vague
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      if (grid[j * W + i] !== -1) continue; // déjà connu
      const votes = new Map(); // classes voisines et leur nombre
      for (const [dj, di] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const jj = j + dj;
        if (jj < 0 || jj >= H) continue; // hors de la grille (pôles)
        const v = grid[jj * W + ((i + di + W) % W)]; // voisin
        if (v !== -1) votes.set(v, (votes.get(v) ?? 0) + 1);
      }
      if (votes.size === 0) continue; // pas de voisin connu : prochaine vague
      next[j * W + i] = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]; // la classe la plus fréquente (égalité : la plus petite)
      changed++;
    }
  }
  grid.set(next);
  if (changed === 0) break; // tout est rempli
}
if (grid.includes(-1)) throw new Error('des cases sont restées vides');
const rle = []; // série de couples [classe, longueur]
for (let k = 0; k < grid.length; ) {
  let run = 1; // longueur de la série en cours
  while (k + run < grid.length && grid[k + run] === grid[k]) run++;
  rle.push(grid[k], run);
  k += run;
}
writeFileSync('src/data/climate.json', JSON.stringify({ source: 'Köppen-Geiger, Kottek et al. 2006 / Rubel et al. 2017 (grille 0,5°)', width: W, height: H, classes, rle }) + '\n');
console.log(`${classes.length} classes, ${rle.length / 2} séries -> src/data/climate.json`);
