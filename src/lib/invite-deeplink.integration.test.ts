/**
 * Tapping a `game_invite` notification deep-links to the correct hosted-game
 * details page with the `invite=1` and `from=<hostId>` search params preserved.
 *
 * The link is written by the server (notification-plan.server.ts) from the
 * game and the invite request; the app only names them. So:
 *   - the always-run test below takes the link the server writes and runs it
 *     through the actual route's `validateSearch`, so it fails if either side
 *     of the contract drifts;
 *   - the backend test checks that `createContactRequest` names the invite
 *     (game and player) for the server. It auto-skips when the seeded fixture
 *     accounts can't sign in.
 *
 * Run:
 *   bunx vitest run src/lib/invite-deeplink.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_ACCOUNTS } from "./test-fixtures";
import { Route as GameIndexRoute } from "@/routes/games.$gameId.index";
import { planNotification } from "./notification-plan.server";

// The notification row is written by a TanStack server function, which has no
// Start runtime under vitest. Capture the payload the writer produces so the
// link contract is still asserted end-to-end against the route parser.
const notif = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/notifications.functions", () => ({
  createNotificationForUser: async ({ data }: { data: Record<string, unknown> }) => {
    notif.calls.push(data);
  },
}));

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

const host = TEST_ACCOUNTS.find((a) => a.key === "host")!;
const player = TEST_ACCOUNTS.find((a) => a.key === "player")!;

function freshClient(): SupabaseClient {
  return createClient(URL!, KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

const skipIfNoBackend = !URL || !KEY;

describe.skipIf(skipIfNoBackend)("invite notification deep link", () => {
  let hostClient: SupabaseClient;
  let playerClient: SupabaseClient;
  let hostId: string;
  let playerId: string;
  let canRun = true;
  let playerAvailabilityId: string | null = null;
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    hostClient = freshClient();
    playerClient = freshClient();
    const [h, p] = await Promise.all([
      hostClient.auth.signInWithPassword({ email: host.email, password: host.password }),
      playerClient.auth.signInWithPassword({ email: player.email, password: player.password }),
    ]);
    if (h.error || p.error || !h.data.user || !p.data.user) {
      canRun = false;
      return;
    }
    hostId = h.data.user.id;
    playerId = p.data.user.id;
    const { data: av } = await playerClient
      .from("player_availabilities")
      .select("id")
      .eq("user_id", playerId)
      .eq("status", "open")
      .limit(1);
    if (av && av.length > 0) playerAvailabilityId = av[0].id as string;
  });

  afterAll(async () => {
    if (canRun && createdRequestIds.length) {
      await hostClient.from("availability_contact_requests").delete().in("id", createdRequestIds);
    }
  });

  it("names the invite for the server: the game and the player", async () => {
    if (!canRun || !playerAvailabilityId) return;

    // Re-sign in the singleton client as host so createContactRequest sees the host session.
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signInWithPassword({ email: host.email, password: host.password });

    const gameId = `deeplink-${Date.now()}`;
    notif.calls.length = 0;
    const { createContactRequest } = await import("./availability");
    await createContactRequest(playerAvailabilityId, playerId, "join us", {
      gameId,
      title: "Deeplink invite game",
      sport: "Basketball",
      location: "Test Park",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const found = notif.calls.find((c) => c.type === "game_invite" && c.user_id === playerId);
    expect(found, "game_invite notification should be requested").toEqual({
      type: "game_invite",
      game_id: gameId,
      user_id: playerId,
    });

    // Track for cleanup.
    const { data: rows } = await hostClient
      .from("availability_contact_requests")
      .select("id")
      .eq("game_id", gameId);
    if (rows) for (const r of rows) createdRequestIds.push(r.id as string);
  });
});

describe("the invite link the server writes", () => {
  const HOST = "00000000-0000-4000-8000-0000000000a1";
  const PLAYER = "00000000-0000-4000-8000-0000000000b2";
  const GAME = "host-abc123-def456";
  const tables: Record<string, Record<string, unknown>[]> = {
    hosted_games: [
      {
        id: GAME,
        host_id: HOST,
        title: "Deeplink invite game",
        date: new Date(Date.now() + 86_400_000).toISOString(),
        sport: "Basketball",
        location: "Test Park",
        cancelled_at: null,
        completed_at: null,
      },
    ],
    availability_contact_requests: [
      { from_user_id: HOST, to_user_id: PLAYER, kind: "invite", game_id: GAME, status: "pending" },
    ],
  };
  const admin = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (k: string, v: unknown) => ((rows = rows.filter((r) => r[k] === v)), q),
        limit: (n: number) => ((rows = rows.slice(0, n)), q),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => res({ data: rows, error: null }),
      };
      return q;
    },
  };

  it("opens the right game, and the game route parses the invite back out", async () => {
    const p = await planNotification(admin, HOST, {
      type: "game_invite",
      game_id: GAME,
      user_id: PLAYER,
    });
    if (!p.ok) throw new Error("refused");
    const link = p.rows[0].link;

    const [pathname, query = ""] = link.split("?");
    expect(pathname).toBe(`/games/${GAME}`);
    const params = new URLSearchParams(query);
    expect(params.get("invite")).toBe("1");
    expect(params.get("from")).toBe(HOST);

    // The actual route's validateSearch parses them back into typed state, so the
    // Game detail page will render the "You're invited" banner.
    const validate = GameIndexRoute.options.validateSearch as unknown as (
      s: Record<string, unknown>,
    ) => { invite?: true; from?: string };
    const parsed = validate(Object.fromEntries(params.entries()));
    expect(parsed.invite).toBe(true);
    expect(parsed.from).toBe(HOST);
  });
});
