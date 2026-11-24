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
  saveReminders: vi.fn(),
  waits: vi.fn(),
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
  saveDefaultRemindersOnAccept: env.saveReminders,
  acceptWaitsForGuardian: env.waits,
  gameInviteErrorMessage: () => "nope",
}));

import { GameInvitationsSection } from "./GameInvitationsSection";

beforeEach(() => {
  env.respond.mockReset();
  env.saveReminders.mockReset();
  env.saveReminders.mockResolvedValue(undefined);
  env.waits.mockReset();
  env.waits.mockResolvedValue(false);
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

  it("sends a player with a payment still to come (not held for a guardian) to the game", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: false });
    expect(await accept()).toBe("You're in. Open the game to finish joining.");
  });

  it("keeps today's copy when the server does not say (the function before 20261127120000)", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr" });
    expect(await accept()).toBe("You're in. Open the game to finish joining.");
  });

  it("says the place waits for the parent when the accept is held for the guardian", async () => {
    const res = { status: "accepted", join_request_id: "jr", on_roster: false };
    env.respond.mockResolvedValue(res);
    env.waits.mockResolvedValue(true);
    const words = await accept();
    expect(words).toBe("Invitation accepted. Your parent has to approve before you're in.");
    expect(env.waits).toHaveBeenCalledWith(res, "me");
    expect(await screen.findByText("Open the game")).toBeTruthy();
  });
});

describe("GameInvitationsSection accept while the held check is still reading", () => {
  it("shows the game link and frees the row at once; the words follow the check", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: false });
    let answer: (v: boolean) => void = () => {};
    env.waits.mockReturnValue(new Promise<boolean>((r) => (answer = r)));
    render(<GameInvitationsSection userId="me" refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(await screen.findByText("Open the game")).toBeTruthy();
    expect(env.toast.success).not.toHaveBeenCalled();
    answer(true);
    await waitFor(() =>
      expect(env.toast.success).toHaveBeenCalledWith(
        "Invitation accepted. Your parent has to approve before you're in.",
      ),
    );
  });
});

describe("GameInvitationsSection reminders (WP 5.4)", () => {
  it("saves the default reminders for the game once the player accepts", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: true });
    await accept();
    expect(env.saveReminders).toHaveBeenCalledTimes(1);
    expect(env.saveReminders).toHaveBeenCalledWith("g1");
  });

  it.each([["declined"], ["expired"], ["cancelled"]])(
    "saves no reminders when the answer is %s",
    async (status) => {
      env.respond.mockResolvedValue({ status });
      render(<GameInvitationsSection userId="me" refreshKey={0} />);
      fireEvent.click(
        await screen.findByRole("button", { name: status === "declined" ? "Decline" : "Accept" }),
      );
      await waitFor(() => expect(env.toast.success).toHaveBeenCalledTimes(1));
      expect(env.saveReminders).not.toHaveBeenCalled();
    },
  );

  it("saves no reminders when the game is full", async () => {
    env.respond.mockResolvedValue({ status: "full" });
    render(<GameInvitationsSection userId="me" refreshKey={0} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(env.toast.error).toHaveBeenCalledTimes(1));
    expect(env.saveReminders).not.toHaveBeenCalled();
  });

  it("a failed reminder save leaves the accept a success", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: true });
    env.saveReminders.mockRejectedValue(new Error("save failed"));
    expect(await accept()).toBe("You're in.");
    expect(env.saveReminders).toHaveBeenCalledWith("g1");
    await new Promise((r) => setTimeout(r, 0));
    expect(env.toast.error).not.toHaveBeenCalled();
    expect(await screen.findByText("Open the game")).toBeTruthy();
  });

  it("does not wait for the reminder save before telling the player they are in", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: true });
    env.saveReminders.mockReturnValue(new Promise(() => {}));
    expect(await accept()).toBe("You're in.");
  });
});
