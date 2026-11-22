import { Fragment, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { superadminFunnel, superadminSetFunnelMinorCounts } from "@/lib/superadmin.functions";
import {
  FUNNEL_ROWS,
  FUNNEL_WINDOWS,
  formatFunnelCount,
  formatFunnelDay,
  formatFunnelPct,
  formatFunnelWeek,
  type FunnelGroup,
  type FunnelReport,
  type FunnelResult,
  type FunnelWeek,
  type FunnelWindow,
} from "@/lib/funnel";
import { userErrorMessage } from "@/lib/user-error";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmAction } from "./ConfirmAction";

const MINORS_LABEL = "Under 18 or age unknown";

/**
 * WP 5.2: the weekly pilot funnel (docs/product/phase-5-validation-plan.md). Totals only, New York weeks, every count
 * from 1 to 4 shown as "<5". The under-18 column appears only while the server-side switch is on; when the database
 * does not have the report yet, the card says so instead of failing.
 */
export function FunnelCard() {
  const [weeks, setWeeks] = useState<FunnelWindow>(8);
  const load = useServerFn(superadminFunnel);
  const { data, isLoading, isError, error } = useQuery<FunnelResult>({
    queryKey: ["superadmin-funnel", weeks],
    queryFn: () => load({ data: { weeks } }),
  });

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Pilot funnel</CardTitle>
          <div className="flex gap-1" role="group" aria-label="Weeks shown">
            {FUNNEL_WINDOWS.map((w) => (
              <Button
                key={w}
                size="sm"
                variant={weeks === w ? "default" : "outline"}
                aria-pressed={weeks === w}
                onClick={() => setWeeks(w)}
              >
                {w}w
              </Button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Post availability, get invited, join, show up. Weekly totals for adults, Monday to Sunday
          in New York time. Counts from 1 to 4 show as &lt;5, and no one is named.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : isError || !data ? (
          <div className="text-sm text-destructive">
            {userErrorMessage(error, "Couldn't load the funnel.")}
          </div>
        ) : !data.available ? (
          <div
            className="rounded-lg border border-dashed p-3 text-sm"
            data-testid="funnel-unavailable"
          >
            <div className="font-medium">Not available yet</div>
            <div className="text-xs text-muted-foreground">
              This database doesn&rsquo;t have the funnel report yet. It appears once migration
              20261127100000 is applied.
            </div>
          </div>
        ) : (
          <>
            <FunnelTable report={data.report} />
            <FunnelNotes report={data.report} />
            <MinorsSwitch on={data.report.minorsColumn} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FunnelTable({ report }: { report: FunnelReport }) {
  // Newest week first. The under-18 cells exist only while the switch is on and the server sent them.
  const weeks = [...report.weeks].reverse();
  const minors = report.minorsColumn;
  if (weeks.length === 0) {
    return <div className="text-sm text-muted-foreground">No weeks to show yet.</div>;
  }
  const cells = (w: FunnelWeek, render: (g: FunnelGroup) => string) => (
    <Fragment key={w.weekStart}>
      <td className="px-2 py-1 text-right tabular-nums">{render(w.adults)}</td>
      {minors ? (
        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
          {w.notConfirmedAdult ? render(w.notConfirmedAdult) : "–"}
        </td>
      ) : null}
    </Fragment>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-xs" aria-label="Weekly funnel">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="px-2 py-1 text-left font-medium">Step</th>
            {weeks.map((w) => (
              <th
                key={w.weekStart}
                colSpan={minors ? 2 : 1}
                className="px-2 py-1 text-right font-medium"
              >
                <div>{formatFunnelWeek(w)}</div>
                {w.source !== "live" ? (
                  <div className="text-[10px] font-normal">saved history</div>
                ) : null}
              </th>
            ))}
          </tr>
          {minors ? (
            <tr className="border-b text-[10px] text-muted-foreground">
              <th />
              {weeks.map((w) => (
                <Fragment key={w.weekStart}>
                  <th className="px-2 py-0.5 text-right font-normal">Adults</th>
                  <th className="px-2 py-0.5 text-right font-normal">{MINORS_LABEL}</th>
                </Fragment>
              ))}
            </tr>
          ) : null}
        </thead>
        <tbody>
          {FUNNEL_ROWS.map((row) => (
            <tr key={row.key} className="border-b border-border/50">
              <td className="px-2 py-1">
                <span className="mr-1 inline-block w-5 text-muted-foreground">
                  {row.step ?? ""}
                </span>
                {row.label}
                {row.detail ? (
                  <div className="pl-6 text-[10px] text-muted-foreground">{row.detail}</div>
                ) : null}
              </td>
              {weeks.map((w) => cells(w, (g) => formatFunnelCount(g[row.key])))}
            </tr>
          ))}
          <tr className="font-medium">
            <td className="px-2 py-1">
              <span className="mr-1 inline-block w-5" />
              Show-up rate · marked coverage
              <div className="pl-6 text-[10px] font-normal text-muted-foreground">
                Showed up of those marked · marked of games started. Low coverage means the rate
                says little.
              </div>
            </td>
            {weeks.map((w) =>
              cells(
                w,
                (g) =>
                  `${formatFunnelPct(g.showUpRatePct)} · ${formatFunnelPct(g.markedCoveragePct)} marked`,
              ),
            )}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function FunnelNotes({ report }: { report: FunnelReport }) {
  return (
    <ul className="space-y-0.5 text-[11px] text-muted-foreground">
      <li>
        {report.pilotStart
          ? `Counting from ${formatFunnelDay(report.pilotStart)} (the pilot start date).`
          : "No pilot start date is set, so every week is counted. Set funnel_pilot_start in Ops & config."}
      </li>
      <li>
        {report.history.available
          ? `Weeks before ${formatFunnelDay(report.history.frozenBefore ?? "")} come from the saved daily history, so deleted posts and leaves don't change them.`
          : "History isn't kept yet: deleted posts and leaves lower past weeks."}
      </li>
      <li>
        Test accounts and staff are never counted. A rate shows only when no count behind it is
        under 5.
      </li>
    </ul>
  );
}

function MinorsSwitch({ on }: { on: boolean }) {
  const qc = useQueryClient();
  const setSwitch = useServerFn(superadminSetFunnelMinorCounts);
  const [open, setOpen] = useState(false);
  const change = useMutation({
    mutationFn: (reason: string) => setSwitch({ data: { enabled: !on, reason } }),
    onSuccess: () => {
      toast.success(on ? "Under-18 column turned off" : "Under-18 column turned on");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["superadmin-funnel"] });
      qc.invalidateQueries({ queryKey: ["superadmin-settings"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: unknown) =>
      toast.error(userErrorMessage(e, "Couldn't change the under-18 column.")),
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 text-xs font-medium">
          {MINORS_LABEL} column
          <Badge variant={on ? "destructive" : "secondary"}>{on ? "On" : "Off"}</Badge>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {on
            ? "Shown because a superadmin turned it on after counsel's sign-off (pilot checklist B1). The audit log says who and why."
            : "Hidden and not computed. Turn it on only after counsel signs off, in writing, on counting minors in product metrics (pilot checklist B1)."}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        {on ? "Turn off…" : "Turn on…"}
      </Button>
      <ConfirmAction
        open={open}
        onOpenChange={setOpen}
        title={on ? "Turn off the under-18 column?" : "Turn on the under-18 column?"}
        description={
          on
            ? "The funnel stops computing and showing numbers for accounts that are not confirmed adults."
            : "The funnel will compute and show one combined column for accounts under 18 or of unknown age, masked below 5. Name counsel's written sign-off and its date in the reason (at least 20 characters); it is kept in the audit log."
        }
        confirmWord={on ? undefined : "COUNSEL"}
        confirmLabel={on ? "Turn off" : "Turn on"}
        pending={change.isPending}
        onConfirm={(reason) => change.mutate(reason)}
      />
    </div>
  );
}
