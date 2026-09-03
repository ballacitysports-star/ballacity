import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { adminYouthOversight, type YouthOversight } from "@/lib/compliance.functions";
import { COHORT_META } from "@/lib/child-policy";
import {
  backlogTone,
  dayPartLabel,
  dayPartOrder,
  fmtMinutes,
  overnightTone,
  STALE_PENDING_DAYS,
  type OversightTone,
} from "@/lib/youth-oversight";

const WINDOWS = [7, 30, 90] as const;

function ToneBadge({ tone, children }: { tone: OversightTone; children: React.ReactNode }) {
  const variant = tone === "ok" ? "secondary" : tone === "warn" ? "outline" : "destructive";
  return <Badge variant={variant}>{children}</Badge>;
}

function cohortLabel(cohort: string) {
  return (COHORT_META as Record<string, { short: string }>)[cohort]?.short ?? cohort;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * Minor time-on-platform averages and the parental-consent backlog.
 * Duration-only telemetry — no page-level tracking of any minor.
 */
export function YouthOversightCard() {
  const qc = useQueryClient();
  const load = useServerFn(adminYouthOversight);
  const [days, setDays] = useState<number>(30);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-youth-oversight", days],
    queryFn: () => load({ data: { days } }) as Promise<YouthOversight>,
  });

  const backlog = data?.backlog;
  const cohorts = data?.cohorts ?? [];
  const rows = [...(data?.usage ?? [])].sort(
    (a, b) =>
      a.cohort.localeCompare(b.cohort) || dayPartOrder(a.dayPart) - dayPartOrder(b.dayPart),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <CardTitle className="text-base">Youth oversight</CardTitle>
        {backlog ? <ToneBadge tone={backlogTone(backlog)}>Consent backlog</ToneBadge> : null}
        {data ? <ToneBadge tone={overnightTone(cohorts)}>Overnight use</ToneBadge> : null}
        <div className="ml-auto flex gap-1">
          {WINDOWS.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={w === days ? "default" : "outline"}
              onClick={() => {
                setDays(w);
                qc.invalidateQueries({ queryKey: ["admin-youth-oversight", w] });
              }}
            >
              {w}d
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? <p className="text-sm text-muted-foreground">Loading youth metrics…</p> : null}
        {isError ? (
          <p className="text-sm text-destructive">
            Could not load youth metrics: {(error as Error).message}
          </p>
        ) : null}

        {backlog && data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric
                label="Awaiting guardian request"
                value={String(backlog.required)}
                hint="Under-16 accounts with no consent record"
              />
              <Metric
                label="Pending approval"
                value={String(backlog.pending)}
                hint={
                  backlog.oldestPendingAt
                    ? `Oldest ${new Date(backlog.oldestPendingAt).toLocaleDateString()}`
                    : "No queue"
                }
              />
              <Metric
                label={`Stale over ${STALE_PENDING_DAYS}d`}
                value={String(backlog.stalePending)}
                hint="Needs a manual follow-up"
              />
              <Metric
                label="Revoked"
                value={String(backlog.revoked)}
                hint={`${backlog.approved} approved all time`}
              />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label="Minor accounts" value={String(data.minorsTotal)} />
              <Metric
                label="Minors not fully consented"
                value={String(data.minorsBlocked)}
                hint="Required + pending + revoked"
              />
              <Metric
                label="Session rows tracked"
                value={String(data.tracked)}
                hint="Duration only"
              />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-medium">
                Average daily minutes per minor ({data.windowDays}-day window)
              </h3>
              {cohorts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No minor session activity recorded in this window.
                </p>
              ) : (
                <div className="space-y-2">
                  {cohorts.map((c) => (
                    <div key={c.cohort} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{cohortLabel(c.cohort)}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.members} member{c.members === 1 ? "" : "s"} active
                        </span>
                        <span className="ml-auto text-sm font-semibold">
                          {fmtMinutes(c.avgDailyMinutes)}/day
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                        {rows
                          .filter((r) => r.cohort === c.cohort)
                          .map((r) => (
                            <span key={r.dayPart}>
                              {dayPartLabel(r.dayPart)}: {fmtMinutes(r.avgDailyMinutes)}
                            </span>
                          ))}
                      </div>
                      {c.overnightMinutes > 0 ? (
                        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                          {fmtMinutes(c.overnightMinutes)} of overnight use per day — check the
                          notification curfew settings.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/moderation">Moderation queue</Link>
              </Button>
              <span className="text-xs text-muted-foreground">
                Duration-only session data. LEGAL REVIEW REQUIRED for retention of these rows.
              </span>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
