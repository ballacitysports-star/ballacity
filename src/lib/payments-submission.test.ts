import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const insert = vi.fn();
const getUser = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ insert: (...a: unknown[]) => insert(...a) }),
    auth: { getUser: () => getUser() },
  },
}));

import { createPaymentSubmission } from "./payments";
import {
  PAYMENTS_AGE_REQUIRED_MESSAGE,
  PAYMENTS_BLOCKED_MESSAGE,
  PAYMENTS_HOST_AGE_REQUIRED_MESSAGE,
  PAYMENTS_PLAYER_AGE_REQUIRED_MESSAGE,
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
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "me" } } });
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
