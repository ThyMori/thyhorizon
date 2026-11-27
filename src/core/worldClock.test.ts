// Tests de l'horloge unique du monde : lecture de la source, heure solaire, outils d'essai, retour au réel.
import { describe, expect, it } from 'vitest';
import { START_LON } from './geo';
import { WorldClock } from './worldClock';

const T0 = Date.UTC(2026, 10, 27, 12, 0, 0); // 27 novembre 2026, 12 h UTC
const fixed = (ms: number) => new WorldClock(() => ms); // horloge figée sur un instant

describe('WorldClock', () => {
  it('lit la source injectée et rien d\'autre', () => {
    let t = T0;
    const c = new WorldClock(() => t);
    expect(c.now()).toBe(T0);
    t += 5000; // la source avance de 5 s
    expect(c.now()).toBe(T0 + 5000);
    expect(c.hoursSinceEpoch()).toBeCloseTo((T0 + 5000) / 3600000, 9);
  });

  it('donne l\'heure solaire du lieu : midi UTC = un peu avant midi à Lannion (ouest), après midi à l\'est', () => {
    const c = fixed(T0);
    expect(c.solar(0).hours).toBeCloseTo(12, 6); // méridien 0 : midi UTC = midi solaire
    expect(c.solar(START_LON).hours).toBeCloseTo(12 + START_LON / 15, 6); // Lannion est à l'ouest : un peu moins de 12 h
    expect(c.solar(150).hours).toBeCloseTo(22, 6); // l'est : plus tard dans la journée
  });

  it('le jour de l\'année change avec la longitude quand on passe minuit solaire', () => {
    const c = fixed(Date.UTC(2026, 10, 27, 23, 0, 0)); // 23 h UTC
    const west = c.solar(-60).day; // 19 h solaire : même jour
    const east = c.solar(120).day; // 7 h le lendemain
    expect(east).toBe(west + 1);
  });

  it('advance, setSolarHours et setDayOfYear ne servent qu\'aux essais et se défont avec reset', () => {
    const c = fixed(T0);
    expect(c.testOffsetMs).toBe(0); // jeu normal : aucun décalage
    c.setSolarHours(6, START_LON);
    expect(c.solar(START_LON).hours).toBeCloseTo(6, 6);
    const day = c.solar(START_LON).day;
    c.setDayOfYear(100, START_LON);
    expect(c.solar(START_LON).day).toBe(100);
    expect(c.solar(START_LON).hours).toBeCloseTo(6, 6); // l'heure n'a pas bougé
    expect(day).not.toBe(100);
    c.advance(3600000); // une heure de plus
    expect(c.solar(START_LON).hours).toBeCloseTo(7, 6);
    c.reset();
    expect(c.testOffsetMs).toBe(0);
    expect(c.now()).toBe(T0);
  });

  it('ignore une avance non valable (NaN, infini)', () => {
    const c = fixed(T0);
    c.advance(NaN);
    c.advance(Infinity);
    expect(c.now()).toBe(T0);
  });

  it('setSolarHours prend le chemin le plus court et garde le même jour', () => {
    const c = fixed(Date.UTC(2026, 10, 27, 12, 0, 0));
    const before = c.solar(0).day;
    c.setSolarHours(11, 0); // une heure en arrière, pas 23 h en avant
    expect(c.now()).toBe(T0 - 3600000);
    expect(c.solar(0).day).toBe(before);
  });
});
