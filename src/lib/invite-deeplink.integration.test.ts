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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_ACCOUNTS } from "./test-fixtures";
import { Route as GameRoute } from "@/routes/games.$gameId";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

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
      await hostClient
        .from("availability_contact_requests")
        .delete()
        .in("id", createdRequestIds);
    }
  });

  it("stores a link that opens the correct game and preserves invite query params", async () => {
    if (!canRun || !playerAvailabilityId) return;

    // Re-sign in the singleton client as host so createContactRequest sees the host session.
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signInWithPassword({ email: host.email, password: host.password });

    const gameId = `deeplink-${Date.now()}`;
    const before = new Date().toISOString();
    const { createContactRequest } = await import("./availability");
    await createContactRequest(playerAvailabilityId, playerId, "join us", {
      gameId,
      title: "Deeplink invite game",
      sport: "Basketball",
      location: "Test Park",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    // Recipient polls for the notification row (RLS scoped to auth.uid()).
    let found: { link: string | null } | null = null;
    for (let i = 0; i < 8; i++) {
      const { data } = await playerClient
        .from("notifications")
        .select("link, type, created_at")
        .eq("user_id", playerId)
        .eq("type", "game_invite")
        .gte("created_at", before)
        .order("created_at", { ascending: false })
        .limit(1);
      if (data && data.length) {
        found = { link: (data[0] as any).link as string | null };
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(found, "game_invite notification row should exist").toBeTruthy();
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
    const parsed = GameRoute.options.validateSearch!(search) as {
      invite?: true;
      from?: string;
    };
    expect(parsed.invite).toBe(true);
    expect(parsed.from).toBe(hostId);
  });
});
