import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source-pinning for the emergency-contact migration. The actual privacy
 * guarantee (new columns unreadable by anon/authenticated without the RPC,
 * owner-only read, owner write still works) is verified by local Postgres
 * replay — docs/guardian-emergency-contact-verification.md, not here, the
 * same split parent-account-type.test.ts uses for its own migration.
 */

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261001150000_guardian_emergency_contact.sql"),
  "utf8",
);

describe("20261001150000: guardian emergency contact", () => {
  it("adds all three columns, nullable, no default exposure", () => {
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS emergency_contact_name text/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS emergency_contact_phone text/);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS emergency_contact_relationship text/);
  });

  it("never re-grants SELECT on the new columns to anon or authenticated", () => {
    // The whole point: these columns are private by omission (see the
    // migration's own header comment), not by an explicit REVOKE. Confirm
    // the file never grants them back, which would silently undo that.
    expect(migration).not.toMatch(/GRANT SELECT.*emergency_contact/);
  });

  it("defines get_my_emergency_contact as an owner-scoped, security-definer reader", () => {
    const fn = migration.slice(migration.indexOf("FUNCTION public.get_my_emergency_contact"));
    expect(fn).toMatch(/SECURITY DEFINER/);
    expect(fn).toMatch(/WHERE p\.id = auth\.uid\(\)/);
    expect(fn).toMatch(/REVOKE ALL ON FUNCTION public\.get_my_emergency_contact\(\) FROM PUBLIC, anon/);
    expect(fn).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_my_emergency_contact\(\) TO authenticated/);
  });
});
