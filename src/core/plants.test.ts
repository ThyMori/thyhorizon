// Tests de la plantation : croissance selon le temps écoulé (avance rapide simulée), textes, règles de place.
import { describe, expect, it } from 'vitest';
import { DAY_MS, MAX_PLANTS, PLANTS, PLANT_SPECIES, SEED_FRACTION, formatAge, formatSpan, growth, plantBlockedBy, plantHeight, plantInfo, plantStage } from './plants';
import { EditStore, sanitizeEdit } from './worldEdits';

const T0 = Date.UTC(2026, 10, 27, 12); // jour de plantation

describe('croissance', () => {
  it('commence à 0, finit à 1 et ne dépasse jamais 1', () => {
    for (const sp of PLANT_SPECIES) {
      expect(growth(sp, T0, T0)).toBe(0);
      expect(growth(sp, T0, T0 + PLANTS[sp].growMs)).toBe(1);
      expect(growth(sp, T0, T0 + PLANTS[sp].growMs * 50)).toBe(1);
    }
  });

  it('suit les durées voulues : carotte 4 j, tournesol 14 j, noisetier 60 j, chêne 1 an', () => {
    expect(PLANTS.carrot.growMs).toBe(4 * DAY_MS);
    expect(PLANTS.sunflower.growMs).toBe(14 * DAY_MS);
    expect(PLANTS.hazel.growMs).toBe(60 * DAY_MS);
    expect(PLANTS.oak.growMs).toBe(365 * DAY_MS);
  });

  it('avance rapide : une carotte est adulte après 4 jours, un chêne seulement à demi après 6 mois', () => {
    expect(growth('carrot', T0, T0 + 4 * DAY_MS)).toBe(1);
    expect(growth('carrot', T0, T0 + 2 * DAY_MS)).toBeCloseTo(0.5, 9);
    expect(growth('oak', T0, T0 + 182.5 * DAY_MS)).toBeCloseTo(0.5, 9);
  });

  it('une date de plantation dans le futur (horloge reculée) ou invalide donne 0, jamais négatif', () => {
    expect(growth('oak', T0 + DAY_MS, T0)).toBe(0);
    expect(growth('oak', NaN, T0)).toBe(0);
  });

  it('la hauteur grandit sans jamais baisser, de la graine à la taille adulte', () => {
    for (const sp of PLANT_SPECIES) {
      let prev = -1;
      for (let i = 0; i <= 100; i++) {
        const h = plantHeight(sp, i / 100);
        expect(h).toBeGreaterThanOrEqual(prev);
        prev = h;
      }
      expect(plantHeight(sp, 0)).toBeCloseTo(PLANTS[sp].adultHeight * SEED_FRACTION, 9);
      expect(plantHeight(sp, 1)).toBeCloseTo(PLANTS[sp].adultHeight, 9);
      expect(plantHeight(sp, 7)).toBeCloseTo(PLANTS[sp].adultHeight, 9); // borné
      expect(plantHeight(sp, -3)).toBeCloseTo(PLANTS[sp].adultHeight * SEED_FRACTION, 9);
    }
  });

  it('les étapes se suivent', () => {
    expect([0, 0.1, 0.5, 1].map(plantStage)).toEqual(['juste planté', 'pousse', 'en croissance', 'adulte']);
  });
});

describe('textes', () => {
  it('dit depuis combien de temps, en français', () => {
    expect(formatAge(10 * 1000)).toBe('à l\'instant');
    expect(formatAge(5 * 60000)).toBe('il y a 5 minutes');
    expect(formatAge(60000 * 61)).toBe('il y a 1 heure');
    expect(formatAge(3 * 3600000)).toBe('il y a 3 heures');
    expect(formatAge(DAY_MS * 1.5)).toBe('il y a 1 jour');
    expect(formatAge(DAY_MS * 9)).toBe('il y a 9 jours');
    expect(formatAge(DAY_MS * 21)).toBe('il y a 3 semaines');
    expect(formatAge(DAY_MS * 95)).toBe('il y a 3 mois');
    expect(formatAge(DAY_MS * 800)).toBe('il y a 2 ans');
    expect(formatAge(NaN)).toBe('à l\'instant');
  });

  it('dit en combien de temps une plante devient adulte', () => {
    expect(PLANT_SPECIES.map((sp) => formatSpan(PLANTS[sp].growMs))).toEqual(['4 jours', '2 semaines', '2 mois', '1 an']);
    expect(formatSpan(DAY_MS)).toBe('1 jour');
  });

  it('accorde « planté » et « plantée » et donne le pourcentage sans arrondir vers le haut', () => {
    expect(plantInfo('carrot', T0, T0 + 2 * DAY_MS)).toContain('Carotte plantée il y a 2 jours');
    expect(plantInfo('carrot', T0, T0 + 2 * DAY_MS)).toContain('50 %');
    expect(plantInfo('oak', T0, T0 + DAY_MS)).toContain('Chêne planté il y a 1 jour');
    expect(plantInfo('carrot', T0, T0 + 4 * DAY_MS - 1000)).toContain('99 %'); // pas 100 % tant qu'elle n'est pas adulte
    expect(plantInfo('carrot', T0, T0 + 5 * DAY_MS)).toContain('adulte');
  });

  it('donne la taille en centimètres puis en mètres', () => {
    expect(plantInfo('carrot', T0, T0)).toMatch(/\(1 cm\)/); // 0,35 × 0,04 ≈ 1 cm
    expect(plantInfo('oak', T0, T0 + 365 * DAY_MS)).toContain('(8,0 m)');
  });
});

