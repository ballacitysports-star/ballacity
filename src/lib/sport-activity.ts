/**
 * Privacy threshold for sport-level admin reporting. Counts below it are shown
 * as a floor ("fewer than 5") instead of the exact number, so a tiny group
 * (a niche sport in one town) cannot be traced to individuals.
 */
export const SPORT_ACTIVITY_MIN = 5;

export type MaskedCount = { value: number | null; small: boolean };

export function maskSmallCount(n: number, min: number = SPORT_ACTIVITY_MIN): MaskedCount {
  return n < min ? { value: null, small: true } : { value: n, small: false };
}
