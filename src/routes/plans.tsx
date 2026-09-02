import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { Check, Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useAllSubscriptions } from "@/hooks/useAllSubscriptions";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { FREE_TIER, PLAN_TIERS } from "@/lib/catalog";
import { getStripeEnvironment } from "@/lib/stripe";
import { createPortalSession } from "@/utils/payments.functions";
import { useState } from "react";

export const Route = createFileRoute("/plans")({
  head: () =>
    pageHead({
      path: "/plans",
      title: "Plans & subscriptions — ballaCity",
      description:
        "Compare ballaCity plans: host games, run a team, and generate unlimited AI highlight reels.",
    }),
  component: PlansPage,
});

function PlansPage() {
  const { user } = useAuth();
  const { hasActive, anyActiveCustomerId, loading } = useAllSubscriptions();
  const { openCheckout, checkoutElement, closeCheckout, isOpen } = useStripeCheckout();
  const [portalBusy, setPortalBusy] = useState(false);

  function handleSubscribe(priceId: string) {
    if (priceId === "free") return;
    if (!user) {
      toast.error("Sign in to subscribe");
      return;
    }
    if (hasActive(priceId)) {
      toast("You're already subscribed to this plan");
      return;
    }
    openCheckout({
      priceId,
      returnUrl: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    });
  }

  async function openPortal() {
    try {
      setPortalBusy(true);
      const res = await createPortalSession({
        data: { environment: getStripeEnvironment(), returnUrl: `${window.location.origin}/plans` },
      });
      if ("error" in res) throw new Error(res.error);
      window.open(res.url, "_blank");
    } catch (e: any) {
      toast.error(e.message ?? "Could not open billing portal");
    } finally {
      setPortalBusy(false);
    }
  }

  if (isOpen) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <button
          onClick={closeCheckout}
          className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to plans
        </button>
        {checkoutElement}
      </div>
    );
  }

  return (
    <div className="min-h-dvh">
      <PaymentTestModeBanner />
      <div className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <Link
          to="/profile"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Profile
        </Link>
        <h1 className="mt-4 font-display text-3xl font-bold">Plans & Subscriptions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscribe or upgrade anytime. All plans are no-commitment monthly.{" "}
          <span className="font-semibold text-foreground">No refunds.</span>
        </p>

        {anyActiveCustomerId() && (
          <button
            onClick={openPortal}
            disabled={portalBusy}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold hover:border-lime/40"
          >
            {portalBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            Manage billing & cancel
          </button>
        )}

        <div className="mt-6 grid gap-4">
          {[FREE_TIER, ...PLAN_TIERS].map((plan) => {
            const active = hasActive(plan.priceId);
            const isFree = plan.priceId === "free";
            return (
              <div
                key={plan.priceId}
                className={`rounded-2xl border p-5 ${plan.highlight ? "border-lime/50 bg-lime/5" : "border-border bg-surface"}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-display text-xl font-bold">{plan.name}</div>
                    <div className="text-sm text-muted-foreground">{plan.tagline}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-2xl font-bold">{plan.priceLabel}</div>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-lime" /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleSubscribe(plan.priceId)}
                  disabled={loading || active || isFree}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-lime px-4 py-2.5 text-sm font-bold text-black disabled:bg-muted disabled:text-muted-foreground"
                >
                  {active ? "Current plan" : isFree ? "Included" : plan.cta}
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Upgrades & downgrades are handled through the billing portal. Cancellations take effect at
          the end of your current period — reels you've already generated stay viewable, but new
          generations are blocked.
        </p>
      </div>
    </div>
  );
}
