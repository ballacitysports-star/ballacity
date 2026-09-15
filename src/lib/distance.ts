// Distance unit helpers. The DB stores kilometers (legacy column name
// `travel_radius_km`) and miles (`distance_mi`); the UI renders whichever unit
// the viewer's region uses.
import type { DistanceUnit } from "./measurement-system";

const KM_PER_MI = 1.609344;

/**
 * Single shared ceiling for every distance/radius control in the app
 * (~half the earth's circumference, i.e. effectively "anywhere").
 */
export const MAX_DISTANCE_MI = 12500;

/** The cap expressed in the viewer's unit, rounded to a whole number. */
export function maxDistanceInUnit(unit: DistanceUnit): number {
  return unit === "km" ? Math.round(MAX_DISTANCE_MI * KM_PER_MI) : MAX_DISTANCE_MI;
}

/** Clamp a mile value into 1…MAX_DISTANCE_MI (null passes through). */
export function clampDistanceMi<T extends number | null | undefined>(value: T): T {
  if (value == null || Number.isNaN(value)) return value;
  return Math.min(MAX_DISTANCE_MI, Math.max(1, value as number)) as T;
}

export function miToKm(mi: number): number {
  return Math.round(mi * KM_PER_MI);
}

export function kmToMi(km: number | null | undefined): number {
  if (km == null) return 0;
  return Math.round(km / KM_PER_MI);
}

/**
 * Render a mile-based value in the viewer's unit.
 * `decimals` controls the rounding of the displayed number.
 */
export function formatDistance(
  valueMi: number | null | undefined,
  unit: DistanceUnit,
  decimals = 0,
): string {
  if (valueMi == null || Number.isNaN(valueMi)) return "";
  const value = unit === "km" ? valueMi * KM_PER_MI : valueMi;
  return `${value.toFixed(decimals)} ${unit}`;
}

/**
 * Round distance presets expressed in the viewer's unit, with the underlying
 * mile value used for filtering/sorting. Keeps chips readable in both systems
 * (5/10/25/50/100 mi vs 5/10/25/50/100 km) instead of showing 8/16/40 km.
 */
export function distancePresets(
  unit: DistanceUnit,
  steps: number[] = [5, 10, 25, 50, 100],
): { mi: number; label: string }[] {
  const presets = steps
    .filter((v) => (unit === "km" ? v / KM_PER_MI : v) <= MAX_DISTANCE_MI)
    .map((v) => ({
      mi: unit === "km" ? v / KM_PER_MI : v,
      label: `${v} ${unit}`,
    }));
  // Top end: one shared cap so no control can ask for more than 12,500 mi.
  presets.push({
    mi: MAX_DISTANCE_MI,
    label: `${maxDistanceInUnit(unit).toLocaleString("en-US")} ${unit} (anywhere)`,
  });
  return presets;
}

/** Render a kilometer-based value in the viewer's unit. */
export function formatDistanceFromKm(
  valueKm: number | null | undefined,
  unit: DistanceUnit,
  decimals = 0,
): string {
  if (valueKm == null || Number.isNaN(valueKm)) return "";
  const value = unit === "km" ? valueKm : valueKm / KM_PER_MI;
  return `${value.toFixed(decimals)} ${unit}`;
}
