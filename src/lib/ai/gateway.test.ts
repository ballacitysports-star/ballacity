import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rawChat } from "./gateway.server";

describe("rawChat cancellation", () => {
  beforeEach(() => {
    process.env["LOVABLE_API_KEY"] = "test-key";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("never calls the gateway once the deadline has passed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const signal = AbortSignal.abort();
    await expect(rawChat({ model: "m", messages: [], signal })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops a call in flight at its deadline as TIMEOUT, without retrying", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const call = rawChat({ model: "m", messages: [], signal: controller.signal });
    controller.abort();
    await expect(call).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
