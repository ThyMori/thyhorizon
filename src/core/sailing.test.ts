import { describe, expect, it } from 'vitest';
import { CRUISER, BoatInput, mainHeight, penonFlow, sailPlan, BoatState, apparentWind, createBoat, hullResistance, pointOfSail, readout, rightingArm, sailCoefficients, sheetAngle, startHeading, stepBoat, wrapPi } from './sailing';
import { msToKnots } from './wind';
import type { Wind } from './wind';

const DEG = Math.PI / 180; // degrés → radians
const DEEP = (): number => 50; // eau profonde partout
const NO_INPUT: BoatInput = { helm: 0, trim: 0, center: false };

// Vent de 12 nœuds (6,17 m/s) qui vient de l'est ; bateau cap nord (yaw 0).
const EAST_12: Wind = { speed: 6.17, from: Math.PI / 2 };

// Pilote automatique de test : tient un cap compas et règle l'écoute pour garder ~12° d'angle d'attaque.
function sail(s: BoatState, wind: Wind, seconds: number, bearingDeg: number, trim = true): void {
  for (let t = 0; t < seconds; t += 0.05) {
    const aw = apparentWind(s, wind);
    const wanted = Math.abs(aw.angle) - 12 * DEG; // angle de bôme idéal
    if (trim) s.sheet = Math.min(1, Math.max(0, (wanted - sheetAngle(0)) / (sheetAngle(1) - sheetAngle(0)))); // écoute réglée directement
    const err = wrapPi(-bearingDeg * DEG - s.yaw); // écart de cap à corriger (yaw voulu − actuel)
    const helm = Math.max(-1, Math.min(1, -err * 2.5 + s.omega * 1.5)); // proportionnel + amortissement
    stepBoat(s, CRUISER, wind, { helm, trim: 0, center: false }, 0.05, DEEP);
  }
}

describe('voile', () => {
  it('portance croissante puis décrochage', () => {
    expect(sailCoefficients(0).cl).toBe(0);
    expect(sailCoefficients(10 * DEG).cl).toBeGreaterThan(0.5);
    expect(sailCoefficients(18 * DEG).cl).toBeGreaterThan(sailCoefficients(40 * DEG).cl); // décroché : moins de portance
    expect(sailCoefficients(60 * DEG).cd).toBeGreaterThan(sailCoefficients(10 * DEG).cd * 3); // et beaucoup plus de traînée
  });
  it('est continue autour du décrochage', () => {
    const a = sailCoefficients(17.9 * DEG);
    const b = sailCoefficients(18.1 * DEG);
    expect(Math.abs(a.cl - b.cl)).toBeLessThan(0.05);
  });
});

describe('coque', () => {
  it('la résistance explose près de la vitesse de coque (~7,4 nœuds)', () => {
    const r5 = hullResistance(CRUISER, 5 / 1.944);
    const r7 = hullResistance(CRUISER, 7.4 / 1.944);
    expect(r7).toBeGreaterThan(r5 * 3);
  });
  it('le redressement s\'oppose à la gîte', () => {
    expect(rightingArm(CRUISER, 0.3)).toBeGreaterThan(0);
    expect(rightingArm(CRUISER, -0.3)).toBeLessThan(0);
    expect(rightingArm(CRUISER, 0)).toBe(0);
  });
});

describe('vent apparent', () => {
  it('vient de l\'avant quand on avance par temps calme', () => {
    const s = createBoat(0, 0, 0);
    s.u = 3;
    const aw = apparentWind(s, { speed: 0.001, from: 0 });
    expect(aw.speed).toBeCloseTo(3, 1);
    expect(Math.abs(aw.angle)).toBeLessThan(0.01);
  });
  it('vent d\'est, cap nord : vient de tribord (angle positif)', () => {
    const s = createBoat(0, 0, 0);
    expect(apparentWind(s, EAST_12).angle).toBeCloseTo(Math.PI / 2, 2);
  });
  it('avancer fait passer le vent apparent vers l\'avant', () => {
    const s = createBoat(0, 0, 0);
    s.u = 3;
    expect(apparentWind(s, EAST_12).angle).toBeLessThan(Math.PI / 2);
  });
});

