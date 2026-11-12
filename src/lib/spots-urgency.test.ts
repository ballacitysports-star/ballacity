import { describe, it, expect } from "vitest";
import {
  getSpotsUrgency,
  hasPaymentIn,
  spotsOpenLabel,
  showFilledUpWarning,
} from "./spots-urgency";

describe("getSpotsUrgency", () => {
  it("returns full when no spots remain", () => {
    expect(getSpotsUrgency(0, 10)).toBe("full");
    expect(getSpotsUrgency(-1, 10)).toBe("full");
  });

  it("returns critical for 1-3 remaining regardless of capacity", () => {
    expect(getSpotsUrgency(1, 100)).toBe("critical");
    expect(getSpotsUrgency(3, 100)).toBe("critical");
    expect(getSpotsUrgency(3)).toBe("critical");
  });

  it("returns low when >3 but within 20% of capacity", () => {
    // 20 capacity, 4 left -> 20% -> low
    expect(getSpotsUrgency(4, 20)).toBe("low");
    // 50 capacity, 10 left -> 20% -> low
    expect(getSpotsUrgency(10, 50)).toBe("low");
  });

  it("returns normal when plenty of room", () => {
    expect(getSpotsUrgency(15, 20)).toBe("normal");
    expect(getSpotsUrgency(50, 100)).toBe("normal");
  });

  it("without maxPlayers, never returns low", () => {
    expect(getSpotsUrgency(20)).toBe("normal");
    expect(getSpotsUrgency(4)).toBe("normal");
  });
});

describe("spotsOpenLabel", () => {
  it("says how many spots are open", () => {
    expect(spotsOpenLabel(10)).toBe("10 spots open");
    expect(spotsOpenLabel(1)).toBe("1 spot open");
  });

  it("says Full when nothing is left", () => {
    expect(spotsOpenLabel(0)).toBe("Full");
    expect(spotsOpenLabel(-2, { short: true })).toBe("Full");
  });

  it("has a short form for tight rows", () => {
    expect(spotsOpenLabel(7, { short: true })).toBe("7 open");
  });
});

describe("showFilledUpWarning (pay page)", () => {
  const full = { liveCount: 10, spotsLeft: 0, viewerHoldsPlace: false, hasSubmission: false };

  it("warns a viewer still about to pay when the live count says the game is full", () => {
    expect(showFilledUpWarning(full)).toBe(true);
  });

  it("does not warn a player who holds a place or has a payment in", () => {
    // The payer whose own PayPal payment filled the last spot, a rostered unpaid player sent
    // here by the host's reminder, and a player waiting on the host to check their proof.
    expect(showFilledUpWarning({ ...full, viewerHoldsPlace: true })).toBe(false);
    expect(showFilledUpWarning({ ...full, hasSubmission: true })).toBe(false);
  });

  it("says nothing while the viewer's own payments are still loading", () => {
    expect(showFilledUpWarning({ ...full, loading: true })).toBe(false);
  });

  it("stays quiet while spots remain or the live count is unknown", () => {
    expect(showFilledUpWarning({ ...full, spotsLeft: 1, liveCount: 9 })).toBe(false);
    expect(showFilledUpWarning({ ...full, liveCount: undefined })).toBe(false);
  });
});

describe("hasPaymentIn", () => {
  it("counts a payment waiting for the host, verified or disputed", () => {
    expect(hasPaymentIn([{ status: "pending" }])).toBe(true);
    expect(hasPaymentIn([{ status: "verified" }])).toBe(true);
    expect(hasPaymentIn([{ status: "disputed" }])).toBe(true);
  });

  it("does not count a rejected or cancelled one: that player is about to pay again", () => {
    expect(hasPaymentIn([{ status: "rejected" }, { status: "cancelled" }])).toBe(false);
    expect(hasPaymentIn([])).toBe(false);
  });
});
