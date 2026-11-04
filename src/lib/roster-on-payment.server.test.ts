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
  // The Row block ends at the first 8-space closing brace (types.ts may or may not end it with ";").
  const body = types.slice(start).split(/\n {8}\};?\n/)[0]!;
  return [...body.matchAll(/^ {10}(\w+)\??:/gm)].map((m) => m[1]!);
}

type Rows = Record<string, any>;
const db: {
  rows: Rows;
  inserts: { table: string; row: any }[];
  insertError: any;
  /** The game's payee, as `game_payee_id` answers it; null means nobody. */
  payee: string | null;
  /** Every .eq() the code made, so a test can see which settings row it asked for. */
  eqs: { table: string; col: string; val: unknown }[];
} = {
  rows: {},
  inserts: [],
  insertError: null,
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
      db.inserts.push({ table, row });
      return { error: table === "game_participants" ? db.insertError : null };
    },
  };
  return chain;
}

const rpc = async (fn: string) => ({ data: fn === "game_payee_id" ? db.payee : null, error: null });

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc } }));

const { addPaidPlayerToRoster } = await import("./roster-on-payment.server");

const rostered = () => db.inserts.filter((i) => i.table === "game_participants");

beforeEach(() => {
  db.rows = { hosted_games: { id: "g1", cancelled_at: null } };
  db.inserts = [];
  db.insertError = null;
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

  it("does not roster an unapproved player on an approval-required game", async () => {
    db.rows.game_payment_settings = { requires_approval: true };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: false });
    expect(rostered()).toHaveLength(0);
  });

  it("rosters an approved player on an approval-required game", async () => {
    db.rows.game_payment_settings = { requires_approval: true };
    db.rows.join_requests = { id: "r1" };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: true });
  });

  it("treats a game with no settings row as request-to-join, like the game page", async () => {
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: false });
    db.rows.join_requests = { id: "r1" };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: true });
  });

  it("does nothing for a missing or cancelled game", async () => {
    db.rows.hosted_games = null;
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: false });
    db.rows.hosted_games = { id: "g1", cancelled_at: "2026-10-01T00:00:00Z" };
    db.rows.game_payment_settings = { requires_approval: false };
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: false });
    expect(rostered()).toHaveLength(0);
  });

  it("is quiet when the player is already on the roster", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    db.insertError = { code: "23505", message: "duplicate" };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: false });
    expect(db.inserts.some((i) => i.table === "notifications")).toBe(false);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("reports a refusal from the join gate (full, ended) instead of pretending", async () => {
    db.rows.game_payment_settings = { requires_approval: false };
    db.insertError = { code: "P0001", message: "GAME_FULL: the roster is full." };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: false });
    expect(error).toHaveBeenCalled();
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
    await expect(addPaidPlayerToRoster("g1", "p1")).resolves.toEqual({ added: false });
    const asked = db.eqs.find((e) => e.table === "game_payment_settings" && e.col === "host_id");
    expect(asked?.val).toBe("00000000-0000-0000-0000-000000000000");
  });
});
