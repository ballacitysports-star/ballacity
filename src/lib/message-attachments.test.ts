import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The message-attachments bucket is the one place in messaging where the data
 * lives outside Postgres, so RLS on the tables says nothing about it. These
 * pin the storage policies that keep an attachment as private as the message
 * that carried it.
 *
 * They read the migrations rather than a live bucket, so they run in CI
 * without one — a deployed project still has to have the migration applied.
 */

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

/** Comments carry prose about policies; parsing them as SQL misreads it. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

const ALL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => stripSqlComments(readFileSync(new URL(f, MIGRATIONS), "utf8")))
  .join("\n")
  .replace(/\s+/g, " ");

/** The last definition of a named storage policy, flattened to one line. */
function lastPolicy(name: string): string {
  const defs = [...ALL.matchAll(new RegExp(`CREATE POLICY "${name}"[\\s\\S]*?;`, "gi"))].map(
    (m) => m[0],
  );
  expect(defs.length, `${name} should be defined`).toBeGreaterThan(0);
  return defs.at(-1)!;
}

describe("message attachment storage", () => {
  it("is created as a private bucket", () => {
    // A public bucket would serve every attachment to anyone holding the path,
    // with no auth at all — the messages RLS would be beside the point.
    const inserts = [...ALL.matchAll(/INSERT INTO storage\.buckets[^;]*;/gi)].map((m) => m[0]);
    const forThis = inserts.filter((s) => s.includes("message-attachments"));
    expect(forThis.length, "the bucket should be created in a migration").toBeGreaterThan(0);
    expect(forThis.at(-1)!).toMatch(/false/);
    expect(forThis.at(-1)!).not.toMatch(/'message-attachments',\s*true/);
  });

  it("only lets participants of that conversation read a file", () => {
    // The first path segment is the conversation id.
    const p = lastPolicy("msg_attach_read_participants");
    expect(p).toMatch(/FOR SELECT/i);
    expect(p).toMatch(/is_conversation_participant\(\s*\(split_part\(name, '\/', 1\)\)::uuid/);
  });

  it("only lets a member upload into their own folder, in a thread they are in", () => {
    // Second segment is the uploader; without both checks a member could write
    // into someone else's conversation, or spoof another sender's folder.
    const p = lastPolicy("msg_attach_insert_sender");
    expect(p).toMatch(/FOR INSERT/i);
    expect(p).toMatch(/auth\.uid\(\)::text = split_part\(name, '\/', 2\)/);
    expect(p).toMatch(/is_conversation_participant/);
  });

  it("lets the sender delete their own file", () => {
    // unsendMessage() relies on this: the RPC clears the row's reference and
    // the client then removes the object. If this policy ever stops covering
    // the sender, unsent attachments start surviving in the bucket again.
    const p = lastPolicy("msg_attach_delete_sender");
    expect(p).toMatch(/FOR DELETE/i);
    expect(p).toMatch(/auth\.uid\(\)::text = split_part\(name, '\/', 2\)/);
  });
});
