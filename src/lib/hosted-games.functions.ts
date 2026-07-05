import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

/** True when the stored coords are the default sentinel or otherwise unusable
 *  for placement on a real map. Mirrors the admin debug classifier. */
function needsGeocode(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  if (lat === 50 && lng === 50) return true; // default sentinel
  // Integer 0-100 pseudo coords also need real geocoding.
  const isReal = lng < 0 || lng > 100 || lat < 0 || lat > 90 || !Number.isInteger(lat) || !Number.isInteger(lng);
  return !isReal;
}

/**
 * Runs a Google geocode for a hosted game the caller owns, but ONLY when the
 * stored coordinates look default/missing/invalid. Safe to call every time
 * after a publish — it's a no-op when the coords are already valid.
 */
export const autoGeocodeHostedGameIfNeeded = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().min(1).max(200) }).parse(d))
  .handler(async ({ context, data }): Promise<
    | { status: "updated"; lat: number; lng: number; formatted: string }
    | { status: "skipped"; reason: string }
    | { status: "failed"; error: string }
  > => {
    const { supabase, userId } = context;

    const { data: game, error: fetchErr } = await supabase
      .from("hosted_games")
      .select("id, host_id, location, lat, lng")
      .eq("id", data.id)
      .maybeSingle();
    if (fetchErr) return { status: "failed", error: fetchErr.message };
    if (!game) return { status: "failed", error: "Game not found" };
    if (game.host_id !== userId) return { status: "failed", error: "Only the host can geocode this game" };

    const lat = Number(game.lat);
    const lng = Number(game.lng);
    if (!needsGeocode(lat, lng)) {
      return { status: "skipped", reason: "Coordinates already valid" };
    }

    const address = String(game.location ?? "").trim();
    if (!address) return { status: "skipped", reason: "No location text to geocode" };

    const lovableKey = process.env.LOVABLE_API_KEY;
    const gKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!lovableKey || !gKey) return { status: "failed", error: "Maps credentials missing on server" };

    let res: Response;
    try {
      res = await fetch(
        `${GATEWAY_URL}/maps/api/geocode/json?address=${encodeURIComponent(address)}`,
        { headers: { Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": gKey } },
      );
    } catch (e: any) {
      return { status: "failed", error: `Geocode fetch failed: ${e?.message ?? "unknown"}` };
    }
    if (!res.ok) return { status: "failed", error: `Geocode HTTP ${res.status}` };

    const body: any = await res.json().catch(() => ({}));
    const first = body?.results?.[0];
    const newLat = first?.geometry?.location?.lat;
    const newLng = first?.geometry?.location?.lng;
    if (typeof newLat !== "number" || typeof newLng !== "number") {
      return {
        status: "failed",
        error: body?.status === "ZERO_RESULTS"
          ? "No location found for that address"
          : `Invalid geocode response (${body?.status ?? "unknown"})`,
      };
    }

    const { error: updErr } = await supabase
      .from("hosted_games")
      .update({ lat: newLat, lng: newLng } as any)
      .eq("id", data.id);
    if (updErr) return { status: "failed", error: updErr.message };

    return { status: "updated", lat: newLat, lng: newLng, formatted: first?.formatted_address ?? address };
  });
