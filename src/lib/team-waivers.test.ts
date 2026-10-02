import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source-pinning for the team-waivers migration. Behavioural claims (RLS
 * actually enforced, immutability guard, idempotent signing, attestation
 * required for a guardian signing on a minor's behalf, signed_by recording
 * the guardian never the child) are verified by local Postgres replay —
 * docs/guardian-team-approvals-verification.md, not here.
 */

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001160000_team_waivers.sql"),
  "utf8",
);

describe("20261001160000: team_waivers table", () => {
  it("caps one published waiver per team with a partial unique index", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX team_waivers_one_published_per_team\s*\n\s*ON public\.team_waivers \(team_id\) WHERE published/,
    );
  });

  it("drafts can only be inserted unpublished, by a team manager, as their own creator", () => {
    const policy = migration.slice(migration.indexOf('"team_waivers_manager_insert"'));
    expect(policy).toMatch(/is_team_manager\(team_id, auth\.uid\(\)\)/);
    expect(policy).toMatch(/AND published = false/);
    expect(policy).toMatch(/AND created_by = auth\.uid\(\)/);
  });

  it("rejects editing content, version or title once published", () => {
    const fn = migration.slice(migration.indexOf("FUNCTION public.team_waivers_guard"));
    expect(fn).toMatch(/IF OLD\.published_at IS NOT NULL THEN/);
    expect(fn).toMatch(/NEW\.content <> OLD\.content/);
    expect(fn).toMatch(/NEW\.version <> OLD\.version/);
    expect(fn).toMatch(/RAISE EXCEPTION 'Published waiver versions are immutable/);
  });
});

describe("20261001160000: team_waiver_signatures table", () => {
  it("can only be written through sign_team_waiver(), never a direct insert", () => {
    expect(migration).toMatch(
      /CREATE POLICY "team_waiver_signatures_no_direct_insert" ON public\.team_waiver_signatures FOR INSERT TO authenticated\s*\n\s*WITH CHECK \(false\)/,
    );
  });
});

describe("20261001160000: publish_team_waiver", () => {
  it("requires team-manager access and unpublishes any prior version for that team first", () => {
    const fn = migration.slice(migration.indexOf("FUNCTION public.publish_team_waiver"));
    expect(fn).toMatch(/NOT public\.is_team_manager\(_w\.team_id, auth\.uid\(\)\)/);
    const unpublishIdx = fn.indexOf("SET published = false, archived_at = now()");
    const publishIdx = fn.indexOf("SET published = true");
    expect(unpublishIdx).toBeGreaterThan(-1);
    expect(publishIdx).toBeGreaterThan(unpublishIdx);
  });
});

describe("20261001160000: sign_team_waiver", () => {
  const fn = migration.slice(migration.indexOf("FUNCTION public.sign_team_waiver"));

  it("requires attestation when signing on behalf of someone else", () => {
    expect(fn).toMatch(/NOT public\.is_guardian_of\(_me, _on_behalf_of\)/);
    expect(fn).toMatch(/NOT _attested THEN\s*\n\s*RAISE EXCEPTION 'ATTESTATION_REQUIRED/);
  });

  it("requires the waiver to be the team's current published one", () => {
    expect(fn).toMatch(/WHERE id = _waiver_id AND team_id = _team_id AND published/);
    expect(fn).toMatch(/RAISE EXCEPTION 'WAIVER_NOT_PUBLISHED'/);
  });

  it("requires the signer to be a team member or a pending invitee", () => {
    expect(fn).toMatch(/is_team_member\(_team_id, _signer\)/);
    expect(fn).toMatch(/invitee_id = _signer AND status = 'pending'/);
    expect(fn).toMatch(/RAISE EXCEPTION 'NOT_TEAM_MEMBER_OR_INVITEE'/);
  });

  it("records signed_by as the actual caller, never the child being signed for", () => {
    const insert = fn.slice(
      fn.indexOf("INSERT INTO public.team_waiver_signatures"),
      fn.indexOf("ON CONFLICT"),
    );
    expect(insert).toMatch(/CASE WHEN _on_behalf_of IS NOT NULL THEN _me ELSE NULL END/);
  });

  it("is idempotent: a second signature for the same signer is a no-op", () => {
    expect(fn).toMatch(/ON CONFLICT \(waiver_id, signer_user_id\) DO NOTHING/);
  });
});
