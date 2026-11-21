import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { superadminListErrors } from "@/lib/error-report-admin.functions";
import { Button } from "@/components/ui/button";

/** The windows offered, in hours. "Last hour" is the one to read right after a publish. */
const WINDOWS = [
  { hours: 1, label: "Last hour" },
  { hours: 24, label: "Last day" },
  { hours: 7 * 24, label: "Last 7 days" },
  { hours: 30 * 24, label: "Last 30 days" },
] as const;

/**
 * P0-8: errors reported by the app (browser and server), grouped by fingerprint. Reports hold
 * no personal data; they are kept 30 days. "Last hour" with "Server only" answers "did the
 * publish break anything on the server": pages that failed to render (ssr) and server functions
 * that failed (server_fn).
 */
export function ErrorsTab() {
  const list = useServerFn(superadminListErrors);
  const [hours, setHours] = useState<number>(7 * 24);
  const [serverOnly, setServerOnly] = useState(false);
  const q = useQuery({
    queryKey: ["superadmin-errors", hours, serverOnly],
    queryFn: () => list({ data: { hours, serverOnly } }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {WINDOWS.map((w) => (
          <Button
            key={w.hours}
            size="sm"
            variant={hours === w.hours ? "default" : "outline"}
            aria-pressed={hours === w.hours}
            onClick={() => setHours(w.hours)}
          >
            {w.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant={serverOnly ? "default" : "outline"}
          aria-pressed={serverOnly}
          onClick={() => setServerOnly((on) => !on)}
        >
          Server only
        </Button>
        <Button size="sm" variant="ghost" onClick={() => q.refetch()}>
          Refresh
        </Button>
      </div>
      {serverOnly ? (
        <p className="text-xs text-muted-foreground">
          Server only: pages that failed to render (ssr) and server functions that failed
          (server_fn).
        </p>
      ) : null}
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">Couldn&apos;t load errors.</p>
      ) : (q.data?.groups.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          {serverOnly
            ? "No server errors reported in this period."
            : "No errors reported in this period."}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {q.data?.total} reports{q.data?.capped ? " (showing the latest 2,000)" : ""}, grouped by
            error. No personal data is stored.
          </p>
          <ul className="space-y-2">
            {q.data?.groups.map((g) => (
              <li key={g.fingerprint} className="rounded-xl border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <code className="break-all text-xs">{g.message}</code>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                    {g.count}×
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {g.route ?? "(no route)"} · {g.sources.join(", ")} · {g.kinds.join(", ")} ·{" "}
                  {g.signedInCount} signed in · last {new Date(g.lastAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
