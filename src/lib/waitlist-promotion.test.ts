import { describe, expect, it } from "vitest";
import {
  formatOfferCountdown,
  offerSecondsRemaining,
  parsePromotionOutcomes,
  promotionNotification,
  waitlistRankLabel,
  type PromotionOutcome,
} from "./waitlist-promotion";

const outcome = (over: Partial<PromotionOutcome>): PromotionOutcome => ({
  entryId: "e1",
  userId: "u1",
  outcome: "promoted",
  position: "Guard",
  expiresAt: null,
  gameTitle: "Friday Hoops",
  ...over,
});

describe("parsePromotionOutcomes", () => {
  it("reads the RPC payload", () => {
    expect(
      parsePromotionOutcomes([
        {
          entryId: "e1",
          userId: "u1",
          outcome: "offered",
          position: "Guard",
          expiresAt: "2026-10-06T16:30:00Z",
          gameTitle: "Friday Hoops",
        },
      ]),
    ).toEqual([outcome({ outcome: "offered", expiresAt: "2026-10-06T16:30:00Z" })]);
  });

  it("drops malformed rows and non-arrays", () => {
    expect(parsePromotionOutcomes(null)).toEqual([]);
    expect(parsePromotionOutcomes({})).toEqual([]);
    expect(
      parsePromotionOutcomes([
        null,
        3,
        { entryId: "e", userId: "u", outcome: "bogus" },
        { userId: "u" },
      ]),
    ).toEqual([]);
  });
});

describe("promotionNotification", () => {
  it("tells a promoted player they are on the roster", () => {
    expect(promotionNotification(outcome({ outcome: "promoted" }))).toEqual({
      type: "waitlist_promoted",
      title: "A spot opened up for Friday Hoops!",
      body: "You're on the roster.",
    });
  });

  it("gives an offered player the 30 minute claim window", () => {
    const n = promotionNotification(outcome({ outcome: "offered" }));
    expect(n?.type).toBe("waitlist_offer");
    expect(n?.body).toContain("30 minutes");
  });

  it("tells an expired player the spot moved on, and stays quiet for declines", () => {
    expect(promotionNotification(outcome({ outcome: "expired" }))?.type).toBe(
      "waitlist_offer_expired",
    );
    expect(promotionNotification(outcome({ outcome: "declined" }))).toBeNull();
  });
});

describe("offer countdown", () => {
  const now = Date.parse("2026-10-06T16:00:00Z");

  it("counts down to the expiry and stops at zero", () => {
    expect(offerSecondsRemaining("2026-10-06T16:30:00Z", now)).toBe(1800);
    expect(offerSecondsRemaining("2026-10-06T16:00:00.400Z", now)).toBe(1);
    expect(offerSecondsRemaining("2026-10-06T15:59:00Z", now)).toBe(0);
    expect(offerSecondsRemaining(null, now)).toBe(0);
    expect(offerSecondsRemaining("garbage", now)).toBe(0);
  });

  it("formats as m:ss", () => {
    expect(formatOfferCountdown(1800)).toBe("30:00");
    expect(formatOfferCountdown(61)).toBe("1:01");
    expect(formatOfferCountdown(9)).toBe("0:09");
    expect(formatOfferCountdown(-4)).toBe("0:00");
  });
});

describe("waitlistRankLabel", () => {
  it("reads naturally with or without a position", () => {
    expect(waitlistRankLabel(1)).toBe("You're #1 on the waitlist");
    expect(waitlistRankLabel(3, "Guard")).toBe("You're #3 on the Guard waitlist");
    expect(waitlistRankLabel(2, "  ")).toBe("You're #2 on the waitlist");
  });
});
