import { isLegalReviewed } from "@/lib/legal-review";
import { describe, expect, it } from "vitest";
import {
  ADDRESS_PRIVACY_NOTE,
  EMERGENCY_NOTICE,
  GAME_INFO_TIPS,
  HOST_RESPONSIBILITY,
  LEGAL_REVIEW_LABEL,
  RISK_ACKNOWLEDGMENT,
  SAFETY_ACK_VERSION,
  SAFETY_TOPICS,
  ackCopy,
  needsRiskAcknowledgment,
} from "./safety";

describe("safety copy", () => {
  it("uses the exact required risk sentence", () => {
    expect(RISK_ACKNOWLEDGMENT.text).toBe(
      "Sports and recreational activities involve inherent risks, including injury. " +
        "By joining this activity, you acknowledge these risks and agree to follow applicable " +
        "facility, host, and safety rules.",
    );
  });

  it("never claims BallaCity guarantees safety", () => {
    const all = [
      RISK_ACKNOWLEDGMENT.text,
      HOST_RESPONSIBILITY.text,
      EMERGENCY_NOTICE,
      ADDRESS_PRIVACY_NOTE,
      ...RISK_ACKNOWLEDGMENT.points,
      ...HOST_RESPONSIBILITY.points,
      ...SAFETY_TOPICS.flatMap((t) => t.points),
    ].join(" ");
    // Only affirmative claims are forbidden; explicit disclaimers ("does not
    // guarantee", "never claim BallaCity guarantees…") are exactly what we want.
    expect(all).not.toMatch(/(?<!(?:not|never claim) )BallaCity (guarantees|ensures) safety/i);
    expect(HOST_RESPONSIBILITY.text).toMatch(/does not organize, supervise, or guarantee/i);

    expect(EMERGENCY_NOTICE).toMatch(/not an emergency service/i);
  });

  it("says the acknowledgments are pending legal review until counsel signs off", () => {
    expect(LEGAL_REVIEW_LABEL).toBe("LEGAL REVIEW REQUIRED");
    expect(RISK_ACKNOWLEDGMENT.disclaimer).toMatch(/not a waiver/i);
    const pending = !isLegalReviewed("safetyAcknowledgments");
    for (const ack of [RISK_ACKNOWLEDGMENT, HOST_RESPONSIBILITY]) {
      expect(/pending legal review/i.test(ack.disclaimer)).toBe(pending);
    }
  });

  it("versions both acknowledgments together", () => {
    expect(ackCopy("participant_risk").version).toBe(SAFETY_ACK_VERSION);
    expect(ackCopy("host_responsibility").version).toBe(SAFETY_ACK_VERSION);
    expect(ackCopy("host_responsibility").kind).toBe("host_responsibility");
  });

  it("covers every required safety center topic", () => {
    expect(SAFETY_TOPICS.map((t) => t.id)).toEqual([
      "sports",
      "meeting",
      "game",
      "payments",
      "messaging",
      "reporting",
      "blocking",
    ]);
    for (const t of SAFETY_TOPICS) expect(t.points.length).toBeGreaterThan(2);
  });

  it("recommends the key game info fields", () => {
    const ids = GAME_INFO_TIPS.map((t) => t.id);
    for (const id of [
      "facility",
      "court",
      "indoor",
      "time",
      "skill",
      "limit",
      "rules",
      "contact",
    ]) {
      expect(ids).toContain(id);
    }
    expect(ADDRESS_PRIVACY_NOTE).toMatch(/residential address/i);
  });
});

describe("needsRiskAcknowledgment", () => {
  const base = { signedIn: true, isHost: false, alreadyJoined: false, acknowledgedVersion: null };

  it("prompts a signed-in player who hasn't acknowledged", () => {
    expect(needsRiskAcknowledgment(base)).toBe(true);
  });

  it("skips hosts and players already on the roster", () => {
    expect(needsRiskAcknowledgment({ ...base, isHost: true })).toBe(false);
    expect(needsRiskAcknowledgment({ ...base, alreadyJoined: true })).toBe(false);
  });

  it("skips when the current version was already acknowledged", () => {
    expect(needsRiskAcknowledgment({ ...base, acknowledgedVersion: SAFETY_ACK_VERSION })).toBe(
      false,
    );
  });

  it("re-prompts when the wording version changed", () => {
    expect(needsRiskAcknowledgment({ ...base, acknowledgedVersion: "2020-old" })).toBe(true);
  });

  it("defers to the sign-in gate for visitors", () => {
    expect(needsRiskAcknowledgment({ ...base, signedIn: false })).toBe(false);
  });
});
