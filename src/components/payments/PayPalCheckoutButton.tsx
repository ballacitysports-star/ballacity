import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createGamePayPalOrder, captureGamePayPalOrder } from "@/lib/paypal.functions";
import { CHECKOUT_UNCONFIRMED_MESSAGE, paymentPolicyMessageOf } from "@/lib/payments-policy";

declare global {
  interface Window {
    paypal?: any;
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(clientId: string, merchantId: string): Promise<void> {
  if (window.paypal?.Buttons) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&merchant-id=${encodeURIComponent(merchantId)}&enable-funding=card,venmo&components=buttons`;
      s.onload = () => resolve();
      s.onerror = () => {
        sdkPromise = null;
        reject(new Error("PayPal failed to load."));
      };
      document.head.appendChild(s);
    });
  }
  return sdkPromise;
}

/**
 * Renders PayPal's own checkout button. Money goes straight to the host's
 * PayPal account; on capture the server marks the player paid automatically.
 */
export function PayPalCheckoutButton(props: {
  gameId: string;
  clientId: string;
  merchantId: string;
  feeLabel: string;
  onPaid: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Why the server refused to start a checkout (say, a guardian has to approve the game first). PayPal reports a
    // failed createOrder only through onError, with its own generic error.
    let startRefusal: string | null = null;
    loadSdk(props.clientId, props.merchantId)
      .then(() => {
        if (cancelled || !ref.current || !window.paypal) return;
        ref.current.innerHTML = "";
        window.paypal
          .Buttons({
            style: { layout: "vertical", shape: "pill", label: "pay" },
            createOrder: async () => {
              startRefusal = null;
              try {
                const { orderId } = await createGamePayPalOrder({ data: { gameId: props.gameId } });
                return orderId;
              } catch (e) {
                startRefusal = paymentPolicyMessageOf(e);
                throw e;
              }
            },
            onApprove: async (data: { orderID: string }) => {
              try {
                const res = await captureGamePayPalOrder({ data: { orderId: data.orderID } });
                // "You're in" only when the server says the player is on the roster; null means it could not tell.
                toast.success(
                  res.rostered === true
                    ? "Payment confirmed — you're in!"
                    : res.rostered === false
                      ? "Payment confirmed. The host will confirm your place on the roster."
                      : "Payment confirmed. Check the game page for your place on the roster.",
                );
                props.onPaid();
              } catch (e) {
                // Only messages written for the player; never PayPal's own error text.
                toast.error(paymentPolicyMessageOf(e) ?? CHECKOUT_UNCONFIRMED_MESSAGE);
              }
            },
            onError: (err: unknown) => {
              console.error("[paypal] button error", err);
              toast.error(startRefusal ?? "PayPal checkout hit a problem. Try another method.");
              startRefusal = null;
            },
          })
          .render(ref.current);
        setReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.gameId, props.clientId, props.merchantId]);

  if (failed) return null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-semibold">Pay {props.feeLabel} — PayPal or card</div>
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Instant confirmation
        </span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        No PayPal account? Tap{" "}
        <span className="font-semibold text-foreground">Debit or Credit Card</span> below.
      </p>
      <div ref={ref} aria-label="Pay with PayPal or card" />
      {!ready && (
        <div className="py-3 text-center text-xs text-muted-foreground">Loading checkout…</div>
      )}
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Goes straight to the host — no proof upload needed.
      </p>
    </div>
  );
}
