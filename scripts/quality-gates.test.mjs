import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

/**
 * Plan 9.2 gates that live in eslint.config.js and bite through the lint ratchet
 * (scripts/lint-changed.mjs: no changed file may gain errors, a new file must have none).
 */
const eslint = new ESLint();
const lint = async (code, filePath = "src/lib/gate-probe.ts") => {
  const [r] = await eslint.lintText(code, { filePath });
  return r.messages.map((m) => `${m.severity === 2 ? "error" : "warn"} ${m.ruleId}`);
};

describe('data gate: no new select("*")', () => {
  it("flags a select of every column", async () => {
    const code = 'export const q = (s: any) => s.from("t").select("*").eq("a", 1);\n';
    expect(await lint(code)).toContain("error no-restricted-syntax");
  });

  it("flags a count that still returns rows", async () => {
    const code = 'export const q = (s: any) => s.from("t").select("*", { count: "exact" });\n';
    expect(await lint(code)).toContain("error no-restricted-syntax");
  });

  it("allows named columns and a head-only count", async () => {
    const cols = 'export const q = (s: any) => s.from("t").select("id, name");\n';
    const count =
      'export const q = (s: any) => s.from("t").select("*", { count: "exact", head: true });\n';
    expect(await lint(cols)).not.toContain("error no-restricted-syntax");
    expect(await lint(count)).not.toContain("error no-restricted-syntax");
  });
}, 60_000);

describe("component size gate", () => {
  const file = (n) =>
    Array.from({ length: n }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";

  it("warns past 800 lines", async () => {
    const msgs = await lint(file(900));
    expect(msgs).toContain("warn local/max-lines-soft");
    expect(msgs).not.toContain("error max-lines");
  });

  it("fails past 1,500 lines", async () => {
    expect(await lint(file(1600))).toContain("error max-lines");
  });

  it("does not count blank lines or comments", async () => {
    const padded = file(700) + "\n// note\n".repeat(1000);
    const msgs = await lint(padded);
    expect(msgs).not.toContain("warn local/max-lines-soft");
    expect(msgs).not.toContain("error max-lines");
  });
}, 60_000);
