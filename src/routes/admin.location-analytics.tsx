import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { adminCheck } from "@/lib/admin.functions";
import { parseBrowser, type DenialReason } from "@/lib/location-denial-telemetry";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/location-analytics")({
  head: () =>
    pageHead({
      path: "/admin/location-analytics",
      title: "Location analytics — ballaCity admin",
      description: "Internal analytics for location permission denials.",
      noindex: true,
    }),
  ssr: false,
  component: LocationAnalyticsPage,
});

type Row = {
  id: string;
  created_at: string;
  reason: string;
  user_id: string | null;
  user_agent: string | null;
  permission_state: string | null;
  sport: string | null;
};

const REASONS: DenialReason[] = [
  "permission_blocked",
  "permission_dismissed",
  "permission_denied",
  "position_unavailable",
  "timeout",
  "unsupported",
  "unknown",
];

const REASON_COLORS: Record<string, string> = {
  permission_blocked: "hsl(0 72% 51%)",
  permission_dismissed: "hsl(25 95% 53%)",
  permission_denied: "hsl(45 93% 47%)",
  position_unavailable: "hsl(200 80% 50%)",
  timeout: "hsl(280 60% 55%)",
  unsupported: "hsl(160 60% 40%)",
  unknown: "hsl(0 0% 50%)",
};

function LocationAnalyticsPage() {
  const navigate = useNavigate();
  const check = useServerFn(adminCheck);
  const [authReady, setAuthReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  const [days, setDays] = useState<string>("30");
  const [sport, setSport] = useState<string>("all");
  const [browser, setBrowser] = useState<string>("all");
  const [sessionType, setSessionType] = useState<string>("all");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setHasSession(!!session);
      setAuthReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const { data: adminData, isLoading: checking } = useQuery({
    queryKey: ["admin-check"],
    queryFn: () => check({}),
    enabled: authReady && hasSession,
  });

  useEffect(() => {
    if (authReady && !hasSession) {
      navigate({ to: "/auth" });
      return;
    }
    if (!checking && adminData && !adminData.isAdmin) {
      toast.error("Admin access required");
      navigate({ to: "/" });
    }
  }, [authReady, hasSession, checking, adminData, navigate]);

  const sinceISO = useMemo(() => {
    const n = Number(days);
    const ms = Number.isFinite(n) && n > 0 ? n * 86400000 : 30 * 86400000;
    return new Date(Date.now() - ms).toISOString();
  }, [days]);

  const {
    data: events,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["denial-events", sinceISO],
    enabled: !!adminData?.isAdmin,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("location_denial_events")
        .select("id,created_at,reason,user_id,user_agent,permission_state,sport")
        .gte("created_at", sinceISO)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const enriched = useMemo(() => {
    return (events ?? []).map((e) => ({
      ...e,
      browser: parseBrowser(e.user_agent),
      sessionType: e.user_id ? "signed_in" : "anonymous",
      sportLabel: e.sport ?? "—",
    }));
  }, [events]);

  const sportOptions = useMemo(() => {
    const set = new Set<string>();
    enriched.forEach((e) => set.add(e.sportLabel));
    return Array.from(set).sort();
  }, [enriched]);

  const browserOptions = useMemo(() => {
    const set = new Set<string>();
    enriched.forEach((e) => set.add(e.browser));
    return Array.from(set).sort();
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched.filter((e) => {
      if (sport !== "all" && e.sportLabel !== sport) return false;
      if (browser !== "all" && e.browser !== browser) return false;
      if (sessionType !== "all" && e.sessionType !== sessionType) return false;
      return true;
    });
  }, [enriched, sport, browser, sessionType]);

  const trendData = useMemo(() => {
    const byDay: Record<string, Record<string, number>> = {};
    filtered.forEach((e) => {
      const day = e.created_at.slice(0, 10);
      if (!byDay[day]) byDay[day] = {};
      byDay[day][e.reason] = (byDay[day][e.reason] ?? 0) + 1;
    });
    const numDays = Math.min(Number(days) || 30, 180);
    const series: Array<Record<string, number | string>> = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const row: Record<string, number | string> = { date: d.slice(5) };
      for (const r of REASONS) row[r] = byDay[d]?.[r] ?? 0;
      series.push(row);
    }
    return series;
  }, [filtered, days]);

  const totalsByReason = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((e) => {
      counts[e.reason] = (counts[e.reason] ?? 0) + 1;
    });
    return REASONS.map((r) => ({ reason: r, count: counts[r] ?? 0 })).filter((x) => x.count > 0);
  }, [filtered]);

  const totalsByBrowser = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach((e) => {
      counts[e.browser] = (counts[e.browser] ?? 0) + 1;
    });
    return Object.entries(counts)
      .map(([browser, count]) => ({ browser, count }))
      .sort((a, b) => b.count - a.count);
  }, [filtered]);

  if (!authReady || checking || !adminData?.isAdmin) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4 max-w-6xl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Location denial analytics</h1>
          <p className="text-sm text-muted-foreground">
            Trends in geolocation permission failures across users, browsers and sports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin">← Admin</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Timeframe</label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="14">Last 14 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
                <SelectItem value="180">Last 180 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Sport</label>
            <Select value={sport} onValueChange={setSport}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sports</SelectItem>
                {sportOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Browser</label>
            <Select value={browser} onValueChange={setBrowser}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All browsers</SelectItem>
                {browserOptions.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Session type</label>
            <Select value={sessionType} onValueChange={setSessionType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sessions</SelectItem>
                <SelectItem value="signed_in">Signed-in</SelectItem>
                <SelectItem value="anonymous">Anonymous</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total denials" value={filtered.length} />
        <StatCard
          label="Unique users"
          value={new Set(filtered.filter((e) => e.user_id).map((e) => e.user_id)).size}
        />
        <StatCard label="Anonymous events" value={filtered.filter((e) => !e.user_id).length} />
        <StatCard label="Top reason" value={totalsByReason[0]?.reason ?? "—"} small />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Denials over time by reason</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-72 grid place-items-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : trendData.length === 0 ? (
            <div className="h-72 grid place-items-center text-sm text-muted-foreground">
              No events in range.
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {REASONS.map((r) => (
                    <Line
                      key={r}
                      type="monotone"
                      dataKey={r}
                      stroke={REASON_COLORS[r]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Totals by reason</CardTitle>
          </CardHeader>
          <CardContent>
            {totalsByReason.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={totalsByReason}
                    margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis
                      dataKey="reason"
                      fontSize={10}
                      interval={0}
                      angle={-20}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Totals by browser</CardTitle>
          </CardHeader>
          <CardContent>
            {totalsByBrowser.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={totalsByBrowser}
                    margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="browser" fontSize={11} />
                    <YAxis fontSize={11} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent events</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">Reason</th>
                <th className="py-2 pr-3">Sport</th>
                <th className="py-2 pr-3">Browser</th>
                <th className="py-2 pr-3">Session</th>
                <th className="py-2 pr-3">Permission</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map((e) => (
                <tr key={e.id} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="py-1.5 pr-3">
                    <Badge variant="secondary" className="text-[10px]">
                      {e.reason}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-3">{e.sportLabel}</td>
                  <td className="py-1.5 pr-3">{e.browser}</td>
                  <td className="py-1.5 pr-3">{e.sessionType}</td>
                  <td className="py-1.5 pr-3">{e.permission_state ?? "—"}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-muted-foreground">
                    No events.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  small,
}: {
  label: string;
  value: string | number;
  small?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={small ? "text-base font-semibold mt-1" : "text-2xl font-semibold mt-1"}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
