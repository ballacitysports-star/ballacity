/**
 * Server-only PayPal Orders API client. Never import from client code.
 * Secrets (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET) are read inside handlers.
 */

function baseUrl(): string {
  return process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";
}

/**
 * How long one PayPal request may take before it is given up (AbortSignal.timeout). Without a limit a hung request
 * would leave an order held in 'capturing' with nothing reported; with it the caller's fallback runs and reports.
 */
const TOKEN_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

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
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status}).`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("PayPal auth returned no token.");
  return json.access_token;
}

/**
 * A POST that PayPal makes idempotent: a repeat carrying the same PayPal-Request-Id returns the first request's result
 * instead of acting again (Orders v2 create and capture, Payments v2 refund). When no answer comes back at all (the
 * connection failed or timed out, so PayPal may or may not have acted) it is sent once more with the same id. Any
 * answer PayPal does give, success or error, is returned as it is.
 */
async function postIdempotent(
  url: string,
  requestId: string,
  headers: Record<string, string>,
  body?: string,
): Promise<Response> {
  // A fresh timeout for each send.
  const send = () =>
    fetch(url, {
      method: "POST",
      headers: { ...headers, "PayPal-Request-Id": requestId },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  try {
    return await send();
  } catch {
    return send();
  }
}

/** A GET of an order, with the request timeout. */
function getOrderJson(orderId: string, token: string): Promise<Response> {
  return fetch(`${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Thrown by captureOrder only when PayPal certainly did not capture: the request was never sent (no access token), or
 * PayPal refused it with a client error that is not "already captured" or "a request with this id is still running".
 * Any other failure (no answer, a timeout, a 5xx, an unreadable answer) is a plain Error: the capture may have happened.
 * The caller tests `notCaptured`, not the class, so a test double can throw one too.
 */
export class PayPalCaptureRefused extends Error {
  readonly notCaptured = true as const;
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly issue: string | null,
  ) {
    super(message);
    this.name = "PayPalCaptureRefused";
  }
}

/**
 * Whether a capture answer with this status and PayPal issue means nothing was captured. 4xx answers are PayPal
 * refusing the request (INSTRUMENT_DECLINED, ORDER_NOT_APPROVED, PAYER_ACTION_REQUIRED, an auth failure, ...), except
 * 408 (timed out), 409 (a request with the same id may still be running) and ORDER_ALREADY_CAPTURED.
 */
export function captureRefusalIsDefinite(httpStatus: number, issue: string | null): boolean {
  if (httpStatus < 400 || httpStatus >= 500) return false;
  if (httpStatus === 408 || httpStatus === 409) return false;
  return issue !== "ORDER_ALREADY_CAPTURED";
}

/** The PayPal-Request-Id of an order's capture: the same for every attempt, so PayPal captures an order at most once. */
export function captureRequestId(orderId: string): string {
  return `capture-${orderId}`;
}

/** The PayPal-Request-Id of a capture's full refund: the same for every attempt, so a capture is refunded at most once. */
export function refundRequestId(captureId: string): string {
  return `refund-${captureId}`;
}

/**
 * Creates an order. `requestId` is the PayPal-Request-Id: one per checkout attempt (the caller makes a fresh one each
 * time a player starts a checkout), so a resend of this request after a lost answer returns the same order rather than
 * a second one.
 */
