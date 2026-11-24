// Tests de la météo réelle (logique pure) et de l'appel réseau avec un faux serveur : jamais de vrai réseau ici.
import { describe, expect, it } from 'vitest';
import { approachWind, cellKey, currentVector, shouldTurnSea, waveTurnFor, forecastUrl, marineUrl, needsRefresh, parseForecast, parseMarine, realWindWithGusts, roundCoord, seaFromReal } from './realWeather';
import { fetchRealConditions, Fetcher } from '../net/openMeteo';

const FORECAST = { current: { wind_speed_10m: 9, wind_direction_10m: 270, cloud_cover: 80, precipitation: 2, pressure_msl: 995, visibility: 2000 } };
const MARINE = { current: { wave_height: 2.4, wave_direction: 280, ocean_current_velocity: 3.6, ocean_current_direction: 90 } }; // courant : 3,6 km/h = 1 m/s vers l'est

describe('coordonnées et adresses', () => {
  it('arrondit à 0,5° et ne contient jamais la position exacte', () => {
    expect(roundCoord(48.7312)).toBe(48.5);
    expect(roundCoord(-3.4601)).toBe(-3.5);
    expect(forecastUrl(48.7312, -3.4601)).toContain('latitude=48.5&longitude=-3.5');
    expect(forecastUrl(48.7312, -3.4601)).not.toContain('48.73');
    expect(marineUrl(48.7312, -3.4601)).toContain('latitude=48.5&longitude=-3.5');
  });
  it('demande les vitesses en m/s', () => expect(forecastUrl(0, 0)).toContain('wind_speed_unit=ms'));
  it('deux points proches ont la même case', () => expect(cellKey(48.6, -3.4)).toBe(cellKey(48.74, -3.6)));
});

describe('quand redemander', () => {
  const t0 = 1_000_000;
  it('jamais demandé : oui', () => expect(needsRefresh(null, 'a', t0)).toBe(true));
  it('même case, réponse récente : non', () => expect(needsRefresh({ key: 'a', at: t0, ok: true }, 'a', t0 + 60_000)).toBe(false));
  it('même case, réponse de plus de 15 min : oui', () => expect(needsRefresh({ key: 'a', at: t0, ok: true }, 'a', t0 + 16 * 60_000)).toBe(true));
  it('échec : on attend 5 min avant de réessayer', () => {
    expect(needsRefresh({ key: 'a', at: t0, ok: false }, 'a', t0 + 2 * 60_000)).toBe(false);
    expect(needsRefresh({ key: 'a', at: t0, ok: false }, 'a', t0 + 6 * 60_000)).toBe(true);
  });
  it('nouvelle case : oui, mais pas plus d’une fois toutes les 20 s', () => {
    expect(needsRefresh({ key: 'a', at: t0, ok: true }, 'b', t0 + 5_000)).toBe(false);
    expect(needsRefresh({ key: 'a', at: t0, ok: true }, 'b', t0 + 30_000)).toBe(true);
  });
});

describe('lecture des réponses', () => {
  it('convertit le temps', () => {
    const r = parseForecast(FORECAST)!;
    expect(r.wind!.speed).toBe(9);
    expect(r.wind!.from).toBeCloseTo(1.5 * Math.PI, 5); // 270° = ouest
    expect(r.weather!.cloud).toBeCloseTo(0.8, 5);
    expect(r.weather!.front).toBeGreaterThan(0.5); // basse pression
    expect(r.weather!.rain).toBeGreaterThan(0);
    expect(r.weather!.fog).toBeGreaterThan(0); // visibilité 2 km
  });
  it('beau temps : pas de pluie ni de brume', () => {
    const r = parseForecast({ current: { wind_speed_10m: 3, wind_direction_10m: 0, cloud_cover: 5, precipitation: 0, pressure_msl: 1030, visibility: 24000 } })!;
    expect(r.weather!.rain).toBe(0);
    expect(r.weather!.fog).toBe(0);
    expect(r.weather!.front).toBe(-0.75);
  });
  it('rejette les réponses inutilisables', () => {
    expect(parseForecast(null)).toBeNull();
    expect(parseForecast({})).toBeNull();
    expect(parseForecast({ current: { wind_speed_10m: 'vite' } })).toBeNull();
    expect(parseForecast({ current: {} })).toBeNull();
  });
  it('vent absurde borné', () => expect(parseForecast({ current: { wind_speed_10m: 500, wind_direction_10m: 720, pressure_msl: 1000 } })!.wind!.speed).toBe(40));
  it('lit la mer, null sur terre', () => {
    const m = parseMarine(MARINE)!;
    expect(m.hs).toBe(2.4);
    expect(m.waveFrom).toBeCloseTo((280 * Math.PI) / 180, 5);
    expect(m.current!.x).toBeCloseTo(1, 5); // vers l'est = +x, 1 m/s
    expect(m.current!.z).toBeCloseTo(0, 5);
    expect(parseMarine({ current: { wave_height: null, wave_direction: null } })).toBeNull();
    expect(parseMarine('x')).toBeNull();
  });
  it('le courant va VERS sa direction : 0° = vers le nord (−z), 180° = vers le sud (+z)', () => {
    expect(currentVector(1, 0).z).toBeCloseTo(-1, 5);
    expect(currentVector(1, 180).z).toBeCloseTo(1, 5);
    expect(currentVector(2, 270).x).toBeCloseTo(-2, 5); // vers l'ouest
  });
  it('courant borné à ~8 nœuds', () => {
    const c = parseMarine({ current: { ocean_current_velocity: 99, ocean_current_direction: 0 } })!.current!;
    expect(Math.hypot(c.x, c.z)).toBeCloseTo(4, 5);
  });
});

