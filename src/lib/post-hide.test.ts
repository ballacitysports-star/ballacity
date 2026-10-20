import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A moderator's "Hide" on a team post or comment must actually hide it.
 *
 * `hidden_at` is set only by superadmin server code. Comments once ignored it
 * entirely (no policy or query read it), team members could read hidden posts
 * through an older policy, and the UPDATE policies let authors clear it.
 *
 * Like message-grants.test.ts, these read the migrations rather than a live
 * database, and they check the LAST definition of each object, so a later
 * migration cannot quietly undo the fix.
 */

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function migrationsInOrder(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => stripSqlComments(readFileSync(new URL(file, MIGRATIONS), "utf8")));
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** The last CREATE POLICY statement with this name on this table. */
function lastPolicy(table: string, name: string): string {
  const re = new RegExp(`CREATE POLICY "${name}"\\s+ON public\\.${table}\\b[^;]*;`, "gi");
  let last = "";
  for (const sql of migrationsInOrder()) for (const m of sql.matchAll(re)) last = m[0];
  return flat(last);
}

/** The last CREATE OR REPLACE FUNCTION body for this function. */
function lastFunction(name: string): string {
  const re = new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    "gi",
  );
  let last = "";
  for (const sql of migrationsInOrder()) for (const m of sql.matchAll(re)) last = m[1];
  return flat(last);
}

describe("read gate hides moderator-hidden content", () => {
  it("comments: hidden or unscreened text is visible to its author only", () => {
    expect(lastPolicy("post_comments", "post_comments_moderated_read")).toContain(
      "AS RESTRICTIVE FOR SELECT USING ( (moderation_status = 'approved' AND hidden_at IS NULL) OR author_id = auth.uid() );",
    );
  });

  it("team posts: hidden or unscreened text is visible to its author and team managers only", () => {
    expect(lastPolicy("team_posts", "team_posts_moderated_read")).toContain(
      "AS RESTRICTIVE FOR SELECT USING ( (moderation_status = 'approved' AND hidden_at IS NULL) OR author_id = auth.uid() OR private_sec.viewer_manages_team(team_id) );",
    );
  });
});

describe("only server code hides or unhides", () => {
  const body = lastFunction("enforce_post_text_moderation");

  it("exempts only the service role and nested system writes", () => {
    expect(body).toContain(
      "IF auth.uid() IS NULL OR pg_trigger_depth() > 1 THEN RETURN NEW; END IF;",
    );
  });

  it("clears hidden_at on a member's insert and pins it on a member's update", () => {
    expect(body).toContain(
      "IF TG_OP = 'INSERT' THEN NEW.moderation_status := 'pending'; NEW.hidden_at := NULL; RETURN NEW; END IF;",
    );
    expect(body).toContain("NEW.hidden_at := OLD.hidden_at;");
  });

  it("still re-queues edited text", () => {
    expect(body).toContain(
      "NEW.moderation_status := CASE WHEN _text_changed THEN 'pending' ELSE OLD.moderation_status END;",
    );
  });
});

describe("comment list", () => {
  it("skips hidden comments", () => {
    const src = readFileSync("src/lib/post-engagement.functions.ts", "utf8");
    const start = src.indexOf("export const listComments");
    const body = src.slice(start, src.indexOf("export const", start + 1));
    expect(body).toContain('.is("hidden_at", null)');
  });
});
