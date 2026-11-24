// Gouttes de pluie sur la « lunette » (l'écran) : de petits « ploc » légers qui s'étalent et disparaissent vite.
// Logique pure (apparition, vie, glissement) ; le dessin est dans src/render/lensDrops.ts.

export interface LensDrop {
  x: number; // position horizontale, de 0 (gauche) à 1 (droite)
  y: number; // position verticale, de 0 (haut) à 1 (bas)
  r: number; // rayon, en part de la hauteur de l'écran
  age: number; // âge (s)
  life: number; // durée de vie (s)
  slide: number; // glissement vers le bas (part de la hauteur par seconde)
  seed: number; // graine pour les petites éclaboussures autour (0 à 1)
}

export const MAX_DROPS = 28; // nombre maximal de gouttes affichées en même temps
export const IMPACT = 0.12; // durée du « ploc » (s) : la goutte s'écrase puis s'étale

// Gouttes qui apparaissent par seconde selon l'intensité de la pluie (0 à 1) : rien sous la bruine très légère.
export const dropRate = (rain: number): number => (rain < 0.08 ? 0 : 0.5 + 5 * Math.min(1, rain));

// Fait vieillir les gouttes, les fait glisser un peu, retire les mortes, et en fait apparaître de nouvelles.
// `carry` = reste fractionnaire d'apparition d'une image à l'autre ; renvoie le nouveau reste.
export function stepDrops(drops: LensDrop[], dt: number, rain: number, carry: number, rnd: () => number): number {
  for (const d of drops) {
    d.age += dt;
    d.y += d.slide * dt * Math.min(1, d.age / d.life + 0.3); // les grosses gouttes se mettent à couler
  }
  for (let i = drops.length - 1; i >= 0; i--) if (drops[i]!.age >= drops[i]!.life) drops.splice(i, 1); // les gouttes finies disparaissent
  let c = carry + dropRate(rain) * Math.min(dt, 0.25);
  while (c >= 1) {
    c -= 1;
    if (drops.length >= MAX_DROPS) continue; // trop de gouttes : on n'en ajoute pas
    const big = rnd() < 0.18; // quelques grosses
    drops.push({
      x: 0.03 + rnd() * 0.94,
      y: 0.03 + rnd() * 0.8,
      r: big ? 0.016 + rnd() * 0.008 : 0.007 + rnd() * 0.006,
      age: 0,
      life: big ? 1.3 + rnd() * 0.7 : 0.7 + rnd() * 0.6,
      slide: big ? 0.02 + rnd() * 0.04 : rnd() * 0.012,
      seed: rnd(),
    });
  }
  return c;
}

// Opacité d'une goutte (0 à 1) : apparaît d'un coup (ploc), reste un instant, s'efface en douceur.
export function dropAlpha(age: number, life: number): number {
  if (age < 0 || age >= life) return 0;
  const attack = Math.min(1, age / 0.04); // montée très rapide
  const fade = Math.min(1, (life - age) / (life * 0.55)); // le dernier gros tiers de la vie : on s'efface
  return attack * smooth(fade); // courbe douce
}
const smooth = (t: number): number => t * t * (3 - 2 * t);

// Échelle de la goutte pendant le « ploc » : elle part petite et s'étale en un instant, puis reste stable.
export function dropScale(age: number): number {
  if (age >= IMPACT) return 1;
  const t = age / IMPACT;
  return 0.55 + 0.45 * (1 - (1 - t) * (1 - t)); // 0,55 → 1 en décélérant
}
