import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { Check, Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useAllSubscriptions } from "@/hooks/useAllSubscriptions";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { freeTierFor, planTiersFrom } from "@/lib/catalog";
import { useMonetizationConfig } from "@/hooks/useMonetizationConfig";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { freeTierFeatures, liveProducts, productForPriceId } from "@/lib/monetization/config";
import { getBillingEnvironment } from "@/lib/stripe";
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
  const { config } = useMonetizationConfig();
  const entitlements = useEntitlements();
  const planTiers = planTiersFrom(config);
  // A plan counts as current when its entitlement is held, so someone who
  // subscribed under an older plan name still sees "Current plan".
  const isCurrent = (priceId: string) => {
    if (hasActive(priceId)) return true;
    const product = productForPriceId(priceId, config);
    return product ? entitlements.has(product.entitlement) : false;
  };
  const { openCheckout, checkoutElement, closeCheckout, isOpen } = useStripeCheckout();
  const access = useFeatureAccess();
  const [portalBusy, setPortalBusy] = useState(false);
  // Free mode hands out every entitlement, so the one card shows the union of
  // the free tier and every paid product's features, de-duplicated.
  const freeModeFeatures = Array.from(
    new Set([...freeTierFeatures(config), ...liveProducts(config).flatMap((p) => p.features)]),
  );

  function handleSubscribe(priceId: string) {
    if (priceId === "free") return;
    if (!access.canCheckout) {
      toast.success(access.notice || "Everything is free right now — nothing to buy.");
      return;
    }
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
      // getBillingEnvironment(), not getStripeEnvironment(): the latter throws
      // when this build has no publishable key, which would strand an existing
      // subscriber with no way to cancel. The portal is created server-side.
      const res = await createPortalSession({
        data: {
          environment: getBillingEnvironment(),
          returnUrl: `${window.location.origin}/plans`,
        },
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
      <div className="page-shell-prose py-6">
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
      <div className="page-shell-prose pb-24 pt-6">
        <Link
          to="/profile"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Profile
        </Link>
        <h1 className="mt-4 page-title">
          {access.freeMode ? "Your plan" : "Plans & Subscriptions"}
        </h1>
        <p className="mt-1 page-subtitle">
          {access.freeMode ? (
            access.notice
          ) : (
            <>
              Subscribe or upgrade anytime. All plans are no-commitment monthly.{" "}
              <span className="font-semibold text-foreground">No refunds.</span>
            </>
          )}
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

        {/* Free mode: one card listing everything the account already has, with
            no prices and nothing to buy. The paid catalog below is skipped
            rather than deleted — turning billing back on restores it. */}
        {access.freeMode ? (
          <div className="mt-6 rounded-2xl border border-lime/50 bg-lime/5 p-5">
            <div className="font-display text-xl font-bold">Everything, included</div>
            <div className="text-sm text-muted-foreground">
              Every ballaCity feature is unlocked on your account.
            </div>
            <ul className="mt-3 space-y-1.5">
              {freeModeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-lime" /> {f}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mt-6 grid gap-4">
            {[freeTierFor(config), ...planTiers].map((plan) => {
              const active = isCurrent(plan.priceId);
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
        )}

        {!access.freeMode && (
          <p className="mt-6 text-xs text-muted-foreground">
            Upgrades & downgrades are handled through the billing portal. Cancellations take effect
            at the end of your current period — reels you've already generated stay viewable, but
            new generations are blocked.
          </p>
        )}
      </div>
    </div>
  );
}
