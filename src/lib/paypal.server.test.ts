import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureOrder,
  captureRefusalIsDefinite,
  createOrder,
  getOrder,
  getOrderCapture,
  parseCaptureResponse,
  paypalPaymentMatches,
  refundCapture,
} from "./paypal.server";

const expected = {
  status: "APPROVED",
  amountCents: 1500,
  currency: "USD",
  merchantId: "HOSTMERCHANT1",
};

const order = {
  status: "APPROVED",
  amountValue: "15.00",
  currency: "USD",
  payeeMerchantId: "HOSTMERCHANT1",
};

describe("paypalPaymentMatches", () => {
  it("accepts an order paying the host the recorded amount", () => {
    expect(paypalPaymentMatches(order, expected)).toBe(true);
  });

  it("rejects a payee other than the host's connected account", () => {
    expect(paypalPaymentMatches({ ...order, payeeMerchantId: "OTHERMERCHANT" }, expected)).toBe(
      false,
    );
  });

  it("rejects a missing payee, even when the host has none connected", () => {
    expect(paypalPaymentMatches({ ...order, payeeMerchantId: null }, expected)).toBe(false);
    expect(
      paypalPaymentMatches({ ...order, payeeMerchantId: null }, { ...expected, merchantId: null }),
    ).toBe(false);
  });

  it("rejects when the host has disconnected PayPal", () => {
    expect(paypalPaymentMatches(order, { ...expected, merchantId: undefined })).toBe(false);
  });

  it("rejects a different amount or currency", () => {
    expect(paypalPaymentMatches({ ...order, amountValue: "14.99" }, expected)).toBe(false);
    expect(paypalPaymentMatches({ ...order, amountValue: null }, expected)).toBe(false);
    expect(paypalPaymentMatches({ ...order, currency: "EUR" }, expected)).toBe(false);
  });

  it("rejects an order not in the expected status", () => {
    expect(paypalPaymentMatches({ ...order, status: "CREATED" }, expected)).toBe(false);
    expect(paypalPaymentMatches(order, { ...expected, status: "COMPLETED" })).toBe(false);
  });
});

describe("captureOrder (review of task #69)", () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  let captureReply: () => Response;

  beforeEach(() => {
    calls.length = 0;
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_ENV", "sandbox");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/v1/oauth2/token"))
        return new Response(JSON.stringify({ access_token: "T" }), { status: 200 });
      return captureReply();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const completed = (captureStatus: string) =>
    JSON.stringify({
      id: "ORDER-1",
      status: "COMPLETED",
      purchase_units: [
        {
          payee: { merchant_id: "HOSTMERCHANT1" },
          payments: {
            captures: [
              {
                id: "CAPTURE-1",
                status: captureStatus,
                amount: { value: "10.00", currency_code: "USD" },
              },
            ],
          },
        },
      ],
    });

  it("asks PayPal for the full order in its answer, so the payee is in it", async () => {
    captureReply = () => new Response(completed("COMPLETED"), { status: 201 });
    await captureOrder("ORDER-1");
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.Prefer).toBe("return=representation");
  });

  it("returns the capture's own status, not only the order's", async () => {
    captureReply = () => new Response(completed("PENDING"), { status: 201 });
    await expect(captureOrder("ORDER-1")).resolves.toMatchObject({
      status: "COMPLETED",
      captureId: "CAPTURE-1",
      captureStatus: "PENDING",
      payeeMerchantId: "HOSTMERCHANT1",
    });
  });

  it("throws when a successful answer cannot be read, so the caller asks PayPal what happened", async () => {
    captureReply = () => new Response("<html>gateway</html>", { status: 201 });
    await expect(captureOrder("ORDER-1")).rejects.toThrow();
    captureReply = () => new Response("{}", { status: 201 });
    await expect(captureOrder("ORDER-1")).rejects.toThrow();
  });
});

/** A capture answer (or an order lookup after a capture) as PayPal v2 shapes it. */
const orderJson = (captures: unknown[], unitPatch: Record<string, unknown> = {}) => ({
  id: "ORDER-1",
  status: "COMPLETED",
  purchase_units: [
    {
      amount: { value: "10.00", currency_code: "USD" },
      payee: { merchant_id: "HOSTMERCHANT1" },
      payments: { captures },
      ...unitPatch,
    },
  ],
});
const cap = (patch: Record<string, unknown> = {}) => ({
  id: "CAPTURE-1",
  status: "COMPLETED",
  amount: { value: "10.00", currency_code: "USD" },
  ...patch,
});

