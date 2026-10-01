import { expect, test } from "@playwright/test";
import { HAS_BACKEND, signInAs } from "./helpers/fixture-auth";

/**
 * Guardian approval + blocking waivers for team/game joins
 * (supabase/migrations/20261001160000_team_waivers.sql,
 * 20261001170000_guardian_approval_columns.sql,
 * 20261001180000_guardian_accept_path_guards.sql).
 *
 * The actual blocking logic (a self-operating minor can't accept a team
 * invite pre-approval, an unsigned published waiver blocks accept for
 * anyone, both gates clear correctly once acted on) is exhaustively verified
 * by local Postgres replay — docs/guardian-team-approvals-verification.md,
 * 31 checks across three scripts, not here.
 *
 * This spec only covers what a real backend can show without creating a new
 * team: every other e2e spec in this repo that needs a team reuses one
 * already seeded for a fixture account, and none exists for this feature —
 * creating one here would leave it behind permanently, since team deletion
 * has no UI anywhere in this app. Rather than orphan a team in the shared
 * project, this just confirms the Parent Center's approvals surface renders
 * correctly with nothing pending, which is still a real assertion about the
 * new FamilyApprovalsPanel wiring (team_join/game_join/waiver sources are
 * additive — they must not appear, or break the panel, when empty).
 */

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

test.describe("guardian team/game approvals, end to end", () => {
  test("the Parent Center renders cleanly with no pending team/game approvals", async ({
    page,
  }) => {
    await signInAs(page, "host");
    await page.goto("/parent", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /parent center/i })).toBeVisible({
      timeout: 15_000,
    });
    // Nothing from this feature should render for an account with no team
    // invites, join requests, or team waivers outstanding.
    await expect(page.getByText(/needs a signed waiver/i)).toHaveCount(0);
    await expect(page.getByText(/wants to join/i)).toHaveCount(0);
  });
});
