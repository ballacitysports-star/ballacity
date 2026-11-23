import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP 5.4: once a player accepts an invitation, they get the game page's default reminder lead times for that game, the
 * same ones the RSVP picker starts from, unless they already chose some for it (an empty choice, "no reminders", counts).
 * Best-effort: a failed save never throws into the accept.
 */
const db = vi.hoisted(() => ({
  rows: new Map<string, { offsets: number[]; last_sent_offset: number | null }>(),
  upserts: [] as { row: Record<string, unknown>; opts: Record<string, unknown> | undefined }[],
  uid: "me" as string | null,
  upsertError: null as { message: string } | null,
  upsertThrows: false,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: db.uid ? { user: { id: db.uid } } : null },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table !== "game_reminders") throw new Error(`unexpected table ${table}`);
      return {
        upsert: async (
          row: { game_id: string; user_id: string; offsets: number[] },
          opts?: { onConflict?: string; ignoreDuplicates?: boolean },
        ) => {
          if (db.upsertThrows) throw new Error("network down");
          db.upserts.push({ row, opts });
          if (db.upsertError) return { error: db.upsertError };
          const key = `${row.game_id}:${row.user_id}`;
          if (db.rows.has(key) && opts?.ignoreDuplicates) return { error: null };
          db.rows.set(key, { offsets: row.offsets, last_sent_offset: null });
          return { error: null };
        },
      };
    },
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));

const { saveDefaultRemindersOnAccept } = await import("./game-invites");
const { DEFAULT_GAME_REMINDER_OFFSETS } = await import("./game-reminders");

beforeEach(() => {
  db.rows.clear();
  db.upserts = [];
  db.uid = "me";
  db.upsertError = null;
  db.upsertThrows = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("saveDefaultRemindersOnAccept", () => {
  it("gives a game with no choice yet the game page's default lead times", async () => {
    await saveDefaultRemindersOnAccept("g1");
    expect(db.rows.get("g1:me")?.offsets).toEqual([1440, 120]);
    expect(db.rows.get("g1:me")?.offsets).toEqual([...DEFAULT_GAME_REMINDER_OFFSETS]);
  });

  it("keeps lead times the player already chose for that game", async () => {
    db.rows.set("g1:me", { offsets: [60], last_sent_offset: 1440 });
    await saveDefaultRemindersOnAccept("g1");
    expect(db.rows.get("g1:me")).toEqual({ offsets: [60], last_sent_offset: 1440 });
    // Insert-only at the database, so a choice saved at the same moment is not replaced either.
    expect(db.upserts[0]?.opts).toMatchObject({
      onConflict: "game_id,user_id",
      ignoreDuplicates: true,
    });
  });

  it("keeps a choice of no reminders", async () => {
    db.rows.set("g1:me", { offsets: [], last_sent_offset: null });
    await saveDefaultRemindersOnAccept("g1");
    expect(db.rows.get("g1:me")?.offsets).toEqual([]);
  });

  it("does not throw when the save is refused or fails", async () => {
    db.upsertError = { message: "denied" };
    await expect(saveDefaultRemindersOnAccept("g1")).resolves.toBeUndefined();
    db.upsertError = null;
    db.upsertThrows = true;
    await expect(saveDefaultRemindersOnAccept("g1")).resolves.toBeUndefined();
  });

  it("saves nothing without a signed-in player", async () => {
    db.uid = null;
    await saveDefaultRemindersOnAccept("g1");
    expect(db.upserts).toEqual([]);
  });

  it("an explicit save still replaces the player's choice", async () => {
    const { saveMyGameReminderOffsets } = await import("./game-reminders");
    db.rows.set("g1:me", { offsets: [60], last_sent_offset: null });
    await saveMyGameReminderOffsets("g1", [30]);
    expect(db.rows.get("g1:me")?.offsets).toEqual([30]);
  });
});