describe("parseCaptureResponse (F04 port)", () => {
  it("reads the capture's own id, status, amount and currency, not the order's", () => {
    const r = parseCaptureResponse(
      orderJson([cap({ status: "PENDING", amount: { value: "4.00", currency_code: "CAD" } })]),
    );
    expect(r).toMatchObject({
      status: "COMPLETED",
      captureCount: 1,
      captureId: "CAPTURE-1",
      captureStatus: "PENDING",
      amountValue: "4.00",
      currency: "CAD",
    });
  });

  it("takes the capture's payee when it names one, else its purchase unit's", () => {
    expect(
      parseCaptureResponse(orderJson([cap({ payee: { merchant_id: "CAPTUREPAYEE" } })]))
        .payeeMerchantId,
    ).toBe("CAPTUREPAYEE");
    expect(parseCaptureResponse(orderJson([cap()])).payeeMerchantId).toBe("HOSTMERCHANT1");
    expect(parseCaptureResponse(orderJson([cap()], { payee: undefined })).payeeMerchantId).toBe(
      null,
    );
  });

  it("keeps PayPal's reason for a pending or declined capture", () => {
    const r = parseCaptureResponse(
      orderJson([cap({ status: "PENDING", status_details: { reason: "PENDING_REVIEW" } })]),
    );
    expect(r.statusReason).toBe("PENDING_REVIEW");
  });

  it("no capture: a count of 0 and nothing read as captured", () => {
    expect(parseCaptureResponse({ status: "APPROVED", purchase_units: [{}] })).toMatchObject({
      status: "APPROVED",
      captureCount: 0,
      captureId: null,
      captureStatus: null,
      amountValue: null,
    });
  });

  it("more than one capture, in one unit or across units: counted, and none of them is taken", () => {
    const one = parseCaptureResponse(orderJson([cap(), cap({ id: "CAPTURE-2" })]));
    expect(one).toMatchObject({ captureCount: 2, captureId: null, captureStatus: null });
    const across = parseCaptureResponse({
      status: "COMPLETED",
      purchase_units: [
        { payments: { captures: [cap()] } },
        { payments: { captures: [cap({ id: "CAPTURE-2" })] } },
      ],
    });
    expect(across).toMatchObject({ captureCount: 2, captureId: null, amountValue: null });
  });

  it("a capture with no id is counted but has no id", () => {
    expect(parseCaptureResponse(orderJson([cap({ id: "" })]))).toMatchObject({
      captureCount: 1,
      captureId: null,
    });
  });

  it("anything that is not an object reads as no capture", () => {
    for (const raw of [null, undefined, "x", 3]) {
      expect(parseCaptureResponse(raw)).toMatchObject({ status: "", captureCount: 0 });
    }
  });
});

describe("PayPal-Request-Id (F04 port)", () => {
  /** Every request after the token, in order. */
  const posts: { url: string; headers: Record<string, string>; body?: unknown }[] = [];
  /** Answers request n (0-based, token requests excluded); a function that throws is a lost answer. */
  let reply: (n: number, url: string) => Response;

  beforeEach(() => {
    posts.length = 0;
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_ENV", "sandbox");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v1/oauth2/token"))
        return new Response(JSON.stringify({ access_token: "T" }), { status: 200 });
      posts.push({
        url,
        headers: { ...(init?.headers as Record<string, string>) },
        body: init?.body,
      });
      return reply(posts.length - 1, url);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const ok = (json: unknown, status = 201) => new Response(JSON.stringify(json), { status });
  const lost = (): never => {
    throw new TypeError("fetch failed");
  };
  const ids = () => posts.map((p) => p.headers["PayPal-Request-Id"]);

  it("capture sends capture-<order id>", async () => {
    reply = () => ok(orderJson([cap()]));
    await captureOrder("ORDER-1");
    expect(ids()).toEqual(["capture-ORDER-1"]);
  });

  it("a capture whose answer is lost is sent again with the same id, and PayPal's answer is used", async () => {
    reply = (n) => (n === 0 ? lost() : ok(orderJson([cap()])));
    await expect(captureOrder("ORDER-1")).resolves.toMatchObject({
      captureId: "CAPTURE-1",
      captureStatus: "COMPLETED",
    });
    expect(ids()).toEqual(["capture-ORDER-1", "capture-ORDER-1"]);
    expect(posts.every((p) => p.url.endsWith("/v2/checkout/orders/ORDER-1/capture"))).toBe(true);
  });

  it("a later retry of the same order, after the network failed twice, sends the same id again", async () => {
    reply = () => lost();
    await expect(captureOrder("ORDER-1")).rejects.toThrow();
    reply = () => ok(orderJson([cap()]));
    await captureOrder("ORDER-1");
    expect(ids()).toEqual(["capture-ORDER-1", "capture-ORDER-1", "capture-ORDER-1"]);
  });

  it("an answer PayPal did give, even an error, is not resent", async () => {
    reply = () => ok({ name: "UNPROCESSABLE_ENTITY", message: "INSTRUMENT_DECLINED" }, 422);
    await expect(captureOrder("ORDER-1")).rejects.toThrow("INSTRUMENT_DECLINED");
    reply = () => ok({ message: "internal" }, 500);
    await expect(captureOrder("ORDER-1")).rejects.toThrow();
    expect(posts).toHaveLength(2);
  });

  it("different orders get different capture ids", async () => {
    reply = () => ok(orderJson([cap()]));
    await captureOrder("ORDER-1");
    await captureOrder("ORDER-2");
    expect(ids()).toEqual(["capture-ORDER-1", "capture-ORDER-2"]);
  });

  it("refund sends refund-<capture id>, and the same id when its answer is lost", async () => {
    reply = (n) => (n === 0 ? lost() : ok({ id: "REFUND-1", status: "COMPLETED" }));
    await expect(refundCapture("CAPTURE-1")).resolves.toEqual({
      refundId: "REFUND-1",
      status: "COMPLETED",
    });
    expect(ids()).toEqual(["refund-CAPTURE-1", "refund-CAPTURE-1"]);
  });

  it("create sends the attempt's id, and the same id when its answer is lost: one order", async () => {
    reply = (n) => (n === 0 ? lost() : ok({ id: "ORDER-9", status: "CREATED" }));
    const input = {
      amountCents: 1000,
      currency: "USD",
      merchantId: "HOSTMERCHANT1",
      description: "BallaCity: Friday run",
      requestId: "create-attempt-1",
    };
    await expect(createOrder(input)).resolves.toEqual({ orderId: "ORDER-9" });
    expect(ids()).toEqual(["create-attempt-1", "create-attempt-1"]);
    expect(posts[0].body).toBe(posts[1].body);
  });

  it("a network failure on both sends is thrown, not swallowed", async () => {
    reply = () => lost();
    await expect(refundCapture("CAPTURE-1")).rejects.toThrow("fetch failed");
    expect(posts).toHaveLength(2);
  });

  it("order lookups are reads and carry no request id", async () => {
    reply = () => ok(orderJson([cap()]), 200);
    await getOrder("ORDER-1");
    await getOrderCapture("ORDER-1");
    expect(ids()).toEqual([undefined, undefined]);
  });
});

