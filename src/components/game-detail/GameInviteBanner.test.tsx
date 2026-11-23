// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * WP 2.0: the invitation banner on a game page. Only the invitee sees it; Accept approves their place and refreshes the
 * page's status, Decline closes it, a full game keeps it open with a note, an ended or withdrawn one says so.
 */
const env = vi.hoisted(() => ({
  invite: null as Record<string, unknown> | null,
  respond: vi.fn(),
  saveReminders: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: env.toast }));
vi.mock("@/lib/game-invites", () => ({
  getGameInvite: async () => env.invite,
  respondToGameInvite: env.respond,
  saveDefaultRemindersOnAccept: env.saveReminders,
  gameInviteErrorMessage: () => "nope",
}));

import { GameInviteBanner } from "./GameInviteBanner";

const pending = (over: Record<string, unknown> = {}) => ({
  id: "inv1",
  game_id: "g1",
  host_id: "host",
  invitee_id: "me",
  availability_id: null,
  message: "Need a guard",
  status: "pending",
  join_request_id: null,
  created_at: "",
  responded_at: null,
  ...over,
});

beforeEach(() => {
  env.invite = pending();
  env.respond.mockReset();
  env.saveReminders.mockReset();
  env.saveReminders.mockResolvedValue(undefined);
  env.toast.error.mockReset();
  env.toast.success.mockReset();
});
afterEach(() => cleanup());

describe("GameInviteBanner", () => {
  it("the invitee accepts: the page re-reads its status", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr" });
    const onAnswered = vi.fn();
    render(<GameInviteBanner inviteId="inv1" viewerId="me" onAnswered={onAnswered} />);
    expect(await screen.findByText("“Need a guard”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    expect(env.respond).toHaveBeenCalledWith("inv1", true);
    expect(screen.queryByTestId("game-invite-banner")).toBeNull();
  });

  it("declining closes it", async () => {
    env.respond.mockResolvedValue({ status: "declined" });
    render(<GameInviteBanner inviteId="inv1" viewerId="me" onAnswered={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.queryByTestId("game-invite-banner")).toBeNull());
    expect(env.respond).toHaveBeenCalledWith("inv1", false);
  });

  it("a full game keeps the invitation open, with a note", async () => {
    env.respond.mockResolvedValue({ status: "full" });
    render(<GameInviteBanner inviteId="inv1" viewerId="me" onAnswered={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(await screen.findByText(/game is full right now/)).toBeTruthy();
    expect(screen.getByTestId("game-invite-banner")).toBeTruthy();
  });

  it("someone else who opens the link sees nothing", async () => {
    const { container } = render(
      <GameInviteBanner inviteId="inv1" viewerId="someone" onAnswered={() => {}} />,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(container.innerHTML).toBe("");
  });

  it("an invitation that ended on accept says so without claiming the game is closed", async () => {
    // WP 5.5: a taken-back invitation answers expired while the game is still open to others.
    env.respond.mockResolvedValue({ status: "expired", on_roster: false });
    render(<GameInviteBanner inviteId="inv1" viewerId="me" onAnswered={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(await screen.findByText("This invitation has ended.")).toBeTruthy();
    expect(screen.queryByText(/no longer taking players/)).toBeNull();
  });

  it("a withdrawn invitation says so", async () => {
    env.invite = pending({ status: "cancelled" });
    render(<GameInviteBanner inviteId="inv1" viewerId="me" onAnswered={() => {}} />);
    expect(await screen.findByText("The host withdrew this invitation.")).toBeTruthy();
  });
});

describe("GameInviteBanner reminders (WP 5.4)", () => {
  it("saves the default reminders for the game once the invitee accepts", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: true });
    const onAnswered = vi.fn();
    render(<GameInviteBanner inviteId="inv1" viewerId="me" onAnswered={onAnswered} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    expect(env.saveReminders).toHaveBeenCalledTimes(1);
    expect(env.saveReminders).toHaveBeenCalledWith("g1");
  });

  it.each([["declined"], ["full"], ["expired"], ["cancelled"]])(
    "saves no reminders when the answer is %s",
    async (status) => {
      env.respond.mockResolvedValue({ status });
      render(<GameInviteBanner inviteId="inv1" viewerId="me" onAnswered={() => {}} />);
      fireEvent.click(
        await screen.findByRole("button", { name: status === "declined" ? "Decline" : "Accept" }),
      );
      await waitFor(() => expect(env.respond).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 0));
      expect(env.saveReminders).not.toHaveBeenCalled();
    },
  );

  it("a failed reminder save leaves the accept a success", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: true });
    env.saveReminders.mockRejectedValue(new Error("save failed"));
    const onAnswered = vi.fn();
    render(<GameInviteBanner inviteId="inv1" viewerId="me" onAnswered={onAnswered} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(env.saveReminders).toHaveBeenCalledWith("g1");
    expect(env.toast.success).toHaveBeenCalledWith("You're in. The host has been told.");
    expect(env.toast.error).not.toHaveBeenCalled();
    expect(screen.queryByTestId("game-invite-banner")).toBeNull();
  });

  it("does not wait for the reminder save before telling the invitee they are in", async () => {
    env.respond.mockResolvedValue({ status: "accepted", join_request_id: "jr", on_roster: true });
    env.saveReminders.mockReturnValue(new Promise(() => {}));
    const onAnswered = vi.fn();
    render(<GameInviteBanner inviteId="inv1" viewerId="me" onAnswered={onAnswered} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
    expect(env.toast.success).toHaveBeenCalledWith("You're in. The host has been told.");
  });
});
