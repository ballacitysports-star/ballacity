// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/components/OrgCard", () => ({
  OrgCard: ({ org, followers }: { org: { name: string }; followers?: number }) => (
    <div data-testid="org" data-followers={followers ?? "none"}>
      {org.name}
    </div>
  ),
}));
vi.mock("@/components/org/OrgDirectoryCard", () => ({
  OrgDirectoryCard: ({ org }: { org: { name: string } }) => <li data-testid="gym">{org.name}</li>,
}));

const org = (id: string, name: string, kind: "team" | "coach", city = "Atlanta") => ({
  id,
  name,
  kind,
  handle: `@${id}`,
  tagline: "",
  city,
  sports: ["Basketball"],
});
const orgs = [
  org("t1", "Apex Elite", "team"),
  ...Array.from({ length: 6 }, (_, i) => org(`tx${i}`, `Atlanta Squad ${i}`, "team")),
  org("c1", "Coach Dre", "coach"),
  org("c2", "Coach Sam", "coach", "Denver"),
];
vi.mock("@/lib/org-store", () => ({ useAllOrgs: () => orgs }));
const followCountCalls = vi.hoisted(() => [] as { kind: string; ids: string[] }[]);
vi.mock("@/lib/entity-follows", () => ({
  useEntityFollowCounts: (kind: string, ids: string[]) => {
    followCountCalls.push({ kind, ids });
    return new Map([["t1", { followers: 2, following: false }]]);
  },
}));
vi.mock("@/components/feed/DiscoverCardActions", () => ({
  DiscoverCardActions: ({ org }: { org: { id: string } }) => (
    <span data-testid={`actions-${org.id}`} />
  ),
}));
vi.mock("@/lib/trainer-orgs.functions", () => ({
  listTrainerOrgs: () => Promise.resolve([{ id: "g1", name: "Apex Basketball Hub" }]),
}));
vi.mock("@/lib/tryouts.functions", () => ({
  listUpcomingTryouts: () =>
    Promise.resolve([
      {
        id: "p1",
        kind: "tryout",
        title: "Spring Tryout",
        teamName: "Apex Elite",
        location: null,
        sports: ["Basketball"],
      },
    ]),
}));

const { DiscoverCategoryPills, DiscoverResults } = await import("./DiscoverResults");

function wrap(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

afterEach(cleanup);

describe("DiscoverCategoryPills", () => {
  it("marks the active category and reports changes", () => {
    const onChange = vi.fn();
    render(<DiscoverCategoryPills value="all" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Trainers" }));
    expect(onChange).toHaveBeenCalledWith("trainers");
  });
});

describe("DiscoverResults", () => {
  it("groups matches across teams, gyms and trainers with See all", async () => {
    const onSeeAll = vi.fn();
    wrap(<DiscoverResults cat="all" q="atlanta" sports={[]} onSeeAll={onSeeAll} />);
    expect(screen.getByRole("region", { name: "Teams" })).toBeTruthy();
    // 7 Atlanta teams, capped to 5 in the grouped view.
    expect(
      screen.getAllByTestId("org").filter((n) => /Squad|Apex/.test(n.textContent!)),
    ).toHaveLength(5);
    expect(await screen.findByTestId("gym")).toBeTruthy();
    expect(screen.getByText("Coach Dre")).toBeTruthy();
    expect(screen.queryByText("Coach Sam")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    expect(onSeeAll).toHaveBeenCalledWith("teams");
  });

  it("shows teams plus upcoming tryouts for the Teams & Tryouts category", async () => {
    wrap(<DiscoverResults cat="teams" q="" sports={[]} />);
    expect(screen.getAllByTestId("org")).toHaveLength(7);
    expect(await screen.findByText("Spring Tryout")).toBeTruthy();
    expect(screen.queryByText("Coach Dre")).toBeNull();
  });

  it("gives every team and trainer card its actions (P2-5)", () => {
    wrap(<DiscoverResults cat="trainers" q="" sports={[]} />);
    expect(screen.getByTestId("actions-c1")).toBeTruthy();
    expect(screen.getByTestId("actions-c2")).toBeTruthy();
    cleanup();
    wrap(<DiscoverResults cat="teams" q="" sports={[]} />);
    expect(screen.getByTestId("actions-t1")).toBeTruthy();
  });

  it("shows each card's real follower count, and no number where none is known (P1-1)", () => {
    wrap(<DiscoverResults cat="teams" q="" sports={[]} />);
    const card = (name: string) =>
      screen.getAllByTestId("org").find((n) => n.textContent === name)!;
    expect(card("Apex Elite").dataset.followers).toBe("2");
    expect(card("Atlanta Squad 0").dataset.followers).toBe("none");
  });

  it("asks for the counts of the whole directory, so a search asks for nothing new (P1-1)", () => {
    followCountCalls.length = 0;
    const { rerender } = wrap(<DiscoverResults cat="all" q="atlanta" sports={[]} />);
    const qc = new QueryClient();
    rerender(
      <QueryClientProvider client={qc}>
        <DiscoverResults cat="all" q="denver" sports={[]} />
      </QueryClientProvider>,
    );
    const asked = followCountCalls.map((c) => `${c.kind}:${c.ids.join(",")}`);
    expect(new Set(asked)).toEqual(new Set([`team:${orgs.map((o) => o.id).join(",")}`]));
  });
});
