import { describe, expect, it } from "vitest";
import { parseMaintenance, shouldBlockForMaintenance } from "./maintenance";

const on = { enabled: true, message: "" };

describe("app-only maintenance", () => {
  it("blocks regular users on app pages", () => {
    expect(shouldBlockForMaintenance(on, "/feed", false)).toBe(true);
    expect(shouldBlockForMaintenance(on, "/games/abc", false)).toBe(true);
  });
  it("never blocks staff", () => {
    expect(shouldBlockForMaintenance(on, "/feed", true)).toBe(false);
  });
  it("keeps SEO pages and sign-in open", () => {
    for (const p of ["/", "/guide/soccer", "/cities/atlanta/soccer", "/privacy", "/auth"]) {
      expect(shouldBlockForMaintenance(on, p, false)).toBe(false);
    }
  });
  it("does nothing when off or unset", () => {
    expect(shouldBlockForMaintenance(parseMaintenance(null), "/feed", false)).toBe(false);
  });
});
