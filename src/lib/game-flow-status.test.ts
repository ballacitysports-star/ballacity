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
