import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { superadminOverview } from "@/lib/superadmin.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function OverviewTab() {
  const load = useServerFn(superadminOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-overview"],
    queryFn: () => load({}),
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  const c = data.counts;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <Stat label="Accounts" value={c.users} hint={`${c.suspended} suspended`} />
        <Stat label="Games" value={c.games} hint={`${c.upcoming} upcoming`} />
        <Stat label="Teams / trainers" value={c.teams} />
        <Stat label="Gyms / orgs" value={c.gyms} />
        <Stat label="Availability posts" value={c.availability} />
        <Stat label="Reviews" value={c.reviews} hint={`${c.flaggedReviews} hidden`} />
        <Stat label="Reports" value={c.reports} hint={`${c.openReports} open`} />
        <Stat label="Messages" value={c.messages} />
        <Stat label="Join requests" value={c.joinRequests} hint={`${c.pendingJoins} pending`} />
        <Stat
          label="Payment submissions"
          value={c.payments}
          hint={`${c.pendingPayments} pending`}
        />
        <Stat label="Purchases" value={c.purchases} />
        <Stat label="Subscriptions" value={c.subscriptions} />
        <Stat label="Reels" value={c.reels} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Accounts by profile type</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(data.byType).map(([k, v]) => (
              <Badge key={k} variant="secondary">
                {k}: {v as number}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base">Recent superadmin actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {data.recentAudit.length === 0 ? (
              <div className="text-muted-foreground">No actions yet.</div>
            ) : (
              data.recentAudit.map((a: any) => (
                <div key={a.id} className="flex justify-between gap-2">
                  <span className="font-mono">{a.action}</span>
                  <span className="text-muted-foreground truncate">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent sign-in events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {data.signins.map((s: any) => (
              <div key={s.id} className="flex justify-between gap-2">
                <span>
                  {s.provider} · {s.event}
                  {s.error_message ? (
                    <span className="text-destructive"> · {s.error_message}</span>
                  ) : null}
                </span>
                <span className="text-muted-foreground">
                  {new Date(s.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-base">Location denials</CardTitle>
            <Button size="sm" variant="outline" asChild>
              <Link to="/admin/location-analytics">Full analytics</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {data.denials.map((d: any) => (
              <div key={d.id} className="flex justify-between gap-2">
                <span>
                  {d.reason}
                  {d.sport ? ` · ${d.sport}` : ""}
                </span>
                <span className="text-muted-foreground">
                  {new Date(d.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
