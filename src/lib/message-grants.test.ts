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

/**
 * Drop `--` line comments and block comments.
 *
 * These migrations carry long prose rationales, and the words GRANT and REVOKE
 * appear in them. Matching SQL statements against the raw text therefore reads
 * sentences as statements — which silently inverted a result here until the
 * assertion that catches it was added.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function migrationsInOrder(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      sql: stripSqlComments(readFileSync(new URL(file, MIGRATIONS), "utf8")),
    }));
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

/**
 * A member must not be able to put themselves into someone else's thread.
 *
 * "Creator adds participants" permitted `user_id = auth.uid()` against any
 * conversation id, so anyone holding an id — they appear in /messages/$id URLs
 * and notification links — could insert themselves, then read the whole
 * history, send into it and react. Probed against production before the fix:
 * an outsider went from 0 visible messages to all of them. No trigger can gate
 * a SELECT, so this was the one part of minor messaging with no second line of
 * defence: an adult with a minor's conversation id could read it.
 */
describe("joining a conversation", () => {
  const all = migrationsInOrder();
  const sql = all.map((m) => m.sql).join("\n");

  /**
   * Walks every GRANT/REVOKE touching the table in migration order and reports
   * the final state of one privilege for `authenticated`. Privilege lists
   * ("GRANT SELECT, INSERT, UPDATE, DELETE") and ALL are both handled — the
   * original grants are written that way, and matching only a lone privilege
   * would make these tests pass without ever seeing the grant they undo.
   */
  function grantHistory(table: string, priv: string): ("granted" | "revoked")[] {
    const re = new RegExp(
      `(GRANT|REVOKE)\\s+([^;]*?)\\s+ON\\s+(?:TABLE\\s+)?public\\.${table}\\b([^;]*);`,
      "gi",
    );
    const seen: ("granted" | "revoked")[] = [];
    for (const { sql: s } of all) {
      for (const m of s.matchAll(re)) {
        const [whole, verb, privs] = m;
        if (!/\bauthenticated\b/.test(whole)) continue;
        const list = privs.replace(/\([^)]*\)/g, "").toUpperCase();
        const touches = list.includes("ALL") || new RegExp(`\\b${priv}\\b`).test(list);
        if (!touches) continue;
        seen.push(/^GRANT$/i.test(verb) ? "granted" : "revoked");
      }
    }
    return seen;
  }

  function lastGrantState(table: string, priv: string): "granted" | "revoked" {
    return grantHistory(table, priv).at(-1) ?? "revoked";
  }

  it("actually observes the grants it claims to revoke", () => {
    // Guards the helper itself: if the regex stopped matching, every
    // assertion below would pass on an empty history.
    expect(grantHistory("conversation_participants", "INSERT")).toContain("granted");
    expect(grantHistory("conversations", "INSERT")).toContain("granted");
  });

  it("leaves authenticated with no INSERT on conversation_participants", () => {
    expect(lastGrantState("conversation_participants", "INSERT")).toBe("revoked");
  });

  it("leaves authenticated with no INSERT on conversations", () => {
    // Otherwise a client can fabricate a conversation that skipped the RPC's
    // consent, privacy and minor-messaging checks.
    expect(lastGrantState("conversations", "INSERT")).toBe("revoked");
  });

  it("drops the policy that allowed self-insertion", () => {
    const dropped = sql.lastIndexOf('DROP POLICY IF EXISTS "Creator adds participants"');
    const created = sql.lastIndexOf('CREATE POLICY "Creator adds participants"');
    expect(dropped, "the policy must be dropped").toBeGreaterThan(-1);
    expect(dropped, "and never recreated afterwards").toBeGreaterThan(created);
  });

  it("leaves no unused column-wide UPDATE grants on the side tables", () => {
    expect(lastGrantState("conversation_participants", "UPDATE")).toBe("revoked");
    expect(lastGrantState("message_reactions", "UPDATE")).toBe("revoked");
  });
});

/**
 * The send-time guard must name the rule that refused, like the RPC does.
 * Raising the old blanket line lost the actionable reason on every refusal
 * that happened at send rather than at thread creation.
 */
describe("enforce_minor_messaging", () => {
  it("raises the reason code rather than a fixed sentence", () => {
    const defs = [
      ...migrationsInOrder()
        .map((m) => m.sql)
        .join("\n")
        .matchAll(
          /CREATE OR REPLACE FUNCTION public\.enforce_minor_messaging\(\)[\s\S]*?\$function\$;/gi,
        ),
    ].map((m) => m[0]);
    expect(defs.length, "the trigger function should be defined").toBeGreaterThan(0);
    const last = defs.at(-1)!;
    expect(last).toMatch(/minor_messaging_block\b/);
    expect(last).toMatch(/MINOR_MESSAGING_BLOCKED:%/);
  });
});
