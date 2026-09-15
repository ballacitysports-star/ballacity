import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { monetizationAnalytics } from "@/lib/monetization/analytics.functions";
import { formatCents } from "@/lib/monetization/fees";

/** Small labelled figure. Wraps freely so the grid works on a phone. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="micro-label text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function MonetizationTab() {
  const [environment, setEnvironment] = useState<"sandbox" | "live">("sandbox");
  const fetchAnalytics = useServerFn(monetizationAnalytics);
  const { data, isLoading, error } = useQuery({
    queryKey: ["monetization-analytics", environment],
    queryFn: () => fetchAnalytics({ data: { environment } }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["sandbox", "live"] as const).map((env) => (
          <button
            key={env}
            onClick={() => setEnvironment(env)}
            className={`rounded-full border px-3 py-1.5 text-xs ${
              environment === env
                ? "border-lime bg-lime/10 text-lime"
                : "border-border text-muted-foreground"
            }`}
          >
            {env === "sandbox" ? "Test" : "Live"}
          </button>
        ))}
      </div>

      {isLoading ? <p className="text-sm text-muted-foreground">Loading revenue…</p> : null}
      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : null}

      {data ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Revenue (last 30 days)"
              value={formatCents(data.totals.revenueLast30dCents)}
              hint="Recurring run-rate plus processed one-off payments"
            />
            <Stat label="MRR" value={formatCents(data.subscriptions.mrrCents)} />
            <Stat
              label="Transactions (30d)"
              value={formatCents(data.transactions.revenueLast30dCents)}
              hint={`${data.transactions.count} processed to date`}
            />
            <Stat
              label="Free → paid"
              value={pct(data.reach.conversionRate)}
              hint={`${data.reach.payingUsers} paying of ${data.reach.players} members`}
            />
          </div>

          <div>
            <p className="section-eyebrow mb-2">Subscriptions</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Active" value={String(data.subscriptions.active)} />
              <Stat label="New (30d)" value={String(data.subscriptions.newLast30d)} />
              <Stat label="Cancelled (30d)" value={String(data.subscriptions.cancelledLast30d)} />
              <Stat
                label="Churn"
                value={pct(data.subscriptions.churnRate)}
                hint={`${data.subscriptions.pastDue} past due`}
              />
            </div>
          </div>

          <div>
            <p className="section-eyebrow mb-2">By product</p>
            <div className="space-y-2">
              {Object.entries(data.subscriptions.byProduct).length === 0 ? (
                <p className="text-sm text-muted-foreground">No active subscriptions yet.</p>
              ) : (
                Object.entries(data.subscriptions.byProduct).map(([key, p]) => (
                  <div
                    key={key}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-4 py-3"
                  >
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {p.active} active · {formatCents(p.mrrCents)} / mo
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <p className="section-eyebrow mb-2">Payments health</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Refunds" value={String(data.transactions.refunds)} />
              <Stat label="Failed payments" value={String(data.transactions.failures)} />
              <Stat label="Paid games" value={String(data.reach.paidGames)} />
              <Stat
                label="Hosts collecting"
                value={String(data.reach.hostsWithPaymentMethods)}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{data.directHostPaymentsNote}</p>
        </div>
      ) : null}
    </div>
  );
}
