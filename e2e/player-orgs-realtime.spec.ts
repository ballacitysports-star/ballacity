import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * E2E: verifies the Organizations section on the public player profile
 * updates in real time when rows in public.trainer_org_members change.
 *
 * Setup: seeds a coach team + trainer_org owned by the fixture user,
 * navigates to the player profile, asserts the org chip is absent,
 * inserts a trainer_org_members row, and asserts the chip appears
 * without a manual reload. Then deletes the row and asserts the chip
 * disappears. Cleans up all seeded rows afterwards.
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

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k!, v!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
  await page.waitForLoadState("networkidle").catch(() => {});
}

test("player profile Organizations section updates in real time", async ({ page }) => {
  const sb = userClient();
  const uid = userId();
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // Seed a coach (trainer) profile owned by the fixture user — required by
  // trainer_org_members.trainer_id FK.
  const trainerId = `c-e2e-${suffix}`.slice(0, 40);
  const { error: teamErr } = await sb
    .from("teams")
    .insert({
      id: trainerId,
      owner_id: uid,
      kind: "coach",
      name: `E2E Coach ${suffix}`,
      handle: `e2e-coach-${suffix}`.slice(0, 32),
    } as any);
  if (teamErr) throw new Error(`Failed to seed coach: ${teamErr.message}`);

  // Seed an organization owned by the fixture user.
  const orgId = crypto.randomUUID();
  const orgName = `E2E Org ${suffix}`;
  const { error: orgErr } = await sb.from("trainer_orgs").insert({
    id: orgId,
    owner_id: uid,
    name: orgName,
    handle: `e2e-org-${suffix}`.slice(0, 32),
  } as any);
  if (orgErr) throw new Error(`Failed to seed org: ${orgErr.message}`);

  try {
    await restoreSession(page);
    await page.goto(`/players/${uid}`, { waitUntil: "domcontentloaded" });

    // The Organizations section renders nothing when the user has no orgs,
    // so the seeded org name must not be visible initially.
    await expect(page.getByText(orgName)).toHaveCount(0);

    // Insert the membership row — the realtime subscription on
    // trainer_org_members should push an update to the open page.
    const { error: memberErr } = await sb.from("trainer_org_members").insert({
      org_id: orgId,
      trainer_id: trainerId,
      user_id: uid,
      role: "member",
    } as any);
    if (memberErr) throw new Error(`Failed to insert membership: ${memberErr.message}`);

    // The chip should appear without a manual reload.
    await expect(page.getByText(orgName)).toBeVisible({ timeout: 20_000 });

    // Delete the membership — the chip should disappear live.
    const { error: delErr } = await sb
      .from("trainer_org_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", uid);
    if (delErr) throw new Error(`Failed to delete membership: ${delErr.message}`);

    await expect(page.getByText(orgName)).toHaveCount(0, { timeout: 20_000 });
  } finally {
    await sb.from("trainer_org_members").delete().eq("org_id", orgId);
    await sb.from("trainer_orgs").delete().eq("id", orgId);
    await sb.from("teams").delete().eq("id", trainerId);
  }
});
