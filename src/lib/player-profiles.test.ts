import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Stage 1 of the Account -> Player Profile refactor.
 *
 * That refactor stopped at stage 1: managed children are credential-less auth
 * users now (managed_accounts), and player_profiles is frozen — read/delete
 * only, pinned in managed-children.test.ts. The table and its leftover rows
 * remain, so these still pin its stage-1 shape: who may write which column,
 * and the fact that minor status is derived rather than declared.
 */

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const ALL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => stripSqlComments(readFileSync(new URL(f, MIGRATIONS), "utf8")))
  .join("\n")
  .replace(/\s+/g, " ");

describe("player_profiles schema", () => {
  it("hangs the athlete off an account, not off a login", () => {
    // The point of the whole refactor: account_id is required, user_id is not.
    expect(ALL).toMatch(/account_id uuid NOT NULL REFERENCES auth\.users\(id\)/);
    expect(ALL).toMatch(/user_id uuid UNIQUE REFERENCES auth\.users\(id\)/);
    // If user_id were NOT NULL a managed child could not exist at all.
    expect(ALL).not.toMatch(/user_id uuid UNIQUE NOT NULL REFERENCES auth\.users/);
  });

  it("refuses a row claiming someone else's login", () => {
    // Without this a client could insert a player row carrying another user's
    // auth id and impersonate them once stage 3 starts trusting user_id.
    expect(ALL).toMatch(
      /player_profiles_self_or_managed_chk CHECK \(user_id IS NULL OR user_id = account_id\)/,
    );
  });

  it("never lets a client move a player between accounts", () => {
    // account_id and user_id decide ownership. They are grantable on INSERT
    // (you create your own) but must be absent from the UPDATE grant, or an
    // owner could re-parent a child onto someone else's account.
    const update = /GRANT UPDATE \(([^)]*)\) ON public\.player_profiles/.exec(ALL);
    expect(update, "an explicit column-level UPDATE grant should exist").not.toBeNull();
    const cols = update![1];
    expect(cols).not.toMatch(/\baccount_id\b/);
    expect(cols).not.toMatch(/\buser_id\b/);
    // A blanket grant would silently include them.
    expect(ALL).toMatch(/REVOKE ALL ON public\.player_profiles FROM authenticated/);
    expect(ALL).not.toMatch(/GRANT ALL ON public\.player_profiles/);
  });

  it("never lets a client set the derived cohort", () => {
    // age_cohort follows date_of_birth by trigger. If a client could write it,
    // a 12-year-old could be marked adult and every minor rule would fall away.
    const ins = /GRANT INSERT \(([^)]*)\) ON public\.player_profiles/.exec(ALL);
    expect(ins).not.toBeNull();
    expect(ins![1]).not.toMatch(/\bage_cohort\b/);
    expect(ALL).toMatch(/BEFORE INSERT OR UPDATE ON public\.player_profiles/);
    expect(ALL).toMatch(/age_cohort_from_birthday\(NEW\.date_of_birth\)/);
  });

  it("scopes every policy to the owning account", () => {
    const policies = [...ALL.matchAll(/CREATE POLICY "([^"]+)" ON public\.player_profiles[^;]*;/g)];
    expect(policies.length, "select/insert/update/delete should each be covered").toBe(4);
    for (const [sql, name] of policies) {
      expect(sql, `${name} should be scoped to account_id`).toMatch(/account_id = auth\.uid\(\)/);
    }
    expect(ALL).toMatch(/ALTER TABLE public\.player_profiles ENABLE ROW LEVEL SECURITY/);
  });

  it("backfills without re-parenting anyone", () => {
    // Stage 1 must not decide that an existing child now belongs to a guardian
    // — that is irreversible and belongs in a later, reviewed step.
    const insert = /INSERT INTO public\.player_profiles[\s\S]*?;/.exec(ALL);
    expect(insert).not.toBeNull();
    expect(insert![0]).toMatch(/FROM public\.profiles p/);
    expect(insert![0]).not.toMatch(/guardian_links/);
    expect(insert![0]).toMatch(/ON CONFLICT \(user_id\) DO NOTHING/);
  });

  it("leaves the existing tables alone", () => {
    // Stage 1 is additive. Any ALTER/DROP against the live identity tables
    // here would make it a cutover instead.
    const stage1 = stripSqlComments(
      readFileSync(new URL("20260908200000_player_profiles_stage1.sql", MIGRATIONS), "utf8"),
    );
    expect(stage1).not.toMatch(/ALTER TABLE\s+(public\.)?profiles/i);
    expect(stage1).not.toMatch(/DROP TABLE/i);
    expect(stage1).not.toMatch(/DROP POLICY/i);
  });
});
