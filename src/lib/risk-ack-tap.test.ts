import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RISK_ACK_WAIT_MS,
  planRiskAckTap,
  riskAckReadFrom,
  settleRiskAckTap,
  type RiskAckRead,
} from "./risk-ack-tap";

const CURRENT = "v-current";
/** A player who has not joined: asked unless the current version is on file. */
const player = (v: string | null) => v !== CURRENT;
/** A host or a confirmed player: never asked. */
const neverAsked = () => false;

describe("riskAckReadFrom", () => {
  it("maps react-query's status and data", () => {
    expect(riskAckReadFrom("pending", undefined)).toEqual({ state: "pending" });
    expect(riskAckReadFrom("success", CURRENT)).toEqual({ state: "answered", version: CURRENT });
    expect(riskAckReadFrom("success", null)).toEqual({ state: "answered", version: null });
    expect(riskAckReadFrom("error", undefined)).toEqual({ state: "failed" });
    // A failed refetch keeps the earlier answer.
    expect(riskAckReadFrom("error", CURRENT)).toEqual({ state: "answered", version: CURRENT });
  });
});

describe("planRiskAckTap", () => {
  it("goes straight to the join for a player who acknowledged", () => {
    expect(planRiskAckTap({ state: "answered", version: CURRENT }, player)).toEqual({
      kind: "decided",
      needsRiskAck: false,
    });
  });

  it("asks a player with no acknowledgment, or an old version", () => {
    for (const version of [null, "v-old"]) {
      expect(planRiskAckTap({ state: "answered", version }, player)).toEqual({
        kind: "decided",
        needsRiskAck: true,
      });
    }
  });

  it("asks when the read failed (fail closed)", () => {
    expect(planRiskAckTap({ state: "failed" }, player)).toEqual({
      kind: "decided",
      needsRiskAck: true,
    });
  });

  it("waits while the first read is out instead of asking a player who may have acknowledged", () => {
    expect(planRiskAckTap({ state: "pending" }, player)).toEqual({ kind: "wait" });
  });

  it("never waits or asks for a viewer the gate does not apply to", () => {
    for (const read of [
      { state: "pending" },
      { state: "failed" },
      { state: "answered", version: null },
    ] as RiskAckRead[]) {
      expect(planRiskAckTap(read, neverAsked)).toEqual({ kind: "decided", needsRiskAck: false });
    }
  });
});

describe("settleRiskAckTap", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("joins without the dialog when the read answers with the current version in time", async () => {
    const decided = settleRiskAckTap(
      () => new Promise((r) => setTimeout(() => r({ state: "answered", version: CURRENT }), 300)),
      player,
    );
    await vi.advanceTimersByTimeAsync(300);
    await expect(decided).resolves.toBe(false);
  });

  it("asks when the read answers with no acknowledgment", async () => {
    const decided = settleRiskAckTap(
      () => Promise.resolve({ state: "answered", version: null }),
      player,
    );
    await expect(decided).resolves.toBe(true);
  });

  it("asks when the read fails or rejects", async () => {
    await expect(
      settleRiskAckTap(() => Promise.resolve({ state: "failed" }), player),
    ).resolves.toBe(true);
    await expect(settleRiskAckTap(() => Promise.reject(new Error("boom")), player)).resolves.toBe(
      true,
    );
  });

  // The old handler awaited the refetch with no bound: a read held up (slow
  // network, offline pause, react-query's ~7 s of retries on a failing first
  // fetch) kept the CTA disabled for that long, or for good.
  it("stops waiting after RISK_ACK_WAIT_MS and asks", async () => {
    let settled: boolean | undefined;
    void settleRiskAckTap(() => new Promise<RiskAckRead>(() => {}), player).then((v) => {
      settled = v;
    });
    await vi.advanceTimersByTimeAsync(RISK_ACK_WAIT_MS - 1);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });

  it("asks when the read is somehow still pending once it returns", async () => {
    await expect(
      settleRiskAckTap(() => Promise.resolve({ state: "pending" }), player),
    ).resolves.toBe(true);
  });
});
