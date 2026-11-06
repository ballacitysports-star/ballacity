/**
 * Migrations run in every environment, so they must not grant anything to a named
 * person. A role for a specific account is given with
 * scripts/bootstrap-superadmin.mjs (or by a superadmin in the app), never by a
 * migration that names an email address. See docs/superadmin-bootstrap.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIRS = ["supabase/migrations", "drizzle/migrations"];

/**
 * Production history that is already applied and cannot be rewritten. On a fresh
 * replay it inserts nothing because no accounts exist yet. Do not add to this list.
 */
const HISTORICAL = new Set([
  "supabase/migrations/20260813172852_fbb914ad-7600-4056-8959-6f7e1ae70460.sql",
]);

/** A quoted string literal that looks like an email address. */
const EMAIL_LITERAL = /'[^'\s]+@[^'\s]+\.[a-z]{2,}'/i;

/** Strips -- line comments and block comments so prose about an address is not flagged. */
function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

function migrationFiles() {
  return DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => join(dir, f)),
  );
}

describe("migrations name no people", () => {
  it("has migrations to check", () => {
    expect(migrationFiles().length).toBeGreaterThan(100);
  });

  it("contains no email address literal outside the historical allowlist", () => {
    const offenders = migrationFiles().filter(
      (f) => !HISTORICAL.has(f) && EMAIL_LITERAL.test(stripSqlComments(readFileSync(f, "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest: each entry still exists and still needs the exemption", () => {
    for (const f of HISTORICAL) {
      expect(EMAIL_LITERAL.test(stripSqlComments(readFileSync(f, "utf8")))).toBe(true);
    }
  });

  it("catches the shape it is meant to catch", () => {
    const sql =
      "INSERT INTO public.user_roles SELECT id, 'admin' FROM auth.users WHERE email = 'x@y.com';";
    expect(EMAIL_LITERAL.test(stripSqlComments(sql))).toBe(true);
    expect(EMAIL_LITERAL.test(stripSqlComments("-- owner is 'x@y.com'\nSELECT 1;"))).toBe(false);
  });
});
