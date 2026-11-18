/* eslint-disable @typescript-eslint/no-explicit-any -- hand-rolled Supabase stub */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The columns each table really has, read from the generated types. The stub
 * below refuses a select that names anything else, the way PostgREST does. A
 * select of `requires_approval` on hosted_games (it lives on
 * game_payment_settings) used to fail quietly, and nobody was ever rostered by
 * the server after paying.
 */
function columnsOf(table: string): string[] {
  const types = readFileSync(new URL("../integrations/supabase/types.ts", import.meta.url), "utf8");
  const start = types.indexOf(`      ${table}: {\n        Row: {`);
  if (start < 0) throw new Error(`no ${table} in types.ts`);
  const body = types.slice(start).split("\n        }\n")[0]!;
  return [...body.matchAll(/^ {10}(\w+)\??:/gm)].map((m) => m[1]!);
}

type Rows = Record<string, any>;
const db: {
  rows: Rows;
  inserts: { table: string; row: any }[];
  insertError: any;
  /** Writing a notification throws (the notifications table is unreachable). */
  notificationsDown: boolean;
  /** The game's payee, as `game_payee_id` answers it; null means nobody. */
  payee: string | null;
  /** Every .eq() the code made, so a test can see which settings row it asked for. */
  eqs: { table: string; col: string; val: unknown }[];
} = {
  rows: {},
  inserts: [],
  insertError: null,
  notificationsDown: false,
  payee: "host-1",
  eqs: [],
};

function from(table: string) {
  const query: { cols: string[] } = { cols: [] };
  const chain: any = {
    select(cols: string) {
      query.cols = cols.split(",").map((c) => c.trim());
      const known = columnsOf(table);
      const unknown = query.cols.filter((c) => !known.includes(c));
      if (unknown.length) {
        chain.error = { code: "42703", message: `column ${table}.${unknown[0]} does not exist` };
      }
      return chain;
    },
    eq: (col: string, val: unknown) => {
      db.eqs.push({ table, col, val });
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () =>
      chain.error
        ? { data: null, error: chain.error }
        : { data: db.rows[table] ?? null, error: null },
    insert: async (row: any) => {
      if (table === "notifications" && db.notificationsDown) throw new Error("notifications down");
      db.inserts.push({ table, row });
      return { error: table === "game_participants" ? db.insertError : null };
    },
  };
  return chain;
}

const rpc = async (fn: string) => ({ data: fn === "game_payee_id" ? db.payee : null, error: null });

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc } }));

const { addPaidPlayerToRoster, holdsPlace, notPlacedWhy, placedAfterVerify } =
  await import("./roster-on-payment.server");

const rostered = () => db.inserts.filter((i) => i.table === "game_participants");
/** The "payment_not_placed" notices written, flattened (one insert carries both). */
const notPlaced = () =>
  db.inserts
    .filter((i) => i.table === "notifications")
    .flatMap((i) => (Array.isArray(i.row) ? i.row : [i.row]))
    .filter((n) => n.type === "payment_not_placed");

beforeEach(() => {
  db.rows = {
    hosted_games: { id: "g1", host_id: "host-1", title: "Sunday Run", cancelled_at: null },
    profiles: { display_name: "Pat" },
  };
  db.inserts = [];
  db.insertError = null;
  db.notificationsDown = false;
  db.payee = "host-1";
  db.eqs = [];
});

