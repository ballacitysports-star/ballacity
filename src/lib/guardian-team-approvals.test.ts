import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source-pinning for the guardian team/game approval migrations. Behavioural
 * claims (RLS actually lets a guardian see their child's pending item,
 * a stranger can't, the blocking gates in team_respond_invite and
 * enforce_child_game_participation actually hold) are verified by local
 * Postgres replay — docs/guardian-team-approvals-verification.md, not here.
 */

const columns = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001170000_guardian_approval_columns.sql"),
  "utf8",
);

describe("20261001170000: approval columns, read policies, guardian RPCs", () => {
  it("adds nullable guardian_approved_at/by to both team_invites and join_requests", () => {
    expect(columns).toMatch(
      /ALTER TABLE public\.team_invites\s*\n\s*ADD COLUMN IF NOT EXISTS guardian_approved_at timestamptz,\s*\n\s*ADD COLUMN IF NOT EXISTS guardian_approved_by uuid/,
    );
    expect(columns).toMatch(
      /ALTER TABLE public\.join_requests\s*\n\s*ADD COLUMN IF NOT EXISTS guardian_approved_at timestamptz,\s*\n\s*ADD COLUMN IF NOT EXISTS guardian_approved_by uuid/,
    );
  });

  it("gives guardians read access to their children's pending items, by is_guardian_of", () => {
    expect(columns).toMatch(
      /CREATE POLICY "Guardians view their children's pending team invites"\s*\nON public\.team_invites FOR SELECT TO authenticated\s*\nUSING \(public\.is_guardian_of\(auth\.uid\(\), invitee_id\)\)/,
    );
    expect(columns).toMatch(
      /CREATE POLICY "Guardians view their children's join requests"\s*\nON public\.join_requests FOR SELECT TO authenticated\s*\nUSING \(public\.is_guardian_of\(auth\.uid\(\), player_id\)\)/,
    );
  });

  it("guardian_approve_team_invite requires a real guardian link and a pending invite", () => {
    const fn = columns.slice(columns.indexOf("FUNCTION public.guardian_approve_team_invite"));
    expect(fn).toMatch(/NOT public\.is_guardian_of\(_me, _row\.invitee_id\)/);
    expect(fn).toMatch(/RAISE EXCEPTION 'NOT_GUARDIAN'/);
    expect(fn).toMatch(/_row\.status <> 'pending' THEN RAISE EXCEPTION 'INVITE_NOT_PENDING'/);
  });

  it("guardian_approve_team_invite sets the approval columns on approve, declines on reject, never changes status to approve", () => {
    const fn = columns.slice(columns.indexOf("FUNCTION public.guardian_approve_team_invite"));
    const approveBranch = fn.slice(fn.indexOf("IF _approve THEN"), fn.indexOf("ELSE"));
    expect(approveBranch).toMatch(/SET guardian_approved_at = now\(\), guardian_approved_by = _me/);
    expect(approveBranch).not.toMatch(/SET status/);
    const declineBranch = fn.slice(fn.indexOf("ELSE"), fn.indexOf("END IF;\nEND;\n$$"));
    expect(declineBranch).toMatch(/SET status = 'declined'/);
  });

  it("guardian_approve_join_request mirrors the same guardian/pending checks for join_requests", () => {
    const fn = columns.slice(columns.indexOf("FUNCTION public.guardian_approve_join_request"));
    expect(fn).toMatch(/NOT public\.is_guardian_of\(_me, _row\.player_id\)/);
    expect(fn).toMatch(/RAISE EXCEPTION 'NOT_GUARDIAN'/);
    expect(fn).toMatch(/_row\.status <> 'pending' THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'/);
  });

  it("guardian_approve_join_request declines into the existing 'rejected' status, not a new value", () => {
    const fn = columns.slice(columns.indexOf("FUNCTION public.guardian_approve_join_request"));
    expect(fn).toMatch(/SET status = 'rejected'/);
  });

  it("both RPCs are owner-scoped: no anon/public execute, authenticated only", () => {
    expect(columns).toMatch(
      /REVOKE ALL ON FUNCTION public\.guardian_approve_team_invite\(uuid, boolean\) FROM PUBLIC, anon/,
    );
    expect(columns).toMatch(
      /REVOKE ALL ON FUNCTION public\.guardian_approve_join_request\(uuid, boolean\) FROM PUBLIC, anon/,
    );
    expect(columns).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.guardian_approve_team_invite\(uuid, boolean\) TO authenticated/,
    );
    expect(columns).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.guardian_approve_join_request\(uuid, boolean\) TO authenticated/,
    );
  });
});
