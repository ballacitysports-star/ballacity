// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  org: { data: null as unknown, error: null as unknown },
  runs: { count: 0 as number | null, error: null as unknown },
  neq: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    hash,
    ...rest
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    hash?: string;
    "aria-label"?: string;
  }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v);
    return (
      <a href={hash ? `${href}#${hash}` : href} aria-label={rest["aria-label"]}>
        {children}
      </a>
    );
  },
}));
vi.mock("@/components/ResponsiveImage", () => ({ ResponsiveImage: () => <img alt="" /> }));
vi.mock("@/components/org/CourtInquiryDialog", () => ({
  CourtInquiryDialog: ({ open, orgName }: { open: boolean; orgName: string }) =>
    open ? <div data-testid="inquiry">{orgName}</div> : null,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "trainer_orgs") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => h.org }) }) };
      }
      // hosted_games count query: select().eq()....is()....gte().lt()[.neq()]
      const chain: Record<string, unknown> = {};
      const done = () => Promise.resolve(h.runs);
      for (const m of ["eq", "is", "gte"]) chain[m] = () => chain;
      chain.lt = () => ({
        neq: (...a: unknown[]) => (h.neq(...a), done()),
        then: (r: never) => done().then(r),
      });
      return { select: () => chain };
    },
  },
}));

import { VenueHubCard } from "./VenueHubCard";
import { otherRunsLabel } from "@/lib/facility-hub";

const apex = {
  id: "o1",
  name: "Apex Basketball Hub",
  verified: true,
  amenities: ["Parking", "4 courts", "Indoor courts"],
  cover_url: null,
  avatar_url: null,
  address: "1 Hoop St",
  city: "Atlanta",
  hours: {},
  timezone: "America/New_York",
  booking_url: null,
  website: null,
};

function renderCard(props: Partial<Parameters<typeof VenueHubCard>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <VenueHubCard orgId="o1" gameId="g1" {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  h.org = { data: null, error: null };
  h.runs = { count: 0, error: null };
  h.neq.mockReset();
});

describe("otherRunsLabel", () => {
  it("words the weekly counter", () => {
    expect(otherRunsLabel(3)).toBe("3 other runs scheduled here this week");
    expect(otherRunsLabel(1)).toBe("1 other run scheduled here this week");
    expect(otherRunsLabel(0)).toBe("No other runs scheduled here this week");
    expect(otherRunsLabel(null)).toBe("See this facility's schedule");
  });
});

describe("VenueHubCard", () => {
  it("shows the facility, amenities, other-run count and links into its schedule", async () => {
    h.org = { data: apex, error: null };
    h.runs = { count: 3, error: null };
    renderCard({ official: false, indoor: true });

    expect(await screen.findByText("3 other runs scheduled here this week")).toBeTruthy();
    expect(h.neq).toHaveBeenCalledWith("id", "g1"); // the game itself isn't counted
    expect(screen.getByLabelText("Verified facility")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Venue amenities" });
    expect(Array.from(list.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "4 courts",
      "Indoor courts",
      "Parking",
    ]);
    expect(screen.getByText("Community run")).toBeTruthy();
    expect(screen.getByText("Indoor")).toBeTruthy();

    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/orgs/o1#facility-events");
    expect(hrefs).toContain("/orgs/o1");
    expect(
      screen.getAllByRole("link", { name: "View Apex Basketball Hub profile and weekly schedule" }),
    ).toHaveLength(2);
  });

  it("labels official events and outdoor courts", async () => {
    h.org = { data: apex, error: null };
    renderCard({ official: true, indoor: false });
    expect(await screen.findByText("Official event")).toBeTruthy();
    expect(screen.getByText("Outdoor")).toBeTruthy();
  });

  it("offers an in-app inquiry when the facility has no booking link", async () => {
    h.org = { data: apex, error: null };
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Send Apex Basketball Hub a court inquiry" }),
    );
    expect(screen.getByTestId("inquiry").textContent).toBe("Apex Basketball Hub");
  });

  it("links straight to the booking page when there is one", async () => {
    h.org = { data: { ...apex, booking_url: "https://apex.example/book" }, error: null };
    renderCard();
    const book = await screen.findByRole("link", {
      name: "Book a court at Apex Basketball Hub (opens their booking page)",
    });
    expect(book.getAttribute("href")).toBe("https://apex.example/book");
    expect(screen.queryByRole("button", { name: /inquiry/ })).toBeNull();
  });

  it("still renders when the run count fails, and renders nothing without a facility", async () => {
    h.org = { data: apex, error: null };
    h.runs = { count: null, error: { message: "boom" } };
    renderCard();
    expect(await screen.findByText("See this facility's schedule")).toBeTruthy();
    cleanup();

    h.org = { data: null, error: null };
    const { container } = renderCard({ orgId: "gone" });
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