describe('où planter', () => {
  const place = (list: { type: 'cairn' | 'plant'; x: number; species?: 'carrot' | 'oak' }[]) => {
    const s = new EditStore();
    for (const [i, e] of list.entries()) s.add(e.type, e.x, 0, 0, T0 + i, () => 0.5 + i / 100, 'moi', e.species);
    return s.all();
  };

  it('libre : rien autour', () => expect(plantBlockedBy([], 0, 0, 'oak')).toBeNull());

  it('refuse trop près d\'un autre plant, selon la plus grande distance des deux espèces', () => {
    const others = place([{ type: 'plant', x: 0, species: 'oak' }]); // un chêne : 3 m de place
    expect(plantBlockedBy(others, 2, 0, 'carrot')).toContain('Trop près');
    expect(plantBlockedBy(others, 3.1, 0, 'carrot')).toBeNull();
    const carrots = place([{ type: 'plant', x: 0, species: 'carrot' }]);
    expect(plantBlockedBy(carrots, 0.3, 0, 'carrot')).toContain('Trop près');
    expect(plantBlockedBy(carrots, 0.5, 0, 'carrot')).toBeNull(); // deux carottes à 50 cm : ça passe
  });

  it('refuse sur un cairn (à moins de 0,8 m)', () => {
    const others = place([{ type: 'cairn', x: 0 }]);
    expect(plantBlockedBy(others, 0.5, 0, 'carrot')).toContain('construction');
    expect(plantBlockedBy(others, 1, 0, 'carrot')).toBeNull();
  });

  it('refuse au-delà du plafond de plantes', () => {
    const fake = Array.from({ length: MAX_PLANTS }, (_, i) => ({ id: `p${i}`, type: 'plant' as const, x: 1000 + i * 10, z: 0, yaw: 0, t: 0, author: 'moi', worldVersion: 1, species: 'carrot' as const }));
    expect(plantBlockedBy(fake, 0, 0, 'carrot')).toContain('beaucoup');
  });
});

describe('plantes dans les modifications du monde', () => {
  const base = { id: 'p1', type: 'plant', x: 1, z: 2, yaw: 0, t: T0, worldVersion: 1 };

  it('garde l\'espèce d\'une plante et son auteur', () => {
    const e = sanitizeEdit({ ...base, species: 'hazel' })!;
    expect(e.species).toBe('hazel');
    expect(e.author).toBe('moi');
    expect(e.t).toBe(T0); // la date de plantation
  });

  it('refuse une plante sans espèce ou d\'une espèce inconnue', () => {
    expect(sanitizeEdit(base)).toBeNull();
    expect(sanitizeEdit({ ...base, species: 'baobab' })).toBeNull();
    expect(sanitizeEdit({ ...base, species: 5 })).toBeNull();
  });

  it('un cairn n\'a pas d\'espèce, même si le fichier en contient une', () => {
    const e = sanitizeEdit({ ...base, type: 'cairn', species: 'oak' })!;
    expect(e.species).toBeUndefined();
  });

  it('EditStore.add enregistre l\'espèce et la date de plantation', () => {
    const s = new EditStore();
    const e = s.add('plant', 5, 5, 0, T0, undefined, 'moi', 'sunflower')!;
    expect(e.species).toBe('sunflower');
    expect(e.t).toBe(T0);
    expect(growth(e.species!, e.t, T0 + 7 * DAY_MS)).toBeCloseTo(0.5, 9); // tournesol : mi-croissance au bout d'une semaine
  });
});
