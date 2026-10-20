// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccountProfile } from "@/lib/account-profiles";
import type { Org } from "@/lib/sample-data";

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

const org: Org = {
  id: "t-1",
  kind: "team",
  name: "Ballacity Scout 14U",
  handle: "@ballacityscout",
  tagline: "",
  city: "Buford, Georgia",
  founded: 2024,
  sports: ["Baseball"],
  verified: false,
  cover: "",
  avatar: "BS",
  accent: "#1e7bff",
  followers: 0,
  roster: 4,
  bio: "A dedicated travel baseball team built on hard work.",
  achievements: [],
  upcoming: [],
} as unknown as Org;

vi.mock("@/lib/org-store", () => ({ ensureOrgById: vi.fn(async () => org) }));
vi.mock("@/lib/trainer-orgs.functions", () => ({ getTrainerOrg: vi.fn() }));
vi.mock("@/lib/hosted-games-store", () => ({ useHostedGames: () => [] }));
vi.mock("@/lib/reviews-db", () => ({ useReviewsFor: () => [] }));
vi.mock("@/components/GameCard", () => ({ GameCard: () => null }));
vi.mock("@/components/ReviewsSection", () => ({ ReviewsSection: () => null }));
vi.mock("@/components/ResponsiveImage", () => ({
  ResponsiveImage: () => <img alt="" />,
  ResponsiveAvatar: () => <img alt="" />,
}));
vi.mock("@/components/team/InvitePlayerDialog", () => ({
  InvitePlayerDialog: ({ open, teamName }: { open: boolean; teamName: string }) =>
    open ? <div role="dialog">Invite to {teamName}</div> : null,
}));
vi.mock("@/components/ProfileShareCard", () => ({
  ProfileShareCard: ({ open, data }: { open: boolean; data: { path: string } }) =>
    open ? <div role="dialog">Share {data.path}</div> : null,
}));
vi.mock("@/components/profile/ProfileAboutSheet", () => ({
  ProfileAboutSheet: () => null,
  AboutBlock: () => null,
  AboutStats: () => null,
}));

import { ActiveProfileView } from "./ActiveProfileView";

afterEach(cleanup);

function profile(kind: AccountProfile["kind"]): AccountProfile {
  return {
    id: "p-1",
    kind,
    refId: "t-1",
    name: org.name,
    handle: org.handle,
    avatarUrl: null,
    avatarFallback: "BS",
    href: { to: "/teams/$teamId", params: { teamId: "t-1" } },
  };
}

function renderView(kind: AccountProfile["kind"]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ActiveProfileView profile={profile(kind)} />
    </QueryClientProvider>,
  );
}

describe("ActiveProfileView actions", () => {
  it("puts Invite players and Share up front for a team", async () => {
    renderView("team");
    const invite = await screen.findByRole("button", { name: /invite players/i });
    fireEvent.click(invite);
    expect(screen.getByRole("dialog").textContent).toContain("Invite to Ballacity Scout 14U");
  });

  it("shares the public team page", async () => {
    renderView("team");
    fireEvent.click(await screen.findByRole("button", { name: /^share$/i }));
    expect(screen.getByRole("dialog").textContent).toContain("Share /teams/t-1");
  });

  it("offers Share but not roster invites to a trainer", async () => {
    renderView("trainer");
    expect(await screen.findByRole("button", { name: /^share$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /invite players/i })).toBeNull();
  });
});
