// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { authSearchFor, useAuthSearchHere } from "@/lib/auth-return";

afterEach(cleanup);

describe("authSearchFor", () => {
  it("returns to the page, keeping its query and hash", () => {
    expect(authSearchFor("/trainers/t1?tab=book#slots")).toEqual({
      next: "/trainers/t1?tab=book#slots",
    });
    expect(authSearchFor("/player-card/u1")).toEqual({ next: "/player-card/u1" });
  });

  it.each([
    "/onboarding",
    "/onboarding/age",
    "/onboarding/account-type?type=player",
    "/onboarding/welcome",
    "/Onboarding/child",
  ])("does not return to the onboarding step %j", (href) => {
    expect(authSearchFor(href)).toEqual({});
  });

  it.each(["/", "/auth", "/auth?next=/feed", "/reset-password", undefined, ""])(
    "gives no next for %j",
    (href) => {
      expect(authSearchFor(href)).toEqual({});
    },
  );

  it.each([
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "javascript:alert(1)",
    "%2F%2Fevil.com",
  ])("gives no next for the crafted %j", (href) => {
    expect(authSearchFor(href)).toEqual({});
  });
});

/** Mounts a real router at `url` and shows what the hook returns there. */
function renderAt(url: string) {
  function Probe() {
    return <output>{JSON.stringify(useAuthSearchHere())}</output>;
  }
  const router = createRouter({
    routeTree: createRootRoute({ component: Probe }),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(<RouterProvider router={router} />);
}

describe("useAuthSearchHere", () => {
  it("is the current path with its query and hash", async () => {
    renderAt("/trainers/t1?tab=book#slots");
    const out = await screen.findByRole("status");
    expect(JSON.parse(out.textContent!)).toEqual({ next: "/trainers/t1?tab=book#slots" });
  });

  it("is empty on an onboarding step", async () => {
    renderAt("/onboarding/age");
    const out = await screen.findByRole("status");
    expect(JSON.parse(out.textContent!)).toEqual({});
  });
});
