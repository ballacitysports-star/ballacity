import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { gamePaymentChannelName, subscribeGamePaymentChanges } from "./game-payment-channel";

type Handler = (payload: { new?: unknown; old?: unknown }) => void;

/** A stand-in for the Supabase client that records channels and lets a test fire changes. */
function fakeClient() {
  const open = new Map<string, { handler: Handler; filter: string }>();
  const created: string[] = [];
  const removed: string[] = [];
  const client = {
    channel(name: string) {
      created.push(name);
      const ch = {
        name,
        on(_type: string, opts: { filter: string }, handler: Handler) {
          open.set(name, { handler, filter: opts.filter });
          return ch;
        },
        subscribe() {
          return ch;
        },
      };
      return ch as never;
    },
    removeChannel(ch: unknown) {
      const { name } = ch as { name: string };
      removed.push(name);
      open.delete(name);
    },
  };
  const fire = (gameId: string, row: unknown, kind: "new" | "old" = "new") =>
    open.get(gamePaymentChannelName(gameId))?.handler({ [kind]: row });
  return { client, created, removed, open, fire };
}

describe("one payment channel per game (P2-6)", () => {
  it("roster rows on the same game share one channel, filtered by game", () => {
    const f = fakeClient();
    const offs = ["p1", "p2", "p3"].map((p) =>
      subscribeGamePaymentChanges("g1", p, () => {}, f.client),
    );
    expect(f.created).toEqual(["payment_submissions:roster:g1"]);
    expect(f.open.get("payment_submissions:roster:g1")?.filter).toBe("game_id=eq.g1");
    offs.forEach((off) => off());
  });

  it("tells only the row whose player changed", () => {
    const f = fakeClient();
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeGamePaymentChanges("g1", "p1", a, f.client);
    const offB = subscribeGamePaymentChanges("g1", "p2", b, f.client);
    f.fire("g1", { game_id: "g1", player_id: "p2" });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    f.fire("g1", { game_id: "other", player_id: "p1" });
    expect(a).not.toHaveBeenCalled();
    offA();
    offB();
  });

  it("a change it cannot route (no player id) makes every row re-check", () => {
    const f = fakeClient();
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeGamePaymentChanges("g1", "p1", a, f.client);
    const offB = subscribeGamePaymentChanges("g1", "p2", b, f.client);
    f.fire("g1", { id: "x" }, "old");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it("closes the channel with its last row, and only then", () => {
    const f = fakeClient();
    const off1 = subscribeGamePaymentChanges("g1", "p1", () => {}, f.client);
    const off2 = subscribeGamePaymentChanges("g1", "p2", () => {}, f.client);
    off1();
    off1(); // calling twice is harmless
    expect(f.removed).toEqual([]);
    off2();
    expect(f.removed).toEqual(["payment_submissions:roster:g1"]);
    // A later row opens a fresh channel.
    const off3 = subscribeGamePaymentChanges("g1", "p1", () => {}, f.client);
    expect(f.created).toEqual(["payment_submissions:roster:g1", "payment_submissions:roster:g1"]);
    off3();
  });

  it("different games get different channels", () => {
    const f = fakeClient();
    const a = vi.fn();
    const offA = subscribeGamePaymentChanges("g1", "p1", a, f.client);
    const offB = subscribeGamePaymentChanges("g2", "p1", () => {}, f.client);
    expect(f.created).toEqual(["payment_submissions:roster:g1", "payment_submissions:roster:g2"]);
    f.fire("g2", { game_id: "g2", player_id: "p1" });
    expect(a).not.toHaveBeenCalled();
    offA();
    offB();
  });

  it("the game page no longer opens a channel per roster row", () => {
    const src = readFileSync("src/routes/games.$gameId.index.tsx", "utf8");
    expect(src).not.toContain("payment_submissions:${req.game_id}:${req.player_id}");
    expect(src).toContain("subscribeGamePaymentChanges(req.game_id, req.player_id");
  });
});
