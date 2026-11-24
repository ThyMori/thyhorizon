// Tests des poses de la main : poses possibles, mélange.
import { describe, expect, it } from 'vitest';
import { HOLD_COMPASS, RELAXED, blendPose, poseIsPossible } from './handPose';

describe('poses de la main', () => {
  it('les poses fournies sont humainement possibles', () => {
    expect(poseIsPossible(RELAXED)).toBe(true);
    expect(poseIsPossible(HOLD_COMPASS)).toBe(true);
  });
  it('tenir la boussole plie plus les doigts que la main détendue', () => {
    for (let f = 0; f < 4; f++) expect(HOLD_COMPASS.fingers[f]![0]).toBeGreaterThan(RELAXED.fingers[f]![0]);
  });
  it('mélange : les extrémités sont exactes, le milieu est entre les deux, t est borné', () => {
    expect(blendPose(RELAXED, HOLD_COMPASS, 0)).toEqual(RELAXED);
    expect(blendPose(RELAXED, HOLD_COMPASS, 1)).toEqual(HOLD_COMPASS);
    const mid = blendPose(RELAXED, HOLD_COMPASS, 0.5);
    expect(mid.fingers[1]![0]).toBeCloseTo((RELAXED.fingers[1]![0] + HOLD_COMPASS.fingers[1]![0]) / 2, 8);
    expect(blendPose(RELAXED, HOLD_COMPASS, 9)).toEqual(HOLD_COMPASS);
    expect(blendPose(RELAXED, HOLD_COMPASS, -3)).toEqual(RELAXED);
    expect(poseIsPossible(mid)).toBe(true);
  });
  it('rejette une pose impossible', () => {
    expect(poseIsPossible({ ...RELAXED, thumb: [3, 0, 0] })).toBe(false);
    expect(poseIsPossible({ ...RELAXED, fingers: [[-0.5, 0, 0], RELAXED.fingers[1], RELAXED.fingers[2], RELAXED.fingers[3]] })).toBe(false);
  });
});
