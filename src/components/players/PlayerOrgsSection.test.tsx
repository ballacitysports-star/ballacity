// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";

/**
 * The org chips on a player's profile follow the player's memberships live.
 * Realtime delivers a membership DELETE with only the row id and without
 * applying the user_id filter, so the section has to recognise its own rows.
 */

type Change = { eventType: string; new: unknown; old: unknown };
type Binding = {
  filter: { event: string; table: string; filter?: string };
  cb: (p: Change) => void;
};

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; org_id: string; role: string; org: unknown }>,
  reads: 0,
  bindings: [] as Array<{
    filter: { event: string; table: string; filter?: string };
    cb: (p: { eventType: string; new: unknown; old: unknown }) => void;
  }>,
  opened: [] as Array<{ name: string; options: unknown }>,
  status: undefined as undefined | ((status: string) => void),
  // When set, each read waits for this before answering, so a test can order the answers.
  gate: null as null | ((n: number) => Promise<void>),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: (_type: string, filter: Binding["filter"], cb: Binding["cb"]) => {
      h.bindings.push({ filter, cb });
      return channel;
    },
    subscribe: (cb?: (status: string) => void) => {
      h.status = cb;
      return channel;
    },
  };
  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: async () => {
            h.reads += 1;
            const n = h.reads;
            const data = h.rows.map((r) => ({ ...r }));
            if (h.gate) await h.gate(n);
            return { data, error: null };
          },
        }),
      }),
      channel: (name: string, options?: unknown) => {
        h.opened.push({ name, options });
        return channel;
      },
      removeChannel: () => {},
    },
  };
});

const { PlayerOrgsSection } = await import("./PlayerOrgsSection");

const org = (name: string) => ({
  id: `org-${name}`,
  name,
  handle: null,
  avatar: null,
  city: null,
  verified: false,
});

/** Deliver a change to every listener registered for that event and table. */
function deliver(table: string, change: Change, opts: { filtered: boolean }) {
  act(() => {
    for (const b of h.bindings) {
      if (b.filter.table !== table) continue;
      if (b.filter.event !== "*" && b.filter.event !== change.eventType) continue;
      if (!!b.filter.filter !== opts.filtered) continue;
      b.cb(change);
    }
  });
}

afterEach(() => {
  cleanup();
  h.rows = [];
  h.reads = 0;
  h.bindings = [];
  h.opened = [];
  h.status = undefined;
  h.gate = null;
});

describe("PlayerOrgsSection", () => {
  it("drops the chip when the membership is deleted, though the DELETE carries only its id", async () => {
    h.rows = [{ id: "m1", org_id: "org-Acme", role: "member", org: org("Acme Gym") }];
    render(<PlayerOrgsSection userId="u2" />);
    expect(await screen.findByText("Acme Gym")).toBeTruthy();

    h.rows = [];
    // Realtime: no user_id filter applied, `old` is the primary key only.
    deliver(
      "trainer_org_members",
      { eventType: "DELETE", new: {}, old: { id: "m1" } },
      {
        filtered: false,
      },
    );
    await waitFor(() => expect(screen.queryByText("Acme Gym")).toBeNull());
  });

  it("ignores another member's row being deleted", async () => {
    h.rows = [{ id: "m1", org_id: "org-Acme", role: "member", org: org("Acme Gym") }];
    render(<PlayerOrgsSection userId="u2" />);
    await screen.findByText("Acme Gym");
    const readsBefore = h.reads;

    deliver(
      "trainer_org_members",
      { eventType: "DELETE", new: {}, old: { id: "other" } },
      {
        filtered: false,
      },
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(h.reads).toBe(readsBefore);
    expect(screen.getByText("Acme Gym")).toBeTruthy();
  });

  it("shows a new membership delivered through the user filter", async () => {
    render(<PlayerOrgsSection userId="u2" />);
    await waitFor(() => expect(h.reads).toBe(1));

    h.rows = [{ id: "m2", org_id: "org-Peak", role: "member", org: org("Peak Training") }];
    deliver(
      "trainer_org_members",
      { eventType: "INSERT", new: { id: "m2", user_id: "u2" }, old: {} },
      { filtered: true },
    );
    expect(await screen.findByText("Peak Training")).toBeTruthy();
  });

  it("opens its channel holding SUBSCRIBED until the changes are live", () => {
    render(<PlayerOrgsSection userId="u2" />);
    expect(h.opened).toStrictEqual([
      { name: "player-orgs:u2", options: { config: { postgres_changes_options: { wait: true } } } },
    ]);
  });

  it("reads the memberships again on every SUBSCRIBED, the first included", async () => {
    render(<PlayerOrgsSection userId="u2" />);
    await waitFor(() => expect(h.reads).toBe(1));

    // A membership added after the read on mount, before the changes were live.
    h.rows = [{ id: "m3", org_id: "org-Peak", role: "member", org: org("Peak Training") }];
    act(() => h.status?.("SUBSCRIBED"));
    expect(await screen.findByText("Peak Training")).toBeTruthy();
    expect(h.reads).toBe(2);

    act(() => h.status?.("CHANNEL_ERROR"));
    await new Promise((r) => setTimeout(r, 10));
    expect(h.reads).toBe(2);

    act(() => h.status?.("SUBSCRIBED"));
    await waitFor(() => expect(h.reads).toBe(3));
  });

  it("keeps the newest read's answer when an older read answers after it", async () => {
    const release: Array<() => void> = [];
    h.gate = (n) => new Promise<void>((r) => (release[n] = r));
    h.rows = [{ id: "m1", org_id: "org-Acme", role: "member", org: org("Acme Gym") }];
    render(<PlayerOrgsSection userId="u2" />);
    await waitFor(() => expect(h.reads).toBe(1));

    h.rows = [{ id: "m2", org_id: "org-Peak", role: "member", org: org("Peak Training") }];
    act(() => h.status?.("SUBSCRIBED"));
    await waitFor(() => expect(h.reads).toBe(2));

    // The catch-up answers first, then the read on mount, with the older list.
    await act(async () => release[2]());
    expect(await screen.findByText("Peak Training")).toBeTruthy();
    await act(async () => release[1]());
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByText("Peak Training")).toBeTruthy();
    expect(screen.queryByText("Acme Gym")).toBeNull();
  });
});
