import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * E2E: verify the team-profile composer can publish a post end-to-end
 * against Lovable Cloud using an authenticated fixture session.
 *
 * Setup: seeds a temporary team owned by the fixture player, opens the
 * team profile, uses the "+ Post" composer, and asserts the created row
 * lands in `public.team_posts` and renders in the feed. Cleans up the
 * post + team afterwards.
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
}

test("team-post composer publishes a post end-to-end", async ({ page }) => {
  const sb = userClient();
  const uid = userId();
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const handle = `e2e-team-${suffix}`.slice(0, 32);

  // Seed a team owned by the fixture user (RLS: owner_id = auth.uid()).
  const teamId = crypto.randomUUID();
  const { error: teamErr } = await sb
    .from("teams")
    .insert({
      id: teamId,
      owner_id: uid,
      kind: "team",
      name: `E2E Team ${suffix}`,
      handle,
    } as any);
  if (teamErr) throw new Error(`Failed to seed team: ${teamErr.message}`);

  try {
    await restoreSession(page);
    await page.goto(`/teams/${teamId}`, { waitUntil: "domcontentloaded" });

    // Ensure Posts tab is selected (default).
    await expect(page.getByRole("button", { name: /^\+\s*Post$/ })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: /^\+\s*Post$/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("New post")).toBeVisible();

    const title = `E2E post ${suffix}`;
    const body = `Automated composer check ${suffix}`;
    await dialog.locator('input[placeholder="What\'s the headline?"]').fill(title);
    await dialog.locator("textarea").fill(body);

    await dialog.getByRole("button", { name: /Publish post/i }).click();

    // Toast confirms server-side success.
    await expect(page.getByText("Post published")).toBeVisible({ timeout: 15_000 });

    // Composer closes and the new post renders in the feed.
    await expect(dialog).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });

    // DB confirms the row exists with the right author + team.
    const { data: rows, error: readErr } = await sb
      .from("team_posts" as any)
      .select("id, title, author_id, team_id")
      .eq("team_id", teamId)
      .eq("title", title);
    if (readErr) throw new Error(readErr.message);
    expect(rows?.length).toBe(1);
    expect((rows![0] as any).author_id).toBe(uid);
  } finally {
    // Cleanup: RLS allows author/owner to delete posts and owner to delete team.
    await sb.from("team_posts" as any).delete().eq("team_id", teamId);
    await sb.from("teams").delete().eq("id", teamId);
  }
});
