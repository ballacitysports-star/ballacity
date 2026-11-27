// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The roster row's Remove (a player with an approved request): one host_remove_player call (hostRemovePlayer, which
 * retries a deadlock once), no PATCH of the request and no DELETE of the roster row of its own, and then, as before,
 * the player's "Removed from" notice and the host's toast. A failure puts the row back. Remove and block goes through
 * the same host_remove_player call (so the removal is recorded in game_removals), then the notice, then the account
 * block. Only a failed removal puts the row back and skips the block; a failed block after the removal does not.
 */
const env = vi.hoisted(() => ({
  writes: [] as string[],
  hostRemovePlayer: vi.fn(async (): Promise<{ code?: string; message?: string } | null> => null),
  reviewJoinRequest: vi.fn(async () => undefined),
  createNotification: vi.fn(async () => undefined),
  blockPlayer: vi.fn(async () => undefined),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: env.toast }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
  useNavigate: () => () => undefined,
}));
vi.mock("@/lib/reviews-db", () => ({ useReviewsFor: () => [] }));
vi.mock("@/lib/game-payment-channel", () => ({ subscribeGamePaymentChanges: () => () => {} }));
vi.mock("@/lib/managed-profile-names", () => ({
  fetchProfileNameBits: async () => ({
    display_name: "Pat",
    avatar_initials: "PA",
    avatar_url: null,
  }),
  withManagedProfileNames: async (rows: unknown) => rows,
}));
vi.mock("@/components/UserAvatar", () => ({ UserAvatar: () => <span /> }));
vi.mock("@/lib/payments", () => ({
  hostRemovePlayer: env.hostRemovePlayer,
  reviewJoinRequest: env.reviewJoinRequest,
  getSignedProofUrl: async () => null,
}));
vi.mock("@/lib/payments.functions", () => ({ reviewPaymentAction: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: env.createNotification }));
vi.mock("@/components/game-detail/game-player-actions", () => ({ blockPlayer: env.blockPlayer }));
vi.mock("@/lib/messages", () => ({ getOrCreateDirectConversation: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  // Reads answer nothing; any write is recorded (the Remove must send none of its own).
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "limit", "in"]) b[m] = () => b;
    b.maybeSingle = async () => ({ data: null, error: null });
    b.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    for (const m of ["update", "delete", "insert", "upsert"]) {
      b[m] = () => {
        env.writes.push(`${m} ${table}`);
        return b;
      };
    }
    return b;
  };
  return { supabase: { from: builder, rpc: vi.fn() } };
});

import { RosterPlayerRow } from "./RosterPlayerRow";

const req = {
  id: "r1",
  game_id: "g1",
  player_id: "p1",
  host_id: "h1",
  status: "approved",
  message: null,
  reviewer_notes: null,
  created_at: "2026-11-20T10:00:00Z",
  reviewed_at: "2026-11-20T11:00:00Z",
} as never;

function renderRow(onOptimistic = vi.fn(() => vi.fn())) {
  render(
    <RosterPlayerRow
      req={req}
      gameTitle="Sunday Run"
      feeRequired={false}
      fee={0}
      holdMinutes={null}
      gameStartsAt="2026-12-01T18:00:00Z"
      onOptimistic={onOptimistic}
    />,
  );
  return onOptimistic;
}

