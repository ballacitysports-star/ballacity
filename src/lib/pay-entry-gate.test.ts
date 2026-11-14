import { describe, it, expect } from "vitest";
import { payEntryBlock, PARTICIPATION_BLOCKED_FALLBACK } from "./pay-entry-gate";
import { can, DEFAULT_CHILD_CONTROLS } from "./child-policy";
import { PAYMENTS_AGE_REQUIRED_MESSAGE, PAYMENTS_BLOCKED_MESSAGE } from "./payments-policy";

const open = { locked: false, reason: "" };
const closed = { locked: true, reason: "The host has closed joining for this game." };
const allowed = { allowed: true, level: "allowed" as const, reason: null };

const fresh = { holdsPlace: false, paymentIn: false, approved: false };

describe("payEntryBlock", () => {
  it("lets an allowed viewer pay on an open game", () => {
    expect(
      payEntryBlock({ ...fresh, gate: open, participation: allowed, payments: allowed }),
    ).toBeNull();
  });

  describe("payments (enforce_game_payment_cohort refuses every new claim)", () => {
    it("blocks a 13-15 account with the payments message, before any other rule", () => {
      const subject = { cohort: "teen_13_15" as const, consent: { status: "approved" } };
      const block = payEntryBlock({
        ...fresh,
        gate: closed,
        participation: can("game_participation", subject as never),
        payments: can("game_payments", subject as never),
      });
      expect(block).toEqual({ kind: "payments", message: PAYMENTS_BLOCKED_MESSAGE });
    });

    it("blocks an under-13 account", () => {
      const subject = { cohort: "child_under_13" as const, consent: { status: "approved" } };
      expect(
        payEntryBlock({
          ...fresh,
          gate: open,
          participation: allowed,
          payments: can("game_payments", subject as never),
        })?.kind,
      ).toBe("payments");
    });

    it("tells an account with no date of birth to add it", () => {
      const subject = { cohort: "unknown" as const };
      expect(
        payEntryBlock({
          ...fresh,
          gate: open,
          participation: allowed,
          payments: can("game_payments", subject as never),
          ageUnknown: true,
        }),
      ).toEqual({ kind: "payments", message: PAYMENTS_AGE_REQUIRED_MESSAGE });
    });

    it("gives the consent reason when a parent has not approved the account", () => {
      const block = payEntryBlock({
        ...fresh,
        gate: open,
        participation: allowed,
        payments: {
          allowed: false,
          level: "protected",
          reason: "A parent or guardian must approve this account first.",
        },
      });
      expect(block).toEqual({
        kind: "payments",
        message: "A parent or guardian must approve this account first.",
      });
    });

    it("applies even to a viewer already in the flow: the database refuses any new claim", () => {
      expect(
        payEntryBlock({
          holdsPlace: true,
          paymentIn: true,
          approved: true,
          gate: open,
          participation: allowed,
          payments: { allowed: false, level: "blocked", reason: "Not available" },
        })?.kind,
      ).toBe("payments");
    });

    it("lets a 16-17 account and an adult pay", () => {
      for (const cohort of ["teen_16_17", "adult"] as const) {
        const subject = { cohort, consent: { status: "approved" } };
        expect(
          payEntryBlock({
            ...fresh,
            gate: open,
            participation: can("game_participation", subject as never),
            payments: can("game_payments", subject as never),
          }),
        ).toBeNull();
      }
    });
  });

  describe("participation (the roster gate refuses the place whoever writes it)", () => {
    it("blocks a 16-17 whose guardian turned games off", () => {
      const subject = {
        cohort: "teen_16_17" as const,
        consent: { status: "approved" },
        controls: { ...DEFAULT_CHILD_CONTROLS, gameParticipation: false },
      };
      expect(
        payEntryBlock({
          ...fresh,
          gate: open,
          participation: can("game_participation", subject as never),
          payments: can("game_payments", subject as never),
        }),
      ).toEqual({ kind: "participation", message: "A parent or guardian has turned this off." });
    });

    it("blocks a viewer with a payment in or an approval too (no place can follow)", () => {
      const participation = { allowed: false, reason: null };
      expect(
        payEntryBlock({
          holdsPlace: false,
          paymentIn: true,
          approved: true,
          gate: open,
          participation,
          payments: allowed,
        }),
      ).toEqual({ kind: "participation", message: PARTICIPATION_BLOCKED_FALLBACK });
    });

    it("leaves a viewer who already holds a place alone", () => {
      expect(
        payEntryBlock({
          holdsPlace: true,
          paymentIn: false,
          approved: false,
          gate: open,
          participation: { allowed: false, reason: "x" },
          payments: allowed,
        }),
      ).toBeNull();
    });
  });

  describe("locked game (the join gate refuses a new player's place)", () => {
    it("blocks a new viewer with the gate's reason", () => {
      expect(
        payEntryBlock({ ...fresh, gate: closed, participation: allowed, payments: allowed }),
      ).toEqual({ kind: "locked", message: "The host has closed joining for this game." });
    });

    it("keeps the way to pay for a viewer already in the flow, as the game page does", () => {
      for (const inFlow of [
        { holdsPlace: true, paymentIn: false, approved: false },
        { holdsPlace: false, paymentIn: true, approved: false },
        { holdsPlace: false, paymentIn: false, approved: true },
      ]) {
        expect(
          payEntryBlock({ ...inFlow, gate: closed, participation: allowed, payments: allowed }),
        ).toBeNull();
      }
    });
  });
});
