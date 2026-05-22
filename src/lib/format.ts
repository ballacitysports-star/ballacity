export function formatWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const hrs = Math.round(diffMs / 3600_000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (hrs < 1) return `Starts in ${Math.max(1, Math.round(diffMs / 60_000))} min`;
  if (hrs < 24) return `Today · ${time}`;
  if (hrs < 48) return `Tomorrow · ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${time}`;
}
