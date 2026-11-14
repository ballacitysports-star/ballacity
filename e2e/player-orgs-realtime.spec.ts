import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { account } from "./helpers/fixture-auth";

/**
 * E2E: verifies the Organizations section on the public player profile
 * updates in real time when rows in public.trainer_org_members change.
 *
 * The profile has to be someone else's, seen by someone allowed to see their
 * memberships:
 *   - opening your own /players/<id> redirects to /profile, which has no
 *     Organizations section (the spec used to do that, so it never saw a chip);
 *   - row-level security shows a membership only to the member and to people
 *     in the same organization (owner/admin/member).
 * So the signed-in fixture player (the browser session) owns an organization
 * and watches the profile of the second fixture player, who joins it the way a
 * trainer does (owner invites their coach profile, they accept) and then
 * leaves. The second player's profile_visibility is 'private' (what the account
 * was created with; e2e/global-setup.ts puts it back to that every run), which
 * hides the profile from the viewer, so it is set to 'members' for the
 * duration. Everything seeded is removed and the previous visibility restored
 * afterwards; if the run is killed first, the next run's global-setup resets it.
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

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

/** The browser's account (fixture "player"), acting through its session token. */
function viewerClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
  });
}

function viewerId(): string {
  const s = JSON.parse(SESSION_JSON!);
  return s?.user?.id as string;
}

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k!, v!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
  await page.waitForLoadState("networkidle").catch(() => {});
}

test("player profile Organizations section updates in real time", async ({ page }) => {
  const owner = viewerClient();
  const ownerId = viewerId();

  // The member: the second fixture player, signed in with its password.
  const member = anonClient();
  const p2 = account("player2");
  const { data: signIn, error: signInErr } = await member.auth.signInWithPassword({
    email: p2.email,
    password: p2.password,
  });
  if (signInErr || !signIn.user)
    throw new Error(`Failed to sign in ${p2.email}: ${signInErr?.message}`);
  const memberId = signIn.user.id;

  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const trainerId = `c-e2e-${suffix}`.slice(0, 40);
  const orgId = crypto.randomUUID();
  const orgName = `E2E Org ${suffix}`;

  // The member's profile must be visible to the viewer; remember its setting.
  const { data: prefs } = await member
    .from("privacy_preferences")
    .select("profile_visibility")
    .eq("user_id", memberId)
    .maybeSingle();
  const previousVisibility = (prefs as { profile_visibility?: string } | null)?.profile_visibility;

  try {
    const { error: visErr } = await member
      .from("privacy_preferences")
      .upsert({ user_id: memberId, profile_visibility: "members" }, { onConflict: "user_id" });
    if (visErr) throw new Error(`Failed to show the member's profile: ${visErr.message}`);

    // The member's coach (trainer) profile — trainer_org_members.trainer_id
    // must be a coach profile the member owns.
    const { error: teamErr } = await member.from("teams").insert({
      id: trainerId,
      owner_id: memberId,
      kind: "coach",
      name: `E2E Coach ${suffix}`,
      handle: `e2e-coach-${suffix}`.slice(0, 32),
    });
    if (teamErr) throw new Error(`Failed to seed coach: ${teamErr.message}`);

    // The organization, owned by the viewer.
    const { error: orgErr } = await owner.from("trainer_orgs").insert({
      id: orgId,
      owner_id: ownerId,
      name: orgName,
      handle: `e2e-org-${suffix}`.slice(0, 32),
    });
    if (orgErr) throw new Error(`Failed to seed org: ${orgErr.message}`);

    // The owner invites the member's coach profile.
    const { data: invite, error: inviteErr } = await owner
      .from("trainer_org_invites")
      .insert({
        org_id: orgId,
        invited_trainer_id: trainerId,
        invited_user_id: memberId,
        invited_by: ownerId,
        role: "member",
      })
      .select("id")
      .single();
    if (inviteErr || !invite) throw new Error(`Failed to invite: ${inviteErr?.message}`);

    await restoreSession(page);
    await page.goto(`/players/${memberId}`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`/players/${memberId}`));
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(p2.displayName, {
      timeout: 15_000,
    });

    // The Organizations section renders nothing while the member has no orgs.
    await expect(page.getByText(orgName)).toHaveCount(0);

    // The member accepts — that writes the trainer_org_members row, and the
    // realtime subscription should push it to the open page.
    const { error: acceptErr } = await member.rpc("accept_trainer_org_invite", {
      _invite: (invite as { id: string }).id,
    });
    if (acceptErr) throw new Error(`Failed to accept the invite: ${acceptErr.message}`);

    // The chip should appear without a manual reload.
    await expect(page.getByText(orgName)).toBeVisible({ timeout: 20_000 });

    // The member leaves — the chip should disappear live.
    const { error: delErr } = await member
      .from("trainer_org_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", memberId);
    if (delErr) throw new Error(`Failed to delete membership: ${delErr.message}`);

    await expect(page.getByText(orgName)).toHaveCount(0, { timeout: 20_000 });
  } finally {
    await member.from("trainer_org_members").delete().eq("org_id", orgId).eq("user_id", memberId);
    await owner.from("trainer_org_invites").delete().eq("org_id", orgId);
    await owner.from("trainer_orgs").delete().eq("id", orgId);
    await member.from("teams").delete().eq("id", trainerId);
    // Every account has a row (handle_new_user writes one, and global-setup
    // sets player2's to 'private'), so a missing value means the read failed:
    // fall back to the fixture's baseline rather than open the profile up.
    const restoreTo = previousVisibility ?? "private";
    if (restoreTo !== "members") {
      await member
        .from("privacy_preferences")
        .update({ profile_visibility: restoreTo })
        .eq("user_id", memberId);
    }
  }
});
