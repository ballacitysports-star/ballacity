import { useCallback, useEffect, useSyncExternalStore } from "react";
import { recordDenial } from "@/lib/location-denial-telemetry";

export type LatLng = { lat: number; lng: number };
export type GeoStatus = "idle" | "prompting" | "granted" | "denied" | "unsupported";

const CACHE_KEY = "openrun.userLoc.v1";
/** How long a stored fix counts as "fresh" before we label it remembered. */
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

type LocationSnapshot = {
  /** Coordinates currently used for every distance in the UI. */
  coords: LatLng | null;
  status: GeoStatus;
  /** When `coords` were captured (ms epoch), or null when we have none. */
  fixedAt: number | null;
  /** True when coords come from the remembered last-granted fix, not a fresh read. */
  remembered: boolean;
  /** Where the current coords came from — a device fix or a typed-in place. */
  source: "device" | "manual" | null;
  /** Label of the manually chosen place, when source is "manual". */
  label: string | null;
  /** Why the last attempt failed ("denied" | "blocked" | "timeout" | "unavailable"). */
  error: "denied" | "blocked" | "timeout" | "unavailable" | null;
};

const EMPTY: LocationSnapshot = {
  coords: null,
  status: "idle",
  fixedAt: null,
  remembered: false,
  source: null,
  label: null,
  error: null,
};

let snapshot: LocationSnapshot = EMPTY;
const listeners = new Set<() => void>();
let hydrated = false;

function emit() {
  for (const l of [...listeners]) l();
}

function setSnapshot(next: LocationSnapshot) {
  snapshot = next;
  emit();
}

function readCache(): { coords: LatLng; at: number } | null {
  if (typeof window === "undefined") return null;
  for (const store of [window.localStorage, window.sessionStorage]) {
    try {
      const raw = store?.getItem(CACHE_KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { at: number; coords: LatLng };
      if (
        !parsed?.coords ||
        typeof parsed.coords.lat !== "number" ||
        typeof parsed.coords.lng !== "number"
      ) {
        continue;
      }
      return { coords: parsed.coords, at: typeof parsed.at === "number" ? parsed.at : 0 };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function writeCache(coords: LatLng) {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ at: Date.now(), coords });
  // localStorage remembers the last granted location across sessions;
  // sessionStorage keeps older builds/tabs in sync.
  try {
    window.localStorage.setItem(CACHE_KEY, payload);
  } catch {
    /* ignore */
  }
  try {
    window.sessionStorage.setItem(CACHE_KEY, payload);
  } catch {
    /* ignore */
  }
}

/** Forget the remembered fix (used by "reset location" affordances). */
export function clearRememberedLocation() {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(CACHE_KEY);
      window.sessionStorage.removeItem(CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
  setSnapshot(EMPTY);
}

/** Load the remembered fix once, after hydration, so SSR/CSR markup matches. */
function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;
  const cached = readCache();
  if (!cached) return;
  const fresh = Date.now() - cached.at <= CACHE_TTL_MS;
  setSnapshot({
    ...EMPTY,
    coords: cached.coords,
    status: "granted",
    fixedAt: cached.at,
    remembered: !fresh,
    source: "device",
  });
}

/** The single viewer location every distance in the app is derived from. */
export function getViewerLocation(): LocationSnapshot {
  return snapshot;
}

/**
 * Set the viewer location from a place the user typed in. This is the fallback
 * when the browser refuses to share a position (blocked permission, embedded
 * preview, unsupported browser) — distances still work, just from a chosen spot.
 */
export function setManualViewerLocation(coords: LatLng, label?: string): void {
  writeCache(coords);
  setSnapshot({
    coords,
    status: "granted",
    fixedAt: Date.now(),
    remembered: false,
    source: "manual",
    label: label ?? null,
    error: null,
  });
}

/**
 * Ask the browser for a position. Safe to call repeatedly: after a denial this
 * re-requests permission, which re-prompts in browsers where the user has since
 * cleared the block, and keeps the remembered fix visible meanwhile.
 *
 * Resolves with the resulting snapshot so callers can react (e.g. offer manual
 * entry) instead of leaving a tap with no visible effect.
 */
export function requestViewerLocation(): Promise<LocationSnapshot> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    setSnapshot({ ...snapshot, status: "unsupported", error: "unavailable" });
    void recordDenial(null);
    return Promise.resolve(snapshot);
  }
  setSnapshot({ ...snapshot, status: "prompting", error: null });
  return new Promise<LocationSnapshot>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(snapshot);
    };
    // Some embedded contexts never invoke either callback (permissions policy
    // blocks the request outright); don't leave the UI stuck on "Locating…".
    const watchdog = setTimeout(() => {
      if (settled) return;
      setSnapshot({
        ...snapshot,
        status: "denied",
        remembered: !!snapshot.coords,
        error: "blocked",
      });
      finish();
    }, 12_000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(watchdog);
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        writeCache(coords);
        setSnapshot({
          coords,
          status: "granted",
          fixedAt: Date.now(),
          remembered: false,
          source: "device",
          label: null,
          error: null,
        });
        finish();
      },
      (err) => {
        clearTimeout(watchdog);
        // Keep the remembered coordinates: a denial shouldn't blank out distances
        // the viewer already saw.
        const code = err?.code;
        setSnapshot({
          ...snapshot,
          status: "denied",
          remembered: !!snapshot.coords,
          error:
            code === 1
              ? "denied"
              : code === 3
                ? "timeout"
                : code === 2
                  ? "unavailable"
                  : "blocked",
        });
        void recordDenial(err);
        finish();
      },
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10_000 },
    );
  });
}

/** Human explanation of the current location state, for tooltips/help text. */
export function locationStatusExplanation(status: GeoStatus, remembered = false): string {
  switch (status) {
    case "granted":
      return remembered
        ? "Using your last known location. Refresh it for exact distances."
        : "Distances are measured from your current location.";
    case "prompting":
      return "Waiting for your device to share a position…";
    case "denied":
      return "Location is blocked for this site. Allow it in your browser's site settings, then tap again.";
    case "unsupported":
      return "This browser can't share a location, so distances can't be measured.";
    default:
      return "Share your location to see how far away each game is.";
  }
}

export function useUserLocation() {
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => EMPTY,
  );

  useEffect(() => {
    hydrateOnce();
  }, []);

  const request = useCallback(() => requestViewerLocation(), []);
  const forget = useCallback(() => clearRememberedLocation(), []);
  const setManual = useCallback(
    (coords: LatLng, label?: string) => setManualViewerLocation(coords, label),
    [],
  );

  return {
    coords: snap.coords,
    status: snap.status,
    fixedAt: snap.fixedAt,
    remembered: snap.remembered,
    source: snap.source,
    label: snap.label,
    error: snap.error,
    explanation: locationStatusExplanation(snap.status, snap.remembered),
    request,
    forget,
    setManual,
  };
}

/** Test helper: reset the shared store between cases. */
export function __resetViewerLocationForTests() {
  hydrated = false;
  snapshot = EMPTY;
  emit();
}
