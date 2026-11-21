import { describe, expect, it, vi } from "vitest";
import { createGatePrefetch } from "./gate-prefetch";

describe("createGatePrefetch", () => {
  it("hands the started answer to the first taker for that user, once", async () => {
    const pf = createGatePrefetch<string>();
    const fetcher = vi.fn(async () => "ok");
    pf.start("u1", fetcher);
    expect(pf.take("u2")).toBeNull();
    const p = pf.take("u1");
    await expect(p).resolves.toBe("ok");
    expect(pf.take("u1")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not start a second check while one is out for the same user", () => {
    const pf = createGatePrefetch<string>();
    const fetcher = vi.fn(async () => "ok");
    pf.start("u1", fetcher);
    pf.start("u1", fetcher);
    return pf.take("u1")!.then(() => expect(fetcher).toHaveBeenCalledTimes(1));
  });

  it("forgets a dropped answer, so the next taker asks afresh", () => {
    const pf = createGatePrefetch<string>();
    pf.start("u1", async () => "stale");
    pf.drop("u1");
    expect(pf.take("u1")).toBeNull();
  });

  it("passes a failure to the taker, and an untaken failure is not unhandled", async () => {
    const pf = createGatePrefetch<string>();
    pf.start("u1", async () => {
      throw new Error("server down");
    });
    pf.start("u2", () => Promise.reject(new Error("never taken")));
    pf.drop("u2");
    await expect(pf.take("u1")).rejects.toThrow("server down");
  });

  it("turns a fetcher that throws synchronously into a rejected answer", async () => {
    const pf = createGatePrefetch<string>();
    pf.start("u1", () => {
      throw new Error("no session");
    });
    await expect(pf.take("u1")).rejects.toThrow("no session");
  });

  it("forgets a failure nobody took yet, so the next taker asks afresh", async () => {
    const pf = createGatePrefetch<string>();
    pf.start("u1", () => Promise.reject(new Error("token refused")));
    // Let the rejection settle before anyone takes it.
    await new Promise((r) => setTimeout(r, 0));
    expect(pf.take("u1")).toBeNull();
    const fresh = vi.fn(async () => "ok");
    pf.start("u1", fresh);
    await expect(pf.take("u1")).resolves.toBe("ok");
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("a late failure does not remove a newer check for the same user", async () => {
    const pf = createGatePrefetch<string>();
    let rejectOld!: (e: Error) => void;
    pf.start("u1", () => new Promise<string>((_, rej) => (rejectOld = rej)));
    const old = pf.take("u1")!;
    old.catch(() => {});
    // The fetcher runs on the next microtask.
    await Promise.resolve();
    pf.start("u1", async () => "new");
    rejectOld(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    await expect(pf.take("u1")).resolves.toBe("new");
  });
});