export async function createOrder(input: {
  amountCents: number;
  currency: string;
  merchantId: string;
  description: string;
  requestId: string;
}): Promise<{ orderId: string }> {
  const token = await getAccessToken();
  const res = await postIdempotent(
    `${baseUrl()}/v2/checkout/orders`,
    input.requestId,
    { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    JSON.stringify({
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
  );
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

type PayPalCapture = {
  id?: string;
  status?: string;
  amount?: { value?: string; currency_code?: string };
  payee?: { merchant_id?: string };
  status_details?: { reason?: string };
};
type PayPalUnit = {
  amount?: { value?: string; currency_code?: string };
  payee?: { merchant_id?: string };
  payments?: { captures?: PayPalCapture[] };
};
type PayPalOrderJson = {
  status?: string;
  message?: string;
  details?: { issue?: string }[];
  purchase_units?: PayPalUnit[];
};

/** Every capture on the order, from every purchase unit, each with the unit it belongs to. */
function capturesOf(json: PayPalOrderJson) {
  const units = Array.isArray(json.purchase_units) ? json.purchase_units : [];
  return units.flatMap((u) =>
    (Array.isArray(u?.payments?.captures) ? u.payments.captures : []).map((c) => ({ c, u })),
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

/**
 * Reads an order without changing it, so it can be checked before capture. The amount and payee are the order's (its
 * first purchase unit), which is what the player approved; use getOrderCapture to read what was actually captured.
 */
export async function getOrder(orderId: string): Promise<OrderDetails> {
  const token = await getAccessToken();
  const res = await getOrderJson(orderId, token);
  const json = ((await res.json().catch(() => null)) ?? {}) as PayPalOrderJson;
  if (!res.ok) throw new Error(json?.message || `PayPal order lookup failed (${res.status}).`);
  const unit = json?.purchase_units?.[0];
  const captures = capturesOf(json);
  const only = captures.length === 1 ? captures[0].c : null;
  return {
    status: String(json?.status ?? ""),
    amountValue: unit?.amount?.value ?? null,
    currency: unit?.amount?.currency_code ?? null,
    payeeMerchantId: unit?.payee?.merchant_id ?? null,
    captureId: only?.id || null,
    captureStatus: only?.status ?? null,
  };
}

/**
 * What a capture did, read from the capture itself, never from the order (an order can be COMPLETED while its capture
 * is still PENDING).
 *   status         the order's status (COMPLETED, APPROVED, ...)
 *   captureCount   how many captures PayPal lists on the order: 0 means nothing was captured, more than 1 cannot happen
 *                  for an order this app creates (one purchase unit, intent CAPTURE) and is never taken as paid
 *   captureId, captureStatus, amountValue, currency, statusReason
 *                  the capture's own, when there is exactly one, else null
 *   payeeMerchantId  the capture's payee, else its purchase unit's
 */
export type CaptureResult = {
  status: string;
  captureCount: number;
  captureId: string | null;
  /** The capture's own status; see OrderDetails.captureStatus. */
  captureStatus: string | null;
  amountValue: string | null;
  currency: string | null;
  payeeMerchantId: string | null;
  /** PayPal's reason for a PENDING or DECLINED capture (status_details.reason), for the report only. */
  statusReason: string | null;
};

/** Pure: reads a capture answer, or an order lookup, as a CaptureResult. */
export function parseCaptureResponse(raw: unknown): CaptureResult {
  const json = (raw && typeof raw === "object" ? raw : {}) as PayPalOrderJson;
  const captures = capturesOf(json);
  const status = String(json.status ?? "");
  if (captures.length !== 1) {
    return {
      status,
      captureCount: captures.length,
      captureId: null,
      captureStatus: null,
      amountValue: null,
      currency: null,
      payeeMerchantId: null,
      statusReason: null,
    };
  }
  const { c, u } = captures[0];
  return {
    status,
    captureCount: 1,
    captureId: typeof c?.id === "string" && c.id ? c.id : null,
    captureStatus: c?.status ?? null,
    amountValue: c?.amount?.value ?? null,
    currency: c?.amount?.currency_code ?? null,
    payeeMerchantId: c?.payee?.merchant_id ?? u?.payee?.merchant_id ?? null,
    statusReason: c?.status_details?.reason ?? null,
  };
}

/**
 * Captures an approved order. Asks for the full order in the answer (Prefer: return=representation), since PayPal's
 * default minimal answer need not name the payee. Sends PayPal-Request-Id capture-<order> (captureRequestId), the same
 * on every attempt, so a resend (here after a lost answer, or a later retry of the same order) returns the first
 * capture's result and never captures twice. Throws PayPalCaptureRefused when PayPal certainly did not capture (see
 * there). Throws a plain Error for anything else, including a successful answer that cannot be read or has no status:
 * the money may have moved, so the caller must ask PayPal (getOrderCapture) rather than guess.
 */
export async function captureOrder(orderId: string): Promise<CaptureResult> {
  let token: string;
  try {
    token = await getAccessToken();
  } catch (e) {
    // Nothing was sent to the capture endpoint.
    throw new PayPalCaptureRefused(
      `PayPal capture not sent: ${e instanceof Error ? e.message : String(e)}`,
      null,
      null,
    );
  }
  const res = await postIdempotent(
    `${baseUrl()}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    captureRequestId(orderId),
    {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  );
  const json = (await res.json().catch(() => null)) as PayPalOrderJson | null;
  if (!res.ok) {
    const issue = json?.details?.[0]?.issue ?? null;
    const message = json?.message || `PayPal capture failed (${res.status}).`;
    if (captureRefusalIsDefinite(res.status, issue)) {
      throw new PayPalCaptureRefused(message, res.status, issue);
    }
    throw new Error(message);
  }
  if (!json || !json.status) throw new Error(`PayPal capture answer unreadable (${res.status}).`);
  return parseCaptureResponse(json);
}

/**
 * Reads an order's capture from PayPal without changing anything: what was captured, for how much, to whom. Used when a
 * capture call gave no usable answer, to learn whether the money moved.
 */
export async function getOrderCapture(orderId: string): Promise<CaptureResult> {
  const token = await getAccessToken();
  const res = await getOrderJson(orderId, token);
  const json = (await res.json().catch(() => null)) as PayPalOrderJson | null;
  if (!res.ok) throw new Error(json?.message || `PayPal order lookup failed (${res.status}).`);
  if (!json || !json.status) throw new Error(`PayPal order answer unreadable (${res.status}).`);
  return parseCaptureResponse(json);
}

/**
 * Refunds a capture in full (PayPal Payments v2: POST /v2/payments/captures/{id}/refund, no body = the whole
 * captured amount). Used when a payment PayPal has taken cannot be recorded. The request id (refundRequestId) makes a
 * retry for the same capture return the first refund instead of asking PayPal for a second one. Throws unless PayPal
 * accepted the refund (COMPLETED, or PENDING while it settles).
 */
export async function refundCapture(
  captureId: string,
): Promise<{ refundId: string | null; status: string }> {
  const token = await getAccessToken();
  const res = await postIdempotent(
    `${baseUrl()}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
    refundRequestId(captureId),
    { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    "{}",
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
