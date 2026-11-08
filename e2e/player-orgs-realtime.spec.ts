import { test, expect } from "@playwright/test";
import { realtimeJoined } from "./helpers/realtime";
import { account, signInAs } from "./helpers/fixture-auth";
import { createClient } from "@supabase/supabase-js";

/**
 * E2E: verifies the Organizations section on the public player profile
 * updates in real time when rows in public.trainer_org_members change.
 *
 * Setup: the host fixture owns a trainer org and invites the player
 * fixture's coach profile; the host views the player's profile while the
 * player accepts (chip appears without a reload) and then leaves (chip
 * disappears). Cleans up all seeded rows afterwards.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const ACCESS_TOKEN = process.env.LOVABLE_BROWSER_SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY || !ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY,
  "Requires signed-in fixture session and Supabase env vars.",
);

function userClient() {
  return createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
  });
}

function userId(): string {
  const s = JSON.parse(SESSION_JSON!);
  return s?.user?.id as string;
}

/** A client signed in as the host fixture, for the org-owner side of the flow. */
async function hostClient() {
  const c = createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const host = account("host");
  const { data, error } = await c.auth.signInWithPassword({
    email: host.email,
    password: host.password,
  });
  if (error || !data.user) throw new Error(`host sign-in failed: ${error?.message ?? "no user"}`);
  return { c, hostId: data.user.id };
}

test("player profile Organizations section updates in real time", async ({ page }) => {
  // Who can see a membership: trainer_org_members rows are readable only by the
  // member and by the org's staff (RLS "Org-scoped members can view trainer org
  // members"). Opening your own /players/<id> redirects to /profile, which has
  // no Organizations section. So the section is seen by org staff looking at a
  // member, and that is the flow tested here: the host owns the org, invites
  // the player's coach profile, and watches the player's page while the player
  // accepts and later leaves. A player cannot add themselves to someone else's
  // org (20261027160000_trainer_org_no_forged_affiliation), hence the invite.
  const sb = userClient();
  const uid = userId();
  const { c: host, hostId } = await hostClient();
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // The player's coach (trainer) profile — trainer_org_members.trainer_id.
  const trainerId = `c-e2e-${suffix}`.slice(0, 40);
  const { error: teamErr } = await sb.from("teams").insert({
    id: trainerId,
    owner_id: uid,
    kind: "coach",
    name: `E2E Coach ${suffix}`,
    handle: `e2e-coach-${suffix}`.slice(0, 32),
  } as never);
  if (teamErr) throw new Error(`Failed to seed coach: ${teamErr.message}`);

  // The organization, owned by the host.
  const orgId = crypto.randomUUID();
  const orgName = `E2E Org ${suffix}`;
  const { error: orgErr } = await host.from("trainer_orgs").insert({
    id: orgId,
    owner_id: hostId,
    name: orgName,
    handle: `e2e-org-${suffix}`.slice(0, 32),
  } as never);
  if (orgErr) throw new Error(`Failed to seed org: ${orgErr.message}`);

  try {
    // The host invites the player's coach profile.
    const { data: invite, error: invErr } = await host
      .from("trainer_org_invites")
      .insert({
        org_id: orgId,
        invited_by: hostId,
        invited_user_id: uid,
        invited_trainer_id: trainerId,
        role: "member",
      } as never)
      .select("id")
      .single();
    if (invErr || !invite) throw new Error(`Failed to invite: ${invErr?.message ?? "no row"}`);

    // The host watches the player's profile.
    await signInAs(page, "host");
    await page.goto(`/players/${uid}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`/players/${uid}`));
    await expect(page.getByText(orgName)).toHaveCount(0);
    // The section does not re-read when it subscribes, so accept only once the
    // page is listening (see helpers/realtime.ts).
    await realtimeJoined(page, `player-orgs:${uid}`);

    // The player accepts — the realtime subscription on trainer_org_members
    // should push the new membership to the open page.
    const { error: acceptErr } = await sb.rpc(
      "accept_trainer_org_invite" as never,
      {
        _invite: (invite as { id: string }).id,
      } as never,
    );
    if (acceptErr) throw new Error(`Failed to accept invite: ${acceptErr.message}`);

    await expect(page.getByText(orgName)).toBeVisible({ timeout: 20_000 });

    // The player leaves — the chip should disappear live.
    const { error: delErr } = await sb
      .from("trainer_org_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", uid);
    if (delErr) throw new Error(`Failed to leave the org: ${delErr.message}`);

    await expect(page.getByText(orgName)).toHaveCount(0, { timeout: 20_000 });
  } finally {
    await sb.from("trainer_org_members").delete().eq("org_id", orgId);
    await host.from("trainer_org_members").delete().eq("org_id", orgId);
    await host.from("trainer_org_invites").delete().eq("org_id", orgId);
    await host.from("trainer_orgs").delete().eq("id", orgId);
    await sb.from("teams").delete().eq("id", trainerId);
    await host.auth.signOut({ scope: "local" });
  }
});
