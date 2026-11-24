// Fabrique src/data/cities.bin : les villes du monde de 5 000 habitants et plus (nom, position, population, pays).
// Source : GeoNames (https://www.geonames.org, licence CC BY 4.0), reprise sans changement depuis le fichier cities.pbf du paquet npm « all-the-cities » (MIT).
// Usage : node scripts/build-cities.mjs chemin/vers/cities.pbf [seuil]   (seuil par défaut : 5000 habitants)
// Le fichier .pbf est un flux de messages « protobuf » : on le lit ici avec un petit décodeur à nous (on n'exécute aucun code téléchargé).
// Format de cities.bin (petit-boutiste) : « THPL », n (uint32), puis n × [lat×1e4 int32, lon×1e4 int32, population uint32, pays 2 octets, décalage du nom uint32], puis les noms en UTF-8 séparés par un octet 0.
import { readFileSync, writeFileSync } from 'node:fs'; // lecture / écriture de fichiers

const input = process.argv[2]; // fichier source
const threshold = Number(process.argv[3] ?? 5000); // population minimale
if (!input) {
  console.error('Usage : node scripts/build-cities.mjs chemin/vers/cities.pbf [seuil]');
  process.exit(1);
}
const buf = readFileSync(input); // tout le fichier
let pos = 0; // position de lecture

// Lit un entier « varint » (7 bits par octet, le bit de poids fort dit « il y a une suite »). Renvoie un nombre (jusqu'à 2^53).
function varint() {
  let result = 0; // valeur en cours
  let mul = 1; // poids de l'octet en cours
  for (;;) {
    const b = buf[pos++]; // octet suivant
    result += (b & 0x7f) * mul; // ajoute ses 7 bits
    if (b < 0x80) return result; // dernier octet
    mul *= 128; // octet suivant : poids ×128
  }
}
// Entier signé « zigzag » : 0,−1,1,−2,2… sont codés 0,1,2,3,4…
function svarint() {
  const n = varint(); // valeur codée
  return n % 2 === 1 ? -(n + 1) / 2 : n / 2; // décodage zigzag
}

const places = []; // villes retenues
let lastLat = 0; // les positions sont codées en différence avec la ville précédente
let lastLon = 0;
let total = 0; // toutes les villes lues
while (pos < buf.length) {
  const len = varint(); // taille du message de cette ville
  const end = pos + len; // fin du message
  const c = { name: '', country: '', pop: 0, lat: 0, lon: 0 }; // la ville en cours
  while (pos < end) {
    const key = varint(); // numéro de champ + type
    const tag = key >> 3; // numéro de champ
    const type = key & 7; // type : 0 = entier, 2 = texte
    if (type === 2) {
      const n = varint(); // longueur du texte
      const text = buf.toString('utf8', pos, pos + n); // le texte
      pos += n;
      if (tag === 2) c.name = text; // nom
      else if (tag === 3) c.country = text; // pays (code à 2 lettres)
    } else if (type === 0) {
      if (tag === 9) c.pop = varint(); // population
      else if (tag === 10) { lastLon += svarint(); c.lon = lastLon / 1e5; } // longitude
      else if (tag === 11) { lastLat += svarint(); c.lat = lastLat / 1e5; } // latitude
      else varint(); // champ numérique qui ne nous sert pas
    } else throw new Error(`Type inattendu ${type} à l'octet ${pos}`);
  }
  total++;
  if (c.pop >= threshold && c.name && /^[A-Z]{2}$/.test(c.country)) places.push(c); // on garde les villes assez grandes
}
places.sort((a, b) => a.lat - b.lat || a.lon - b.lon); // tri du sud au nord : même fichier à chaque fabrication
const names = places.map((p) => Buffer.from(p.name.replace(/\0/g, ''), 'utf8')); // noms en octets
const nameBytes = names.reduce((s, n) => s + n.length + 1, 0); // taille de la zone des noms
const out = Buffer.alloc(8 + places.length * 18 + nameBytes); // fichier final
out.write('THPL', 0, 'ascii'); // signature
out.writeUInt32LE(places.length, 4); // nombre de villes
let off = 8; // position d'écriture
let nameOff = 0; // décalage du nom courant dans la zone des noms
places.forEach((p, i) => {
  out.writeInt32LE(Math.round(p.lat * 1e4), off); // latitude ×10 000
  out.writeInt32LE(Math.round(p.lon * 1e4), off + 4); // longitude ×10 000
  out.writeUInt32LE(p.pop, off + 8); // population
  out.write(p.country, off + 12, 'ascii'); // pays
  out.writeUInt32LE(nameOff, off + 14); // où est son nom
  off += 18;
  nameOff += names[i].length + 1; // le nom suivant commence après l'octet 0
});
for (const n of names) { // zone des noms
  n.copy(out, off);
  off += n.length;
  out[off++] = 0; // séparateur
}
writeFileSync(new URL('../src/data/cities.bin', import.meta.url), out); // écriture
console.log(`${total} villes lues, ${places.length} retenues (≥ ${threshold} hab.), ${(out.length / 1024).toFixed(0)} Ko`);
