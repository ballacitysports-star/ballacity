import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A conversation member must not be able to rewrite the other person's
 * messages.
 *
 * `authenticated` once held UPDATE on every column of public.messages while
 * the policy permitting it only checked that the caller was a participant.
 * RLS cannot restrict columns, so the grant was the only thing in the way:
 * a participant could rewrite a body, reattribute a message via sender_id,
 * backdate created_at, soft-delete through deleted_at, or move a message into
 * another conversation.
 *
 * These read the migrations rather than a live database, so they run in CI
 * without one. They pin the shape of the fix, not the runtime state — a
 * deployed database still has to have the migration applied.
 */

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS), "utf8") }));
}

/** Every GRANT/REVOKE of UPDATE on a table, in migration order. */
function updateGrantHistory(table: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `(GRANT|REVOKE)\\s+UPDATE\\s*(\\([^)]*\\))?\\s+ON\\s+(?:TABLE\\s+)?public\\.${table}\\b[^;]*;`,
    "gi",
  );
  for (const { sql } of migrationsInOrder()) {
    for (const m of sql.matchAll(re)) out.push(m[0]);
  }
  return out.map((s) => s.replace(/\s+/g, " ").trim());
}

describe("public.messages update grants", () => {
  const history = updateGrantHistory("messages");

  it("ends with authenticated holding UPDATE on read_at only", () => {
    const forAuthenticated = history.filter((s) => /\bauthenticated\b/.test(s));
    expect(forAuthenticated.length, "expected grants on messages to exist").toBeGreaterThan(0);
    const last = forAuthenticated.at(-1)!;
    expect(last).toMatch(/^GRANT UPDATE \(\s*read_at\s*\) ON public\.messages TO authenticated;$/i);
  });

  it("revokes the blanket UPDATE before narrowing it", () => {
    const revokeAt = history.findIndex((s) => /^REVOKE UPDATE ON public\.messages/i.test(s));
    const narrowAt = history.findIndex((s) => /^GRANT UPDATE \(/i.test(s));
    expect(revokeAt, "a blanket REVOKE must exist").toBeGreaterThanOrEqual(0);
    expect(narrowAt, "a column-scoped GRANT must exist").toBeGreaterThan(revokeAt);
  });

  it("never re-grants an unrestricted UPDATE afterwards", () => {
    const narrowAt = history.findIndex((s) => /^GRANT UPDATE \(/i.test(s));
    const after = history.slice(narrowAt + 1);
    for (const stmt of after) {
      // A later GRANT is only acceptable if it still names columns.
      if (/^GRANT UPDATE/i.test(stmt) && /\bauthenticated\b/.test(stmt)) {
        expect(stmt, "UPDATE on messages must stay column-scoped").toMatch(/GRANT UPDATE \(/i);
      }
    }
  });
});

describe("public.conversations update grants", () => {
  it("ends with authenticated holding no UPDATE at all", () => {
    const history = updateGrantHistory("conversations").filter((s) => /\bauthenticated\b/.test(s));
    expect(history.length).toBeGreaterThan(0);
    expect(history.at(-1)!).toMatch(
      /^REVOKE UPDATE ON public\.conversations FROM authenticated;$/i,
    );
  });
});

describe("the read-receipt policy", () => {
  const all = migrationsInOrder()
    .map((m) => m.sql)
    .join("\n");

  it("is the last definition and restricts a member to other people's messages", () => {
    const defs = [...all.matchAll(/CREATE POLICY "Recipients mark read"[\s\S]*?;/gi)].map((m) =>
      m[0].replace(/\s+/g, " "),
    );
    expect(defs.length, "policy should be defined").toBeGreaterThan(0);
    expect(defs.at(-1)!).toMatch(/sender_id\s*<>\s*auth\.uid\(\)/i);
  });
});
