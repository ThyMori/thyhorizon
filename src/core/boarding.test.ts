import { describe, expect, it } from 'vitest';
import { findLandingSpot, findLaunchSpot } from './boarding';
import { CRUISER } from './sailing';

// Un monde-test : la terre pour x < 0 (hauteur 5 m), la mer pour x > 100 (−20 m), une pente entre les deux.
const coast = {
  heightAt: (x: number): number => (x < 0 ? 5 : x > 100 ? -20 : 5 - (x / 100) * 25),
};

describe('mise à l\'eau', () => {
  it('trouve une eau profonde dans la direction du regard', () => {
    // yaw = −π/2 : le regard pointe vers l'est (+x), c'est-à-dire vers la mer
    const spot = findLaunchSpot(coast, CRUISER, -20, 0, -Math.PI / 2);
    expect(spot).not.toBeNull();
    expect(spot!.x).toBeGreaterThan(30); // assez loin du bord…
    expect(coast.heightAt(spot!.x - 4.25)).toBeLessThanOrEqual(-3.5); // …pour avoir 3,5 m sous toute la coque (même à l'arrière)
  });
  it('trouve aussi la mer quand on regarde vers la terre', () => {
    const spot = findLaunchSpot(coast, CRUISER, -20, 0, Math.PI / 2); // regard vers l'ouest : la terre
    expect(spot).not.toBeNull();
    expect(spot!.x).toBeGreaterThan(0);
  });
  it('renvoie null s\'il n\'y a pas de mer à portée', () => {
    expect(findLaunchSpot({ heightAt: () => 100 }, CRUISER, 0, 0, 0, 300)).toBeNull();
  });
});

describe('débarquement', () => {
  it('trouve la terre quand on est près du rivage', () => {
    const spot = findLandingSpot(coast, 18, 0); // à 18 m du bord, la pente donne ~0 m de hauteur vers x = 20
    expect(spot).not.toBeNull();
    expect(coast.heightAt(spot!.x)).toBeGreaterThan(-1);
  });
  it('refuse de débarquer en pleine mer', () => {
    expect(findLandingSpot(coast, 500, 0)).toBeNull();
  });
});
