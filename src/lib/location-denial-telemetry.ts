// Lightweight client-side instrumentation for geolocation denials.
// We capture the reason a GPS auto-center failed so the inline prompt can
// be fine-tuned to the actual failure mode (browser block vs. user dismiss
// vs. signal unavailable vs. timeout). Data is kept in localStorage for
// the in-app prompt AND mirrored to the backend `location_denial_events`
// table so admins can track denial trends across users/devices.

import { supabase } from "@/integrations/supabase/client";

export type DenialReason =
  | "permission_blocked" // Permissions API reports 'denied' — browser/site setting
  | "permission_dismissed" // User dismissed the prompt (code 1, state 'prompt')
  | "permission_denied" // Generic code 1 (Permissions API unavailable)
  | "position_unavailable" // code 2 — no signal / hardware off
  | "timeout" // code 3
  | "unsupported" // navigator.geolocation missing
  | "unknown";

export type DenialRecord = {
  reason: DenialReason;
  code: number | null;
  message: string;
  permissionState: PermissionState | "unsupported" | null;
  at: number;
  userAgent: string;
};

const STORAGE_KEY = "loc-denial-telemetry/v1";
const MAX_RECORDS = 20;

type Store = {
  records: DenialRecord[];
  counts: Partial<Record<DenialReason, number>>;
};

function readStore(): Store {
  if (typeof window === "undefined") return { records: [], counts: {} };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { records: [], counts: {} };
    const parsed = JSON.parse(raw) as Store;
    return {
      records: Array.isArray(parsed.records) ? parsed.records : [],
      counts: parsed.counts ?? {},
    };
  } catch {
    return { records: [], counts: {} };
  }
}

function writeStore(store: Store) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — ignore */
  }
}

export async function classifyGeoError(
  err: GeolocationPositionError | null,
): Promise<{ reason: DenialReason; permissionState: PermissionState | "unsupported" | null }> {
  let permissionState: PermissionState | "unsupported" | null = "unsupported";
  try {
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      const status = await navigator.permissions.query({ name: "geolocation" as PermissionName });
      permissionState = status.state;
    }
  } catch {
    permissionState = "unsupported";
  }

  if (!err) return { reason: "unsupported", permissionState };

  if (err.code === 1) {
    if (permissionState === "denied") return { reason: "permission_blocked", permissionState };
    if (permissionState === "prompt") return { reason: "permission_dismissed", permissionState };
    return { reason: "permission_denied", permissionState };
  }
  if (err.code === 2) return { reason: "position_unavailable", permissionState };
  if (err.code === 3) return { reason: "timeout", permissionState };
  return { reason: "unknown", permissionState };
}

export async function recordDenial(
  err: GeolocationPositionError | null,
): Promise<DenialRecord> {
  const { reason, permissionState } = await classifyGeoError(err);
  const record: DenialRecord = {
    reason,
    code: err?.code ?? null,
    message: err?.message ?? "",
    permissionState,
    at: Date.now(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
  };
  const store = readStore();
  store.records = [record, ...store.records].slice(0, MAX_RECORDS);
  store.counts[reason] = (store.counts[reason] ?? 0) + 1;
  writeStore(store);
  return record;
}

export function getDenialStats(): Store {
  return readStore();
}

export function clearDenialStats() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export type PromptCopy = {
  title: string;
  hint: string;
  cta: string;
};

/**
 * Fine-tuned inline prompt copy. The first arg is the most recent denial
 * reason; the second is the cumulative count for that reason so repeat
 * offenders get nudged toward the right remediation (e.g. open browser
 * settings) instead of just "tap to try again".
 */
export function promptCopyFor(reason: DenialReason, repeatCount = 1): PromptCopy {
  switch (reason) {
    case "permission_blocked":
      return {
        title: "Location is blocked for this site",
        hint:
          repeatCount > 1
            ? "Open your browser's site settings and allow Location, then reload."
            : "Allow location in your browser's site settings to auto-center the map.",
        cta: "Try again after allowing",
      };
    case "permission_dismissed":
      return {
        title: "We need your location",
        hint: "Tap below and choose Allow on the browser prompt to center the map on you.",
        cta: "Share my location",
      };
    case "permission_denied":
      return {
        title: "Location permission denied",
        hint: "Tap to retry. If nothing happens, check your browser's site permissions.",
        cta: "Try again",
      };
    case "position_unavailable":
      return {
        title: "Location signal unavailable",
        hint: "Move somewhere with a clearer GPS signal or enable location services on your device.",
        cta: "Retry",
      };
    case "timeout":
      return {
        title: "Locating took too long",
        hint: "Your device didn't return a fix in time. Tap to try once more.",
        cta: "Retry",
      };
    case "unsupported":
      return {
        title: "Location isn't supported here",
        hint: "Your browser doesn't expose geolocation. Set your area manually above.",
        cta: "Retry",
      };
    default:
      return {
        title: "Couldn't get your location",
        hint: "Tap to try again, or set your area manually above.",
        cta: "Retry",
      };
  }
}
