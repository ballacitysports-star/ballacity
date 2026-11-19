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
}));

vi.mock("sonner", () => ({ toast: env.toast }));
vi.mock("@/lib/game-invites", () => ({
  listGameInvitesForGame: async () => env.invites,
  inviteeNames: async (ids: string[]) =>
    Object.fromEntries(ids.map((id) => [id, id === "u1" ? "Ana" : id === "u2" ? "Ben" : "Player"])),
  invitePlayersToGame: env.bulk,
  cancelGameInvite: env.cancel,
  gameInviteErrorMessage: () => "nope",
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
});
