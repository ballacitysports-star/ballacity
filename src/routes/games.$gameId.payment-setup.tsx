import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { RouteFallback, FALLBACK_ACTION_CLASS } from "@/components/layout/RouteFallback";
import { pageHead } from "@/lib/seo";
import { useEffect, useState } from "react";
import { ArrowLeft, Check, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { GAMES } from "@/lib/sample-data";
import { useAuth } from "@/hooks/use-auth";
import {
  type PaymentMethod,
  type HostPayPalAccount,
  paymentTypeMeta,
  listMyPaymentMethods,
  getMyGamePaymentSettings,
  upsertGamePaymentSettings,
  getMyPayPalAccount,
  saveMyPayPalAccount,
  disconnectMyPayPalAccount,
} from "@/lib/payments";
import { LegalNotice } from "@/components/LegalNotice";
import { RefundPolicyFields } from "@/components/RefundPolicyFields";
import { DEFAULT_REFUND_RULE, normalizeRefundPolicy, type RefundPolicy } from "@/lib/refund-policy";

export const Route = createFileRoute("/games/$gameId/payment-setup")({
  head: () =>
    pageHead({
      title: "Payment setup — BallaCity",
      description: "Set the entry fee, accepted payment methods, and refund policy for your game.",
      noindex: true,
    }),
  loader: ({ params }) => {
    const game = GAMES.find((g) => g.id === params.gameId);
    if (!game) throw notFound();
    return { game };
  },
  notFoundComponent: () => (
    <RouteFallback
      title="Game not found"
      message="It may have wrapped up or been cancelled."
      action={
        <Link to="/feed" className={FALLBACK_ACTION_CLASS}>
          Back to feed
        </Link>
      }
    />
  ),
  errorComponent: ({ reset }) => (
    <RouteFallback
      title="Couldn't open payment setup"
      onRetry={reset}
      action={
        <Link to="/feed" className={FALLBACK_ACTION_CLASS}>
          Back to feed
        </Link>
      }
    />
  ),
  component: SetupPage,
});

function SetupPage() {
  const { game } = Route.useLoaderData();
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [fee, setFee] = useState<string>(String(game.price || 0));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deadline, setDeadline] = useState("");
  const [refundRule, setRefundRule] = useState<RefundPolicy>({
    rule: DEFAULT_REFUND_RULE,
    latePct: 0,
  });
  const [refundPolicy, setRefundPolicy] = useState("");
  const [instructions, setInstructions] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paypal, setPaypal] = useState<HostPayPalAccount | null>(null);
  const [paypalMerchantId, setPaypalMerchantId] = useState("");
  const [paypalEmail, setPaypalEmail] = useState("");
  const [paypalSaving, setPaypalSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) nav({ to: "/auth" });
  }, [loading, user, nav]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [m, s, pp] = await Promise.all([
        listMyPaymentMethods(),
        getMyGamePaymentSettings(game.id),
        getMyPayPalAccount(),
      ]);
      if (pp) {
        setPaypal(pp);
        setPaypalMerchantId(pp.merchant_id);
        setPaypalEmail(pp.email ?? "");
      }
      setMethods(m.filter((x) => x.is_enabled));
      if (s) {
        setFee(String(s.entry_fee));
        setSelected(new Set(s.accepted_method_ids));
        setDeadline(s.payment_deadline ? s.payment_deadline.slice(0, 16) : "");
        setRefundRule(normalizeRefundPolicy(s.refund_rule, s.late_refund_pct));
        setRefundPolicy(s.refund_policy ?? "");
        setInstructions(s.payment_instructions ?? "");
        setRequiresApproval(!!s.requires_approval);
      }
    })();
  }, [user, game.id]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await upsertGamePaymentSettings({
        game_id: game.id,
        entry_fee: Number(fee) || 0,
        accepted_method_ids: Array.from(selected),
        payment_deadline: deadline ? new Date(deadline).toISOString() : null,
        refund_rule: refundRule.rule,
        late_refund_pct: refundRule.rule === "none" ? 0 : refundRule.latePct,
        refund_policy: refundPolicy || null,
        payment_instructions: instructions || null,
        requires_approval: requiresApproval,
      });
      toast.success("Settings saved");
      nav({ to: "/games/$gameId", params: { gameId: game.id } });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="page-shell-narrow pt-6 pb-24 space-y-5">
      <div className="flex items-center gap-3">
        <Link
          to="/games/$gameId"
          params={{ gameId: game.id }}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="bar-title">Payment setup</h1>
          <div className="text-xs text-muted-foreground">{game.title}</div>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-surface p-4 space-y-3">
        <div>
          <div className="text-sm font-semibold">PayPal checkout (in-app)</div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Let players pay inside BallaCity — money goes straight to your PayPal account and
            they're marked paid automatically. Find your Merchant ID in PayPal → Account settings →
            Business information.
          </p>
        </div>
        {paypal ? (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3 py-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold flex items-center gap-1.5">
                <Check className="h-4 w-4 text-lime" /> Connected
              </div>
              <div className="text-xs text-muted-foreground truncate">
                Merchant {paypal.merchant_id}
                {paypal.email ? ` · ${paypal.email}` : ""}
              </div>
            </div>
            <button
              type="button"
              disabled={paypalSaving}
              onClick={async () => {
                setPaypalSaving(true);
                try {
                  await disconnectMyPayPalAccount();
                  setPaypal(null);
                  setPaypalMerchantId("");
                  setPaypalEmail("");
                  toast.success("PayPal disconnected");
                } catch (e: any) {
                  toast.error(e.message);
                } finally {
                  setPaypalSaving(false);
                }
              }}
              className="text-xs font-semibold text-coral"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <input
              value={paypalMerchantId}
              onChange={(e) => setPaypalMerchantId(e.target.value)}
              placeholder="PayPal Merchant ID (e.g. ABC123DEF456G)"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              maxLength={64}
            />
            <input
              value={paypalEmail}
              onChange={(e) => setPaypalEmail(e.target.value)}
              placeholder="PayPal account email (optional)"
              type="email"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              maxLength={200}
            />
            <button
              type="button"
              disabled={paypalSaving || !paypalMerchantId.trim()}
              onClick={async () => {
                setPaypalSaving(true);
                try {
                  await saveMyPayPalAccount(paypalMerchantId, paypalEmail);
                  const saved = await getMyPayPalAccount();
                  setPaypal(saved);
                  toast.success("PayPal connected — players can now pay in-app");
                } catch (e: any) {
                  toast.error(e.message);
                } finally {
                  setPaypalSaving(false);
                }
              }}
              className="inline-flex items-center rounded-full bg-lime-gradient px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              {paypalSaving ? "Connecting…" : "Connect PayPal"}
            </button>
          </div>
        )}
      </section>

      <section>
        <Label>Entry fee</Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface pl-7 pr-3 py-3 text-sm outline-none focus:border-lime"
          />
        </div>
      </section>

      <section>
        <button
          type="button"
          onClick={() => setRequiresApproval((v) => !v)}
          className={`w-full flex items-center justify-between gap-3 rounded-2xl border p-4 text-left ${
            requiresApproval ? "border-lime bg-lime/5" : "border-border bg-surface"
          }`}
        >
          <div className="min-w-0">
            <div className="font-semibold text-sm">Require my approval to join</div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Players send a request and you decide who's in. Useful for skill-matched or
              invite-only games.
            </p>
          </div>
          <div
            className={`shrink-0 grid h-7 w-12 items-center rounded-full p-0.5 transition-colors ${requiresApproval ? "bg-lime" : "bg-secondary"}`}
          >
            <div
              className={`h-6 w-6 rounded-full bg-background shadow transition-transform ${requiresApproval ? "translate-x-5" : ""}`}
            />
          </div>
        </button>
      </section>

      <section>
        <Label>Accepted payment methods</Label>
        {methods.length === 0 ? (
          <Link
            to="/payments"
            className="block rounded-2xl border border-dashed border-coral/40 bg-coral/5 p-4 text-sm"
          >
            <div className="flex items-center gap-2 font-semibold text-coral">
              <ShieldAlert className="h-4 w-4" /> No payment methods yet
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Add Venmo, Cash App, Zelle, or others before charging for games.
            </p>
          </Link>
        ) : (
          <div className="space-y-2">
            {methods.map((m) => {
              const meta = paymentTypeMeta(m.payment_type);
              const on = selected.has(m.id);
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => {
                    const n = new Set(selected);
                    if (on) n.delete(m.id);
                    else n.add(m.id);
                    setSelected(n);
                  }}
                  className={`w-full flex items-center gap-3 rounded-2xl border p-3 text-left ${
                    on ? "border-lime bg-lime/5" : "border-border bg-surface"
                  }`}
                >
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-secondary text-base">
                    {meta.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{m.label || meta.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {m.username || m.contact_info}
                    </div>
                  </div>
                  <div
                    className={`grid h-6 w-6 place-items-center rounded-full ${on ? "bg-lime text-primary-foreground" : "border border-border"}`}
                  >
                    {on && <Check className="h-4 w-4" />}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <Label>Payment deadline (optional)</Label>
        <input
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm outline-none focus:border-lime [color-scheme:dark]"
        />
      </section>

      <section>
        <Label>Refund policy</Label>
        <RefundPolicyFields
          value={refundRule}
          onChange={setRefundRule}
          cutoffMin={game.cancelCutoffMin}
          idPrefix="setup-refund"
          className="mb-3"
        />
        <Label>Refund notes (optional)</Label>
        <textarea
          rows={3}
          value={refundPolicy}
          onChange={(e) => setRefundPolicy(e.target.value)}
          placeholder="e.g. Rain-outs are refunded in full."
          className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm outline-none focus:border-lime resize-none"
        />
      </section>

      <section>
        <Label>Payment instructions (optional)</Label>
        <textarea
          rows={3}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. Include your full name in the payment note."
          className="w-full rounded-xl border border-border bg-surface px-3 py-3 text-sm outline-none focus:border-lime resize-none"
        />
      </section>

      <LegalNotice />

      <button
        type="submit"
        disabled={saving || (Number(fee) > 0 && selected.size === 0)}
        className="w-full rounded-2xl bg-lime-gradient py-4 font-bold text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save payment settings"}
      </button>
    </form>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 section-eyebrow text-muted-foreground">{children}</div>;
}
