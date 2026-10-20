// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    className?: string;
  }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v);
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

import { teamSetupSteps } from "@/lib/team-setup";
import { TeamSetupChecklist } from "./TeamSetupChecklist";

const fresh = { hasLogo: false, hasCover: false, bio: "", gameCount: 0, invitedCount: 0 };
const editTo = { to: "/teams/$teamId/edit", params: { teamId: "t-1" } };

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("teamSetupSteps", () => {
  it("lists the five setup steps, all open for a brand-new team", () => {
    const steps = teamSetupSteps(fresh);
    expect(steps.map((s) => s.id)).toEqual(["logo", "cover", "bio", "game", "invite"]);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("marks steps done from the team's state", () => {
    const steps = teamSetupSteps({
      hasLogo: true,
      hasCover: true,
      bio: "Travel baseball team in Buford.",
      gameCount: 1,
      invitedCount: 2,
    });
    expect(steps.every((s) => s.done)).toBe(true);
  });

  it("needs more than a few characters of bio", () => {
    expect(teamSetupSteps({ ...fresh, bio: "  Hi team  " }).find((s) => s.id === "bio")?.done).toBe(
      false,
    );
  });
});

describe("TeamSetupChecklist", () => {
  it("shows progress and links each open step to where it's done", () => {
    const onInvite = vi.fn();
    render(
      <TeamSetupChecklist
        teamId="t-1"
        steps={teamSetupSteps({ ...fresh, hasLogo: true, bio: "Travel baseball team." })}
        editTo={editTo}
        onInvite={onInvite}
      />,
    );
    expect(screen.getByText("2 of 5 done")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
    expect(screen.getByRole("link", { name: /choose a cover/i }).getAttribute("href")).toBe(
      "/teams/t-1/edit",
    );
    expect(screen.getByRole("link", { name: /host your first game/i }).getAttribute("href")).toBe(
      "/create",
    );
    fireEvent.click(screen.getByRole("button", { name: /invite players/i }));
    expect(onInvite).toHaveBeenCalledOnce();
  });

  it("disappears once everything is done", () => {
    const { container } = render(
      <TeamSetupChecklist
        teamId="t-1"
        steps={teamSetupSteps({
          hasLogo: true,
          hasCover: true,
          bio: "Travel baseball team.",
          gameCount: 3,
          invitedCount: 4,
        })}
        editTo={editTo}
        onInvite={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("can be hidden, and stays hidden for that team", () => {
    const props = { steps: teamSetupSteps(fresh), editTo, onInvite: () => {} };
    const { unmount } = render(<TeamSetupChecklist teamId="t-1" {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /hide setup checklist/i }));
    expect(screen.queryByText(/finish setting up/i)).toBeNull();
    unmount();

    render(<TeamSetupChecklist teamId="t-1" {...props} />);
    expect(screen.queryByText(/finish setting up/i)).toBeNull();
    cleanup();
    render(<TeamSetupChecklist teamId="t-2" {...props} />);
    expect(screen.getByText(/finish setting up/i)).toBeTruthy();
  });
});
