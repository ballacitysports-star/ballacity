import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Task #71: a minor with a linked guardian on an open game (no host approval) used to be offered "Join Run" or
 * "Pay Host" with no request, so the database refused them and their guardian had nothing to approve. They now ask
 * their parent; the request goes to the guardian alone and stays out of the host's queue while the game is open.
 */

const settingsRows: { game_id: string; requires_approval: boolean | null }[] = [];
let settingsError: { message: string } | null = null;
const settingsQueries: string[][] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "game_payment_settings") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => {
            settingsQueries.push(ids);
            return Promise.resolve({
              data: settingsError ? null : settingsRows.filter((r) => ids.includes(r.game_id)),
              error: settingsError,
            });
          },
        }),
      };
    },
  },
}));

const {
  ASK_PARENT_LABEL,
  guardedOpenCopy,
  guardedOpenStep,
  guardianOnlyJoin,
  guardianOnlyRequestKey,
  hostAnswersRequest,
  isGuardianOnlyRequest,
} = await import("./guarded-open-join");
const { joinWait, playerWaitCopy } = await import("./join-guardian-status");
const { paymentSubmissionErrorMessage, PAYMENTS_GUARDIAN_APPROVAL_MESSAGE } =
  await import("./payments-policy");
const { withoutGuardianOnly } = await import("./payments");

beforeEach(() => {
  settingsRows.length = 0;
  settingsQueries.length = 0;
  settingsError = null;
});

describe("who asks their parent instead of joining", () => {
  it("a guarded player on an open game", () => {
    expect(guardianOnlyJoin({ isHost: false, hasGuardian: true, requiresApproval: false })).toBe(
      true,
    );
  });

  it("not on a game that needs the host (the usual request, answered by both)", () => {
    expect(guardianOnlyJoin({ isHost: false, hasGuardian: true, requiresApproval: true })).toBe(
      false,
    );
  });

  it("not a player with no guardian, nor the host", () => {
    expect(guardianOnlyJoin({ isHost: false, hasGuardian: false, requiresApproval: false })).toBe(
      false,
    );
    expect(guardianOnlyJoin({ isHost: true, hasGuardian: true, requiresApproval: false })).toBe(
      false,
    );
  });
});

describe("where the player stands", () => {
  it("no request yet: ask", () => {
    expect(guardedOpenStep(null)).toBe("ask_parent");
    expect(ASK_PARENT_LABEL).toBe("Ask your parent");
  });

  it("asked, no answer: waiting; the host's own status does not matter", () => {
    expect(guardedOpenStep({ status: "pending", guardian_approved_at: null })).toBe(
      "waiting_parent",
    );
    expect(guardedOpenStep({ status: "approved" })).toBe("waiting_parent");
  });

  it("the parent said yes: cleared to join or pay, with the request still pending for the host", () => {
    expect(
      guardedOpenStep({ status: "pending", guardian_approved_at: "2026-11-11T10:00:00Z" }),
    ).toBe("cleared");
  });

  it("declined: may ask again", () => {
    expect(guardedOpenStep({ status: "rejected", guardian_approved_at: null })).toBe("declined");
  });

  it("tells the player the host does not need to answer, and what to do next", () => {
    expect(guardedOpenCopy("ask_parent", { isPaid: false }).body).toMatch(/doesn't need the host/);
    expect(guardedOpenCopy("waiting_parent", { isPaid: false }).body).toMatch(
      /host doesn't need to answer/,
    );
    expect(guardedOpenCopy("cleared", { isPaid: false }).body).toMatch(/Join Run/);
    expect(guardedOpenCopy("cleared", { isPaid: true }).body).toMatch(/Pay the host/);
    expect(guardedOpenCopy("declined", { isPaid: false, declinedByGuardian: true }).title).toMatch(
      /parent said no/,
    );
    expect(guardedOpenCopy("declined", { isPaid: false }).title).toMatch(/declined/);
  });
});

describe("the waiting banner on an open game", () => {
  it("waits on the parent only, never the host", () => {
    const w = joinWait({
      hostStatus: "pending",
      needsGuardian: true,
      guardianApproved: false,
      hostAnswers: false,
    })!;
    expect(w).toEqual({ onParent: true, onHost: false, guardianOnly: true });
    const copy = playerWaitCopy(w);
    expect(copy.title).toBe("Waiting for your parent");
    expect(copy.title).not.toMatch(/host/i);
    expect(copy.body).not.toMatch(/host said yes/i);
  });

  it("nothing to wait for once the parent approved", () => {
    expect(
      joinWait({
        hostStatus: "pending",
        needsGuardian: true,
        guardianApproved: true,
        hostAnswers: false,
      }),
    ).toBeNull();
  });

  it("a game that needs the host is unchanged", () => {
    expect(
      joinWait({ hostStatus: "pending", needsGuardian: true, guardianApproved: false }),
    ).toEqual({ onParent: true, onHost: true });
  });
});

describe("what the host is asked to answer", () => {
  const mine = { game_id: "open", idempotency_key: guardianOnlyRequestKey("open") };

  it("marks a request sent to the guardian alone", () => {
    expect(isGuardianOnlyRequest(mine)).toBe(true);
    expect(isGuardianOnlyRequest({ idempotency_key: "join:open" })).toBe(false);
    expect(isGuardianOnlyRequest({ idempotency_key: null })).toBe(false);
    expect(isGuardianOnlyRequest(null)).toBe(false);
  });

  it("the host does not answer it while the game is open, and does once approval is on", () => {
    expect(hostAnswersRequest(mine, false)).toBe(false);
    expect(hostAnswersRequest(mine, true)).toBe(true);
    // No settings row: request-to-join, so the host answers.
    expect(hostAnswersRequest(mine, undefined)).toBe(true);
    expect(hostAnswersRequest(mine, null)).toBe(true);
  });

  it("every other request stays with the host", () => {
    expect(hostAnswersRequest({ idempotency_key: "join:open" }, false)).toBe(true);
  });

  it("drops only guardian-only requests on open games from the host's list", async () => {
    settingsRows.push(
      { game_id: "open", requires_approval: false },
      { game_id: "queue", requires_approval: true },
    );
    const rows = [
      mine,
      { game_id: "open", idempotency_key: "join:open" },
      { game_id: "queue", idempotency_key: guardianOnlyRequestKey("queue") },
      { game_id: "nosettings", idempotency_key: guardianOnlyRequestKey("nosettings") },
    ];
    const kept = await withoutGuardianOnly(rows);
    expect(kept).toEqual(rows.slice(1));
    expect(settingsQueries).toEqual([["open", "queue", "nosettings"]]);
  });

  it("reads nothing when no request is guardian-only", async () => {
    const rows = [{ game_id: "g", idempotency_key: "join:g" }];
    expect(await withoutGuardianOnly(rows)).toEqual(rows);
    expect(settingsQueries).toHaveLength(0);
  });

  it("keeps everything if the settings cannot be read", async () => {
    settingsError = { message: "boom" };
    expect(await withoutGuardianOnly([mine])).toEqual([mine]);
  });
});

describe("a refused payment before the parent approved", () => {
  it("is a next step, not the database's code", () => {
    const msg = paymentSubmissionErrorMessage(
      "GUARDIAN_APPROVAL_REQUIRED: a parent or guardian has to approve this game before a payment can be sent.",
    );
    expect(msg).toBe(PAYMENTS_GUARDIAN_APPROVAL_MESSAGE);
    expect(msg).not.toMatch(/GUARDIAN_APPROVAL_REQUIRED/);
    expect(msg).toMatch(/parent/);
  });
});
