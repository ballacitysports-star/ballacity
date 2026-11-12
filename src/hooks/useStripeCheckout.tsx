import { lazy, Suspense, useState, useCallback } from "react";

// Stripe's checkout (and through it Stripe.js) loads only when checkout opens, not for every viewer of a page that
// can offer it.
const StripeEmbeddedCheckout = lazy(() =>
  import("@/components/StripeEmbeddedCheckout").then((m) => ({
    default: m.StripeEmbeddedCheckout,
  })),
);

interface CheckoutOptions {
  priceId: string;
  quantity?: number;
  returnUrl?: string;
  collectShipping?: boolean;
}

export function useStripeCheckout() {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<CheckoutOptions | null>(null);

  const openCheckout = useCallback((opts: CheckoutOptions) => {
    setOptions(opts);
    setIsOpen(true);
  }, []);

  const closeCheckout = useCallback(() => {
    setIsOpen(false);
    setOptions(null);
  }, []);

  const checkoutElement =
    isOpen && options ? (
      <Suspense
        fallback={
          <div role="status" className="py-8 text-center text-sm text-muted-foreground">
            Loading checkout…
          </div>
        }
      >
        <StripeEmbeddedCheckout {...options} />
      </Suspense>
    ) : null;

  return { openCheckout, closeCheckout, isOpen, checkoutElement };
}
