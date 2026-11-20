import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AVAILABILITY_POST_RETURN, validateProfileEditSearch } from "./profile-return";

/**
 * WP 4.1: "Complete my profile" returns to posting through `returnTo` on /profile/edit. Only a path on this site may
 * come through: anything else is dropped and Done goes to the profile as before.
 */
describe("returnTo on /profile/edit", () => {
  it("keeps an internal path, including the way back to posting", () => {
    expect(validateProfileEditSearch({ returnTo: AVAILABILITY_POST_RETURN })).toEqual({
      returnTo: "/availability?compose=quick",
    });
    expect(validateProfileEditSearch({ returnTo: "/feed" })).toEqual({ returnTo: "/feed" });
  });

  it("drops anything that could leave the site or loop through sign-in", () => {
    for (const returnTo of [
      "https://evil.example/x",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/.//evil.example",
      "javascript:alert(1)",
      "availability",
      "/auth?next=/feed",
      "/reset-password",
      "/",
      "",
      42,
      null,
      undefined,
    ]) {
      expect(validateProfileEditSearch({ returnTo })).toEqual({});
    }
    expect(validateProfileEditSearch({})).toEqual({});
  });

  it("the edit screen validates with it, still saves before leaving, and falls back to the profile", () => {
    const src = readFileSync("src/routes/profile.edit.tsx", "utf8");
    expect(src).toContain("validateSearch: validateProfileEditSearch,");
    expect(src).toContain(
      'const leave = () => (returnTo ? nav({ href: returnTo }) : nav({ to: "/profile" }));',
    );
    // Done waits for the autosave and stops on a failed save before it leaves.
    const done = src.slice(src.indexOf("const done = async"), src.indexOf("const goBack"));
    expect(done.indexOf("await autosave.flush()")).toBeGreaterThan(-1);
    expect(done.indexOf("if (!ok)")).toBeLessThan(done.indexOf("void leave();"));
  });
});
