import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { superadminListErrors } from "@/lib/error-report-admin.functions";
import { Button } from "@/components/ui/button";

/**
 * P0-8: errors reported by the app (browser and server), grouped by fingerprint. Reports hold
 * no personal data; they are kept 30 days.
 */
export function ErrorsTab() {
  const list = useServerFn(superadminListErrors);
  const [days, setDays] = useState(7);
  const q = useQuery({
    queryKey: ["superadmin-errors", days],
    queryFn: () => list({ data: { days } }),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {[1, 7, 30].map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? "default" : "outline"}
            onClick={() => setDays(d)}
          >
            Last {d === 1 ? "day" : `${d} days`}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => q.refetch()}>
          Refresh
        </Button>
      </div>
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : q.isError ? (
        <p className="text-sm text-destructive">Couldn&apos;t load errors.</p>
      ) : (q.data?.groups.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No errors reported in this period.</p>
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