describe('performances (vent de 12 nœuds)', () => {
  it('au travers : environ 5 à 7 nœuds', () => {
    const s = createBoat(0, 0, 0);
    sail(s, EAST_12, 120, 0);
    const kn = msToKnots(s.u);
    expect(kn).toBeGreaterThan(4.5);
    expect(kn).toBeLessThan(7.5);
  });
  it('au près (angle du vent vrai 45°) : avance, avec de la dérive', () => {
    const s = createBoat(0, 0, 0);
    sail(s, EAST_12, 40, 0); // on prend de la vitesse au travers…
    sail(s, EAST_12, 120, 45); // …puis on remonte à 45° du vent (cap 45° : vent de l'est à 45° sur tribord)
    const kn = msToKnots(s.u);
    expect(kn).toBeGreaterThan(3);
    expect(kn).toBeLessThan(6.5);
    const r = readout(s, EAST_12);
    expect(r.leewayDeg).toBeGreaterThan(0.5); // dérive : la quille n'est pas parfaite
    expect(r.leewayDeg).toBeLessThan(9);
  });
  it('ne peut pas avancer dans le vent', () => {
    const s = createBoat(0, 0, 0);
    s.u = 3;
    sail(s, EAST_12, 5, 0);
    sail(s, EAST_12, 120, 90, false); // cap plein est = face au vent, écoute bordée
    expect(msToKnots(Math.abs(s.u))).toBeLessThan(1.2);
  });
  it('gîte du côté sous le vent, plus au près qu\'au travers', () => {
    const reach = createBoat(0, 0, 0);
    sail(reach, EAST_12, 100, 0);
    const beat = createBoat(0, 0, 0);
    sail(beat, EAST_12, 40, 0);
    sail(beat, EAST_12, 100, 48);
    expect(reach.heel).toBeLessThan(0); // vent de tribord : penché à bâbord (négatif)
    expect(Math.abs(beat.heel / DEG)).toBeGreaterThan(5);
    expect(Math.abs(beat.heel / DEG)).toBeLessThan(25);
  });
  it('la voile qui faseye ne tire presque rien', () => {
    const s = createBoat(0, 0, 0);
    s.sheet = 1; // écoute toute choquée
    for (let i = 0; i < 400; i++) stepBoat(s, CRUISER, { speed: 6.17, from: 2 * Math.PI - Math.PI / 4 }, NO_INPUT, 0.05, DEEP); // vent à 45° bâbord, écoute choquée
    expect(msToKnots(s.u)).toBeLessThan(1);
    expect(s.luff).toBeGreaterThan(0.8);
  });
  it('vent arrière : avance, sous la vitesse de coque', () => {
    const s = createBoat(0, 0, 0);
    sail(s, EAST_12, 150, 270, false); // cap ouest (270°), vent de l'est dans le dos
    const kn = msToKnots(s.u);
    expect(kn).toBeGreaterThan(2.5);
    expect(kn).toBeLessThan(6.5);
  });
});

describe('barre', () => {
  it('à pleine vitesse, la barre fait tourner le bateau (5 à 25 °/s)', () => {
    const s = createBoat(0, 0, 0);
    sail(s, EAST_12, 60, 0); // vitesse de croisière
    const yaw0 = s.yaw;
    for (let i = 0; i < 100; i++) stepBoat(s, CRUISER, EAST_12, { helm: 1, trim: 0, center: false }, 0.05, DEEP); // 5 s de barre à droite
    const rate = ((yaw0 - s.yaw) / DEG) / 5; // tourner à tribord = yaw qui diminue
    expect(rate).toBeGreaterThan(5);
    expect(rate).toBeLessThan(25);
  });
  it('sans vitesse, la barre ne fait presque rien', () => {
    const s = createBoat(0, 0, 0);
    const calm: Wind = { speed: 0.5, from: 0 };
    for (let i = 0; i < 100; i++) stepBoat(s, CRUISER, calm, { helm: 1, trim: 0, center: false }, 0.05, DEEP);
    expect(Math.abs(s.yaw / DEG)).toBeLessThan(5);
  });
  it('la barre revient au milieu quand on la lâche', () => {
    const s = createBoat(0, 0, 0);
    for (let i = 0; i < 30; i++) stepBoat(s, CRUISER, EAST_12, { helm: 1, trim: 0, center: false }, 0.05, DEEP);
    expect(s.rudder).toBeGreaterThan(0.3);
    for (let i = 0; i < 100; i++) stepBoat(s, CRUISER, EAST_12, NO_INPUT, 0.05, DEEP);
    expect(Math.abs(s.rudder)).toBeLessThan(0.01);
  });
  it('au près, barre lâchée, le bateau lofe (barre au vent)', () => {
    const s = createBoat(0, 0, 0);
    sail(s, EAST_12, 40, 0);
    sail(s, EAST_12, 60, 45);
    s.rudder = 0;
    for (let i = 0; i < 40; i++) stepBoat(s, CRUISER, EAST_12, NO_INPUT, 0.05, DEEP);
    expect(s.omega).toBeGreaterThan(0); // tourne à tribord = vers le vent (qui vient de tribord)
  });
});

