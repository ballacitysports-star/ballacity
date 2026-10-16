import { describe, expect, it } from "vitest";
import { describeAvailabilityError, summarizeAvailability, type AvailabilityAnswer } from "./team-availability";

const answer = (userId: string, status: AvailabilityAnswer["status"]): AvailabilityAnswer => ({ userId, status, note: null, byGuardian: false });

describe("summarizeAvailability", () => {
  it("counts each roster member once and treats missing answers as no reply", () => {
    expect(summarizeAvailability(["a", "b", "c", "d", "a"], [answer("a", "available"), answer("b", "maybe"), answer("c", "unavailable")]))
      .toEqual({ available: 1, maybe: 1, unavailable: 1, noReply: 1 });
  });

  it("ignores answers from people who left the roster", () => {
    expect(summarizeAvailability(["a"], [answer("gone", "available")])).toEqual({ available: 0, maybe: 0, unavailable: 0, noReply: 1 });
  });
});

describe("describeAvailabilityError", () => {
  it("translates server codes and falls back to a generic message", () => {
    expect(describeAvailabilityError("NOT_ON_TEAM")).toMatch(/roster/);
    expect(describeAvailabilityError("EVENT_STARTED")).toMatch(/already started/);
    expect(describeAvailabilityError(undefined)).toMatch(/try again/);
  });
});
