// Fabrique src/data/relief.bin : le relief réel de la Terre (altitudes et profondeurs) en basse résolution, pour le monde du jeu.
// Source : ETOPO (NOAA / NCEI, domaine public) en grille de 10 minutes d'arc, telle que publiée au format VTP par pyvista/vtk-data :
//   https://raw.githubusercontent.com/pyvista/vtk-data/master/Data/EarthModels/ETOPO_10min_Ice.vtp
// Usage : node scripts/build-relief.mjs chemin/vers/ETOPO_10min_Ice.vtp
// Format du fichier produit (voir src/core/relief.ts) :
//   16 octets d'en-tête : « THRL », largeur (u16), hauteur (u16), mètres par unité (u16), réservé (u16), puis 2 octets de remplissage ;
//   puis les altitudes (int16, en unités), ligne par ligne du nord (90°) au sud (−90°), colonne 0 = longitude 0° vers l'est,
//   codées en différence avec la case de gauche, puis compressées (zlib).
import { readFileSync, writeFileSync } from 'node:fs'; // lecture / écriture de fichiers
import { deflateSync, inflateSync } from 'node:zlib'; // compression

const input = process.argv[2]; // fichier source
if (!input) {
  console.error('Usage : node scripts/build-relief.mjs chemin/vers/ETOPO_10min_Ice.vtp');
  process.exit(1);
}

const METERS_PER_UNIT = 4; // précision : 4 m (suffisant : le détail est inventé par-dessus)
const MIN_M = -200; // on ne garde pas les abysses : sous 200 m de fond, l'eau est opaque de toute façon
const MAX_M = 6600; // un peu plus que le maximum de la grille (6 527 m, lissé par la basse résolution)

const file = readFileSync(input); // contenu du VTP
const start = file.indexOf('_', file.indexOf('<AppendedData')) + 1; // début des données ajoutées (encodées en base64)

// Lit un tableau du VTP (compressé zlib par blocs, encodé en base64) à la position « offset ».
function readArray(offset, bytesPerValue, count) {
  let p = start + offset;
  const head = Buffer.from(file.subarray(p, p + 16).toString('latin1'), 'base64'); // nombre de blocs, taille de bloc, dernier bloc
  const blocks = head.readUInt32LE(0);
  const headLen = 12 + 4 * blocks; // longueur de l'en-tête en octets
  const headChars = Math.ceil(headLen / 3) * 4; // et en caractères base64
  const header = Buffer.from(file.subarray(p, p + headChars).toString('latin1'), 'base64');
  const sizes = Array.from({ length: blocks }, (_, i) => header.readUInt32LE(12 + 4 * i)); // taille compressée de chaque bloc
  p += headChars;
  const total = sizes.reduce((a, b) => a + b, 0);
  const packed = Buffer.from(file.subarray(p, p + Math.ceil(total / 3) * 4).toString('latin1'), 'base64'); // données compressées
  const parts = [];
  let q = 0;
  for (const s of sizes) {
    parts.push(inflateSync(packed.subarray(q, q + s)));
    q += s;
  }
  const out = Buffer.concat(parts);
  if (out.length !== bytesPerValue * count) throw new Error(`Tableau inattendu : ${out.length} octets au lieu de ${bytesPerValue * count}`);
  return out;
}

const COLS = 2161; // 0° à 360° inclus (la dernière colonne répète la première)
const ROWS = 1081; // 90° à −90°
const raw = readArray(0, 4, COLS * ROWS); // altitudes en flottants 32 bits
const width = COLS - 1; // on retire la colonne en double : le monde se referme sur lui-même
const values = new Int16Array(width * ROWS);
for (let j = 0; j < ROWS; j++) {
  for (let i = 0; i < width; i++) {
    const m = Math.min(MAX_M, Math.max(MIN_M, raw.readFloatLE(4 * (j * COLS + i)))); // altitude en mètres, bornée
    values[j * width + i] = Math.round(m / METERS_PER_UNIT);
  }
}

// Différences avec la case de gauche (bien plus compressibles).
const deltas = new Int16Array(values.length);
for (let j = 0; j < ROWS; j++) for (let i = 0; i < width; i++) deltas[j * width + i] = values[j * width + i] - (i === 0 ? 0 : values[j * width + i - 1]);
const packed = deflateSync(Buffer.from(deltas.buffer), { level: 9 });

const header = Buffer.alloc(16);
header.write('THRL', 0, 'latin1'); // signature
header.writeUInt16LE(width, 4);
header.writeUInt16LE(ROWS, 6);
header.writeUInt16LE(METERS_PER_UNIT, 8);
writeFileSync('src/data/relief.bin', Buffer.concat([header, packed]));
console.log(`relief.bin : ${width} × ${ROWS} cases, ${((16 + packed.length) / 1e6).toFixed(2)} Mo`);
