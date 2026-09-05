/**
 * Integration test: tapping a `game_invite` notification deep-links to the
 * correct hosted-game details page with the `invite=1` and `from=<hostId>`
 * search params preserved.
 *
 * We assert on the persisted `notifications.link` value (what the in-app
 * Alerts list and the browser notification handler navigate to) and run it
 * through the actual route's `validateSearch` so the test fails if either
 * side of the contract drifts:
 *   - `createContactRequest` (the writer) must encode `?invite=1&from=...`
 *   - `/games/$gameId` route (the reader) must parse those params back out
 *
 * Auto-skips when the seeded fixture accounts can't sign in.
 *
 * Run:
 *   bunx vitest run src/lib/invite-deeplink.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_ACCOUNTS } from "./test-fixtures";
import { Route as GameIndexRoute } from "@/routes/games.$gameId.index";

// The notification row is written by a TanStack server function, which has no
// Start runtime under vitest. Capture the payload the writer produces so the
// link contract is still asserted end-to-end against the route parser.
const notif = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/notifications.functions", () => ({
  createNotificationForUser: async ({ data }: { data: Record<string, unknown> }) => {
    notif.calls.push(data);
  },
}));
vi.mock("@/lib/push.functions", () => ({ sendPushToUser: async () => {} }));


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

  it("stores a link that opens the correct game and preserves invite query params", async () => {
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

    const found = notif.calls.find(
      (c) => c.type === "game_invite" && c.user_id === playerId,
    ) as { link: string | null } | undefined;
    expect(found, "game_invite notification should be written").toBeTruthy();
    expect(found!.link, "notification.link must be set").toBeTruthy();


    // Track for cleanup.
    const { data: rows } = await hostClient
      .from("availability_contact_requests")
      .select("id")
      .eq("game_id", gameId);
    if (rows) for (const r of rows) createdRequestIds.push(r.id as string);

    const link = found!.link!;

    // 1. Path points to the correct hosted game.
    const [pathname, query = ""] = link.split("?");
    expect(pathname).toBe(`/games/${gameId}`);

    // 2. Both invite query params are present and non-empty.
    const params = new URLSearchParams(query);
    expect(params.get("invite")).toBe("1");
    expect(params.get("from")).toBe(hostId);

    // 3. The actual route's validateSearch parses them back into typed state,
    //    so the Game detail page will render the "You're invited" banner.
    const search = Object.fromEntries(params.entries()) as Record<string, unknown>;
    const validate = GameIndexRoute.options.validateSearch as unknown as (
      s: Record<string, unknown>,
    ) => { invite?: true; from?: string };
    const parsed = validate(search);
    expect(parsed.invite).toBe(true);
    expect(parsed.from).toBe(hostId);
  });
});
