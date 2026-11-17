import { describe, expect, it, vi } from "vitest";
import { createOnboardingPrefetch } from "./onboarding-prefetch";

describe("createOnboardingPrefetch", () => {
  it("hands the started answer to the first taker for that user, once", async () => {
    const pf = createOnboardingPrefetch<string>();
    const fetcher = vi.fn(async () => "ok");
    pf.start("u1", fetcher);
    expect(pf.take("u2")).toBeNull();
    const p = pf.take("u1");
    await expect(p).resolves.toBe("ok");
    expect(pf.take("u1")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not start a second check while one is out for the same user", () => {
    const pf = createOnboardingPrefetch<string>();
    const fetcher = vi.fn(async () => "ok");
    pf.start("u1", fetcher);
    pf.start("u1", fetcher);
    return pf.take("u1")!.then(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it("forgets a dropped answer, so the next taker asks afresh", () => {
    const pf = createOnboardingPrefetch<string>();
    pf.start("u1", async () => "stale");
    pf.drop("u1");
    expect(pf.take("u1")).toBeNull();
  });

  it("passes a failure to the taker, and an untaken failure is not unhandled", async () => {
    const pf = createOnboardingPrefetch<string>();
    pf.start("u1", async () => {
      throw new Error("server down");
    });
    pf.start("u2", () => Promise.reject(new Error("never taken")));
    pf.drop("u2");
    await expect(pf.take("u1")).rejects.toThrow("server down");
  });

  it("turns a fetcher that throws synchronously into a rejected answer", async () => {
    const pf = createOnboardingPrefetch<string>();
    pf.start("u1", () => {
      throw new Error("no session");
    });
    await expect(pf.take("u1")).rejects.toThrow("no session");
  });
});
