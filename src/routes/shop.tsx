import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { ArrowLeft, Package } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { MERCH_ITEMS } from "@/lib/catalog";

export const Route = createFileRoute("/shop")({
  head: () =>
    pageHead({
      path: "/shop",
      title: "Shop — ballaCity",
      description: "ballaCity gear and merch for players, teams, and trainers.",
    }),
  component: ShopPage,
});

function ShopPage() {
  const { user } = useAuth();
  const { openCheckout, checkoutElement, closeCheckout, isOpen } = useStripeCheckout();

  function buy(priceId: string) {
    if (!user) {
      toast.error("Sign in to check out");
      return;
    }
    openCheckout({
      priceId,
      collectShipping: true,
      returnUrl: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    });
  }

  if (isOpen) {
    return (
      <div className="page-shell-prose py-6">
        <button
          onClick={closeCheckout}
          className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to shop
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
        <h1 className="mt-4 font-display text-3xl font-bold">Shop</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ballaCity gear, shipped to your door.{" "}
          <span className="font-semibold text-foreground">All sales final — no refunds.</span>
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {MERCH_ITEMS.map((item) => (
            <div key={item.priceId} className="rounded-2xl border border-border bg-surface p-5">
              <div className="grid h-32 place-items-center rounded-xl bg-muted/40 text-5xl">
                {item.emoji}
              </div>
              <div className="mt-3 flex items-start justify-between gap-2">
                <div>
                  <div className="font-display text-lg font-bold">{item.name}</div>
                  <div className="text-xs text-muted-foreground">{item.description}</div>
                </div>
                <div className="font-display text-lg font-bold">{item.priceLabel}</div>
              </div>
              <button
                onClick={() => buy(item.priceId)}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-bold text-black"
              >
                <Package className="h-4 w-4" /> Buy
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
