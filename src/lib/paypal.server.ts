/**
 * Server-only PayPal Orders API client. Never import from client code.
 * Secrets (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET) are read inside handlers.
 */

function baseUrl(): string {
  return process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

async function getAccessToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal is not configured yet.");
  const res = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}).`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("PayPal auth returned no token.");
  return json.access_token;
}

export async function createOrder(input: {
  amountCents: number;
  currency: string;
  merchantId: string;
  description: string;
}): Promise<{ orderId: string }> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: input.currency,
            value: (input.amountCents / 100).toFixed(2),
          },
          payee: { merchant_id: input.merchantId },
          description: input.description.slice(0, 127),
        },
      ],
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok || !json.id) throw new Error(json.message || `PayPal order failed (${res.status}).`);
  return { orderId: json.id };
}

/**
 * True when a PayPal order (or capture) is in the expected status and pays
 * exactly the recorded amount, in the recorded currency, to the host's
 * connected merchant account.
 */
export function paypalPaymentMatches(
  actual: {
    status: string;
    amountValue: string | null;
    currency: string | null;
    payeeMerchantId: string | null;
  },
  expected: {
    status: string;
    amountCents: number;
    currency: string;
    merchantId: string | null | undefined;
  },
): boolean {
  const cents = actual.amountValue ? Math.round(Number(actual.amountValue) * 100) : 0;
  return (
    actual.status === expected.status &&
    cents === expected.amountCents &&
    actual.currency === expected.currency &&
    !!actual.payeeMerchantId &&
    actual.payeeMerchantId === expected.merchantId
  );
}

export type OrderDetails = {
  status: string;
  amountValue: string | null;
  currency: string | null;
  payeeMerchantId: string | null;
  /** The capture's id once the order has been captured (status COMPLETED), else null. */
  captureId: string | null;
  /**
   * The capture's own status (COMPLETED, PENDING, DECLINED, ...). An order can be COMPLETED while its capture is still
   * PENDING (an eCheck, or a payee account under review): the money has not settled.
   */
  captureStatus: string | null;
};

/** Reads an order without changing it, so it can be checked before capture. */
export async function getOrder(orderId: string): Promise<OrderDetails> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    message?: string;
    purchase_units?: {
      amount?: { value?: string; currency_code?: string };
      payee?: { merchant_id?: string };
      payments?: { captures?: { id?: string; status?: string }[] };
    }[];
  };
  if (!res.ok) throw new Error(json?.message || `PayPal order lookup failed (${res.status}).`);
  const unit = json?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    status: String(json?.status ?? ""),
    amountValue: unit?.amount?.value ?? null,
    currency: unit?.amount?.currency_code ?? null,
    payeeMerchantId: unit?.payee?.merchant_id ?? null,
    captureId: capture?.id ?? null,
    captureStatus: capture?.status ?? null,
  };
}

export type CaptureResult = {
  status: string;
  captureId: string | null;
  /** The capture's own status; see OrderDetails.captureStatus. */
  captureStatus: string | null;
  amountValue: string | null;
  currency: string | null;
  payeeMerchantId: string | null;
};

/**
 * Captures an approved order. Asks for the full order in the answer (Prefer: return=representation), since PayPal's
 * default minimal answer need not name the payee. Throws when PayPal refuses, and also when a successful answer cannot be
 * read or has no status: the money may have moved, so the caller must ask PayPal (getOrder) rather than guess.
 */
export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(
    `${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
    },
  );
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(json?.message || `PayPal capture failed (${res.status}).`);
  if (!json || !json.status) throw new Error(`PayPal capture answer unreadable (${res.status}).`);
  const unit = json?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    status: String(json.status),
    captureId: capture?.id ?? null,
    captureStatus: capture?.status ?? null,
    amountValue: capture?.amount?.value ?? null,
    currency: capture?.amount?.currency_code ?? null,
    payeeMerchantId: unit?.payee?.merchant_id ?? null,
  };
}

/**
 * Refunds a capture in full (PayPal Payments v2: POST /v2/payments/captures/{id}/refund, no body = the whole
 * captured amount). Used when a payment PayPal has taken cannot be recorded. The request id makes a retry for the same
 * capture return the first refund instead of asking PayPal for a second one. Throws unless PayPal accepted the refund
 * (COMPLETED, or PENDING while it settles).
 */
export async function refundCapture(
  captureId: string,
): Promise<{ refundId: string | null; status: string }> {
  const token = await getAccessToken();
  const res = await fetch(
    `${baseUrl()}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": `refund-${captureId}`,
      },
      body: "{}",
    },
  );
  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    message?: string;
  };
  if (!res.ok) throw new Error(json?.message || `PayPal refund failed (${res.status}).`);
  const status = String(json?.status ?? "");
  if (status !== "COMPLETED" && status !== "PENDING") {
    throw new Error(`PayPal refund not accepted (${status || "no status"}).`);
  }
  return { refundId: json.id ?? null, status };
}
