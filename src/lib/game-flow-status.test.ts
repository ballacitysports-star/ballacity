import { describe, expect, it } from "vitest";
import { computePlayerFlowStatus, isGameId } from "./game-flow-status";

describe("isGameId", () => {
  it("accepts the ids games are actually stored with", () => {
    expect(isGameId("host-mvli8nwx-l71w")).toBe(true);
    expect(isGameId("host-muoo8rqa-qskp")).toBe(true);
    expect(isGameId("6f1c2d3e-0000-4000-8000-123456789abc")).toBe(true);
  });

  it("refuses ids that name no stored game", () => {
    for (const id of [
      "",
      "g1",
      "sample-1",
      "host-",
      "host-a",
      "host-a-b-c",
      "../x",
      undefined,
      null,
    ]) {
      expect(isGameId(id as string | null | undefined)).toBe(false);
    }
  });
});

describe("computePlayerFlowStatus on a paid game that needs approval", () => {
  const settings = { entry_fee: 10, requires_approval: true } as never;
  const pending = { status: "pending" } as never;

  it("reports a waiting request as requested, so it can be cancelled", () => {
    expect(
      computePlayerFlowStatus({ joinRequest: pending, submissions: [], settings, isJoined: false }),
    ).toBe("requested");
  });

  it("still reports it as requested when the player cannot read the payment settings yet", () => {
    expect(
      computePlayerFlowStatus({
        joinRequest: pending,
        submissions: [],
        settings: null,
        isJoined: false,
      }),
    ).toBe("requested");
  });
});

// A guarded minor's request to their parent on an open game: the host never answers it, so it stays "pending" (or
// becomes "rejected" on the parent's no) while the child pays and joins. Task #71 review.
describe("computePlayerFlowStatus on an open game with a request to the parent", () => {
  const paidOpen = { entry_fee: 10, requires_approval: false } as never;
  const freeOpen = { entry_fee: 0, requires_approval: false } as never;
  const pending = { status: "pending", guardian_approved_at: "2026-11-11T00:00:00Z" } as never;
  const waiting = { status: "pending", guardian_approved_at: null } as never;
  const declined = { status: "rejected", reviewer_notes: "Declined by guardian" } as never;
  const flow = (
    joinRequest: unknown,
    submissions: { status: string }[],
    settings: unknown,
    isJoined = false,
  ) =>
    computePlayerFlowStatus({
      joinRequest: joinRequest as never,
      submissions: submissions as never,
      settings: settings as never,
      isJoined,
    });

  it("is still a request (cancel takes it back) before any payment or place", () => {
    expect(flow(waiting, [], paidOpen)).toBe("requested");
    expect(flow(pending, [], paidOpen)).toBe("requested");
    expect(flow(pending, [], freeOpen)).toBe("requested");
    expect(flow(declined, [], paidOpen)).toBe("rejected");
  });

  it("follows the payment once one is sent, so the way out withdraws it", () => {
    expect(flow(pending, [{ status: "pending" }], paidOpen)).toBe("payment_submitted");
    expect(flow(pending, [{ status: "verified" }], paidOpen, true)).toBe("payment_verified");
    expect(flow(declined, [{ status: "pending" }], paidOpen)).toBe("payment_submitted");
  });

  it("follows the roster once the child is in", () => {
    expect(flow(pending, [], freeOpen, true)).toBe("confirmed");
  });

  it("a turned-down payment does not hide the request", () => {
    expect(flow(pending, [{ status: "rejected" }], paidOpen)).toBe("requested");
  });

  it("leaves games with a host queue, or with no settings, as they were", () => {
    const paidQueue = { entry_fee: 10, requires_approval: true } as never;
    expect(flow(pending, [{ status: "pending" }], paidQueue)).toBe("requested");
    expect(flow(pending, [{ status: "pending" }], null, true)).toBe("requested");
    expect(flow(declined, [{ status: "pending" }], paidQueue)).toBe("rejected");
  });
});
