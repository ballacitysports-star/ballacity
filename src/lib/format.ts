// Use a fixed timezone and day anchor so SSR and client hydration render identically.
// The app is NYC-centric, so we display everything in America/New_York.
const TZ = "America/New_York";
const HOUR_MS = 3600_000;

function dayAnchorMs() {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  return d.getTime();
}

export function formatWhen(iso: string) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  const hrs = Math.round((d.getTime() - dayAnchorMs()) / HOUR_MS);
  if (hrs < 24 && hrs >= 0) return `Today · ${time}`;
  if (hrs < 48 && hrs >= 0) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ })} · ${time}`;
}

/** Date-only "when" line (no time), used for all-day events. */
export function formatWhenDate(iso: string) {
  const d = new Date(iso);
  const hrs = Math.round((d.getTime() - dayAnchorMs()) / HOUR_MS);
  if (hrs < 24 && hrs >= 0) return `Today`;
  if (hrs < 48 && hrs >= 0) return `Tomorrow`;
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ })}`;
}