describe('écoute', () => {
  it('se règle entre bordée et choquée', () => {
    const s = createBoat(0, 0, 0);
    for (let i = 0; i < 400; i++) stepBoat(s, CRUISER, EAST_12, { helm: 0, trim: -1, center: false }, 0.05, DEEP);
    expect(s.sheet).toBe(0);
    for (let i = 0; i < 400; i++) stepBoat(s, CRUISER, EAST_12, { helm: 0, trim: 1, center: false }, 0.05, DEEP);
    expect(s.sheet).toBe(1);
  });
});

describe('fond et événements', () => {
  it('on ne peut pas aller vers moins profond que le tirant d\'eau', () => {
    const s = createBoat(0, 0, Math.PI); // cap sud
    s.sheet = 0.9;
    const depth = (_x: number, z: number): number => 4 - Math.max(0, z) * 0.05; // la profondeur diminue vers le sud : 0 à z = 80
    for (let i = 0; i < 2400; i++) stepBoat(s, CRUISER, { speed: 8, from: 0 }, NO_INPUT, 0.05, depth); // vent du nord : pousse vers le sud
    expect(s.z).toBeLessThan(80); // arrêté avant la plage
    expect(s.aground).toBe(true);
  });
  it('signale un virement de bord', () => {
    const s = createBoat(0, 0, 0);
    s.u = 3;
    s.sheet = 0.2;
    stepBoat(s, CRUISER, { speed: 6, from: Math.PI / 2 }, NO_INPUT, 0.05, DEEP); // vent de tribord
    s.event = null;
    stepBoat(s, CRUISER, { speed: 6, from: 2 * Math.PI - 30 * DEG }, NO_INPUT, 0.05, DEEP); // le vent vient maintenant de bâbord
    expect(s.event).toBe('tack');
  });
  it('signale un empannage (vent arrière qui change de bord)', () => {
    const s = createBoat(0, 0, 0);
    s.u = 3;
    stepBoat(s, CRUISER, { speed: 6, from: 160 * DEG }, NO_INPUT, 0.05, DEEP); // vent de l'arrière tribord
    s.event = null;
    stepBoat(s, CRUISER, { speed: 6, from: 200 * DEG }, NO_INPUT, 0.05, DEEP); // de l'arrière bâbord
    expect(s.event).toBe('gybe');
  });
});

describe('cap de départ et allures', () => {
  it('garde le cap demandé s\'il n\'est pas face au vent', () => {
    expect(startHeading(0, { speed: 6, from: Math.PI / 2 })).toBe(0);
  });
  it('s\'écarte du vent s\'il est trop proche', () => {
    const wind: Wind = { speed: 6, from: 0 }; // vent du nord ; yaw 0.1 ≈ cap nord = face au vent
    const y = startHeading(0.1, wind);
    const twa = Math.abs(wrapPi(wind.from + y)); // angle du vent vrai pour ce nouveau cap
    expect(twa).toBeGreaterThan(60 * DEG);
  });
  it('nomme les allures', () => {
    expect(pointOfSail(20 * DEG)).toBe('face au vent');
    expect(pointOfSail(45 * DEG)).toBe('au près');
    expect(pointOfSail(90 * DEG)).toBe('au travers');
    expect(pointOfSail(175 * DEG)).toBe('vent arrière');
  });
  it('les instruments donnent un cap compas entre 0 et 360', () => {
    const s = createBoat(0, 0, Math.PI / 2); // yaw π/2 = cap ouest = 270°
    expect(readout(s, EAST_12).bearing).toBeCloseTo(270, 3);
  });
});

describe('penons', () => {
  const at = (sheet: number): { trim: number; flow: number } => {
    const s = createBoat(0, 0, -50 * DEG); // cap compas 50°, vent de l'est : au près, à tribord amures
    s.u = 2.5; // un peu de vitesse
    s.sheet = sheet;
    sail(s, EAST_12, 6, 50, false); // on laisse la voile se mettre en place (écoute fixe)
    return penonFlow(s, EAST_12);
  };
  it('voile trop choquée : le penon du vent se soulève (trim < 0)', () => {
    expect(at(0.95).trim).toBeLessThan(-0.5);
  });
  it('voile trop bordée : le penon sous le vent décroche (trim > 0)', () => {
    expect(at(0.0).trim).toBeGreaterThan(0.3);
  });
  it('voile bien réglée : les deux penons filent droit', () => {
    const s = createBoat(0, 0, -150 * DEG);
    s.u = 2.5;
    sail(s, EAST_12, 20, 150, true); // pilote qui garde ~12° d'angle d'attaque
    const f = penonFlow(s, EAST_12);
    expect(Math.abs(f.trim)).toBeLessThan(0.8);
  });
  it('sans vent, les penons pendent (flow ≈ 0)', () => {
    const s = createBoat(0, 0, 0);
    expect(penonFlow(s, { speed: 0, from: 0 }).flow).toBeLessThan(0.05);
  });
});

