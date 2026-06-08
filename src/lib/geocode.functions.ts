import { createServerFn } from "@tanstack/react-start";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export const reverseGeocode = createServerFn({ method: "POST" })
  .inputValidator((data: { lat: number; lng: number }) => {
    if (typeof data?.lat !== "number" || typeof data?.lng !== "number") {
      throw new Error("lat and lng required");
    }
    if (data.lat < -90 || data.lat > 90 || data.lng < -180 || data.lng > 180) {
      throw new Error("invalid coordinates");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const gKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !gKey) throw new Error("Maps credentials missing");

    const url = `${GATEWAY_URL}/maps/api/geocode/json?latlng=${data.lat},${data.lng}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gKey,
      },
    });
    if (!res.ok) throw new Error(`Geocode failed: ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{ formatted_address?: string; address_components?: Array<{ long_name: string; types: string[] }> }>;
    };
    const first = body.results?.[0];
    const formatted = first?.formatted_address ?? "";
    const comp = (type: string) =>
      first?.address_components?.find((c) => c.types.includes(type))?.long_name ?? "";
    const city = comp("locality") || comp("postal_town") || comp("sublocality") || comp("administrative_area_level_2");
    const region = comp("administrative_area_level_1");
    const cityLine = [city, region].filter(Boolean).join(", ");
    return { formatted, city: cityLine };
  });
