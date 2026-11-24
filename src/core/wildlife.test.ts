// Tests de la vie sauvage sonore : les bons animaux, aux bonnes heures, dans les bons milieux.
import { describe, expect, it } from 'vitest';
import { LifeInput, lifeMix, warmth, wetness } from './wildlife';

const SUMMER = 196; // mi-juillet
const BASE: LifeInput = { cls: 'Cfb', lat: 48.7, day: SUMMER, sunElevation: 40, hours: 13, forest: 0.55, conifer: 0.1, land: true, snowy: false, shore: 0, rain: 0, wind: 2 };

describe('chaleur et humidité', () => {
  it('tropical chaud, polaire froid', () => {
    expect(warmth('Af', 0, SUMMER)).toBeGreaterThan(0.8);
    expect(warmth('EF', 80, SUMMER)).toBeLessThan(0.25);
  });
  it('les climats tempérés suivent la saison (inversée dans l’hémisphère sud)', () => {
    expect(warmth('Cfb', 48, SUMMER)).toBeGreaterThan(warmth('Cfb', 48, 15));
    expect(warmth('Cfb', -40, SUMMER)).toBeLessThan(warmth('Cfb', -40, 15));
  });
  it('désert sec, forêt humide', () => expect(wetness('Af')).toBeGreaterThan(wetness('BWh')));
});

describe('oiseaux', () => {
  it('chœur de l’aube > journée > nuit', () => {
    const dawn = lifeMix({ ...BASE, sunElevation: 3, hours: 6 }).birds;
    const noon = lifeMix(BASE).birds;
    const night = lifeMix({ ...BASE, sunElevation: -30, hours: 1 }).birds;
    expect(dawn).toBeGreaterThan(noon);
    expect(noon).toBeGreaterThan(0);
    expect(night).toBe(0);
  });
  it('se taisent sous la pluie forte, dans la tempête, sur l’eau, sur la neige', () => {
    expect(lifeMix({ ...BASE, rain: 1 }).birds).toBe(0);
    expect(lifeMix({ ...BASE, wind: 20 }).birds).toBe(0);
    expect(lifeMix({ ...BASE, land: false }).birds).toBe(0);
    expect(lifeMix({ ...BASE, snowy: true }).birds).toBe(0);
  });
  it('plus nombreux en forêt qu’en terrain nu', () => expect(lifeMix({ ...BASE, forest: 0.9 }).birds).toBeGreaterThan(lifeMix({ ...BASE, forest: 0.02, cls: 'BWh' }).birds));
  it('absents en plein hiver continental glacial', () => expect(lifeMix({ ...BASE, cls: 'Dfc', lat: 62, day: 15 }).birds).toBe(0));
});

describe('insectes et amphibiens', () => {
  const NIGHT: Partial<LifeInput> = { sunElevation: -25, hours: 23 };
  it('grillons : nuit chaude seulement', () => {
    expect(lifeMix({ ...BASE, ...NIGHT, cls: 'Csa', lat: 40 }).crickets.gain).toBeGreaterThan(0.1);
    expect(lifeMix({ ...BASE, cls: 'Csa', lat: 40 }).crickets.gain).toBe(0); // plein jour
    expect(lifeMix({ ...BASE, ...NIGHT, day: 15 }).crickets.gain).toBe(0); // nuit d’hiver
    expect(lifeMix({ ...BASE, ...NIGHT, cls: 'Csa', lat: 40, rain: 1 }).crickets.gain).toBe(0);
  });
  it('cigales : grosse chaleur sèche, en journée', () => {
    expect(lifeMix({ ...BASE, cls: 'Csa', lat: 40, sunElevation: 60 }).cicadas).toBeGreaterThan(0.05);
    expect(lifeMix({ ...BASE, cls: 'Csa', lat: 40, sunElevation: -30 }).cicadas).toBe(0);
    expect(lifeMix({ ...BASE, cls: 'Cfb', sunElevation: 60 }).cicadas).toBe(0);
  });
  it('grenouilles : humide, tiède, la nuit, de préférence près de l’eau', () => {
    const f = (o: Partial<LifeInput>): number => lifeMix({ ...BASE, ...NIGHT, cls: 'Cfa', lat: 35, ...o }).frogs;
    expect(f({ shore: 0.5 })).toBeGreaterThan(f({ shore: 0 }));
    expect(f({})).toBeGreaterThan(0);
    expect(lifeMix({ ...BASE, ...NIGHT, cls: 'BWh', lat: 25 }).frogs).toBe(0);
    expect(lifeMix({ ...BASE, cls: 'Cfa', lat: 35, sunElevation: 60 }).frogs).toBe(0);
  });
  it('chouette : de nuit, en forêt seulement', () => {
    expect(lifeMix({ ...BASE, ...NIGHT }).owl).toBeGreaterThan(0);
    expect(lifeMix({ ...BASE, ...NIGHT, forest: 0.02 }).owl).toBe(0);
    expect(lifeMix(BASE).owl).toBe(0);
  });
});

describe('mer et vent', () => {
  it('goélands : sur la côte de jour, pas de nuit ni sans rivage à terre', () => {
    expect(lifeMix({ ...BASE, shore: 0.8 }).gulls).toBeGreaterThan(0.1);
    expect(lifeMix({ ...BASE, shore: 0.8, sunElevation: -30 }).gulls).toBe(0);
    expect(lifeMix({ ...BASE, shore: 0 }).gulls).toBe(0);
  });
  it('en mer : quelques goélands au large, plus près des terres', () => {
    const far = lifeMix({ ...BASE, land: false, shore: 0 }).gulls;
    const near = lifeMix({ ...BASE, land: false, shore: 0.6 }).gulls;
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far);
  });
  it('feuillage : monte avec le vent et le nombre d’arbres, plus grave chez les conifères, nul sur l’eau', () => {
    expect(lifeMix({ ...BASE, wind: 10 }).foliage.gain).toBeGreaterThan(lifeMix({ ...BASE, wind: 3 }).foliage.gain);
    expect(lifeMix({ ...BASE, wind: 10, forest: 0.9 }).foliage.gain).toBeGreaterThan(lifeMix({ ...BASE, wind: 10, forest: 0.1 }).foliage.gain);
    expect(lifeMix({ ...BASE, conifer: 1 }).foliage.freq).toBeLessThan(lifeMix({ ...BASE, conifer: 0 }).foliage.freq);
    expect(lifeMix({ ...BASE, wind: 10, land: false }).foliage.gain).toBe(0);
  });
  it('toutes les valeurs restent positives et bornées, même extrêmes', () => {
    const m = lifeMix({ ...BASE, rain: 9, wind: 99, shore: 9, forest: 5, sunElevation: -90 });
    for (const v of [m.birds, m.gulls, m.frogs, m.owl, m.crickets.gain, m.cicadas, m.foliage.gain]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(m.birds).toBeLessThan(3);
  });
});
