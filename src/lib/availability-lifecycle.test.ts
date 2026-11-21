import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pause, resume and reconfirm send only what the database lets an author change (migration 20261114110000): the
 * status between open and paused, and last_confirmed_at, which the server re-stamps.
 */

const server = {
  updates: [] as { patch: Record<string, unknown>; id: unknown }[],
  error: null as { message: string } | null,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          server.updates.push({ patch, id });
          return { error: server.error };
        },
      }),
    }),
  },
}));

const { reconfirmAvailability, setAvailabilityPaused } = await import("./availability");

beforeEach(() => {
  server.updates = [];
  server.error = null;
});

describe("availability lifecycle", () => {
  it("pauses and resumes by status only", async () => {
    await setAvailabilityPaused("p1", true);
    await setAvailabilityPaused("p1", false);
    expect(server.updates).toEqual([
      { patch: { status: "paused" }, id: "p1" },
      { patch: { status: "open" }, id: "p1" },
    ]);
  });

  it("reconfirms an open post without touching its status", async () => {
    await reconfirmAvailability("p1", "open");
    expect(Object.keys(server.updates[0].patch)).toEqual(["last_confirmed_at"]);
  });

  it("reopens an expired post when reconfirming it", async () => {
    await reconfirmAvailability("p1", "expired");
    expect(server.updates[0].patch.status).toBe("open");
  });

  it("surfaces a refusal", async () => {
    server.error = {
      message: "AVAILABILITY_FIELD_FORBIDDEN: this post's visibility is managed by BallaCity.",
    };
    await expect(setAvailabilityPaused("p1", false)).rejects.toEqual(server.error);
  });
});
