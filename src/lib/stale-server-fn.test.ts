import { describe, expect, it, vi } from "vitest";
import { createStaleServerFnFetch, isStaleServerFnError, STALE_SERVER_FN_HEADER } from "./stale-server-fn";

describe("stale server action recovery", () => {
  it("recognizes missing handlers, not auth or database failures", () => {
    expect(isStaleServerFnError(new Error("Invalid server function ID: old"))).toBe(true);
    expect(isStaleServerFnError(new Error("Unauthorized"))).toBe(false);
    expect(isStaleServerFnError(new Error("database unavailable"))).toBe(false);
  });

  it("recovers once for concurrent stale requests without resending a POST", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response("stale", {
      status: 409, headers: { [STALE_SERVER_FN_HEADER]: "1" },
    }));
    const recover = vi.fn();
    const wrapped = createStaleServerFnFetch(fetcher, recover);
    await Promise.all([wrapped("/_serverFn/old", { method: "POST" }), wrapped("/_serverFn/other")]);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("leaves ordinary failures and non-action responses alone", async () => {
    const recover = vi.fn();
    const wrapped = createStaleServerFnFetch(async () => new Response("Unauthorized", { status: 500 }), recover);
    expect((await wrapped("/_serverFn/current")).status).toBe(500);
    const other = createStaleServerFnFetch(async () => new Response("Invalid server function ID: old", { status: 500 }), recover);
    await other("/feed");
    expect(recover).not.toHaveBeenCalled();
  });

  it("recognizes legacy missing-handler responses without consuming their body", async () => {
    const recover = vi.fn();
    const wrapped = createStaleServerFnFetch(async () => new Response("Invalid server function ID: old", { status: 500 }), recover);
    const response = await wrapped("/_serverFn/old");
    expect(recover).toHaveBeenCalledTimes(1);
    expect(await response.text()).toBe("Invalid server function ID: old");
  });
});