describe("addPaidPlayerToRoster", () => {
  it("only selects columns that exist on the tables it reads", () => {
    expect(columnsOf("hosted_games")).toContain("cancelled_at");
    expect(columnsOf("hosted_games")).not.toContain("requires_approval");
    expect(columnsOf("game_payment_settings")).toContain("requires_approval");
  });

  it("puts a paid player on the roster of an instant-join game and tells them", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: true });
    expect(rostered()).toEqual([
      { table: "game_participants", row: { game_id: "g1", user_id: "p1" } },
    ]);
    expect(db.inserts.some((i) => i.table === "notifications")).toBe(true);
  });

  it("keeps the position the player picked", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    await addPaidPlayerToRoster("g1", "p1", "  Guard ");
    expect(rostered()[0]!.row).toEqual({ game_id: "g1", user_id: "p1", position: "Guard" });
  });

  it("does not roster an unapproved player on an approval-required game, and says so to both", async () => {
    db.rows.game_payment_settings = { requires_approval: true };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({
      added: false,
      reason: "approval_required",
      noticeSent: true,
    });
    expect(rostered()).toHaveLength(0);
    const [host, player] = notPlaced();
    expect(host).toMatchObject({ user_id: "host-1", link: "/games/g1" });
    expect(host.body).toMatch(/Pat's payment for Sunday Run is confirmed/);
    expect(host.body).toMatch(/haven't approved their request/);
    expect(player).toMatchObject({ user_id: "p1", link: "/games/g1" });
    expect(player.body).toMatch(/the host still has to approve your request/);
  });

  it("rosters an approved player on an approval-required game", async () => {
    db.rows.game_payment_settings = { requires_approval: true };
    db.rows.join_requests = { id: "r1" };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: true });
  });

  it("treats a game with no settings row as request-to-join, like the game page", async () => {
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toMatchObject({
      added: false,
      reason: "approval_required",
    });
    db.rows.join_requests = { id: "r1" };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: true });
  });

  it("does nothing for a missing game", async () => {
    db.rows.hosted_games = null;
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({
      added: false,
      reason: "game_missing",
    });
    expect(rostered()).toHaveLength(0);
    expect(db.inserts).toHaveLength(0);
  });

  it("does not roster anyone on a cancelled game, and tells the host and the player", async () => {
    db.rows.hosted_games = {
      id: "g1",
      host_id: "host-1",
      title: "Sunday Run",
      cancelled_at: "2026-10-01T00:00:00Z",
    };
    db.rows.game_payment_settings = { requires_approval: false };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({
      added: false,
      reason: "cancelled",
      noticeSent: true,
    });
    expect(rostered()).toHaveLength(0);
    const notices = notPlaced();
    expect(notices.map((n) => n.user_id)).toEqual(["host-1", "p1"]);
    expect(notices[0].body).toMatch(/the game was cancelled\. .*send their money back/);
    expect(notices[1].title).toBe("Payment confirmed, but you're not on the roster yet");
    expect(notices[1].body).toMatch(/Ask them for your place or your money back/);
  });

  it("is quiet when the player is already on the roster", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    db.insertError = { code: "23505", message: "duplicate" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await addPaidPlayerToRoster("g1", "p1");
    expect(result).toEqual({ added: false, reason: "already_on_roster" });
    expect(holdsPlace(result)).toBe(true);
    expect(db.inserts.some((i) => i.table === "notifications")).toBe(false);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("keeps a player already on the roster of an approval-required game without an approved request", async () => {
    // The host added them, or they joined before approval was switched on: no request, but the place is theirs.
    db.rows.game_payment_settings = { requires_approval: true };
    db.rows.game_participants = { user_id: "p1" };
    const result = await addPaidPlayerToRoster("g1", "p1");
    expect(result).toEqual({ added: false, reason: "already_on_roster" });
    expect(holdsPlace(result)).toBe(true);
    expect(rostered()).toHaveLength(0);
    expect(notPlaced()).toHaveLength(0);
    expect(db.eqs).toEqual(
      expect.arrayContaining([
        { table: "game_participants", col: "game_id", val: "g1" },
        { table: "game_participants", col: "user_id", val: "p1" },
      ]),
    );
  });

  it("keeps a player already on the roster of a game with no settings row", async () => {
    db.rows.game_participants = { user_id: "p1" };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({
      added: false,
      reason: "already_on_roster",
    });
    expect(notPlaced()).toHaveLength(0);
  });

  it("reports a refusal from the join gate (full, ended) instead of pretending", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    db.insertError = { code: "P0001", message: "GAME_FULL: the roster is full." };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await addPaidPlayerToRoster("g1", "p1");
    expect(result).toEqual({
      added: false,
      reason: "refused",
      code: "GAME_FULL",
      noticeSent: true,
    });
    expect(holdsPlace(result)).toBe(false);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
    // Not silent: the host and the player are both told, with the reason.
    const [host, player] = notPlaced();
    expect(host).toMatchObject({ user_id: "host-1", title: "Paid, not on the roster · Pat" });
    expect(host.body).toMatch(/couldn't be added to the roster: the roster is full\./);
    expect(player).toMatchObject({ user_id: "p1" });
    expect(player.body).toMatch(/Your payment for Sunday Run is confirmed.*the roster is full/);
    // And the "you're on the roster" notice is not sent.
    expect(
      db.inserts.some((i) => i.table === "notifications" && i.row?.type === "join_approved"),
    ).toBe(false);
  });

  it("names only the game's own state to the host, never a rule about the player", () => {
    expect(notPlacedWhy("GAME_FULL")).toBe("the roster is full");
    expect(notPlacedWhy("GAME_COMPLETED")).toBe("the game has ended");
    expect(notPlacedWhy("GAME_JOINS_CLOSED")).toBe("joining is closed");
    expect(notPlacedWhy("GAME_SIGNUP_CLOSED")).toBe("joining is closed");
    for (const code of [
      "AGE_REQUIREMENT_NOT_MET",
      "CHILD_GAME_PARTICIPATION_BLOCKED",
      "BLOCKED_BY_HOST",
      "AGE_VERIFICATION_REQUIRED",
      undefined,
    ]) {
      expect(notPlacedWhy(code)).toBe("the game's joining rules don't allow it");
    }
  });

  it("falls back to 'A player' when the player has no profile name", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    db.rows.profiles = null;
    db.insertError = { code: "P0001", message: "GAME_COMPLETED: this game has already ended." };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({
      added: false,
      reason: "refused",
      code: "GAME_COMPLETED",
      noticeSent: true,
    });
    expect(notPlaced()[0].title).toBe("Paid, not on the roster · A player");
    expect(notPlaced()[0].body).toMatch(/the game has ended/);
    error.mockRestore();
  });

  it("a notice that cannot be written never fails the caller", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    db.insertError = { code: "P0001", message: "GAME_FULL: the roster is full." };
    db.notificationsDown = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // noticeSent false: the caller must not tell the host a notice went out.
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({
      added: false,
      reason: "refused",
      code: "GAME_FULL",
      noticeSent: false,
    });
    expect(error).toHaveBeenCalledWith("[roster] not-placed notice failed", expect.any(Error));
    error.mockRestore();
  });

  it("only believes the settings row held by the game's payee, never just the newest one", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    await addPaidPlayerToRoster("g1", "p1");
    expect(
      db.eqs.filter((e) => e.table === "game_payment_settings" && e.col === "host_id"),
    ).toEqual([{ table: "game_payment_settings", col: "host_id", val: "host-1" }]);
  });

  it("with no payee it asks for no real settings row, so the game is request-to-join", async () => {
    db.payee = null;
    db.rows.game_payment_settings = null;
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toMatchObject({ added: false });
    const asked = db.eqs.find((e) => e.table === "game_payment_settings" && e.col === "host_id");
    expect(asked?.val).toBe("00000000-0000-0000-0000-000000000000");
  });
});