describe('manœuvres de voiles', () => {
  const WIND22 = { speed: 22 * 0.5144, from: Math.PI / 2 }; // 22 nœuds de l'est
  // Tient le cap compas 45° avec la barre ; écoute fixe. Renvoie le bateau après 40 s.
  const hold = (setup: (s: BoatState) => void): BoatState => {
    const s = createBoat(0, 0, -45 * DEG);
    s.u = 3;
    setup(s);
    s.mainUp = s.mainTarget;
    s.jibOut = s.jibTarget;
    s.reefLevel = s.reef;
    s.sheet = 0.35;
    sail(s, WIND22, 40, 45, false);
    return s;
  };
  it('le plan de voilure : pleine, 3 ris, sans voile', () => {
    const full = createBoat(0, 0, 0);
    expect(sailPlan(full, CRUISER).area).toBeCloseTo(48, 5);
    const reefed = createBoat(0, 0, 0);
    reefed.reef = 3;
    reefed.reefLevel = 3;
    expect(sailPlan(reefed, CRUISER).area).toBeLessThan(sailPlan(full, CRUISER).area * 0.7);
    expect(sailPlan(reefed, CRUISER).ceHeight).toBeLessThan(sailPlan(full, CRUISER).ceHeight); // centre de voilure plus bas
    const bare = createBoat(0, 0, 0);
    bare.mainUp = 0;
    bare.jibOut = 0;
    expect(sailPlan(bare, CRUISER).area).toBe(0);
  });
  it('les ris réduisent la gîte dans la brise', () => {
    const full = hold(() => undefined);
    const reefed = hold((s) => {
      s.reef = 3;
    });
    expect(Math.abs(reefed.heel)).toBeLessThan(Math.abs(full.heel));
  });
  it('affaler et hisser prennent du temps (affaler plus vite)', () => {
    const calm = { speed: 0, from: 0 };
    const run = (s: BoatState, seconds: number): void => {
      for (let t = 0; t < seconds; t += 0.2) stepBoat(s, CRUISER, calm, NO_INPUT, 0.2, DEEP); // pas de 0,2 s (stepBoat borne un pas à 0,25 s)
    };
    const s = createBoat(0, 0, 0);
    stepBoat(s, CRUISER, calm, { helm: 0, trim: 0, center: false, toggleMain: true }, 0.2, DEEP); // appui : affaler
    expect(s.mainTarget).toBe(0);
    run(s, 1);
    expect(s.mainUp).toBeGreaterThan(0.7); // une seconde ne suffit pas
    run(s, 8);
    expect(s.mainUp).toBe(0); // affalée au bout d'environ 7 s
    stepBoat(s, CRUISER, calm, { helm: 0, trim: 0, center: false, toggleMain: true }, 0.2, DEEP); // appui : hisser
    run(s, 10);
    expect(s.mainUp).toBeLessThan(1); // hisser est plus lent : 10 s ne suffisent pas
    run(s, 10);
    expect(s.mainUp).toBe(1);
  });
  it('ris : un appui prend un ris, jamais plus de 3, et on peut les larguer', () => {
    const s = createBoat(0, 0, 0);
    for (let i = 0; i < 5; i++) stepBoat(s, CRUISER, { speed: 0, from: 0 }, { helm: 0, trim: 0, center: false, reef: 1 }, 0.1, DEEP);
    expect(s.reef).toBe(3);
    stepBoat(s, CRUISER, { speed: 0, from: 0 }, { helm: 0, trim: 0, center: false, reef: -1 }, 0.1, DEEP);
    expect(s.reef).toBe(2);
    for (let i = 0; i < 150; i++) stepBoat(s, CRUISER, { speed: 0, from: 0 }, NO_INPUT, 0.2, DEEP);
    expect(mainHeight(s)).toBeCloseTo(0.56, 2); // 2 ris
  });
  it('sans grand-voile le bateau abat (barre sous le vent) ; sans foc il lofe', () => {
    const jibOnly = hold((s) => {
      s.mainTarget = 0;
    });
    const mainOnly = hold((s) => {
      s.jibTarget = 0;
    });
    // vent de l'est, bateau au 45° : la barre pour tenir le cap est « sous le vent » (positive = à tribord) avec le foc seul
    expect(jibOnly.rudder).toBeGreaterThan(mainOnly.rudder + 0.05);
    expect(jibOnly.rudder).toBeGreaterThan(0.05);
    expect(mainOnly.rudder).toBeLessThan(-0.03);
  });
  it('sans aucune voile, pas de poussée : le bateau ralentit', () => {
    const s = createBoat(0, 0, -45 * DEG);
    s.u = 3;
    s.mainTarget = s.jibTarget = 0;
    s.mainUp = s.jibOut = 0;
    sail(s, WIND22, 30, 45, false);
    expect(s.u).toBeLessThan(1.5);
  });
});
