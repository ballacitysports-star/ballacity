// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
const teams: { teamId: string }[] = [];
vi.mock("@/components/players/InviteToTeamDialog", () => ({
  useMyRecruitingTeams: () => ({ teams, isLoading: false }),
  InviteToTeamDialog: ({ playerId }: { playerId: string }) => (
    <div data-testid="invite-dialog">{playerId}</div>
  ),
}));

const { RosterRecruitPanel } = await import("./RosterRecruitPanel");

const roster = [
  { userId: "me", displayName: "Me", avatarInitials: "ME" },
  { userId: "u2", displayName: "Jordan", avatarInitials: "JO" },
];

afterEach(() => {
  cleanup();
  teams.length = 0;
});

describe("RosterRecruitPanel", () => {
  it("is hidden for viewers who don't lead a team", () => {
    const { container } = render(<RosterRecruitPanel roster={roster} meId="me" />);
    expect(container.innerHTML).toBe("");
  });

  it("lets team leaders invite other players, not themselves", () => {
    teams.push({ teamId: "t1" });
    render(<RosterRecruitPanel roster={roster} meId="me" />);
    expect(screen.queryByRole("button", { name: /invite me/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Invite Jordan to your team" }));
    expect(screen.getByTestId("invite-dialog").textContent).toBe("u2");
  });
});
