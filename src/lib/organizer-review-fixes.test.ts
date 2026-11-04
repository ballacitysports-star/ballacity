import { beforeEach, describe, expect, it, vi } from "vitest";

// SEC-5 final review (780eaf8f): the client never names a minor host where the database can do it,
// and reads payment settings through the masked view.
const h = vi.hoisted(() => ({
  calls: [] as { table: string; op: string; payload?: unknown; filters: Record<string, unknown> }[],
  readRow: null as unknown,
  insertError: null as unknown,
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const call = {
      table,
      op: "select",
      payload: undefined as unknown,
      filters: {} as Record<string, unknown>,
    };
    h.calls.push(call);
    const done = () => Promise.resolve({ data: h.readRow, error: null });
    const chain: any = {
      insert: (payload: unknown) => {
        call.op = "insert";
        call.payload = payload;
        return Promise.resolve({ error: h.insertError });
      },
      update: (payload: unknown) => {
        call.op = "update";
        call.payload = payload;
        return chain;
      },
      upsert: (payload: unknown) => {
        call.op = "upsert";
        call.payload = payload;
        return Promise.resolve({ error: null });
      },
      select: () => chain,
      eq: (k: string, v: unknown) => ((call.filters[k] = v), chain),
      order: () => chain,
      limit: () => chain,
      maybeSingle: done,
      then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
    };
    return chain;
  };
  return {
    supabase: {
      from,
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "me" } } }) },
    },
  };
});
vi.mock("@/lib/guardian-push.functions", () => ({ pingGuardians: () => undefined }));

beforeEach(() => {
  h.calls = [];
  h.readRow = null;
  h.insertError = null;
});

describe("game reports (F3)", () => {
  it("files a game report without naming the host; the database takes it from the game", async () => {
    const { submitReport } = await import("./moderation");
    await submitReport({ subjectType: "game", reason: "fake_game", gameId: "g1" });
    const insert = h.calls.find((c) => c.op === "insert")!;
    expect(insert.table).toBe("user_reports");
    expect(insert.payload).not.toHaveProperty("reported_id");
    expect(insert.payload).toMatchObject({ subject_type: "game", game_id: "g1" });
  });

  it("drops a host id the caller passes for a game report", async () => {
    const { submitReport } = await import("./moderation");
    await submitReport({
      subjectType: "game",
      reportedId: "someone",
      reason: "spam",
      gameId: "g1",
    });
    expect(h.calls.find((c) => c.op === "insert")!.payload).not.toHaveProperty("reported_id");
  });

  it("still names the person for a user report", async () => {
    const { submitReport } = await import("./moderation");
    await submitReport({ subjectType: "user", reportedId: "them", reason: "spam" });
    expect(h.calls.find((c) => c.op === "insert")!.payload).toMatchObject({ reported_id: "them" });
  });
});

describe("waitlist review (F1)", () => {
  it("does not send reviewed_by; the database records the reviewer", async () => {
    const { reviewWaitlistEntry } = await import("./waitlist-store");
    await reviewWaitlistEntry("w1", "approved");
    const update = h.calls.find((c) => c.op === "update")!;
    expect(update.table).toBe("game_position_waitlist");
    expect(update.payload).not.toHaveProperty("reviewed_by");
    expect(update.payload).toMatchObject({ status: "approved" });
  });
});

describe("payment settings (F4)", () => {
  it("reads settings through the masked view", async () => {
    const { getGamePaymentSettings, getMyGamePaymentSettings } = await import("./payments");
    await getGamePaymentSettings("g1");
    await getMyGamePaymentSettings("g1");
    expect(h.calls.map((c) => c.table)).toEqual([
      "game_payment_settings_visible",
      "game_payment_settings_visible",
    ]);
    expect(h.calls[1].filters).toEqual({ game_id: "g1", viewer_is_holder: true });
  });

  it("saves by id when I hold settings, and never upserts on host_id", async () => {
    const { upsertGamePaymentSettings } = await import("./payments");
    h.readRow = { id: "s1" };
    await upsertGamePaymentSettings({ game_id: "g1", entry_fee: 5, accepted_method_ids: [] });
    expect(h.calls.some((c) => c.op === "upsert")).toBe(false);
    const update = h.calls.find((c) => c.op === "update")!;
    expect(update.table).toBe("game_payment_settings");
    expect(update.filters).toEqual({ id: "s1" });
    expect(update.payload).not.toHaveProperty("host_id");
  });

  it("inserts my settings when I hold none yet", async () => {
    const { upsertGamePaymentSettings } = await import("./payments");
    await upsertGamePaymentSettings({ game_id: "g1", entry_fee: 0, accepted_method_ids: [] });
    const insert = h.calls.find((c) => c.op === "insert")!;
    expect(insert.table).toBe("game_payment_settings");
    expect(insert.payload).toMatchObject({ game_id: "g1", host_id: "me" });
  });
});
