// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WP 2.1: the host's invitations on the game page. The invited list with answers and Withdraw; "Invite nearby" lists the
 * players available near the game, with those already invited or on the roster greyed out, and invites the picked ones in
 * one call with an optional note.
 */
const env = vi.hoisted(() => ({
  invites: [] as Record<string, unknown>[],
  nearby: [] as Record<string, unknown>[],
  bulk: vi.fn(),
  cancel: vi.fn(async () => "cancelled"),
  near: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  regulars: [] as Record<string, unknown>[],
  groups: [] as { id: string; name: string; memberIds: string[] }[],
  deleteGroup: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: env.toast }));
vi.mock("@/lib/game-invites", () => ({
  listGameInvitesForGame: async () => env.invites,
  inviteeNames: async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, id === "u1" ? "Ana" : id === "u2" ? "Ben" : "Player"])),
  invitePlayersToGame: env.bulk,
  cancelGameInvite: env.cancel,
  gameInviteErrorMessage: () => "nope",
  listRegularPlayers: async () => env.regulars,
}));
vi.mock("@/lib/host-groups", () => ({
  GROUP_NAME_MAX: 60,
  groupNameError: () => null,
  createHostGroup: vi.fn(),
  listMyHostGroups: async () => env.groups,
  deleteHostGroup: env.deleteGroup,
}));
vi.mock("@/lib/availability", () => ({
  listAvailabilityNear: (q: unknown) => {
    env.near(q);
    return Promise.resolve(env.nearby);
  },
}));

import { GameInvitesPanel } from "./GameInvitesPanel";

const FUTURE = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
const game = (over: Record<string, unknown> = {}) =>
  ({
    id: "g1",
    title: "Thursday run",
    sport: "Basketball",
    date: FUTURE,
    duration: "90 min",
    lat: 34.12,
    lng: -84.0,
    ...over,
  }) as never;
const inv = (id: string, invitee: string, status: string) => ({
  id,
  game_id: "g1",
  host_id: "host",
  invitee_id: invitee,
  availability_id: null,
  message: null,
  status,
  join_request_id: null,
  created_at: "",
  responded_at: null,
});
const person = (user: string, name: string, mi: number) => ({
  id: `post-${user}`,
  user_id: user,
  author_name: name,
  distance_mi: mi,
  skill_level: "Intermediate",
});

function show(g = game(), rosterIds: string[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GameInvitesPanel game={g} hostId="host" rosterIds={rosterIds} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  env.invites = [];
  env.nearby = [];
  env.bulk.mockReset();
  env.near.mockReset();
  env.cancel.mockClear();
  env.toast.success.mockClear();
  env.toast.error.mockClear();
  env.regulars = [];
  env.groups = [];
  env.deleteGroup.mockReset();
});
afterEach(() => cleanup());

