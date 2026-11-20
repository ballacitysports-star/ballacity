// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

/**
 * WP 4.1, links into My availability & invitations, run through the real routes in a real router rather than read from
 * source:
 * - `/players?tab=mine` (the old "Mine" tab) redirects to /availability. Every `availability_reconfirm` notification
 *   links there (supabase/migrations/20261118100000_availability_expiry_job.sql writes `link = '/players?tab=mine'`).
 * - Profile edit leaves through `nav({ href: returnTo })`; `/availability?compose=quick` must reach the availability
 *   page's validateSearch as `{ compose: "quick" }`, which is what opens the quick sheet.
 */
// Importing the route pulls in modules that touch the client at load; nothing here calls it.
vi.mock("@/integrations/supabase/client", () => {
  const inert: unknown = new Proxy(function () {}, {
    get: (_t, key) => (key === "then" ? undefined : inert),
    apply: () => inert,
  });
  return { supabase: inert };
});

import { Route as PlayersRoute } from "@/routes/_tabs.players";
import { Route as AvailabilityRoute } from "@/routes/availability";
import { AVAILABILITY_POST_RETURN } from "@/lib/profile-return";

function routerAt(url: string) {
  const root = createRootRoute();
  // The same wiring routeTree.gen.ts gives it, under a bare root instead of the tabs layout.
  const players = PlayersRoute.update({
    id: "/players",
    path: "/players",
    getParentRoute: () => root,
  } as never);
  const availability = AvailabilityRoute.update({
    id: "/availability",
    path: "/availability",
    getParentRoute: () => root,
  } as never);
  const home = createRoute({ getParentRoute: () => root, path: "/" });
  const routeTree = root.addChildren([players as never, availability as never, home]);
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
}

describe("/players?tab=mine", () => {
  it("lands on /availability (the reconfirm notification link)", async () => {
    const router = routerAt("/players?tab=mine");
    await router.load();
    expect(router.state.location.pathname).toBe("/availability");
    expect(router.state.location.search).not.toHaveProperty("tab");
  });

  it("the Browse list itself stays on /players", async () => {
    const router = routerAt("/players?tab=browse");
    await router.load();
    expect(router.state.location.pathname).toBe("/players");
  });

  it("plain /players stays on /players", async () => {
    const router = routerAt("/players");
    await router.load();
    expect(router.state.location.pathname).toBe("/players");
  });
});

describe("back to posting from profile edit", () => {
  it("href navigation to the return path keeps compose=quick for /availability", async () => {
    const router = routerAt("/");
    await router.load();
    await router.navigate({ href: AVAILABILITY_POST_RETURN });
    expect(router.state.location.pathname).toBe("/availability");
    expect(router.state.location.search).toEqual({ compose: "quick" });
  });

  it("the old Mine link arrives without a compose flag (no sheet opens by itself)", async () => {
    const router = routerAt("/players?tab=mine");
    await router.load();
    expect(router.state.location.search).toEqual({ compose: "" });
  });
});
