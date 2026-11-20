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

describe("WP 4.0 gate: no raw error text in a toast (src/routes, src/components)", () => {
  const RULE = "error local/no-raw-toast-error";
  const component = "src/components/gate-probe.tsx";
  const wrap = (body) =>
    `import { toast } from "sonner";\nexport function f(e: Error, err: unknown) {\n  ${body}\n}\n`;

  it.each([
    ["e.message", "toast.error(e.message);"],
    ["e?.message", "toast.warning((err as Error)?.message);"],
    ["String(e)", "toast(String(err));"],
    ["a template with ${e.message}", "toast.error(`Upload failed: ${e.message}`);"],
    ["a description of e.message", 'toast.error("Couldn\'t save", { description: e.message });'],
    ["a description of String(e)", 'toast.message("Saved", { description: String(err) });'],
    ["a ternary", 'toast.error(err instanceof Error ? err.message : "Failed");'],
    [
      "a ternary on a library error",
      'toast.error(err instanceof PostgrestError ? err.message : "x");',
    ],
    ["a ?? fallback", 'toast.error((err as Error)?.message ?? "Could not remove player.");'],
    ["a || fallback", 'toast.error(e.message || "Failed");'],
    ["a + concatenation", 'toast.error("Failed: " + e.message);'],
    ["a ?? inside a template", 'toast.error(`Failed: ${(err as Error)?.message ?? ""}`);'],
    ["a method on the text", "toast.error(e.message.slice(0, 80));"],
    [
      "a ternary description",
      'toast.error("Couldn\'t save", { description: err instanceof Error ? err.message : "y" });',
    ],
  ])("flags %s", async (_name, body) => {
    const msgs = await lint(wrap(body), component);
    expect(msgs).toContain(RULE);
  });

  it("names userErrorMessage in its message", async () => {
    const [r] = await eslint.lintText(wrap("toast.error(e.message);"), { filePath: component });
    const m = r.messages.find((x) => x.ruleId === "local/no-raw-toast-error");
    expect(m?.message).toContain("userErrorMessage");
    expect(m?.message).toContain("src/lib/user-error.ts");
  });

  it("applies under src/routes too", async () => {
    expect(await lint(wrap("toast.error(e.message);"), "src/routes/gate-probe.tsx")).toContain(
      RULE,
    );
  });

  it.each([
    [
      "a mapped sentence",
      'toast.error(userErrorMessage(err, "Couldn\'t save. Please try again."));',
    ],
    ["toast.message with our own text", 'toast.message("Sign in to react");'],
    ["a plain template", "toast.error(`Couldn't remove ${e.name}.`);"],
    ["a success toast", 'toast.success("Saved");'],
    [
      "a mapper fed a ternary",
      'toast.error(userErrorMessage(err instanceof Error ? err : null, "Couldn\'t save. Please try again."));',
    ],
    ["a ternary of own sentences", 'toast.error(e.name ? "Couldn\'t save." : "Saved nothing.");'],
    [
      "a condition that reads the message",
      'toast.error(e.message ? "Couldn\'t save." : "Failed.");',
    ],
    [
      "our own Error class's sentence",
      'toast.error(err instanceof OwnRefusal ? err.message : userErrorMessage(err, "Couldn\'t save."));',
    ],
  ])("allows %s", async (_name, body) => {
    const code = `import { userErrorMessage } from "@/lib/user-error";\n${wrap(body)}`;
    expect(await lint(code, component)).not.toContain(RULE);
  });

  it("still applies the select(*) gate in these folders", async () => {
    const code = 'export const q = (s: any) => s.from("t").select("*");\n';
    expect(await lint(code, component)).toContain("error no-restricted-syntax");
  });

  it("leaves other folders alone", async () => {
    expect(await lint(wrap("toast.error(e.message);"), "src/lib/gate-probe.tsx")).not.toContain(
      RULE,
    );
  });
}, 60_000);
