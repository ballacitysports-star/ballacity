import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Game ids are text, everywhere they cross a boundary.
 *
 * `hosted_games.id` is `text`, `conversations.game_id` is `TEXT`, and
 * addHostedGame() mints ids shaped `host-<base36>-<random>` — never uuids. A
 * database function that took a game id as `uuid` therefore failed the cast
 * before its body ran, which is how messaging a host broke for every game
 * created in the app while looking fine for the rare uuid-shaped id.
 *
 * These read the migrations rather than a live database, so they hold in CI
 * without one. They are a type-agreement check, not a substitute for running
 * the migration.
 */

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** The parameter list of the last definition of `name`, in migration order. */
function latestSignature(name: string): string | null {
  let found: string | null = null;
  for (const file of migrationFiles()) {
    const sql = readFileSync(new URL(file, MIGRATIONS), "utf8");
    const re = new RegExp(`FUNCTION\\s+public\\.${name}\\s*\\(([^)]*)\\)`, "gi");
    for (const m of sql.matchAll(re)) {
      // Skip GRANT/REVOKE lines, which name argument types without defining.
      const line = sql.slice(Math.max(0, m.index! - 40), m.index!);
      if (/GRANT|REVOKE/i.test(line)) continue;
      found = m[1]!.replace(/\s+/g, " ").trim();
    }
  }
  return found;
}

describe("game ids are text across the database boundary", () => {
  it("passes a game id to create_direct_conversation as text, not uuid", () => {
    const sig = latestSignature("create_direct_conversation");
    expect(sig, "create_direct_conversation should still be defined").toBeTruthy();
    expect(sig).toMatch(/_game_id\s+text/i);
    expect(sig, "a uuid game id parameter cannot accept `host-…` ids").not.toMatch(
      /_game_id\s+uuid/i,
    );
  });

  it("keeps conversations.game_id text, which is what that parameter feeds", () => {
    const create = migrationFiles()
      .map((f) => readFileSync(new URL(f, MIGRATIONS), "utf8"))
      .find((sql) => /CREATE TABLE public\.conversations\b/i.test(sql));
    expect(create).toBeTruthy();
    const table = create!.match(/CREATE TABLE public\.conversations\s*\(([\s\S]*?)\);/i)![1]!;
    expect(table).toMatch(/game_id\s+TEXT/i);
  });

  it("keeps hosted_games.id text, which is where those ids come from", () => {
    const create = migrationFiles()
      .map((f) => readFileSync(new URL(f, MIGRATIONS), "utf8"))
      .find((sql) => /CREATE TABLE public\.hosted_games\b/i.test(sql));
    expect(create).toBeTruthy();
    const table = create!.match(/CREATE TABLE public\.hosted_games\s*\(([\s\S]*?)\);/i)![1]!;
    expect(table).toMatch(/^\s*id\s+text\s+PRIMARY KEY/im);
  });
});
