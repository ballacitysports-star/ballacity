import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripeEnvironment } from "@/lib/stripe";
import { getStripe } from "@/lib/stripe-loader";
import { createCheckoutSession } from "@/utils/payments.functions";
import { userErrorMessage } from "@/lib/user-error";

interface StripeEmbeddedCheckoutProps {
  priceId: string;
  quantity?: number;
  returnUrl?: string;
  collectShipping?: boolean;
}

export function StripeEmbeddedCheckout({
  priceId,
  quantity,
  returnUrl,
  collectShipping,
}: StripeEmbeddedCheckoutProps) {
  const fetchClientSecret = async (): Promise<string> => {
    const result = await createCheckoutSession({
      data: {
        priceId,
        quantity,
        collectShipping,
        returnUrl: returnUrl || window.location.href,
        environment: getStripeEnvironment(),
      },
    });
    // result.error can be Stripe's raw text; Stripe's checkout may show or log what fetchClientSecret throws.
    if ("error" in result) {
      throw new Error(userErrorMessage(result.error, "Checkout couldn't start. Please try again."));
    }
    if (!result.clientSecret) throw new Error("Stripe did not return a client secret");
    return result.clientSecret;
  };

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
