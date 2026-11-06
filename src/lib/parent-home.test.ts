import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Route as GuardianRoute } from "@/routes/guardian";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

/**
 * One home for parents (P1-8): the Guardian Dashboard now lives inside the Parent Center.
 * /guardian is still linked from emails, notifications and pushes, so it must keep
 * working as a redirect to that section.
 */
describe("parent home", () => {
  it("/guardian redirects to the Parent Center's activity section", () => {
    let thrown: unknown;
    try {
      (GuardianRoute.options.beforeLoad as () => void)();
    } catch (e) {
      thrown = e;
    }
    const opts = (thrown as { options?: { to?: string; hash?: string } })?.options;
    expect(opts?.to).toBe("/parent");
    expect(opts?.hash).toBe("activity");
  });

  it("the Parent Center shows the children's activity section", () => {
    const src = read("routes/parent.index.tsx");
    expect(src).toMatch(/<ChildrenActivitySection \/>/);
    expect(src).not.toMatch(/to="\/guardian"/);
  });

  it("the section anchors at #activity", () => {
    expect(read("components/child/ChildrenActivitySection.tsx")).toMatch(/id="activity"/);
  });
});
