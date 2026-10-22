import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { superadminPaymentHealth } from "@/lib/superadmin.functions";
import {
  PAYMENT_HEALTH_WINDOWS,
  formatDollars,
  formatPct,
  type PaymentHealth,
} from "@/lib/payment-health";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Stat({
  label,
  value,
  detail,
  warn,
}: {
  label: string;
  value: string;
  detail: string;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${warn ? "border-coral/50 bg-coral/5" : "border-border"}`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

export function PaymentHealthCard() {
  const [days, setDays] = useState<number>(90);
  const load = useServerFn(superadminPaymentHealth);
  const { data, isLoading, isError } = useQuery<PaymentHealth>({
    queryKey: ["superadmin-payment-health", days],
    queryFn: () => load({ data: { days } }),
  });

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Payment health</CardTitle>
          <div className="flex gap-1" role="group" aria-label="Time window">
            {PAYMENT_HEALTH_WINDOWS.map((w) => (
              <Button
                key={w}
                size="sm"
                variant={days === w ? "default" : "outline"}
                aria-pressed={days === w}
                onClick={() => setDays(w)}
              >
                {w}d
              </Button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          How often paid games go wrong. If these stay low, holding fees until the event isn't worth
          building yet.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : isError || !data ? (
          <div className="text-sm text-coral">Couldn't load payment health.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat
                label="Host cancelled after paid"
                value={formatPct(data.host_cancellations.rate_pct)}
                detail={`${data.host_cancellations.games_cancelled_after_payment} of ${data.host_cancellations.games_that_took_payment} paid games · ${data.host_cancellations.players_affected} players · ${formatDollars(data.host_cancellations.dollars_affected)}`}
                warn={(data.host_cancellations.rate_pct ?? 0) >= 10}
              />
              <Stat
                label="Disputed payments"
                value={formatPct(data.submissions.dispute_rate_pct)}
                detail={`${data.submissions.disputed} of ${data.submissions.total} submissions`}
                warn={(data.submissions.dispute_rate_pct ?? 0) >= 5}
              />
              <Stat
                label="Refunds owed now"
                value={String(data.refunds.owed_now_count)}
                detail={`${formatDollars(data.refunds.owed_now_dollars)} · ${data.refunds.owed_overdue_count} over 3 days (${formatDollars(data.refunds.owed_overdue_dollars)})`}
                warn={data.refunds.owed_overdue_count > 0}
              />
              <Stat
                label="Verified payments"
                value={formatDollars(data.submissions.verified_dollars)}
                detail={`${data.submissions.verified} verified · ${data.refunds.sent_in_window} refunds sent`}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold">By payment method</div>
                {data.by_type.length === 0 ? (
                  <div className="text-xs text-muted-foreground">No payments in this window.</div>
                ) : (
                  <div className="divide-y text-xs">
                    {data.by_type.map((t) => (
                      <div key={t.payment_type} className="flex justify-between gap-2 py-1">
                        <span>{t.payment_type}</span>
                        <span className="text-muted-foreground">
                          {t.submissions} submitted · {t.verified} verified · {t.disputed} disputed
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold">Hosts with repeat problems</div>
                {data.repeat_hosts.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    None with two or more problems.
                  </div>
                ) : (
                  <div className="divide-y text-xs">
                    {data.repeat_hosts.map((h) => (
                      <div key={h.host_id} className="flex justify-between gap-2 py-1">
                        <span className="truncate">{h.display_name ?? h.host_id.slice(0, 8)}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {h.cancelled_games} cancelled · {h.disputes} disputes ·{" "}
                          {h.overdue_refunds} overdue refunds
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