describe("GameInvitesPanel", () => {
  it("lists the invited players with their answers, and withdraws a waiting one", async () => {
    env.invites = [inv("i1", "u1", "pending"), inv("i2", "u2", "accepted")];
    show();
    expect(await screen.findByText("1 waiting · 1 accepted")).toBeTruthy();
    const ana = screen.getByText("Ana").closest("li")!;
    expect(within(ana).getByText("Waiting")).toBeTruthy();
    expect(within(screen.getByText("Ben").closest("li")!).getByText("Accepted")).toBeTruthy();
    expect(within(screen.getByText("Ben").closest("li")!).queryByRole("button")).toBeNull();
    fireEvent.click(within(ana).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(env.cancel).toHaveBeenCalledWith("i1"));
  });

  it("invites the picked players nearby in one call, with the note", async () => {
    env.invites = [inv("i1", "u1", "pending")];
    env.nearby = [
      person("u1", "Ana", 1),
      person("u3", "Cal", 2),
      person("u4", "Dee", 5),
      person("u5", "Eve", 3),
    ];
    env.bulk.mockResolvedValue({ invited: 2, skipped: {} });
    show(game(), ["u5"]);
    fireEvent.click(await screen.findByRole("button", { name: /Invite nearby/ }));
    await screen.findByText("Cal");
    expect(env.near).toHaveBeenCalledWith(
      expect.objectContaining({
        lat: 34.12,
        lng: -84.0,
        sport: "Basketball",
        radiusMi: 25,
        limit: 30,
      }),
    );
    expect(
      (screen.getByRole("checkbox", { name: "Invite Ana" }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "Invite Eve" }) as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.getByText("On the roster")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Invite Cal" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Invite Dee" }));
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "Need a guard" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite 2 players" }));
    await waitFor(() => expect(env.bulk).toHaveBeenCalledWith("g1", ["u3", "u4"], "Need a guard"));
    expect(env.toast.success).toHaveBeenCalledWith("Invited 2 players.");
  });

  it("says so when no one nearby has posted for this time", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Invite nearby/ }));
    expect(await screen.findByText(/No one nearby has posted availability/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Pick players to invite" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("a game without a mapped place cannot search, and says why", async () => {
    show(game({ lat: null, lng: null }));
    expect(await screen.findByText(/Add the game's address/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: /Invite nearby/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("nothing for a game that has started", () => {
    const { container } = show(game({ date: new Date(Date.now() - 60_000).toISOString() }));
    expect(container.innerHTML).toBe("");
  });

  describe("Delete group (WP 4.3)", () => {
    const regular = (user: string) => ({
      user_id: user,
      games: 3,
      last_played: "2026-11-01T18:00:00Z",
      status: "available",
    });

    async function openGroup() {
      env.regulars = [regular("u1"), regular("u2")];
      env.groups = [{ id: "grp1", name: "Tuesday crew", memberIds: ["u1"] }];
      show();
      fireEvent.click(await screen.findByRole("button", { name: /Invite regulars/ }));
      fireEvent.click(await screen.findByRole("button", { name: "Tuesday crew" }));
      return screen.getByRole("button", { name: "Delete group" });
    }

    it("is a 44px target, and asks before deleting; Keep it deletes nothing", async () => {
      const del = await openGroup();
      expect(del.className).toContain("min-h-11");
      fireEvent.click(del);
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText("Delete “Tuesday crew”?")).toBeTruthy();
      expect(env.deleteGroup).not.toHaveBeenCalled();
      const keep = within(dialog).getByRole("button", { name: "Keep it" });
      expect(keep.className).toContain("min-h-11");
      fireEvent.click(keep);
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(env.deleteGroup).not.toHaveBeenCalled();
      // Focus goes back to the button that opened the dialog, not to <body>.
      await waitFor(() => expect(document.activeElement).toBe(del));
    });

    it("deletes the group once confirmed", async () => {
      env.deleteGroup.mockResolvedValue(undefined);
      fireEvent.click(await openGroup());
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
      await waitFor(() => expect(env.deleteGroup).toHaveBeenCalledWith("grp1"));
      await waitFor(() =>
        expect(env.toast.success).toHaveBeenCalledWith("Deleted “Tuesday crew”."),
      );
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      // "Delete group" is gone with the group, so focus lands on "All regulars", inside the sheet.
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "All regulars" })),
      );
    });

    it("a failed delete says so in plain words and keeps the dialog open", async () => {
      env.deleteGroup.mockRejectedValue(new Error("permission denied for table host_groups"));
      fireEvent.click(await openGroup());
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
      await waitFor(() => expect(env.toast.error).toHaveBeenCalledTimes(1));
      const shown = String(env.toast.error.mock.calls[0][0]);
      expect(shown).not.toMatch(/permission denied|host_groups/);
      expect(screen.getByRole("alertdialog")).toBeTruthy();
      expect(env.toast.success).not.toHaveBeenCalled();
      // Focus stayed in the dialog while the delete ran (the button was never disabled under it).
      expect(screen.getByRole("alertdialog").contains(document.activeElement)).toBe(true);
    });
  });
});
