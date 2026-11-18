import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const insert = vi.fn();
const getSession = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ insert: (...a: unknown[]) => insert(...a) }),
    auth: { getSession: () => getSession() },
  },
}));

import { createPaymentSubmission } from "./payments";
import {
  PAYMENTS_AGE_REQUIRED_MESSAGE,
  PAYMENTS_BLOCKED_MESSAGE,
  PAYMENTS_HOST_AGE_REQUIRED_MESSAGE,
  PAYMENTS_PLAYER_AGE_REQUIRED_MESSAGE,
  PAYMENT_CLAIM_REFUSAL_CODES,
  PAYMENT_PRECONDITION_MESSAGES,
  paymentClaimRefusalMessage,
  paymentSubmissionErrorMessage,
} from "./payments-policy";

const claim = {
  game_id: "g1",
  host_id: "host",
  payment_method_id: "m1",
  payment_type: "venmo",
  screenshot_path: null,
  paid_amount: 10,
};

beforeEach(() => {
  rpc.mockReset();
  insert.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: { user: { id: "me" } } }, error: null });
});

describe("paymentSubmissionErrorMessage (20261111120000)", () => {
  it("turns the database's age refusal into a next step", () => {
    const msg = paymentSubmissionErrorMessage(
      "AGE_VERIFICATION_REQUIRED: add your date of birth before paying for a game.",
    );
    expect(msg).toBe(PAYMENTS_AGE_REQUIRED_MESSAGE);
    expect(msg).not.toMatch(/AGE_VERIFICATION_REQUIRED/);
  });

  it("tells a host what to do when a player or the host has no date of birth", () => {
    const player = paymentSubmissionErrorMessage(
      "AGE_VERIFICATION_REQUIRED: this player must add their date of birth before paying for a game.",
    );
    expect(player).toBe(PAYMENTS_PLAYER_AGE_REQUIRED_MESSAGE);
    expect(player).toMatch(/turn the claim down/);
    expect(
      paymentSubmissionErrorMessage(
        "AGE_VERIFICATION_REQUIRED: add your date of birth before taking payments.",
      ),
    ).toBe(PAYMENTS_HOST_AGE_REQUIRED_MESSAGE);
    for (const m of [player, PAYMENTS_HOST_AGE_REQUIRED_MESSAGE]) {
      expect(m).not.toMatch(/AGE_VERIFICATION_REQUIRED/);
    }
  });

  it("explains the cohort refusal without the code", () => {
    expect(
      paymentSubmissionErrorMessage(
        "PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this account yet.",
      ),
    ).toBe(PAYMENTS_BLOCKED_MESSAGE);
    expect(
      paymentSubmissionErrorMessage(
        "PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this host account yet.",
      ),
    ).toBe("Payment coordination isn't available for this host account yet.");
  });

  it("passes any other error through unchanged", () => {
    expect(paymentSubmissionErrorMessage("network down")).toBe("network down");
  });
});

describe("paymentSubmissionErrorMessage: the roster rules on a manual claim (20261118200000)", () => {
  /** Each code the trigger raises, with the sentence it raises it with, read from the migration itself. */
  const raised = [
    ...readFileSync(
      new URL(
        "../../supabase/migrations/20261118200000_payment_claim_preconditions.sql",
        import.meta.url,
      ),
      "utf8",
    ).matchAll(/WHEN '([A-Z_]+)' THEN '((?:[^']|'')*)'/g),
  ].map(([, code, sentence]) => ({
    code: code!,
    raw: `${code}: ${sentence!.replace(/''/g, "'")}`,
  }));

  it("knows every code the trigger raises, and only those", () => {
    expect(raised.map((r) => r.code).sort()).toEqual([...PAYMENT_CLAIM_REFUSAL_CODES].sort());
  });

  it.each(PAYMENT_CLAIM_REFUSAL_CODES)(
    "%s reads as PayPal's sentence, without saying nothing was charged",
    (code) => {
      const { raw } = raised.find((r) => r.code === code)!;
      const msg = paymentSubmissionErrorMessage(raw);
      expect(msg).toBe(paymentClaimRefusalMessage(code));
      expect(`${msg} You weren't charged.`).toBe(PAYMENT_PRECONDITION_MESSAGES[code]);
      // The money may already have moved in the player's payment app.
      expect(msg).not.toMatch(/charged/i);
      expect(msg).not.toContain(code);
      expect(msg.length).toBeGreaterThan(10);
    },
  );

  it("gives the plain sentences the player sees", () => {
    expect(paymentSubmissionErrorMessage("GAME_FULL: this game is full.")).toBe(
      "This game is full.",
    );
    expect(paymentSubmissionErrorMessage("GAME_CANCELLED: x")).toBe("This game was cancelled.");
    expect(paymentSubmissionErrorMessage("BLOCKED_BY_HOST: x")).toBe(
      "You can't join this host's games.",
    );
  });

  it("matches whole codes at the start only", () => {
    // A longer code that merely ends in one of these is not that code.
    const child =
      "CHILD_GAME_PARTICIPATION_BLOCKED: a parent or guardian must approve this account.";
    expect(paymentSubmissionErrorMessage(child)).toBe(child);
    // Other codes and plain errors pass through as before.
    expect(paymentSubmissionErrorMessage("PAYMENT_IN_PROGRESS: x")).toBe("PAYMENT_IN_PROGRESS: x");
    expect(paymentSubmissionErrorMessage("network down: GAME_FULL")).toBe(
      "network down: GAME_FULL",
    );
  });
});

describe("createPaymentSubmission", () => {
  it("tells an account with no date of birth to add one, and writes nothing", async () => {
    // Not allowed to pay, and no declared age.
    rpc.mockResolvedValue({ data: false });
    await expect(createPaymentSubmission(claim)).rejects.toThrow(PAYMENTS_AGE_REQUIRED_MESSAGE);
    expect(rpc).toHaveBeenCalledWith("age_verified", { _user: "me" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps the general refusal for an account that has a date of birth", async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === "game_payments_allowed" ? { data: false } : { data: true },
    );
    await expect(createPaymentSubmission(claim)).rejects.toThrow(PAYMENTS_BLOCKED_MESSAGE);
    expect(insert).not.toHaveBeenCalled();
  });

  it("explains the database's refusal when the gate is passed", async () => {
    rpc.mockResolvedValue({ data: true });
    insert.mockResolvedValue({
      error: {
        message: "AGE_VERIFICATION_REQUIRED: add your date of birth before paying for a game.",
      },
    });
    await expect(createPaymentSubmission(claim)).rejects.toThrow(PAYMENTS_AGE_REQUIRED_MESSAGE);
  });

  it("writes the claim as the signed-in player", async () => {
    rpc.mockResolvedValue({ data: true });
    insert.mockResolvedValue({ error: null });
    await createPaymentSubmission(claim);
    expect(insert).toHaveBeenCalledWith({ ...claim, player_id: "me" });
  });
});
