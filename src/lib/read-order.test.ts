import { describe, expect, it } from "vitest";
import { claimNewestRead, newReadOrder } from "./read-order";

describe("claimNewestRead", () => {
  it("applies answers that arrive in send order", () => {
    const order = newReadOrder();
    const first = ++order.sent;
    const second = ++order.sent;
    expect(claimNewestRead(order, first)).toBe(true);
    expect(claimNewestRead(order, second)).toBe(true);
    expect(order.newestApplied).toBe(2);
  });

  it("drops an older answer that arrives after a newer one", () => {
    const order = newReadOrder();
    const older = ++order.sent;
    const newer = ++order.sent;
    expect(claimNewestRead(order, newer)).toBe(true);
    expect(claimNewestRead(order, older)).toBe(false);
    expect(order.newestApplied).toBe(newer);
  });

  it("lets the same read claim twice, for an early part and then the rest of its answer", () => {
    const order = newReadOrder();
    const readNo = ++order.sent;
    expect(claimNewestRead(order, readNo)).toBe(true);
    expect(claimNewestRead(order, readNo)).toBe(true);
  });

  it("still applies an older answer when the newer read failed and claimed nothing", () => {
    const order = newReadOrder();
    const older = ++order.sent;
    ++order.sent; // sent, then failed: never claimed
    expect(claimNewestRead(order, older)).toBe(true);
  });
});