describe("placedAfterVerify (what the host's verify call reports)", () => {
  it("is true when the player holds the place", () => {
    expect(placedAfterVerify({ added: true })).toBe(true);
    expect(placedAfterVerify({ added: false, reason: "already_on_roster" })).toBe(true);
  });

  it("is false only when both sides were sent the notice", () => {
    expect(
      placedAfterVerify({ added: false, reason: "refused", code: "GAME_FULL", noticeSent: true }),
    ).toBe(false);
    expect(placedAfterVerify({ added: false, reason: "approval_required", noticeSent: true })).toBe(
      false,
    );
  });

  it("is null when no notice went out, so the caller sends the usual verified notice", () => {
    expect(placedAfterVerify({ added: false, reason: "game_missing" })).toBeNull();
    expect(
      placedAfterVerify({ added: false, reason: "refused", code: "GAME_FULL", noticeSent: false }),
    ).toBeNull();
  });

  it("follows addPaidPlayerToRoster end to end", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    db.insertError = { code: "P0001", message: "GAME_FULL: the roster is full." };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(placedAfterVerify(await addPaidPlayerToRoster("g1", "p1"))).toBe(false);
    db.notificationsDown = true;
    expect(placedAfterVerify(await addPaidPlayerToRoster("g1", "p1"))).toBeNull();
    db.rows.hosted_games = null;
    expect(placedAfterVerify(await addPaidPlayerToRoster("g1", "p1"))).toBeNull();
    error.mockRestore();
  });
});
