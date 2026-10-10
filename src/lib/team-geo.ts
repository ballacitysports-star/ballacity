// Real coordinates for a team's home court, saved into `venueGeo` so distance
// and map pins use the court (or the city when no court is given) instead of a
// guess. Failures return `undefined`: saving the team must never depend on it.
import type { Org } from "@/lib/sample-data";

type Geocode = (args: {
  data: { address: string };
}) => Promise<{ lat: number; lng: number; formatted: string }>;

export async function geocodeTeamHome(
  geocode: Geocode,
  homeCourt: string | null | undefined,
  city: string | null | undefined,
): Promise<NonNullable<Org["venueGeo"]> | undefined> {
  const court = (homeCourt ?? "").trim();
  const town = (city ?? "").trim();
  const address = [court, town].filter(Boolean).join(", ");
  if (address.length < 2) return undefined;
  try {
    const r = await geocode({ data: { address } });
    return [{ address: court || town, placeId: "", lat: r.lat, lng: r.lng }];
  } catch {
    return undefined;
  }
}
