import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTES, isPublicForViewer } from "./root-gate";

const signedOut = (p: string) => isPublicForViewer(p, false);
const signedIn = (p: string) => isPublicForViewer(p, true);

describe("root gates: which pages skip sign-in, age and account-type checks", () => {
  it("lets anyone open the landing page, legal and safety pages, and auth", () => {
    for (const p of [
      "/",
      "/auth",
      "/terms",
      "/privacy",
      "/youth-policy",
      "/safety",
      "/trust-center",
    ]) {
      expect(signedOut(p), p).toBe(true);
      expect(signedIn(p), p).toBe(true);
    }
  });

  it("covers sub-pages of a public route, but not look-alike paths", () => {
    expect(signedOut("/guide/basketball")).toBe(true);
    expect(signedOut("/tryouts/123")).toBe(true);
    expect(signedOut("/termsx")).toBe(false);
    expect(signedOut("/authorize")).toBe(false);
    expect(signedOut("/tryoutsadmin")).toBe(false);
  });

  it("keeps account, money, family and admin pages behind sign-in", () => {
    for (const p of [
      "/settings",
      "/profile/edit",
      "/parent",
      "/payments",
      "/messages/abc",
      "/notifications",
      "/host",
      "/admin",
      "/superadmin",
      "/account/data",
      "/games/g1/pay",
      "/teams/t1/manage",
      "/teams/create",
      "/coach",
    ]) {
      expect(signedOut(p), p).toBe(false);
      expect(signedIn(p), p).toBe(false);
    }
  });

  it("gives a signed-out visitor the public game, team and tab previews", () => {
    for (const p of [
      "/games/g1",
      "/teams/t1",
      "/trainers/x",
      "/orgs",
      "/orgs/o1",
      "/feed",
      "/profile",
    ]) {
      expect(signedOut(p), p).toBe(true);
    }
  });

  it("sends a signed-in member through the age and account-type steps on those same pages", () => {
    for (const p of ["/games/g1", "/teams/t1", "/feed", "/profile"]) {
      expect(signedIn(p), p).toBe(false);
    }
  });

  it("opens one shared reel page, never the reel studio", () => {
    expect(signedOut("/reels/r1")).toBe(true);
    expect(signedOut("/reels")).toBe(true); // the signed-out tab preview
    expect(signedIn("/reels")).toBe(false);
    expect(signedIn("/reels/r1")).toBe(true);
    expect(signedOut("/reels/r1/edit")).toBe(false);
  });

  it("every listed public route starts with a slash and has no trailing slash", () => {
    for (const p of PUBLIC_ROUTES) {
      expect(p.startsWith("/"), p).toBe(true);
      if (p !== "/") expect(p.endsWith("/"), p).toBe(false);
    }
  });

  it("no sensitive area is ever added to the public list", () => {
    const sensitive =
      /^\/(settings|account|parent|payments|admin|superadmin|host|messages|notifications|manage)\b/;
    expect(PUBLIC_ROUTES.filter((p) => sensitive.test(p))).toEqual([]);
  });
});
