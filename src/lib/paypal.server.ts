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

export type CaptureResult = {
  status: string;
  captureId: string | null;
  amountValue: string | null;
  currency: string | null;
  payeeMerchantId: string | null;
};

export async function captureOrder(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await fetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.message || `PayPal capture failed (${res.status}).`);
  const unit = json?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    status: String(json?.status ?? ""),
    captureId: capture?.id ?? null,
    amountValue: capture?.amount?.value ?? null,
    currency: capture?.amount?.currency_code ?? null,
    payeeMerchantId: unit?.payee?.merchant_id ?? null,
  };
}
