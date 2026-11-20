// @vitest-environment jsdom
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({
  user: null as null | { id: string },
  visible: { pickupGames: true, tryouts: true, availability: true, trainerSpotlight: true },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useRouter: () => ({ state: { location: { pathname: "/" } }, navigate: vi.fn() }),
  Link: ({
    to,
    params,
    search,
    children,
    className,
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace("$" + k, v);
    if (search) href += "?" + new URLSearchParams(search).toString();
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock("@/hooks/useLandingListingsConfig", () => ({
  useLandingListingsConfig: () => ({ visible: h.visible }),
}));
vi.mock("@/lib/hosted-games-store", () => ({ useHostedGames: () => [] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/authgate-log", () => ({ readStoredSupabaseSession: () => null }));
vi.mock("@/lib/last-visited", () => ({ readLastVisited: () => null }));
vi.mock("@/components/GameCard", () => ({ GameCard: () => null }));
vi.mock("@/components/Logo", () => ({ Logo: () => <span>BallaCity</span> }));
vi.mock("@/components/AuthRedirectSkeleton", () => ({
  AuthRedirectSkeleton: () => <div data-testid="auth-redirect" />,
}));
vi.mock("@/components/tryouts/TryoutsSection", () => ({
  TryoutsSection: ({ compact }: { compact?: boolean }) => (
    <div data-testid="tryouts" data-compact={String(!!compact)} />
  ),
}));
vi.mock("@/components/landing/FeaturedFacilityTrainer", () => ({
  FeaturedFacilityTrainer: () => <div data-testid="trainer-spotlight" />,
}));

import { Route } from "@/routes/index";
import { SITE_DESCRIPTION, SITE_TITLE } from "@/lib/seo";
import { SPORT_GUIDES } from "@/lib/sports-guide";

type RouteOptions = {
  component: () => ReactElement;
  head: () => { meta: Record<string, string>[] };
};
const options = (Route as unknown as { options: RouteOptions }).options;
const Landing = options.component;

const hrefOf = (name: RegExp | string) => screen.getByRole("link", { name }).getAttribute("href");
const section = (heading: string) =>
  screen.getByRole("heading", { level: 2, name: heading }).closest("section") as HTMLElement;
const follows = (a: HTMLElement, b: HTMLElement) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  h.user = null;
  h.visible = { pickupGames: true, tryouts: true, availability: true, trainerSpotlight: true };
});
afterEach(cleanup);

describe("landing page: basketball-first, availability-first pickup", () => {
  it("leads with posting when you're free and getting invited", () => {
    render(<Landing />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Post when you're free.Get invited to play.",
    );
    expect(screen.getByText(/Pickup basketball in your city/)).toBeTruthy();
    expect(hrefOf(/^Post when you're free/)).toBe("/availability?compose=quick");
    const how = section("Post when you're free. Get invited.");
    expect(
      within(how)
        .getAllByRole("heading", { level: 3 })
        .map((e) => e.textContent),
    ).toEqual(["Post when you're free", "Get invited", "Show up and play"]);
  });

  it("every posting call to action opens posting (sign-in first when signed out), not the browse list", () => {
    render(<Landing />);
    for (const name of [
      /^Post when you're free/,
      /^Post your availability/,
      /^Get found by teams/,
      /^Get started/,
    ]) {
      expect(hrefOf(name)).toBe("/availability?compose=quick");
    }
    expect(screen.queryAllByRole("link").map((a) => a.getAttribute("href"))).not.toContain(
      "/players",
    );
  });

  it("keeps the links the signed-out preview spec clicks, once each", () => {
    render(<Landing />);
    expect(screen.getAllByRole("link", { name: /Find a game near me/ })).toHaveLength(1);
    expect(hrefOf(/Find a game near me/)).toBe("/feed");
    expect(screen.getAllByRole("link", { name: /^Browse teams/ })).toHaveLength(1);
    expect(hrefOf(/^Browse teams/)).toBe("/teams");
    expect(
      screen.getAllByRole("link", { name: /Host a game/ }).map((a) => a.getAttribute("href")),
    ).toContain("/create");
  });

  it("keeps every sport, with Basketball first", () => {
    render(<Landing />);
    const sports = section("Basketball first. Every sport welcome.");
    const links = within(sports).getAllByRole("link");
    expect(links).toHaveLength(SPORT_GUIDES.length);
    expect(links[0].getAttribute("href")).toBe("/guide/basketball");
    for (const g of SPORT_GUIDES) {
      expect(within(sports).getByRole("link", { name: new RegExp(g.sport) })).toBeTruthy();
    }
  });

  it("puts tryouts, teams, trainers and facilities in one compact section below pickup", () => {
    render(<Landing />);
    const more = section("Tryouts, trainers & facilities");
    expect(more.id).toBe("more");
    expect(within(more).getByRole("link", { name: /^Browse teams/ })).toBeTruthy();
    expect(
      within(more)
        .getByRole("link", { name: /Find a trainer/ })
        .getAttribute("href"),
    ).toBe("/trainers");
    expect(
      within(more)
        .getByRole("link", { name: /Explore facilities/ })
        .getAttribute("href"),
    ).toBe("/orgs");
    expect(within(more).getByRole("link", { name: "List your facility" })).toBeTruthy();
    expect(within(more).getByTestId("tryouts").getAttribute("data-compact")).toBe("true");
    expect(within(more).getByTestId("trainer-spotlight")).toBeTruthy();
    expect(within(more).getByRole("link", { name: "Get found by teams" })).toBeTruthy();
    // One section, not three: no separate teams or facilities sections remain.
    expect(screen.queryByRole("heading", { name: /Built for teams/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /For gyms/ })).toBeNull();
    // Lower down: after how-it-works, games and sports.
    const how = section("Post when you're free. Get invited.");
    const games = section("Games near you");
    const sports = section("Basketball first. Every sport welcome.");
    expect(follows(how, games) && follows(games, sports) && follows(sports, more)).toBe(true);
  });

  it("still honours the landing listing switches", () => {
    h.visible = {
      pickupGames: false,
      tryouts: false,
      availability: false,
      trainerSpotlight: false,
    };
    render(<Landing />);
    expect(screen.queryByRole("heading", { name: "Games near you" })).toBeNull();
    expect(screen.queryByTestId("tryouts")).toBeNull();
    expect(screen.queryByTestId("trainer-spotlight")).toBeNull();
    expect(screen.queryByRole("link", { name: "Get found by teams" })).toBeNull();
    // The compact cards are static, so they stay.
    expect(hrefOf(/^Browse teams/)).toBe("/teams");
  });

  it("keeps the young-player safety answer", () => {
    render(<Landing />);
    expect(screen.getByText("Is it safe for young players?")).toBeTruthy();
    expect(screen.getByText(/Players under 18 need a parent or guardian/)).toBeTruthy();
  });

  it("sends a signed-in visitor through the redirect skeleton, not the marketing page", () => {
    h.user = { id: "u1" };
    render(<Landing />);
    expect(screen.getByTestId("auth-redirect")).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});

describe("landing page head", () => {
  it("uses the basketball-first title, description and share card", () => {
    expect(SITE_TITLE).toMatch(/Pickup Basketball/);
    expect(SITE_DESCRIPTION).toMatch(/^Post when you're free and get invited/);
    expect(SITE_DESCRIPTION).toMatch(/Soccer, pickleball/);
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(160);
    const meta = options.head().meta;
    const content = (key: string) =>
      meta.find((m) => m.property === key || m.name === key)?.content ?? "";
    expect(meta.find((m) => "title" in m)?.title).toBe(SITE_TITLE);
    expect(content("description")).toBe(SITE_DESCRIPTION);
    const image = new URL(content("og:image"));
    expect(image.pathname).toBe("/api/public/og");
    expect(image.searchParams.get("title")).toBe("Post when you're free. Get invited to play.");
    expect(image.searchParams.get("meta")).toMatch(/^Basketball\|/);
  });
});
