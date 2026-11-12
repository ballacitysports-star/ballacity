import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  addsPolicy,
  checkPolicyTests,
  parseAddedLines,
  stripSqlComment,
} from "./policy-tests-gate.mjs";

describe("policy-tests gate (plan 9.2)", () => {
  it("finds create and alter policy in added lines, in any case, outside comments", () => {
    expect(addsPolicy(["CREATE POLICY team_read ON public.teams FOR SELECT"])).toBe(true);
    expect(addsPolicy(["  alter policy x on public.t using (true);"])).toBe(true);
    expect(addsPolicy(["DROP POLICY IF EXISTS x ON public.t;"])).toBe(false);
    expect(addsPolicy(["-- create policy is done in the next migration"])).toBe(false);
    expect(addsPolicy(["select 1; -- then create policy"])).toBe(false);
    expect(addsPolicy(["CREATE FUNCTION public.f() RETURNS void"])).toBe(false);
    expect(stripSqlComment("a -- b")).toBe("a ");
  });

  it("fails a policy migration without a SQL test, naming the migration", () => {
    expect(
      checkPolicyTests([
        { path: "supabase/migrations/20261201000000_x.sql", added: ["CREATE POLICY p ON t"] },
        { path: "src/lib/x.ts", added: [] },
      ]),
    ).toEqual({ ok: false, migrations: ["supabase/migrations/20261201000000_x.sql"] });
  });

  it("passes when the branch also changes a SQL test, or adds no policy", () => {
    expect(
      checkPolicyTests([
        { path: "supabase/migrations/20261201000000_x.sql", added: ["CREATE POLICY p ON t"] },
        { path: "supabase/tests/760_x.test.sql", added: [] },
      ]).ok,
    ).toBe(true);
    expect(
      checkPolicyTests([
        { path: "supabase/migrations/20261201000000_x.sql", added: ["CREATE TABLE t (id int)"] },
      ]).ok,
    ).toBe(true);
    // A policy outside the migrations folder (a rollback, a doc) does not count.
    expect(
      checkPolicyTests([{ path: "docs/rollbacks/x.down.sql", added: ["CREATE POLICY p ON t"] }]).ok,
    ).toBe(true);
  });

  it("reads added lines per file from a unified diff", () => {
    const patch = [
      "diff --git a/supabase/migrations/a.sql b/supabase/migrations/a.sql",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/supabase/migrations/a.sql",
      "@@ -0,0 +1,2 @@",
      "+CREATE POLICY p ON t",
      "+-- note",
      "diff --git a/supabase/migrations/b.sql b/supabase/migrations/b.sql",
      "--- a/supabase/migrations/b.sql",
      "+++ b/supabase/migrations/b.sql",
      "@@ -3 +3 @@",
      "-old",
      "+new",
    ].join("\n");
    const m = parseAddedLines(patch);
    expect(m.get("supabase/migrations/a.sql")).toEqual(["CREATE POLICY p ON t", "-- note"]);
    expect(m.get("supabase/migrations/b.sql")).toEqual(["new"]);
  });

  it("runs on every pull request in CI, against the base branch", () => {
    const wf = readFileSync(".github/workflows/unit-lint.yml", "utf8");
    const step = wf.slice(wf.indexOf("Policy changes come with a SQL test"));
    expect(step).toMatch(/if: github\.event_name == 'pull_request'/);
    expect(step).toMatch(/POLICY_BASE: origin\/\$\{\{ github\.base_ref \}\}/);
    expect(step).toMatch(/run: node scripts\/policy-tests-gate\.mjs/);
  });
});
