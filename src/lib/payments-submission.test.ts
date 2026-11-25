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
  CLAIM_REFUSED_REFUND_STEP,
  PAYMENTS_AGE_REQUIRED_MESSAGE,
  PAYMENTS_BLOCKED_MESSAGE,
  PAYMENTS_HOST_AGE_REQUIRED_MESSAGE,
  PAYMENTS_PLAYER_AGE_REQUIRED_MESSAGE,
  PAYMENT_CLAIM_REFUSAL_CODES,
  PAYMENT_PRECONDITION_MESSAGES,
  PAYMENT_SAVE_FAILED_MESSAGE,
  paymentClaimRefusalMessage,
} from "./payments-policy";
import { paymentSubmissionErrorMessage } from "./user-error";

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

  it("never shows any other error's own text", () => {
    expect(paymentSubmissionErrorMessage("network down")).toBe(PAYMENT_SAVE_FAILED_MESSAGE);
    for (const raw of [
      "TypeError: Failed to fetch",
      "JWT expired",
      'new row violates row-level security policy for table "payment_submissions"',
      'new row for relation "payment_submissions" violates check constraint "paid_amount_positive"',
      "Could not find the function public.game_payments_allowed(_user) in the schema cache",
    ]) {
      const msg = paymentSubmissionErrorMessage(raw);
      expect(msg, raw).not.toContain(raw);
      expect(msg, raw).toMatch(/^[A-Z].*\.$/);
    }
    // Other codes the database raises on a claim read as the shared catalog words them.
    expect(
      paymentSubmissionErrorMessage(
        "PAYMENT_DESTINATION_INVALID: payment for this game must go to its host.",
      ),
    ).toBe("This payment has to go to the game's host.");
    // A sentence that is already ours is passed on (payments.tsx maps the error a mapper threw).
    expect(paymentSubmissionErrorMessage(PAYMENTS_BLOCKED_MESSAGE)).toBe(PAYMENTS_BLOCKED_MESSAGE);
    expect(paymentSubmissionErrorMessage(PAYMENT_SAVE_FAILED_MESSAGE)).toBe(
      PAYMENT_SAVE_FAILED_MESSAGE,
    );
  });
});

