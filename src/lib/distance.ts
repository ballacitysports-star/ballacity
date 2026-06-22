// Distance unit helpers. The DB stores kilometers (legacy column name
// `travel_radius_km`); the UI works entirely in miles.
const KM_PER_MI = 1.609344;

export function miToKm(mi: number): number {
  return Math.round(mi * KM_PER_MI);
}

export function kmToMi(km: number | null | undefined): number {
  if (km == null) return 0;
  return Math.round(km / KM_PER_MI);
}
