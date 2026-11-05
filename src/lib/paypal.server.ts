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
    }[];
  };
  if (!res.ok) throw new Error(json?.message || `PayPal order lookup failed (${res.status}).`);
  const unit = json?.purchase_units?.[0];
  return {
    status: String(json?.status ?? ""),
    amountValue: unit?.amount?.value ?? null,
    currency: unit?.amount?.currency_code ?? null,
    payeeMerchantId: unit?.payee?.merchant_id ?? null,
  };
}

/**
 * The outcome of a capture, read from the CAPTURE, never from the order. PayPal can report an order as
 * COMPLETED while its capture is still PENDING (for example an eCheck or a payment under review); only a capture
 * whose own status is COMPLETED means the money has settled.
 *   status         the capture's status (COMPLETED, PENDING, DECLINED, FAILED, ...), "MISSING" when there is no
 *                  capture, "AMBIGUOUS" when there is more than one
 *   orderStatus    the order-level status, kept for the record only
 */
export type CaptureResult = {
  status: string;
  orderStatus: string;
  captureId: string | null;
  amountValue: string | null;
  currency: string | null;
  payeeMerchantId: string | null;
  statusReason: string | null;
};

/** Pure: maps a PayPal capture (or order lookup) response to a CaptureResult. */
export function parseCaptureResponse(json: any): CaptureResult {
  const units: any[] = Array.isArray(json?.purchase_units) ? json.purchase_units : [];
  const captures = units.flatMap((u: any) =>
    (Array.isArray(u?.payments?.captures) ? u.payments.captures : []).map((c: any) => ({ c, u })),
  );
  const orderStatus = String(json?.status ?? "");
  if (captures.length !== 1) {
    return {
      status: captures.length === 0 ? "MISSING" : "AMBIGUOUS",
      orderStatus,
      captureId: null,
      amountValue: null,
      currency: null,
      payeeMerchantId: null,
      statusReason: null,
    };
  }
  const { c, u } = captures[0];
  return {
    status: String(c?.status ?? "MISSING"),
    orderStatus,
    captureId: typeof c?.id === "string" && c.id ? c.id : null,
    amountValue: c?.amount?.value ?? null,
    currency: c?.amount?.currency_code ?? null,
    payeeMerchantId: c?.payee?.merchant_id ?? u?.payee?.merchant_id ?? null,
    statusReason: c?.status_details?.reason ?? null,
  };
}

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(
    `${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // PayPal treats a repeated request with the same id as the same capture, so a retry never captures twice.
        "PayPal-Request-Id": `capture-${orderId}`,
      },
    },
  );
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.message || `PayPal capture failed (${res.status}).`);
  return parseCaptureResponse(json);
}

/** Re-reads an order's capture state from PayPal (used to settle a capture that was pending or unknown). */
export async function getOrderCapture(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.message || `PayPal order lookup failed (${res.status}).`);
  return parseCaptureResponse(json);
}

/**
 * Refunds a capture in full. Used when a captured payment could not be
 * recorded (the database refused the payment row), so the player is never
 * charged for a payment the app does not know about.
 */
export async function refundCapture(captureId: string): Promise<{ refundId: string | null }> {
  const token = await getAccessToken();
  const res = await fetch(
    `${baseUrl()}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    },
  );
  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!res.ok) throw new Error(json?.message || `PayPal refund failed (${res.status}).`);
  return { refundId: json.id ?? null };
}
