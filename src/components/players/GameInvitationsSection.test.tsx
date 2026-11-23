// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The Players tab's game invitations. Accepting a free game's invitation with no guardian step puts the player on the
 * roster on the server (20261127120000, on_roster: true), so the toast says they are in and sends them nowhere; a paid
 * game or a guardian step still needs the game page, and so does the function before 20261127120000 (no on_roster).
 */
const env = vi.hoisted(() => ({
  respond: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: env.toast }));
vi.mock("@/lib/game-invites", () => ({
  listMyPendingGameInvites: async () => [
    {
      id: "inv1",
      game_id: "g1",
      host_id: "host",
      invitee_id: "me",
      availability_id: null,
      message: null,
      status: "pending",
      join_request_id: null,
      created_at: "",
      responded_at: null,
      game: null,
    },
  ],
  respondToGameInvite: env.respond,
  gameInviteErrorMessage: () => "nope",
}));

import { GameInvitationsSection } from "./GameInvitationsSection";

beforeEach(() => {
  env.respond.mockReset();
  env.toast.success.mockReset();
  env.toast.error.mockReset();
});
afterEach(() => cleanup());

async function accept() {
  render(<GameInvitationsSection userId="me" refreshKey={0} />);
  fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
  await waitFor(() => expect(env.toast.success).toHaveBeenCalledTimes(1));
  expect(env.respond).toHaveBeenCalledWith("inv1", true);
  return String(env.toast.success.mock.calls[0]![0]);
}

describe("GameInvitationsSection accept", () => {
  it("tells a player the server put on the roster that they are in", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: true });
    expect(await accept()).toBe("You're in.");
  });

  it("sends a player with a payment or a guardian step still to come to the game", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: false });
    expect(await accept()).toBe("You're in. Open the game to finish joining.");
  });

  it("keeps today's copy when the server does not say (the function before 20261127120000)", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr" });
    expect(await accept()).toBe("You're in. Open the game to finish joining.");
  });
});
