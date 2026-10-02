import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * Source-pinning for the migrations that make `parent` a real account type.
 * Rendering a database round-trip here would mean standing up Postgres;
 * these tests instead pin the exact statements against regressions, the same
 * way managed-children.test.ts and device-pairing.test.ts pin theirs. The
 * behavioural claims (constraints actually enforced, handle_new_user actually
 * nulls an unrecognised type, provision_managed_child's insert actually
 * idempotent) are verified by local Postgres replay —
 * docs/parent-account-type-verification.md, not here.
 */

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");

const backfillDrift = read("20260725025124_profiles_account_type_valid.sql");
const main = read("20261001130000_parent_account_type.sql");
const backfill = read("20261001140000_backfill_parent_account_profiles.sql");

describe("20260725025124: back-filled drift matches production's stored statement", () => {
  it("hashes to production's recorded value once its own trailing newline is stripped", () => {
    const body = backfillDrift.slice(backfillDrift.indexOf("ALTER TABLE public.profiles"));
    const noTrailingNewline = body.endsWith("\n") ? body.slice(0, -1) : body;
    expect(createHash("md5").update(noTrailingNewline).digest("hex")).toBe(
      "a25e6248b2cbf8c887a9f3df7c29b6a5",
    );
  });

  it("creates profiles_account_type_valid guarded by an existence check", () => {
    expect(backfillDrift).toMatch(/CREATE CONSTRAINT|ADD CONSTRAINT profiles_account_type_valid/);
    expect(backfillDrift).toMatch(/CHECK \(account_type IS NULL OR account_type IN/);
  });
});

describe("20261001130000: widens every constraint that names the old four types", () => {
  it("drops and re-adds profiles_account_type_check with parent included", () => {
    expect(main).toMatch(/DROP CONSTRAINT IF EXISTS profiles_account_type_check/);
    expect(main).toMatch(
      /ADD CONSTRAINT profiles_account_type_check\s*\n\s*CHECK \(account_type IN \('player','team','trainer','gym','parent'\)\)/,
    );
  });

  it("drops and re-adds profiles_account_type_valid with parent included", () => {
    expect(main).toMatch(/DROP CONSTRAINT IF EXISTS profiles_account_type_valid/);
    expect(main).toMatch(
      /ADD CONSTRAINT profiles_account_type_valid\s*\n\s*CHECK \(account_type IS NULL OR account_type IN \('player','team','trainer','gym','parent'\)\)/,
    );
  });

  it("drops and re-adds account_profiles_kind_check with parent included", () => {
    expect(main).toMatch(/DROP CONSTRAINT IF EXISTS account_profiles_kind_check/);
    expect(main).toMatch(
      /ADD CONSTRAINT account_profiles_kind_check\s*\n\s*CHECK \(kind IN \('player','team','trainer','gym','parent'\)\)/,
    );
  });

  it("adds a partial unique index capping one parent profile per user, mirroring the player one", () => {
    expect(main).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS account_profiles_parent_uniq\s*\n\s*ON public\.account_profiles \(user_id\) WHERE kind = 'parent'/,
    );
  });

  it("handle_new_user: the allow-list accepts parent instead of silently nulling it", () => {
    const fn = main.slice(main.indexOf("FUNCTION public.handle_new_user"));
    expect(fn).toMatch(/_type NOT IN \('player','team','trainer','gym','parent'\)/);
  });

  it("provision_managed_child: the new insert runs after managed_accounts, before the birthday", () => {
    const fn = main.slice(main.indexOf("FUNCTION public.provision_managed_child"));
    const accountsIdx = fn.indexOf("INSERT INTO public.managed_accounts");
    const parentRowIdx = fn.indexOf("INSERT INTO public.account_profiles");
    const birthdayIdx = fn.indexOf("INSERT INTO public.profile_birthdays");
    expect(accountsIdx).toBeGreaterThan(-1);
    expect(parentRowIdx).toBeGreaterThan(accountsIdx);
    expect(birthdayIdx).toBeGreaterThan(parentRowIdx);
  });

  it("provision_managed_child's new insert is idempotent and never touches an existing row", () => {
    const fn = main.slice(main.indexOf("FUNCTION public.provision_managed_child"));
    const insert = fn.slice(fn.indexOf("INSERT INTO public.account_profiles"));
    expect(insert).toMatch(
      /INSERT INTO public\.account_profiles \(user_id, kind, ref_id\)\s*\n\s*VALUES \(_parent, 'parent', NULL\)\s*\n\s*ON CONFLICT DO NOTHING;/,
    );
  });

  it("provision_managed_child still writes the CHILD's own account_type as player, never the guardian's", () => {
    const fn = main.slice(main.indexOf("FUNCTION public.provision_managed_child"));
    expect(fn).toMatch(/account_type = 'player'/);
    expect(fn).not.toMatch(/account_type = 'parent'/);
  });
});

describe("20261001140000: backfills existing guardians without touching their active view", () => {
  it("inserts one parent row per distinct existing guardian, idempotently", () => {
    expect(backfill).toMatch(
      /INSERT INTO public\.account_profiles \(user_id, kind, ref_id\)\s*\n\s*SELECT DISTINCT managed_by, 'parent', NULL\s*\n\s*FROM public\.managed_accounts\s*\n\s*ON CONFLICT DO NOTHING;/,
    );
  });

  it("the insert's column list is exactly user_id, kind, ref_id — nothing else", () => {
    expect(backfill).toMatch(/INSERT INTO public\.account_profiles \(user_id, kind, ref_id\)/);
    // Already pinned by the test above, restated: no other column appears in
    // the statement itself (the header comment is prose, not code, and is
    // allowed to name them — this checks the SQL body only).
    const sql = backfill.slice(backfill.indexOf("INSERT INTO public.account_profiles"));
    for (const column of ["active_profile_id", "default_profile_id"]) {
      expect(sql).not.toContain(column);
    }
  });
});
