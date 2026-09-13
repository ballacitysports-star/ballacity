import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

export type PlaceSuggestion = {
  id: string;
  primary: string;
  secondary: string;
};

export const autocompletePlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { input: string; lat?: number | null; lng?: number | null; sessionToken?: string }) => {
      const input = String(data?.input ?? "").trim();
      if (input.length < 2) throw new Error("input too short");
      if (input.length > 200) throw new Error("input too long");
      const lat =
        typeof data?.lat === "number" && data.lat >= -90 && data.lat <= 90 ? data.lat : null;
      const lng =
        typeof data?.lng === "number" && data.lng >= -180 && data.lng <= 180 ? data.lng : null;
      const sessionToken =
        typeof data?.sessionToken === "string" && data.sessionToken.length <= 80
          ? data.sessionToken
          : undefined;
      return { input, lat, lng, sessionToken };
    },
  )
  .handler(async ({ data }) => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const gKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !gKey) throw new Error("Maps credentials missing");

    const body: Record<string, unknown> = { input: data.input };
    if (data.sessionToken) body.sessionToken = data.sessionToken;
    if (data.lat != null && data.lng != null) {
      body.locationBias = {
        circle: {
          center: { latitude: data.lat, longitude: data.lng },
          radius: 50000,
        },
      };
      body.origin = { latitude: data.lat, longitude: data.lng };
    }

    const res = await fetch(`${GATEWAY_URL}/places/v1/places:autocomplete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Autocomplete failed: ${res.status} ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
          };
          text?: { text?: string };
        };
      }>;
    };

    const suggestions: PlaceSuggestion[] = (json.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
      .slice(0, 5)
      .map((p) => ({
        id: p.placeId!,
        primary: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
        secondary: p.structuredFormat?.secondaryText?.text ?? "",
      }));

    return { suggestions };
  });

export type PlaceDetails = {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
};

export const getPlaceDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { placeId: string; sessionToken?: string }) => {
    const placeId = String(data?.placeId ?? "").trim();
    if (!placeId || placeId.length > 200) throw new Error("invalid placeId");
    const sessionToken =
      typeof data?.sessionToken === "string" && data.sessionToken.length <= 80
        ? data.sessionToken
        : undefined;
    return { placeId, sessionToken };
  })
  .handler(async ({ data }): Promise<PlaceDetails> => {
    const lovableKey = process.env.LOVABLE_API_KEY;
    const gKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !gKey) throw new Error("Maps credentials missing");

    const url = new URL(`${GATEWAY_URL}/places/v1/places/${encodeURIComponent(data.placeId)}`);
    if (data.sessionToken) url.searchParams.set("sessionToken", data.sessionToken);

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": gKey,
        "X-Goog-FieldMask": "id,formattedAddress,location",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Place details failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      id?: string;
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    };
    const lat = json.location?.latitude;
    const lng = json.location?.longitude;
    if (typeof lat !== "number" || typeof lng !== "number") {
      throw new Error("Place details missing location");
    }
    return {
      placeId: json.id ?? data.placeId,
      formattedAddress: json.formattedAddress ?? "",
      lat,
      lng,
    };
  });
