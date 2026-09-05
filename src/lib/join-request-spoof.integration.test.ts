/**
 * Integration tests: server-side validation for join_requests and
 * player_availabilities. Verifies the database triggers + RLS reject
 * spoofed skill levels, travel radius, host_id, and status transitions
 * regardless of what the client sends.
 *
 * Runs against the live Supabase backend using the seeded fixture
 * accounts (see src/lib/test-fixtures.ts + seedTestAccounts). Auto-skips
 * when the fixture accounts cannot be signed in (e.g. CI without seed).
 *
 * Run with:
 *   bunx vitest run src/lib/join-request-spoof.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TEST_ACCOUNTS } from "./test-fixtures";

const URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

const player = TEST_ACCOUNTS.find((a) => a.key === "player")!;
const player2 = TEST_ACCOUNTS.find((a) => a.key === "player2")!;

function freshClient(): SupabaseClient {
  return createClient(URL!, KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

const skipIfNoBackend = !URL || !KEY;

describe.skipIf(skipIfNoBackend)("join_requests spoofing rejections", () => {
  let playerClient: SupabaseClient;
  let player2Client: SupabaseClient;
  let playerId: string;
  let player2Id: string;
  let realGameId: string | null = null;
  let realHostId: string | null = null;
  let canRun = true;

  beforeAll(async () => {
    playerClient = freshClient();
    player2Client = freshClient();

    const a = await playerClient.auth.signInWithPassword({
      email: player.email,
      password: player.password,
    });
    const b = await player2Client.auth.signInWithPassword({
      email: player2.email,
      password: player2.password,
    });
    if (a.error || b.error || !a.data.user || !b.data.user) {
      canRun = false;
      return;
    }
    playerId = a.data.user.id;
    player2Id = b.data.user.id;

    // Find a real game_payment_settings row to test host_id spoofing against.
    // It's public-readable for any participant; if RLS hides it, we just skip
    // the one test that needs it.
    const { data: gps } = await playerClient
      .from("game_payment_settings")
      .select("game_id, host_id")
      .neq("host_id", playerId)
      .limit(1);
    if (gps && gps.length > 0) {
      realGameId = gps[0].game_id as string;
      realHostId = gps[0].host_id as string;
    }
  });

  afterAll(async () => {
    // Cleanup any rows the tests inserted.
    if (playerClient && playerId) {
      await playerClient.from("join_requests").delete().eq("player_id", playerId);
    }
  });

  it("rejects join request with player_id != auth.uid() (RLS)", async () => {
    if (!canRun) return;
    const { error } = await playerClient.from("join_requests").insert({
      game_id: `spoof-${Date.now()}`,
      player_id: player2Id, // spoof: insert on behalf of another user
      host_id: playerId,
      status: "pending",
    });
    expect(error).not.toBeNull();
  });

  it("rejects self-join (player_id = host_id)", async () => {
    if (!canRun) return;
    const { error } = await playerClient.from("join_requests").insert({
      game_id: `self-${Date.now()}`,
      player_id: playerId,
      host_id: playerId,
    });
    expect(error?.message ?? "").toMatch(/own game/i);
  });

  it("rejects host_id that doesn't match the configured game host", async () => {
    if (!canRun || !realGameId || !realHostId) return;
    const { error } = await playerClient.from("join_requests").insert({
      game_id: realGameId,
      player_id: playerId,
      host_id: playerId, // spoof: claim self as host
    });
    expect(error?.message ?? "").toMatch(/host_id/i);
  });

  it("forces status='pending' on insert (status spoofing neutralized)", async () => {
    if (!canRun) return;
    const gameId = `status-${Date.now()}`;
    const { data, error } = await playerClient
      .from("join_requests")
      .insert({
        game_id: gameId,
        player_id: playerId,
        host_id: player2Id,
        status: "approved", // spoof attempt
      })
      .select("status")
      .single();
    if (error) {
      // Allowed: trigger or RLS could reject outright. Either way, no row
      // is created with a spoofed status.
      expect(error).not.toBeNull();
      return;
    }
    expect(data?.status).toBe("pending");
  });

  it("rejects invalid status transition on update", async () => {
    if (!canRun) return;
    const gameId = `txn-${Date.now()}`;
    const { data: ins, error: insErr } = await playerClient
      .from("join_requests")
      .insert({ game_id: gameId, player_id: playerId, host_id: player2Id })
      .select("id")
      .single();
    if (insErr || !ins) return;
    // Player can't UPDATE (RLS limits UPDATE to host) — verify that as well.
    const { error: updErr } = await playerClient
      .from("join_requests")
      .update({ status: "approved" })
      .eq("id", ins.id);
    // Either RLS blocks (no error, 0 rows) or trigger blocks. Re-read.
    const { data: after } = await playerClient
      .from("join_requests")
      .select("status")
      .eq("id", ins.id)
      .single();
    expect(after?.status).toBe("pending");
    // updErr may be null because RLS UPDATE silently matches 0 rows.
    void updErr;
  });
});

describe.skipIf(skipIfNoBackend)("player_availabilities spoofing rejections", () => {
  let client: SupabaseClient;
  let userId: string;
  let canRun = true;
  const createdIds: string[] = [];

  beforeAll(async () => {
    client = freshClient();
    const { data, error } = await client.auth.signInWithPassword({
      email: player.email,
      password: player.password,
    });
    if (error || !data.user) {
      canRun = false;
      return;
    }
    userId = data.user.id;
  });

  afterAll(async () => {
    if (canRun && createdIds.length) {
      await client.from("player_availabilities").delete().in("id", createdIds);
    }
  });

  it("rejects an empty skill_level", async () => {
    if (!canRun) return;
    // Per-sport tier names are owned by the app, so the database validates
    // shape only: a blank or oversized value must still be refused.
    const { error } = await client.from("player_availabilities").insert({
      user_id: userId,
      sports: ["Basketball"],
      skill_level: "   ",
      travel_radius_km: 25,
      status: "open",
    });
    expect(error?.message ?? "").toMatch(/skill_level/i);
  });

  it("rejects travel_radius_km outside the allowed range", async () => {
    if (!canRun) return;
    const { error } = await client.from("player_availabilities").insert({
      user_id: userId,
      sports: ["Basketball"],
      skill_level: "Intermediate",
      travel_radius_km: 99999, // spoof: beyond the 20200 km cap
      status: "open",
    });
    expect(error?.message ?? "").toMatch(/travel_radius_km/i);
  });


  it("rejects unknown sport", async () => {
    if (!canRun) return;
    const { error } = await client.from("player_availabilities").insert({
      user_id: userId,
      sports: ["Quidditch"],
      skill_level: "Intermediate",
      travel_radius_km: 25,
      status: "open",
    });
    expect(error?.message ?? "").toMatch(/sport/i);
  });

  it("rejects user_id mutation on update", async () => {
    if (!canRun) return;
    const { data: ins, error: insErr } = await client
      .from("player_availabilities")
      .insert({
        user_id: userId,
        sports: ["Basketball"],
        skill_level: "Intermediate",
        travel_radius_km: 25,
        status: "open",
        note: "[spoof-test]",
      })
      .select("id")
      .single();
    if (insErr || !ins) return;
    createdIds.push(ins.id as string);
    const { error } = await client
      .from("player_availabilities")
      .update({ user_id: "00000000-0000-0000-0000-000000000000" })
      .eq("id", ins.id);
    expect(error?.message ?? "").toMatch(/user_id/i);
  });
});
