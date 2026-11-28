import { describe, expect, it } from "vitest";
import { claimLocalWrite, claimNewestRead, newReadOrder } from "./read-order";

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

describe("claimLocalWrite", () => {
  it("takes the next number and claims it", () => {
    const order = newReadOrder();
    ++order.sent;
    const writeNo = claimLocalWrite(order);
    expect(writeNo).toBe(2);
    expect(order.sent).toBe(2);
    expect(order.newestApplied).toBe(2);
  });

  it("drops a read sent before the local write that answers after it", () => {
    const order = newReadOrder();
    const before = ++order.sent;
    claimLocalWrite(order);
    expect(claimNewestRead(order, before)).toBe(false);
  });

  it("still applies a read sent after the local write", () => {
    const order = newReadOrder();
    claimLocalWrite(order);
    const after = ++order.sent;
    expect(claimNewestRead(order, after)).toBe(true);
  });

  it("keeps a read sent before the write dropped after the write is undone", () => {
    // The undo claims nothing and gives nothing back, so the write's claim still holds.
    const order = newReadOrder();
    const before = ++order.sent;
    claimLocalWrite(order);
    // ...the write fails and the page puts the old row back without touching the order...
    expect(claimNewestRead(order, before)).toBe(false);
  });

  it("lets a read sent between the write and its undo land after the undo", () => {
    const order = newReadOrder();
    claimLocalWrite(order);
    const between = ++order.sent;
    // ...the write fails and the page puts the old row back without touching the order...
    expect(claimNewestRead(order, between)).toBe(true);
  });

  it("is never blocked by an earlier local write", () => {
    const order = newReadOrder();
    const first = claimLocalWrite(order);
    const second = claimLocalWrite(order);
    expect(second).toBeGreaterThan(first);
    expect(order.newestApplied).toBe(second);
  });
});
