import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { geocodeAddress } from "@/lib/geocode.functions";
import { cityForText } from "@/lib/launch-cities";
import { cityKey } from "@/lib/org-distance";
import type { LatLng } from "@/lib/geo";
import type { Org } from "@/lib/sample-data";

/** Most distinct cities geocoded per page, so a long list can't fan out. */
const MAX_CITIES = 25;

/**
 * Coordinates for the cities of orgs that have no saved venue coordinates, so
 * teams and clubs still get a distance. Results are cached for the session;
 * cities we already know (launch cities) and orgs with venue geo are skipped.
 */
export function useOrgCityCoords(
  orgs: Pick<Org, "city" | "venueGeo">[],
  enabled: boolean,
): ReadonlyMap<string, LatLng> {
  const geocode = useServerFn(geocodeAddress);
  const cities = useMemo(() => {
    const out = new Map<string, string>();
    for (const o of orgs) {
      if ((o.venueGeo?.length ?? 0) > 0) continue;
      const key = cityKey(o.city);
      if (!key || out.has(key) || cityForText(o.city)) continue;
      out.set(key, o.city.trim());
      if (out.size >= MAX_CITIES) break;
    }
    return [...out];
  }, [orgs]);

  const results = useQueries({
    queries: cities.map(([key, label]) => ({
      queryKey: ["org-city-coords", key],
      queryFn: async () => {
        try {
          const r = await geocode({ data: { address: label } });
          return { lat: r.lat, lng: r.lng } as LatLng;
        } catch {
          return null; // unresolved cities simply show no distance
        }
      },
      enabled,
      staleTime: Infinity,
      gcTime: Infinity,
      retry: false,
    })),
  });

  return useMemo(() => {
    const map = new Map<string, LatLng>();
    cities.forEach(([key], i) => {
      const data = results[i]?.data;
      if (data) map.set(key, data);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cities, results.map((r) => r.dataUpdatedAt).join(",")]);
}
