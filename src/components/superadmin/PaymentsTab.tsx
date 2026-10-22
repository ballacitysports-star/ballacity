import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  superadminListPayments,
  superadminSetSubmissionStatus,
  superadminTogglePaymentMethod,
} from "@/lib/superadmin.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentHealthCard } from "@/components/superadmin/PaymentHealthCard";

export function PaymentsTab() {
  const qc = useQueryClient();
  const load = useServerFn(superadminListPayments);
  const setStatus = useServerFn(superadminSetSubmissionStatus);
  const toggleMethod = useServerFn(superadminTogglePaymentMethod);

  const { data, isLoading } = useQuery({
    queryKey: ["superadmin-payments"],
    queryFn: () => load({ data: {} }),
  });

  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      toast.success("Updated");
      qc.invalidateQueries({ queryKey: ["superadmin-payments"] });
      qc.invalidateQueries({ queryKey: ["superadmin-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (isLoading || !data) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <PaymentHealthCard />
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Payment submissions</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {data.submissions.length === 0 ? (
            <div className="text-sm text-muted-foreground">None yet.</div>
          ) : (
            data.submissions.map((s: any) => (
              <div key={s.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs min-w-0">
                  <div className="truncate">
                    Game {s.game_id} · {s.payment_type ?? "—"} ·{" "}
                    {s.paid_amount != null ? `$${Number(s.paid_amount).toFixed(2)}` : "no amount"}
                  </div>
                  <div className="text-muted-foreground truncate">
                    {new Date(s.submitted_at).toLocaleString()}
                    {s.reviewer_notes ? ` · ${s.reviewer_notes}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge
                    variant={
                      s.status === "verified"
                        ? "default"
                        : s.status === "rejected"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {s.status}
                  </Badge>
                  {(["verified", "pending", "rejected"] as const).map((st) => (
                    <Button
                      key={st}
                      size="sm"
                      variant="outline"
                      disabled={s.status === st || act.isPending}
                      onClick={() =>
                        act.mutate(() => setStatus({ data: { id: s.id, status: st } }))
                      }
                    >
                      {st}
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Host payment methods</CardTitle>
        </CardHeader>
        <CardContent className="divide-y">
          {data.methods.map((m: any) => (
            <div key={m.id} className="py-2 flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                {m.payment_type}
                {m.label ? ` · ${m.label}` : ""}
                {m.username ? ` · ${m.username}` : ""}
              </span>
              <Button
                size="sm"
                variant={m.is_enabled ? "destructive" : "outline"}
                disabled={act.isPending}
                onClick={() =>
                  act.mutate(() => toggleMethod({ data: { id: m.id, enabled: !m.is_enabled } }))
                }
              >
                {m.is_enabled ? "Disable" : "Enable"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Game payment settings</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          {data.settings.map((s: any) => (
            <div key={s.id} className="truncate">
              Game {s.game_id} · ${Number(s.entry_fee).toFixed(2)} ·{" "}
              {s.requires_approval ? "approval required" : "open"}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Purchases</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          {data.purchases.map((p: any) => (
            <div key={p.id} className="flex justify-between gap-2">
              <span className="truncate">
                {p.product_id} · {(p.amount_total / 100).toFixed(2)} {p.currency.toUpperCase()}
              </span>
              <span className="text-muted-foreground">
                {p.status} · {p.environment}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          {data.subscriptions.map((s: any) => (
            <div key={s.id} className="flex justify-between gap-2">
              <span className="truncate">{s.product_id}</span>
              <span className="text-muted-foreground">
                {s.status}
                {s.cancel_at_period_end ? " · cancelling" : ""}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Verification events</CardTitle>
        </CardHeader>
        <CardContent className="text-xs space-y-1">
          {data.events.map((e: any) => (
            <div key={e.id} className="flex justify-between gap-2">
              <span className="font-mono truncate">
                {e.action} {e.from_status ?? "—"} → {e.to_status}
              </span>
              <span className="text-muted-foreground">
                {new Date(e.created_at).toLocaleString()}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
