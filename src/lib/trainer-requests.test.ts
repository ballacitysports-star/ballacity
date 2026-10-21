import { beforeEach, describe, expect, it, vi } from "vitest";

const result = { data: null as unknown, error: null as unknown };
const eq = vi.fn();
const select = vi.fn(() => Promise.resolve(result));
const update = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (v: unknown) => {
        update(v);
        return { eq: (c: string, id: string) => (eq(c, id), { select }) };
      },
    }),
  },
}));

import { cancelTrainerSessionRequest } from "./trainer-requests";

describe("cancelTrainerSessionRequest", () => {
  beforeEach(() => {
    update.mockClear();
    eq.mockClear();
    result.data = [{ id: "r1" }];
    result.error = null;
  });

  it("marks the request cancelled", async () => {
    await cancelTrainerSessionRequest("r1");
    expect(update).toHaveBeenCalledWith({ status: "cancelled" });
    expect(eq).toHaveBeenCalledWith("id", "r1");
  });

  it("fails when the database changed nothing (already completed, or not theirs)", async () => {
    result.data = [];
    await expect(cancelTrainerSessionRequest("r1")).rejects.toThrow(/can't be cancelled/i);
  });

  it("surfaces a database error", async () => {
    result.data = null;
    result.error = new Error("boom");
    await expect(cancelTrainerSessionRequest("r1")).rejects.toThrow("boom");
  });
});