describe("paymentSubmissionErrorMessage: the roster rules on a manual claim (20261119200000, 20261202100000)", () => {
  /**
   * Each code the trigger raises, with the sentence it raises it with, read from the migration that last defines it
   * (20261202100000_removal_sticks added REMOVED_BY_HOST to 20261119200000's list).
   */
  const raised = [
    ...readFileSync(
      new URL("../../supabase/migrations/20261202100000_removal_sticks.sql", import.meta.url),
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
    "%s reads as PayPal's sentence, without saying nothing was charged, then how to get money back",
    (code) => {
      const { raw } = raised.find((r) => r.code === code)!;
      const msg = paymentSubmissionErrorMessage(raw);
      expect(msg).toBe(paymentClaimRefusalMessage(code));
      const reason = PAYMENT_PRECONDITION_MESSAGES[code]!.replace(/ You weren't charged\.$/, "");
      expect(msg).toBe(`${reason} ${CLAIM_REFUSED_REFUND_STEP}`);
      // The money may already have moved in the player's payment app, and no row tells the host.
      expect(msg).not.toMatch(/charged/i);
      expect(msg).toMatch(/message them to ask for it back\.$/);
      expect(msg).not.toContain(code);
      expect(msg.length).toBeGreaterThan(10);
    },
  );

  it("gives the plain sentences the player sees", () => {
    expect(paymentSubmissionErrorMessage("GAME_FULL: this game is full.")).toBe(
      "This game is full. If you already sent the host money, message them to ask for it back.",
    );
    expect(paymentSubmissionErrorMessage("GAME_CANCELLED: x")).toBe(
      "This game was cancelled. If you already sent the host money, message them to ask for it back.",
    );
    expect(paymentSubmissionErrorMessage("GAME_PARTICIPATION_BLOCKED: x")).toBe(
      "A parent or guardian has to allow game participation before you can pay. If you already sent the host money, message them to ask for it back.",
    );
  });

  it("matches whole codes at the start only", () => {
    // A longer code that merely ends in one of these is not that code.
    const child =
      "CHILD_GAME_PARTICIPATION_BLOCKED: a parent or guardian must approve this account.";
    expect(paymentSubmissionErrorMessage(child)).toBe(
      "A parent or guardian needs to allow games on this account first.",
    );
    // A code at the start that is not a claim refusal, and a refusal code later in the text, are not claim refusals.
    expect(paymentSubmissionErrorMessage("PAYMENT_IN_PROGRESS: x")).toBe(
      PAYMENT_SAVE_FAILED_MESSAGE,
    );
    const late = paymentSubmissionErrorMessage("network down: GAME_FULL");
    expect(late).not.toBe(paymentClaimRefusalMessage("GAME_FULL"));
    expect(late).not.toContain("network down");
  });
});

/**
 * The payment_submissions triggers that refuse with a plain sentence and no code, in their exact words: retrying
 * cannot get past them, so the player or host must read what to change, not "try again".
 */
const TRIGGER_TEXTS = {
  // reject_payment_credentials (trigger no_payment_credentials, 20260901165150).
  credentialWords:
    "Never enter card, bank, or password details here. OpenRun does not store payment credentials.",
  credentialNumber:
    "That looks like a card or bank account number. OpenRun does not store payment credentials — use your payment app handle instead.",
  // enforce_approval_before_payment (20261103140000:207), ERRCODE 42501.
  hostApproval: "Host approval required before payment can be submitted for this game.",
  // The review guard (20260915214000).
  hostOnlyReview: "Only the game host can confirm or decline a payment",
  hostOnlyDetails: "Only the game host can confirm payment details",
  locked: "Payment claim details are locked once a submission leaves pending review",
};

describe("paymentSubmissionErrorMessage: the triggers that refuse without a code", () => {
  it("says what to change for each, never 'try again' and never the trigger's own text", () => {
    for (const [name, raw] of Object.entries(TRIGGER_TEXTS)) {
      for (const err of [raw, { message: raw, code: "P0001", details: null, hint: null }]) {
        const msg = paymentSubmissionErrorMessage(err);
        expect(msg, name).not.toBe(PAYMENT_SAVE_FAILED_MESSAGE);
        expect(msg, name).not.toBe(raw);
        expect(msg, name).not.toMatch(/OpenRun|try again/i);
        expect(msg, name).toMatch(/^[A-Z].*\.$/);
      }
    }
  });

  it("tells a player to take card or bank numbers out of the transaction ID", () => {
    for (const raw of [TRIGGER_TEXTS.credentialWords, TRIGGER_TEXTS.credentialNumber]) {
      expect(paymentSubmissionErrorMessage(raw)).toMatch(/transaction ID and note/);
      expect(paymentSubmissionErrorMessage(raw)).toMatch(/payment app's handle/);
    }
  });

  it("tells an unapproved player to wait for the host, and how to get money back, even with its SQLSTATE", () => {
    const expected = paymentClaimRefusalMessage("HOST_APPROVAL_REQUIRED");
    expect(expected).toMatch(
      /^The host has to approve your request for a spot before you can pay\./,
    );
    expect(expected).toContain(CLAIM_REFUSED_REFUND_STEP);
    expect(expected).not.toMatch(/weren't charged/);
    expect(paymentSubmissionErrorMessage(TRIGGER_TEXTS.hostApproval)).toBe(expected);
    expect(
      paymentSubmissionErrorMessage({ message: TRIGGER_TEXTS.hostApproval, code: "42501" }),
    ).toBe(expected);
  });

  it("tells a reviewer who is not the host that only the host can review", () => {
    for (const raw of [TRIGGER_TEXTS.hostOnlyReview, TRIGGER_TEXTS.hostOnlyDetails]) {
      expect(paymentSubmissionErrorMessage(raw)).toBe(
        "Only the game's host can confirm or decline this payment.",
      );
    }
  });

  it("reads the SQLSTATE of an error passed whole, where an uncoded refusal has no better words", () => {
    expect(
      paymentSubmissionErrorMessage({ message: "something we have not seen", code: "42501" }),
    ).toBe("You don't have permission to do that.");
    expect(paymentSubmissionErrorMessage("something we have not seen")).toBe(
      PAYMENT_SAVE_FAILED_MESSAGE,
    );
  });

  it("matches the triggers' texts as the migrations raise them", () => {
    const migration = (f: string) =>
      readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8");
    const credentials = migration("20260901165150_7ebeef7d-965a-4f5d-8935-a90a9a6b940b.sql");
    expect(credentials).toContain(TRIGGER_TEXTS.credentialWords);
    expect(credentials).toContain(TRIGGER_TEXTS.credentialNumber);
    expect(migration("20261103140000_payment_settings_host_guard.sql")).toContain(
      TRIGGER_TEXTS.hostApproval,
    );
    const review = migration("20260915214000_freeze_payment_claim_metadata_on_dispute.sql");
    for (const raw of [
      TRIGGER_TEXTS.hostOnlyReview,
      TRIGGER_TEXTS.hostOnlyDetails,
      TRIGGER_TEXTS.locked,
    ]) {
      expect(review).toContain(raw);
    }
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

  it("tells the player why a 19-digit transaction ID was refused instead of 'try again'", async () => {
    rpc.mockResolvedValue({ data: true });
    insert.mockResolvedValue({
      error: { message: TRIGGER_TEXTS.credentialNumber, code: "P0001", details: null, hint: null },
    });
    await expect(createPaymentSubmission(claim)).rejects.toThrow(/transaction ID and note/);
  });

  it("passes the whole error on, so a refusal's SQLSTATE is read", async () => {
    rpc.mockResolvedValue({ data: true });
    insert.mockResolvedValue({
      error: { message: TRIGGER_TEXTS.hostApproval, code: "42501", details: null, hint: null },
    });
    await expect(createPaymentSubmission(claim)).rejects.toThrow(
      paymentClaimRefusalMessage("HOST_APPROVAL_REQUIRED"),
    );
  });

  it("writes the claim as the signed-in player", async () => {
    rpc.mockResolvedValue({ data: true });
    insert.mockResolvedValue({ error: null });
    await createPaymentSubmission(claim);
    expect(insert).toHaveBeenCalledWith({ ...claim, player_id: "me" });
  });
});
