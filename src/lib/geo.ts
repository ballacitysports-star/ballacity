import { useCallback, useEffect, useState } from "react";
import { recordDenial } from "@/lib/location-denial-telemetry";

export type LatLng = { lat: number; lng: number };
export type GeoStatus = "idle" | "prompting" | "granted" | "denied" | "unsupported";

const CACHE_KEY = "openrun.userLoc.v1";
const CACHE_TTL_MS = 10 * 60 * 1000;

export const MI_PER_KM = 0.621371;
export const KM_PER_MI = 1.609344;

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function readCache(): LatLng | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; coords: LatLng };
    if (Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.coords;
  } catch {
    return null;
  }
}

function writeCache(coords: LatLng) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), coords }));
  } catch {
    /* ignore */
  }
}

export function useUserLocation() {
  const cached = typeof window !== "undefined" ? readCache() : null;
  const [coords, setCoords] = useState<LatLng | null>(cached);
  const [status, setStatus] = useState<GeoStatus>(cached ? "granted" : "idle");

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      void recordDenial(null);
      return;
    }
    setStatus("prompting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(next);
        setStatus("granted");
        writeCache(next);
      },
      (err) => {
        setStatus("denied");
        void recordDenial(err);
      },
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10_000 },
    );
  }, []);

  useEffect(() => {
    // no-op: request is explicit
  }, []);

  return { coords, status, request };
}
