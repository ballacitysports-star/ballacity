import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source-pinning for the combined accept-path guard migration. Behavioural
 * claims (a self-operating minor is actually blocked pre-approval and
 * unblocked after, a team's unsigned waiver actually blocks accept for both
 * a minor and an adult, decline stays ungated, a non-approval-queue game's
 * direct join is unaffected) are verified by local Postgres replay —
 * docs/guardian-team-approvals-verification.md, not here.
 */

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001180000_guardian_accept_path_guards.sql"),
  "utf8",
);

describe("20261001180000: team_respond_invite's new guard clauses", () => {
  const fn = migration.slice(
    migration.indexOf("FUNCTION public.team_respond_invite"),
    migration.indexOf("FUNCTION public.enforce_child_game_participation"),
  );

  it("still runs every pre-existing check, unchanged, before the new ones", () => {
    expect(fn).toMatch(/RAISE EXCEPTION 'AUTH_REQUIRED'/);
    expect(fn).toMatch(/RAISE EXCEPTION 'INVITE_NOT_FOUND'/);
    expect(fn).toMatch(/RAISE EXCEPTION 'NOT_INVITEE'/);
    expect(fn).toMatch(/RAISE EXCEPTION 'INVITE_NOT_PENDING'/);
    expect(fn).toMatch(/RAISE EXCEPTION 'INVITE_EXPIRED'/);
    expect(fn).toMatch(/RAISE EXCEPTION 'CHILD_ACTIVITY_LOCKED'/);
  });

  it("gates accept (never decline) on guardian approval for any minor with an active guardian link", () => {
    const guardianClause = fn.slice(
      fn.indexOf("NEW: guardian approval"),
      fn.indexOf("NEW: waiver signature"),
    );
    expect(guardianClause).toMatch(/IF _accept\s*\n\s*AND public\.is_minor\(_me\)/);
    expect(guardianClause).toMatch(
      /EXISTS \(SELECT 1 FROM public\.guardian_links WHERE child_user_id = _me AND status = 'active'\)/,
    );
    expect(guardianClause).toMatch(/_row\.guardian_approved_at IS NULL/);
    expect(guardianClause).toMatch(/RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED/);
  });

  it("gates accept on an unsigned current published waiver, for anyone, not just minors", () => {
    const waiverClause = fn.slice(fn.indexOf("NEW: waiver signature"));
    expect(waiverClause).toMatch(/IF _accept AND EXISTS \(/);
    expect(waiverClause).toMatch(
      /FROM public\.team_waivers w\s*\n\s*WHERE w\.team_id = _row\.team_id AND w\.published/,
    );
    expect(waiverClause).toMatch(/s\.signer_user_id = _me/);
    expect(waiverClause).toMatch(/RAISE EXCEPTION 'WAIVER_REQUIRED/);
  });

  it("the guard clauses sit after child_features_locked and before team_members is ever touched", () => {
    const lockedIdx = fn.indexOf("CHILD_ACTIVITY_LOCKED");
    const guardianIdx = fn.indexOf("GUARDIAN_APPROVAL_REQUIRED");
    const waiverIdx = fn.indexOf("WAIVER_REQUIRED");
    const membersIdx = fn.indexOf("INSERT INTO public.team_members");
    expect(guardianIdx).toBeGreaterThan(lockedIdx);
    expect(waiverIdx).toBeGreaterThan(guardianIdx);
    expect(membersIdx).toBeGreaterThan(waiverIdx);
  });
});

describe("20261001180000: enforce_child_game_participation's new clause", () => {
  const fn = migration.slice(migration.indexOf("FUNCTION public.enforce_child_game_participation"));

  it("preserves both pre-existing checks unchanged", () => {
    expect(fn).toMatch(/RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED/);
    expect(fn).toMatch(/RAISE EXCEPTION 'CHILD_GAME_PARTICIPATION_BLOCKED/);
  });

  it("only gates the game_participants table, never join_requests itself", () => {
    const clause = fn.slice(fn.indexOf("NEW: per-request guardian approval"));
    expect(clause).toMatch(/TG_TABLE_NAME = 'game_participants'/);
    expect(clause).not.toMatch(/TG_TABLE_NAME = 'join_requests'/);
  });

  it("only fires for a game that actually has a join_requests row to hold an approval against", () => {
    const clause = fn.slice(fn.indexOf("NEW: per-request guardian approval"));
    expect(clause).toMatch(
      /EXISTS \(SELECT 1 FROM public\.join_requests jr WHERE jr\.game_id = NEW\.game_id AND jr\.player_id = subject\)/,
    );
  });

  it("requires guardian_approved_at specifically, and raises the expected error", () => {
    const clause = fn.slice(fn.indexOf("NEW: per-request guardian approval"));
    expect(clause).toMatch(/jr\.guardian_approved_at IS NOT NULL/);
    expect(clause).toMatch(/RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED/);
  });
});