describe("getOrder and getOrderCapture (F04 port)", () => {
  let body: string;
  let status = 200;
  beforeEach(() => {
    status = 200;
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/v1/oauth2/token")
        ? new Response(JSON.stringify({ access_token: "T" }), { status: 200 })
        : new Response(body, { status }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("getOrder reads what was approved; getOrderCapture reads what was captured", async () => {
    body = JSON.stringify(orderJson([cap({ amount: { value: "4.00", currency_code: "USD" } })]));
    await expect(getOrder("ORDER-1")).resolves.toMatchObject({
      amountValue: "10.00",
      captureId: "CAPTURE-1",
    });
    await expect(getOrderCapture("ORDER-1")).resolves.toMatchObject({
      amountValue: "4.00",
      captureId: "CAPTURE-1",
      captureCount: 1,
    });
  });

  it("getOrder names no capture when there is more than one", async () => {
    body = JSON.stringify(orderJson([cap(), cap({ id: "CAPTURE-2" })]));
    await expect(getOrder("ORDER-1")).resolves.toMatchObject({
      captureId: null,
      captureStatus: null,
    });
  });

  it("getOrderCapture throws on a refusal or an unreadable answer, so the caller does not guess", async () => {
    body = JSON.stringify({ message: "RESOURCE_NOT_FOUND" });
    status = 404;
    await expect(getOrderCapture("ORDER-1")).rejects.toThrow("RESOURCE_NOT_FOUND");
    body = "<html>gateway</html>";
    status = 200;
    await expect(getOrderCapture("ORDER-1")).rejects.toThrow();
    body = "{}";
    await expect(getOrderCapture("ORDER-1")).rejects.toThrow();
  });
});

describe("what a failed capture says about the money (re-review)", () => {
  const sent: { url: string; init?: RequestInit }[] = [];
  let token: () => Response;
  let reply: () => Response;
  beforeEach(() => {
    sent.length = 0;
    token = () => new Response(JSON.stringify({ access_token: "T" }), { status: 200 });
    vi.stubEnv("PAYPAL_CLIENT_ID", "id");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
    vi.stubEnv("PAYPAL_ENV", "sandbox");
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      sent.push({ url, init });
      return url.endsWith("/v1/oauth2/token") ? token() : reply();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const paypalError = (status: number, issue: string) =>
    new Response(
      JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue }], message: issue }),
      { status },
    );
  const failure = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e as Record<string, unknown>,
    );

  it("a decline PayPal answers is a refusal: nothing was captured", async () => {
    reply = () => paypalError(422, "INSTRUMENT_DECLINED");
    const e = await failure(captureOrder("ORDER-1"));
    expect(e).toMatchObject({ notCaptured: true, httpStatus: 422, issue: "INSTRUMENT_DECLINED" });
  });

  it("a 5xx, a 409, a timeout status or 'already captured' is not a refusal: the money may have moved", async () => {
    for (const r of [
      () => new Response(JSON.stringify({ message: "internal" }), { status: 500 }),
      () => paypalError(409, "PREVIOUS_REQUEST_IN_PROGRESS"),
      () => paypalError(408, "TIMEOUT"),
      () => paypalError(422, "ORDER_ALREADY_CAPTURED"),
    ]) {
      reply = r;
      const e = await failure(captureOrder("ORDER-1"));
      expect(e).toBeInstanceOf(Error);
      expect(e?.notCaptured).toBeUndefined();
    }
  });

  it("a rate limit or 'previous request in progress' on the first send is not a refusal either", async () => {
    for (const r of [
      () => paypalError(429, "RATE_LIMIT_REACHED"),
      () => paypalError(422, "PREVIOUS_REQUEST_IN_PROGRESS"),
    ]) {
      reply = r;
      const e = await failure(captureOrder("ORDER-1"));
      expect(e).toBeInstanceOf(Error);
      expect(e?.notCaptured).toBeUndefined();
    }
  });

  it("any error answer to a resend is not a refusal: the first send may still be capturing (re-review)", async () => {
    // The first send gets no answer (the 15 s limit fired while PayPal was still working on it), so it is resent with
    // the same id. Whatever the resend is told describes the resend, not the first send.
    for (const [status, issue] of [
      [422, "PREVIOUS_REQUEST_IN_PROGRESS"],
      [429, "RATE_LIMIT_REACHED"],
      [422, "INSTRUMENT_DECLINED"],
    ] as const) {
      let n = 0;
      reply = () => {
        n += 1;
        if (n === 1) throw new DOMException("The operation timed out.", "TimeoutError");
        return paypalError(status, issue);
      };
      const e = await failure(captureOrder("ORDER-1"));
      expect(n).toBe(2);
      expect(e).toBeInstanceOf(Error);
      expect(e?.notCaptured).toBeUndefined();
    }
  });

  it("no answer at all is not a refusal", async () => {
    reply = () => {
      throw new TypeError("fetch failed");
    };
    const e = await failure(captureOrder("ORDER-1"));
    expect(e?.notCaptured).toBeUndefined();
  });

  it("no access token: the capture is never sent, and says so", async () => {
    token = () => new Response("{}", { status: 401 });
    reply = () => new Response("{}", { status: 201 });
    const e = await failure(captureOrder("ORDER-1"));
    expect(e).toMatchObject({ notCaptured: true, httpStatus: null });
    expect(sent.some((c) => c.url.endsWith("/capture"))).toBe(false);
  });

  it("captureRefusalIsDefinite", () => {
    expect(captureRefusalIsDefinite(400, "INVALID_REQUEST")).toBe(true);
    expect(captureRefusalIsDefinite(401, null)).toBe(true);
    expect(captureRefusalIsDefinite(422, "ORDER_NOT_APPROVED")).toBe(true);
    expect(captureRefusalIsDefinite(422, "ORDER_ALREADY_CAPTURED")).toBe(false);
    expect(captureRefusalIsDefinite(408, null)).toBe(false);
    expect(captureRefusalIsDefinite(409, null)).toBe(false);
    expect(captureRefusalIsDefinite(429, null)).toBe(false);
    expect(captureRefusalIsDefinite(429, "RATE_LIMIT_REACHED")).toBe(false);
    expect(captureRefusalIsDefinite(422, "PREVIOUS_REQUEST_IN_PROGRESS")).toBe(false);
    expect(captureRefusalIsDefinite(500, null)).toBe(false);
    expect(captureRefusalIsDefinite(201, null)).toBe(false);
  });

  it("every PayPal request has a time limit, a fresh one for each send", async () => {
    let n = 0;
    reply = () => {
      n += 1;
      if (n === 1) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(orderJson([cap()])), { status: 201 });
    };
    await captureOrder("ORDER-1");
    await getOrder("ORDER-1");
    await refundCapture("CAPTURE-1").catch(() => null);
    const signals = sent.map((c) => c.init?.signal);
    expect(signals.length).toBeGreaterThanOrEqual(6);
    for (const sig of signals) expect(sig).toBeInstanceOf(AbortSignal);
    const captureSends = sent.filter((c) => c.url.endsWith("/capture"));
    expect(captureSends).toHaveLength(2);
    expect(captureSends[0].init?.signal).not.toBe(captureSends[1].init?.signal);
  });
});
