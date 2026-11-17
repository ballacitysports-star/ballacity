// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { usePersistedSearch } from "@/hooks/use-persisted-search";

/**
 * The contract the Players/Teams/Trainers tabs (and their E2E spec) rely on:
 * the saved filter is in the URL as soon as the page has mounted, and the
 * saved snapshot is never overwritten with the defaults on the way.
 */

const KEY = "openrun:test-search";
const DEFAULTS = { q: "", sport: "", view: "list" };
const SAVED = { q: "", sport: "Basketball", view: "list" };

let writes: string[] = [];
const realSetItem = Storage.prototype.setItem;

beforeEach(() => {
  writes = [];
  Storage.prototype.setItem = function (k: string, v: string) {
    if (k === KEY) writes.push(v);
    return realSetItem.call(this, k, v);
  };
});

afterEach(() => {
  cleanup();
  Storage.prototype.setItem = realSetItem;
  localStorage.clear();
});

/** A /players-like route whose page mounts only once `ready` (the auth gate) opens. */
function mountAt(url: string) {
  let setReady: (v: boolean) => void = () => {};
  const root = createRootRoute({ component: () => <Outlet /> });
  const page = createRoute({
    getParentRoute: () => root,
    path: "/players",
    validateSearch: (s: Record<string, unknown>) => ({
      q: typeof s.q === "string" ? s.q : "",
      sport: typeof s.sport === "string" ? s.sport : "",
      view: typeof s.view === "string" ? s.view : "list",
    }),
    component: function Gate() {
      const [ready, set] = useState(false);
      setReady = set;
      return ready ? <Page /> : <p>Loading…</p>;
    },
  });
  function Page() {
    // The route is not in the app's registered tree, so its search type is not inferred.
    const search = page.useSearch() as typeof DEFAULTS;
    usePersistedSearch(KEY, search, "/players", DEFAULTS);
    return <output>{search.sport}</output>;
  }
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(<RouterProvider router={router} />);
  return { router, open: (v: boolean) => act(async () => setReady(v)) };
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await act(() => new Promise((r) => setTimeout(r, 0)));
};
const urlSport = (router: ReturnType<typeof mountAt>["router"]) =>
  new URLSearchParams(router.history.location.search).get("sport");

describe("usePersistedSearch", () => {
  it("puts the saved filter in the URL when the page mounts, and keeps it saved", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, s: SAVED }));
    const { router, open } = mountAt("/players");
    await settle();
    await open(true);
    // Restored in the mount's layout effect: in the URL as soon as the page is up.
    expect(urlSport(router)).toBe("Basketball");
    await settle();
    expect(urlSport(router)).toBe("Basketball");
    expect(writes.map((w) => JSON.parse(w).s.sport)).not.toContain("");
    expect(JSON.parse(localStorage.getItem(KEY)!).s.sport).toBe("Basketball");
  });

  it("lets an explicit link win over the saved filter", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, s: SAVED }));
    const { router, open } = mountAt("/players?sport=Soccer");
    await settle();
    await open(true);
    await settle();
    expect(urlSport(router)).toBe("Soccer");
    expect(JSON.parse(localStorage.getItem(KEY)!).s.sport).toBe("Soccer");
  });

  it("keeps the restore through a router reload and a remount while it lands", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, s: SAVED }));
    const { router, open } = mountAt("/players");
    await settle();
    // The root's SIGNED_IN handler calls router.invalidate(); the auth gate can
    // close and reopen. Neither may drop the restored sport or save the defaults.
    await act(async () => {
      void router.invalidate();
    });
    await open(true);
    await open(false);
    await open(true);
    await settle();
    expect(urlSport(router)).toBe("Basketball");
    expect(writes.map((w) => JSON.parse(w).s.sport)).not.toContain("");
    expect(JSON.parse(localStorage.getItem(KEY)!).s.sport).toBe("Basketball");
  });
});
