/**
 * Ops marks these flags "not enforced" because nothing reads them. If code starts reading one, the label becomes a
 * lie, so this fails until the flag is taken off the list.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_ENFORCED_SETTINGS, notEnforcedNote } from "./not-enforced-settings";

// Files allowed to name the keys: the list itself, its tests and the generated database types.
const ALLOWED = new Set([
  "src/lib/not-enforced-settings.ts",
  "src/lib/not-enforced-settings.test.ts",
  "src/components/superadmin/OpsTab.test.tsx",
  "src/integrations/supabase/types.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path.split("\\").join("/")] : [];
  });
}

describe("not-enforced settings", () => {
  it("lists the seeded flags that nothing reads", () => {
    expect(Object.keys(NOT_ENFORCED_SETTINGS).sort()).toEqual([
      "announcement_banner",
      "games_creation_enabled",
      "maintenance_mode",
      "reels_enabled",
      "signups_enabled",
    ]);
  });

  it("has no reader anywhere in src", () => {
    const keys = Object.keys(NOT_ENFORCED_SETTINGS);
    const readers = sourceFiles("src")
      .filter((f) => !ALLOWED.has(f))
      .flatMap((f) => {
        const text = readFileSync(f, "utf8");
        return keys.filter((k) => text.includes(k)).map((k) => `${f}: ${k}`);
      });
    expect(readers).toEqual([]);
  });

  it("gives a note only for listed keys", () => {
    expect(notEnforcedNote("signups_enabled")).toMatch(/^Not enforced\./);
    expect(notEnforcedNote("maintenance")).toBeNull();
    expect(notEnforcedNote("constructor")).toBeNull();
  });
});
