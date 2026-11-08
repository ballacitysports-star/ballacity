// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const store = { mine: new Set<string>(), unclaimed: new Set<string>() };
vi.mock("@/lib/org-store", () => ({
  isMyOrg: (id: string) => store.mine.has(id),
  isOrgUnclaimed: (id: string) => store.unclaimed.has(id),
}));
vi.mock("@/components/FollowEntityButton", () => ({
  FollowEntityButton: ({ kind, id }: { kind: string; id: string }) => (
    <span data-testid="follow">{`${kind}:${id}`}</span>
  ),
}));
vi.mock("@/components/TrainerActions", () => ({
  TrainerActions: ({ org }: { org: { id: string } }) => <span data-testid="trainer">{org.id}</span>,
}));
vi.mock("@/components/team/GuardianTeamContactAction", () => ({
  GuardianTeamContactAction: ({ teamId }: { teamId: string }) => (
    <span data-testid="guardian-contact">{teamId}</span>
  ),
}));

const { DiscoverCardActions } = await import("./DiscoverCardActions");
const org = (id: string, kind: "team" | "coach") => ({ id, kind, name: `Org ${id}` }) as never;

afterEach(() => {
  cleanup();
  store.mine.clear();
  store.unclaimed.clear();
});

describe("DiscoverCardActions (P2-5)", () => {
  it("a team: Follow and the parents' staff contact", () => {
    render(<DiscoverCardActions org={org("t1", "team")} />);
    expect(screen.getByTestId("follow").textContent).toBe("team:t1");
    expect(screen.getByTestId("guardian-contact").textContent).toBe("t1");
    expect(screen.queryByTestId("trainer")).toBeNull();
  });

  it("a trainer: Follow (as a team row) and request or message", () => {
    render(<DiscoverCardActions org={org("c1", "coach")} />);
    expect(screen.getByTestId("follow").textContent).toBe("team:c1");
    expect(screen.getByTestId("trainer").textContent).toBe("c1");
    expect(screen.queryByTestId("guardian-contact")).toBeNull();
  });

  it("no Follow for your own listing or an unclaimed one, and no booking yourself", () => {
    store.mine.add("c1");
    render(<DiscoverCardActions org={org("c1", "coach")} />);
    expect(screen.queryByTestId("follow")).toBeNull();
    expect(screen.queryByTestId("trainer")).toBeNull();
    cleanup();

    store.unclaimed.add("t2");
    render(<DiscoverCardActions org={org("t2", "team")} />);
    expect(screen.queryByTestId("follow")).toBeNull();
  });

  it("followOnly shows just Follow (the trainers list already has request and message)", () => {
    render(<DiscoverCardActions org={org("c1", "coach")} followOnly />);
    expect(screen.getByTestId("follow")).toBeTruthy();
    expect(screen.queryByTestId("trainer")).toBeNull();
  });
});