beforeEach(() => {
  env.writes.length = 0;
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("RosterPlayerRow: Remove", () => {
  it("removes through one host_remove_player call, then tells the player and the host", async () => {
    const onOptimistic = renderRow();
    await screen.findByText("Pat");
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(env.toast.success).toHaveBeenCalledWith("Pat removed."));
    expect(onOptimistic).toHaveBeenCalledWith("r1", "rejected");
    expect(env.hostRemovePlayer).toHaveBeenCalledTimes(1);
    expect(env.hostRemovePlayer).toHaveBeenCalledWith("g1", "p1");
    // No request PATCH and no roster DELETE of its own, and no payment residue deleted.
    expect(env.reviewJoinRequest).not.toHaveBeenCalled();
    expect(env.writes).toEqual([]);
    expect(env.createNotification).toHaveBeenCalledWith({
      user_id: "p1",
      type: "join_declined",
      title: "Removed from Sunday Run",
      body: "The host removed you from this game.",
      link: "/games/g1",
    });
  });

  it("puts the row back and says so when the removal fails", async () => {
    const rollback = vi.fn();
    env.hostRemovePlayer.mockResolvedValueOnce({
      code: "42501",
      message: "NOT_GAME_HOST: only the game's host can remove players from it.",
    });
    renderRow(vi.fn(() => rollback));
    await screen.findByText("Pat");
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(env.toast.error).toHaveBeenCalled());
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(env.createNotification).not.toHaveBeenCalled();
    expect(env.toast.success).not.toHaveBeenCalled();
  });

  it("asks first, and does nothing when the host says no", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderRow();
    await screen.findByText("Pat");
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(env.hostRemovePlayer).not.toHaveBeenCalled();
  });

  it("removes and blocks through one host_remove_player call, with no writes of its own", async () => {
    const onOptimistic = renderRow();
    await screen.findByText("Pat");
    fireEvent.click(screen.getByRole("button", { name: /^block$/i }));
    await waitFor(() => expect(env.blockPlayer).toHaveBeenCalledWith("p1", "Pat", "removed"));
    expect(onOptimistic).toHaveBeenCalledWith("r1", "rejected");
    expect(env.hostRemovePlayer).toHaveBeenCalledTimes(1);
    expect(env.hostRemovePlayer).toHaveBeenCalledWith("g1", "p1");
    // No "Blocked by host" PATCH of the request and no roster DELETE from the client.
    expect(env.reviewJoinRequest).not.toHaveBeenCalled();
    expect(env.writes).toEqual([]);
    expect(env.createNotification).toHaveBeenCalledWith({
      user_id: "p1",
      type: "join_declined",
      title: "Removed from Sunday Run",
      body: "The host removed you from this game.",
      link: "/games/g1",
    });
  });

  it("removes first, then tells the player, then blocks", async () => {
    renderRow();
    await screen.findByText("Pat");
    fireEvent.click(screen.getByRole("button", { name: /^block$/i }));
    await waitFor(() => expect(env.blockPlayer).toHaveBeenCalledTimes(1));
    const removed = env.hostRemovePlayer.mock.invocationCallOrder[0];
    const notified = env.createNotification.mock.invocationCallOrder[0];
    const blocked = env.blockPlayer.mock.invocationCallOrder[0];
    expect(removed).toBeLessThan(notified);
    expect(notified).toBeLessThan(blocked);
  });

  it("puts the row back and blocks no one when the removal behind Block fails", async () => {
    const rollback = vi.fn();
    // A plain failure with no catalog sentence, so the removal's own wording shows.
    env.hostRemovePlayer.mockResolvedValueOnce({ message: "something broke" });
    renderRow(vi.fn(() => rollback));
    await screen.findByText("Pat");
    fireEvent.click(screen.getByRole("button", { name: /^block$/i }));
    await waitFor(() =>
      expect(env.toast.error).toHaveBeenCalledWith(
        "Couldn't remove this player. Please try again.",
      ),
    );
    expect(rollback).toHaveBeenCalledTimes(1);
    expect(env.blockPlayer).not.toHaveBeenCalled();
    expect(env.createNotification).not.toHaveBeenCalled();
  });

  it("keeps the removal when the block after it fails", async () => {
    const rollback = vi.fn();
    // blockPlayer reports its own failure ("Removed, but couldn't block", game-player-actions.test.ts); a throw from it
    // must not undo the committed removal either.
    env.blockPlayer.mockRejectedValueOnce(new Error("boom"));
    renderRow(vi.fn(() => rollback));
    await screen.findByText("Pat");
    fireEvent.click(screen.getByRole("button", { name: /^block$/i }));
    await waitFor(() => expect(env.toast.error).toHaveBeenCalledTimes(1));
    expect(env.toast.error.mock.calls[0][0]).toMatch(/^Removed, but couldn't block Pat\. /);
    expect(env.hostRemovePlayer).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
    expect(env.toast.error).not.toHaveBeenCalledWith(
      "Couldn't remove this player. Please try again.",
    );
  });
});
