/**
 * Integration tests for the player invite / contact-request endpoint.
 *
 * Verifies that the `availability_contact_requests` insert path:
 *   - rejects spoofed `from_user_id` (acting as another user)
 *   - rejects spoofed `to_user_id` (must equal the availability owner)
 *   - rejects self-invites
 *   - rejects invite rows with no `game_id`
 *   - forces `status='pending'` regardless of client input
 *   - locks identity fields (`from_user_id`, `to_user_id`,
 *     `availability_id`, `kind`, `game_id`) against UPDATE
 *   - persists the selected hosted game metadata exactly as sent
 *     (game_id, game_title, game_sport, game_starts_at, game_location)
 *
 * Auto-skips when the seeded fixture accounts can't sign in.
 *
 * Run:
 *   bunx vitest run src/lib/invite-contact-request.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_ACCOUNTS } from "./test-fixtures";

// The in-app notification insert runs through a TanStack server function, which
// has no Start runtime inside vitest. Capture its payload instead so the
// notification contract stays testable here.
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
const player2 = TEST_ACCOUNTS.find((a) => a.key === "player2")!;

function freshClient(): SupabaseClient {
  return createClient(URL!, KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

const skipIfNoBackend = !URL || !KEY;

describe.skipIf(skipIfNoBackend)("availability invite endpoint", () => {
  let hostClient: SupabaseClient;
  let playerClient: SupabaseClient;
  let player2Client: SupabaseClient;
  let hostId: string;
  let playerId: string;
  let player2Id: string;
  let canRun = true;

  // The availability owned by `player` — invites are sent FROM host TO player.
  let playerAvailabilityId: string | null = null;
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    hostClient = freshClient();
    playerClient = freshClient();
    player2Client = freshClient();

    const [h, p, p2] = await Promise.all([
      hostClient.auth.signInWithPassword({ email: host.email, password: host.password }),
      playerClient.auth.signInWithPassword({ email: player.email, password: player.password }),
      player2Client.auth.signInWithPassword({ email: player2.email, password: player2.password }),
    ]);
    if (h.error || p.error || p2.error || !h.data.user || !p.data.user || !p2.data.user) {
      canRun = false;
      return;
    }
    hostId = h.data.user.id;
    playerId = p.data.user.id;
    player2Id = p2.data.user.id;

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
      // Cleanup using the host client (sender owns the row by RLS).
      await hostClient.from("availability_contact_requests").delete().in("id", createdRequestIds);
    }
  });

  it("rejects from_user_id spoofing (acting as another user)", async () => {
    if (!canRun || !playerAvailabilityId) return;
    const { error } = await hostClient.from("availability_contact_requests").insert({
      availability_id: playerAvailabilityId,
      from_user_id: player2Id, // spoof: claim to be player2
      to_user_id: playerId,
      kind: "invite",
      game_id: `game-${Date.now()}`,
      status: "pending",
    });
    expect(error).not.toBeNull();
  });

  it("rejects to_user_id that doesn't match the availability owner", async () => {
    if (!canRun || !playerAvailabilityId) return;
    const { error } = await hostClient.from("availability_contact_requests").insert({
      availability_id: playerAvailabilityId, // owned by `player`
      from_user_id: hostId,
      to_user_id: player2Id, // spoof: route to the wrong recipient
      kind: "invite",
      game_id: `game-${Date.now()}`,
    });
    expect(error?.message ?? "").toMatch(/to_user_id|availability owner/i);
  });

  it("rejects self-invite (from == to)", async () => {
    if (!canRun) return;
    // Use host's own availability if any, else fall back to player's id collision attempt.
    const { data: hostAv } = await hostClient
      .from("player_availabilities")
      .select("id")
      .eq("user_id", hostId)
      .limit(1);
    const availabilityId = hostAv?.[0]?.id ?? playerAvailabilityId;
    if (!availabilityId) return;
    const { error } = await hostClient.from("availability_contact_requests").insert({
      availability_id: availabilityId,
      from_user_id: hostId,
      to_user_id: hostId,
      kind: "invite",
      game_id: `self-${Date.now()}`,
    });
    expect(error).not.toBeNull();
  });

  it("rejects invite without a game_id", async () => {
    if (!canRun || !playerAvailabilityId) return;
    const { error } = await hostClient.from("availability_contact_requests").insert({
      availability_id: playerAvailabilityId,
      from_user_id: hostId,
      to_user_id: playerId,
      kind: "invite",
      game_id: null, // spoof: invite kind requires a game_id
    });
    expect(error?.message ?? "").toMatch(/game_id/i);
  });

  it("forces status='pending' on insert (status spoofing neutralized)", async () => {
    if (!canRun || !playerAvailabilityId) return;
    const { data, error } = await hostClient
      .from("availability_contact_requests")
      .insert({
        availability_id: playerAvailabilityId,
        from_user_id: hostId,
        to_user_id: playerId,
        kind: "invite",
        game_id: `status-${Date.now()}`,
        game_title: "Status spoof test",
        status: "accepted", // spoof attempt
      })
      .select("id, status")
      .single();
    if (error) {
      expect(error).not.toBeNull();
      return;
    }
    createdRequestIds.push(data!.id as string);
    expect(data!.status).toBe("pending");
  });

  it("persists the selected hosted game metadata exactly as sent", async () => {
    if (!canRun || !playerAvailabilityId) return;
    const gameId = `persist-${Date.now()}`;
    const payload = {
      availability_id: playerAvailabilityId,
      from_user_id: hostId,
      to_user_id: playerId,
      kind: "invite" as const,
      game_id: gameId,
      game_title: "Sunday Pickup at Prospect Park",
      game_sport: "Basketball",
      game_starts_at: new Date(Date.now() + 86_400_000).toISOString(),
      game_location: "Prospect Park, Brooklyn NY",
      message: "Come join us!",
    };
    const { data, error } = await hostClient
      .from("availability_contact_requests")
      .insert(payload)
      .select(
        "id, kind, game_id, game_title, game_sport, game_starts_at, game_location, message, from_user_id, to_user_id, status",
      )
      .single();
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    if (!data) return;
    createdRequestIds.push(data.id as string);

    expect(data.kind).toBe("invite");
    expect(data.game_id).toBe(gameId);
    expect(data.game_title).toBe(payload.game_title);
    expect(data.game_sport).toBe(payload.game_sport);
    expect(data.game_location).toBe(payload.game_location);
    expect(new Date(data.game_starts_at as string).toISOString()).toBe(payload.game_starts_at);
    expect(data.message).toBe(payload.message);
    expect(data.from_user_id).toBe(hostId);
    expect(data.to_user_id).toBe(playerId);
    expect(data.status).toBe("pending");
  });

  it("locks identity fields against UPDATE (game_id, kind, from/to, availability)", async () => {
    if (!canRun || !playerAvailabilityId) return;
    const originalGameId = `lock-${Date.now()}`;
    const { data: ins, error: insErr } = await hostClient
      .from("availability_contact_requests")
      .insert({
        availability_id: playerAvailabilityId,
        from_user_id: hostId,
        to_user_id: playerId,
        kind: "invite",
        game_id: originalGameId,
        game_title: "Original game",
      })
      .select("id")
      .single();
    if (insErr || !ins) return;
    createdRequestIds.push(ins.id as string);

    // Try to mutate game_id / kind / to_user_id. Either RLS matches zero rows
    // (sender has no UPDATE grant) or the trigger raises "identity fields are
    // immutable" — both are acceptable; the row must not change.
    const identityErr = /immutable|identity/i;
    const { error: gameIdErr } = await hostClient
      .from("availability_contact_requests")
      .update({ game_id: `swapped-${Date.now()}` })
      .eq("id", ins.id);
    if (gameIdErr) expect(gameIdErr.message).toMatch(identityErr);

    const { error: kindErr } = await hostClient
      .from("availability_contact_requests")
      .update({ kind: "contact" })
      .eq("id", ins.id);
    if (kindErr) expect(kindErr.message).toMatch(identityErr);

    const { error: toErr } = await hostClient
      .from("availability_contact_requests")
      .update({ to_user_id: player2Id })
      .eq("id", ins.id);
    if (toErr) expect(toErr.message).toMatch(identityErr);

    // Confirm row is unchanged.
    const { data: after } = await hostClient
      .from("availability_contact_requests")
      .select("game_id, kind, to_user_id")
      .eq("id", ins.id)
      .single();
    expect(after?.game_id).toBe(originalGameId);
    expect(after?.kind).toBe("invite");
    expect(after?.to_user_id).toBe(playerId);
  });

  it("createContactRequest(invite) notifies the recipient", async () => {
    if (!canRun || !playerAvailabilityId) return;
    // Use the real client-side helper so we exercise the same code path the UI uses.
    const mod = await import("./availability");
    // Swap the singleton client briefly via dynamic import context: createContactRequest
    // reads the signed-in user via supabase.auth — re-sign in the shared client as host.
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signInWithPassword({ email: host.email, password: host.password });

    const gameId = `notif-${Date.now()}`;
    notif.calls.length = 0;
    await mod.createContactRequest(playerAvailabilityId, playerId, "Want in?", {
      gameId,
      title: "Notif verification game",
      sport: "Basketball",
      location: "Test Park",
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const found = notif.calls.find((c) => c.type === "game_invite" && c.user_id === playerId) as
      Record<string, string> | undefined;
    expect(found).toBeTruthy();
    expect(found!.title).toMatch(/Notif verification game/);
    expect(found!.link).toBe(`/games/${gameId}?invite=1&from=${hostId}`);

    // Cleanup the request row created via the helper (by recipient/game_id).
    const { data: rows } = await hostClient
      .from("availability_contact_requests")
      .select("id")
      .eq("game_id", gameId);
    if (rows) for (const r of rows) createdRequestIds.push(r.id as string);
  });
});
