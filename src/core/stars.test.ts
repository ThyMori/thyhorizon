// Tests des étoiles : catalogue réel, couleurs, éclat, tableaux pour la carte graphique.
import { describe, expect, it } from 'vitest';
import catalog from '../data/stars.json';
import { StarRow, buildStarBuffers, starBrightness, starColor, starSize } from './stars';

const stars = catalog.stars as unknown as StarRow[]; // le JSON est typé en listes de nombres : on précise qu'il s'agit de lignes de 4 valeurs

describe('catalogue', () => {
  it('contient plus de 5 000 vraies étoiles jusqu\'à la magnitude 6', () => {
    expect(stars.length).toBeGreaterThan(5000);
    expect(Math.max(...stars.map((s) => s[2]))).toBeLessThanOrEqual(6.01);
  });
  it('commence par Sirius, l\'étoile la plus brillante du ciel', () => {
    expect(stars[0]![2]).toBeCloseTo(-1.44, 2);
    expect(stars[0]![0]).toBeCloseTo(101.29, 1); // ascension droite de Sirius
    expect(stars[0]![1]).toBeCloseTo(-16.72, 1); // déclinaison de Sirius
  });
  it('contient la Polaire près du pôle nord céleste', () => {
    expect(stars.some((s) => s[1] > 89 && s[2] < 2.1)).toBe(true);
  });
  it('a des valeurs valides partout', () => {
    for (const s of stars) {
      expect(s.every(Number.isFinite)).toBe(true);
      expect(s[0]).toBeGreaterThanOrEqual(0);
      expect(s[0]).toBeLessThan(360);
      expect(Math.abs(s[1])).toBeLessThanOrEqual(90);
    }
  });
});

describe('couleur', () => {
  it('va du bleu au rouge selon l\'indice B-V', () => {
    const blue = starColor(-0.3);
    const sunlike = starColor(0.65);
    const red = starColor(1.8);
    expect(blue[2]).toBeGreaterThan(blue[0]); // bleutée
    expect(red[0]).toBeGreaterThan(red[2]); // rougeâtre
    expect(sunlike[0]).toBeGreaterThan(sunlike[2]); // chaude
  });
  it('reste valide hors des bornes', () => {
    for (const bv of [-5, 0.3, 9]) expect(starColor(bv).every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('éclat et taille', () => {
  it('augmentent avec la brillance', () => {
    expect(starBrightness(-1.4)).toBeCloseTo(1, 9);
    expect(starBrightness(6)).toBeLessThan(0.3);
    expect(starBrightness(2)).toBeGreaterThan(starBrightness(4));
    expect(starSize(-1.4)).toBeGreaterThan(starSize(2));
    expect(starSize(2)).toBeGreaterThan(starSize(6));
  });
});

describe('tableaux pour la carte graphique', () => {
  it('placent les étoiles sur une sphère de rayon donné', () => {
    const b = buildStarBuffers(stars, 2500);
    expect(b.positions.length).toBe(stars.length * 3);
    for (let i = 0; i < 50; i++) expect(Math.hypot(b.positions[i * 3]!, b.positions[i * 3 + 1]!, b.positions[i * 3 + 2]!)).toBeCloseTo(2500, 1);
    expect(b.positions[2]).toBeLessThan(0); // Sirius est dans l'hémisphère céleste sud (Z < 0)
    expect(b.sizes.length).toBe(stars.length);
    expect(b.brightness[0]).toBeCloseTo(1, 9);
  });
});
