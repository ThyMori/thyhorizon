// Tests du bruit et de la graine : le monde doit être reproductible et bien borné.
import { describe, expect, it } from 'vitest';
import { Noise2D, fbm, hashSeed, mulberry32 } from './noise';

describe('mulberry32', () => {
  it('donne la même suite pour la même graine', () => {
    const a = mulberry32(42); // premier générateur
    const b = mulberry32(42); // second générateur, même graine
    expect([a(), a(), a()]).toEqual([b(), b(), b()]); // mêmes valeurs
  });
  it('reste dans [0 ; 1[', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('hashSeed', () => {
  it('est stable et différencie les textes', () => {
    expect(hashSeed('horizon')).toBe(hashSeed('horizon'));
    expect(hashSeed('horizon')).not.toBe(hashSeed('horizoN'));
  });
});

describe('Noise2D', () => {
  it('est déterministe', () => {
    expect(new Noise2D(1).noise(12.3, -4.5)).toBe(new Noise2D(1).noise(12.3, -4.5));
  });
  it('change avec la graine', () => {
    expect(new Noise2D(1).noise(12.3, 4.5)).not.toBe(new Noise2D(2).noise(12.3, 4.5));
  });
  it('reste borné et continu (pas de saut brutal)', () => {
    const n = new Noise2D(5);
    let prev = n.noise(0, 0);
    for (let i = 1; i < 2000; i++) {
      const v = n.noise(i * 0.01, i * 0.007);
      expect(Math.abs(v)).toBeLessThanOrEqual(1.05); // borne théorique ~1
      expect(Math.abs(v - prev)).toBeLessThan(0.1); // pas de discontinuité
      prev = v;
    }
  });
  it('fonctionne avec de grandes coordonnées négatives', () => {
    const n = new Noise2D(9);
    expect(Number.isFinite(n.noise(-123456.7, -98765.4))).toBe(true);
  });
});

describe('fbm', () => {
  it('reste dans ~[-1 ; 1]', () => {
    const n = new Noise2D(3);
    for (let i = 0; i < 500; i++) {
      expect(Math.abs(fbm(n, i * 0.37, i * 0.11, 4))).toBeLessThanOrEqual(1.05);
    }
  });
});
