// Use a fixed timezone so SSR (UTC) and client (user-local) render identically.
// The app is NYC-centric, so we display everything in America/New_York.
const TZ = "America/New_York";

export function formatWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const hrs = Math.round(diffMs / 3600_000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ });
  if (hrs < 1 && diffMs > 0) return `Starts in ${Math.max(1, Math.round(diffMs / 60_000))} min`;
  if (hrs < 24 && hrs >= 0) return `Today · ${time}`;
  if (hrs < 48 && hrs >= 0) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: TZ })} · ${time}`;
}
