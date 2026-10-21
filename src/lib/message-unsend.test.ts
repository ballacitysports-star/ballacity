import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Unsending clears a message's text and file and stamps deleted_at. The table
 * rule that every message has text or a file refused that update, so unsend
 * failed for every message. These pin the two pieces that have to agree.
 */

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

const ALL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) =>
    readFileSync(new URL(f, MIGRATIONS), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " "),
  )
  .join("\n")
  .replace(/\s+/g, " ");

function lastDefinition(re: RegExp): string {
  const defs = [...ALL.matchAll(re)].map((m) => m[0]);
  expect(defs.length, `${re} should be defined`).toBeGreaterThan(0);
  return defs.at(-1)!;
}

describe("unsending a message", () => {
  const rule = lastDefinition(
    /ADD CONSTRAINT messages_body_or_attachment_chk CHECK \([\s\S]*?\);/gi,
  );

  it("lets a message that was unsent be empty", () => {
    expect(rule).toMatch(/deleted_at IS NOT NULL/);
  });

  it("still requires a live message to have text or a file", () => {
    expect(rule).toMatch(/body IS NOT NULL AND length\(btrim\(body\)\) > 0/);
    expect(rule).toMatch(/attachment_path IS NOT NULL/);
  });

  it("clears the text and the file together with stamping deleted_at", () => {
    // This is what makes the rule above necessary: if the function ever stops
    // emptying the row, the exception can go.
    const fn = lastDefinition(/CREATE OR REPLACE FUNCTION public\.unsend_message[\s\S]*?\$\$;/gi);
    expect(fn).toMatch(/body = NULL/);
    expect(fn).toMatch(/attachment_path = NULL/);
    expect(fn).toMatch(/deleted_at = now\(\)/);
    expect(fn).toMatch(/sender_id = _me/);
  });
});
