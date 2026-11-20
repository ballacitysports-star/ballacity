import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP 2.0: the app sends invitations through the server functions only, with the fields they take, and turns every refusal
 * code into a sentence; a pending invitation to a game that already started is not offered.
 */
const server = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  result: null as unknown,
  error: null as { message: string } | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      server.calls.push({ fn, args });
      return { data: server.result, error: server.error };
    },
  },
}));

const lib = await import("./game-invites");

beforeEach(() => {
  server.calls = [];
  server.result = null;
  server.error = null;
});

describe("sending and answering", () => {
  it("invites one player through game_invite_player, trimming the note", async () => {
    server.result = "inv-1";
    await expect(
      lib.inviteToGame("g1", "u2", { availabilityId: "p9", message: "  see you  " }),
    ).resolves.toBe("inv-1");
    expect(server.calls).toEqual([
      {
        fn: "game_invite_player",
        args: { _game: "g1", _invitee: "u2", _availability: "p9", _message: "see you" },
      },
    ]);
  });

  it("sends no note when it is blank", async () => {
    await lib.inviteToGame("g1", "u2", { message: "   " });
    expect(server.calls[0].args._message).toBeNull();
  });

  it("invites several through game_invite_players", async () => {
    server.result = { invited: 2, skipped: { GAME_FULL: 1 } };
    await expect(lib.invitePlayersToGame("g1", ["a", "b", "c"])).resolves.toEqual({
      invited: 2,
      skipped: { GAME_FULL: 1 },
    });
    expect(server.calls[0]).toEqual({
      fn: "game_invite_players",
      args: { _game: "g1", _invitees: ["a", "b", "c"], _message: null },
    });
  });

  it("answers and withdraws through their functions", async () => {
    server.result = { status: "accepted", join_request_id: "jr" };
    await expect(lib.respondToGameInvite("inv", true)).resolves.toEqual({
      status: "accepted",
      join_request_id: "jr",
    });
    await lib.cancelGameInvite("inv");
    expect(server.calls.map((c) => [c.fn, c.args])).toEqual([
      ["game_respond_invite", { _invite: "inv", _accept: true }],
      ["game_cancel_invite", { _invite: "inv" }],
    ]);
  });

  it("surfaces a refusal as an error", async () => {
    server.error = { message: "GAME_FULL: this game has no free places." };
    await expect(lib.inviteToGame("g1", "u2")).rejects.toThrow("GAME_FULL");
  });
});

describe("gameInviteErrorMessage", () => {
  it.each([
    ["NOT_GAME_HOST: only the game's host can invite players to it.", "Only the game's host"],
    ["GAME_NOT_OPEN: this game is not taking players now.", "isn't taking players"],
    ["GAME_FULL: this game has no free places.", "This game is full."],
    ["INVITE_NOT_AVAILABLE: this player can't be invited to this game.", "can't be invited"],
    ["MINOR_MESSAGING_BLOCKED:messaging_off:self", "can't be invited"],
    ["INVITE_LIMIT: at most 30 players at once.", "up to 30 players"],
    ["INVITE_LIMIT: at most 100 invitations a day.", "100 invites a day"],
    ["AGE_VERIFICATION_REQUIRED: add your date of birth", "date of birth"],
    ["something else entirely", "Something went wrong"],
  ])("%s", (raw, expected) => {
    expect(lib.gameInviteErrorMessage(new Error(raw))).toContain(expected);
  });

  it("never shows the raw code", () => {
    expect(lib.gameInviteErrorMessage(new Error("INVITE_NOT_AVAILABLE: x"))).not.toMatch(
      /[A-Z]{4,}_/,
    );
  });
});

describe("pendingFor", () => {
  const NOW = new Date("2026-11-20T12:00:00Z");
  const row = (id: string, status: string, date: string | null) =>
    ({
      id,
      status,
      game: date
        ? {
            id: "g",
            title: "Run",
            sport: "basketball",
            date,
            location: null,
            timezone: null,
            host_id: "h",
          }
        : null,
    }) as unknown as Parameters<typeof lib.pendingFor>[0][number];

  it("keeps pending invitations to games still ahead", () => {
    const out = lib.pendingFor(
      [
        row("ahead", "pending", "2026-11-21T18:00:00Z"),
        row("started", "pending", "2026-11-20T11:00:00Z"),
        row("answered", "accepted", "2026-11-21T18:00:00Z"),
        row("nogame", "pending", null),
      ],
      NOW,
    );
    expect(out.map((r) => r.id)).toEqual(["ahead"]);
  });
});