describe('direction de la houle', () => {
  it('une houle d’ouest (270°) donne un vecteur « d’où elle vient » pointant vers −x', () => {
    const t = waveTurnFor((270 * Math.PI) / 180);
    const c = Math.cos(t), s = Math.sin(t);
    const main = { dx: 0.8 * c - 0.6 * s, dz: 0.8 * s + 0.6 * c }; // houle principale tournée (voir waveDir)
    const n = Math.hypot(main.dx, main.dz);
    expect(main.dx / n).toBeCloseTo(-1, 5);
    expect(main.dz / n).toBeCloseTo(0, 5);
  });
  it('une houle du nord (0°) vient de −z', () => {
    const t = waveTurnFor(0);
    const c = Math.cos(t), s = Math.sin(t);
    expect((0.8 * s + 0.6 * c) / 1).toBeCloseTo(-1, 5);
  });
  it('on ne tourne la mer que pour un écart de plus de 15°', () => {
    expect(shouldTurnSea(0, (10 * Math.PI) / 180)).toBe(false);
    expect(shouldTurnSea(0, (20 * Math.PI) / 180)).toBe(true);
    expect(shouldTurnSea(3.1, -3.1)).toBe(false); // passage par ±π : écart réel de 0,08 rad
  });
});

describe('conversion en état de jeu', () => {
  it('la houle suit la mesure', () => expect(seaFromReal(2.4, 9).hs).toBe(2.4));
  it('le vent réel a des rafales bornées', () => {
    const w = realWindWithGusts({ speed: 10, from: 1 }, 123)!;
    expect(w.speed).toBeGreaterThan(8.5);
    expect(w.speed).toBeLessThan(11.5);
    expect(realWindWithGusts(null, 0)).toBeNull();
  });
  it('le vent tourne par le plus court chemin (350° → 10°)', () => {
    const a = approachWind({ speed: 5, from: (350 * Math.PI) / 180 }, { speed: 5, from: (10 * Math.PI) / 180 }, 0.5);
    expect((a.from * 180) / Math.PI).toBeCloseTo(0, 3);
  });
});

describe('appel réseau avec faux serveur', () => {
  const ok = (body: unknown) => ({ ok: true, json: async () => body });
  it('assemble temps et mer', async () => {
    const urls: string[] = [];
    const f: Fetcher = async (u) => (urls.push(u), u.includes('marine') ? ok(MARINE) : ok(FORECAST));
    const r = await fetchRealConditions(48.73, -3.46, 42, f);
    expect(r!.wind!.speed).toBe(9);
    expect(r!.hs).toBe(2.4);
    expect(r!.current!.x).toBeCloseTo(1, 5);
    expect(r!.waveFrom).not.toBeNull();
    expect(r!.fetchedAt).toBe(42);
    expect(urls.every((u) => !u.includes('48.73'))).toBe(true); // jamais la position exacte
  });
  it('garde le temps si la mer échoue (sur terre)', async () => {
    const f: Fetcher = async (u) => (u.includes('marine') ? { ok: false, json: async () => ({}) } : ok(FORECAST));
    const r = await fetchRealConditions(0, 0, 1, f);
    expect(r!.hs).toBeNull();
    expect(r!.wind).not.toBeNull();
  });
  it('réseau coupé : null, sans exception', async () => {
    const f: Fetcher = async () => {
      throw new Error('hors ligne');
    };
    expect(await fetchRealConditions(0, 0, 1, f)).toBeNull();
  });
  it('JSON invalide : null', async () => {
    const f: Fetcher = async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } });
    expect(await fetchRealConditions(0, 0, 1, f)).toBeNull();
  });
});
