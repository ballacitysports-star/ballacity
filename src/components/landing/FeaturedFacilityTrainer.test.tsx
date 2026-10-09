// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FeaturedTrainer } from "@/lib/featured-trainer";

const featured = vi.hoisted(() => ({ fn: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    className?: string;
  }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v);
    if (search) href += `?${new URLSearchParams(search).toString()}`;
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));
vi.mock("@/lib/trainer-orgs.functions", () => ({ getFeaturedFacilityTrainer: featured.fn }));

import { FacilityTrainerCard, FeaturedFacilityTrainer } from "./FeaturedFacilityTrainer";

afterEach(() => {
  cleanup();
  featured.fn.mockReset();
});

const live: FeaturedTrainer = {
  id: "t-123",
  name: "Coach Dre Allen",
  avatar: null,
  city: "Atlanta, GA",
  verified: true,
  ratePerHour: 90,
  specialties: ["1-on-1", "Basketball"],
  blurb: "Guard skills and film study.",
  rating: 4.7,
  reviewCount: 12,
  facility: { id: "o-9", name: "Peak Courts", city: "Atlanta, GA" },
};

const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));

describe("FacilityTrainerCard (example)", () => {
  it("shows the labeled example with the spec's details", () => {
    render(<FacilityTrainerCard example />);
    expect(screen.getByText("Example profile")).toBeTruthy();
    expect(screen.getByText("Coach Jordan Kim")).toBeTruthy();
    expect(screen.getByText("Bogan Park Sports Complex")).toBeTruthy();
    expect(screen.getByText("(86 reviews)")).toBeTruthy();
    expect(screen.getByText("$75")).toBeTruthy();
    expect(screen.getByText("Paid to the trainer directly")).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Shooting & Footwork",
      "Speed & Agility",
      "Private 1-on-1",
      "Clinics",
    ]);
  });

  it("only links to real pages, never a booking sheet", () => {
    render(<FacilityTrainerCard example />);
    expect(hrefs()).toEqual(["/trainers", "/trainers/create"]);
  });
});

describe("FacilityTrainerCard (live trainer)", () => {
  it("shows the real trainer with working profile, facility and booking links", () => {
    render(<FacilityTrainerCard trainer={live} />);
    expect(screen.queryByText("Example profile")).toBeNull();
    expect(screen.getByText("Coach Dre Allen")).toBeTruthy();
    expect(screen.getByText("(12 reviews)")).toBeTruthy();
    expect(screen.getByText("$90")).toBeTruthy();
    expect(hrefs()).toEqual([
      "/orgs/o-9",
      "/trainers",
      "/trainers/t-123",
      "/trainers/t-123?modal=book",
    ]);
  });

  it("doesn't invent a rating for a trainer with no reviews", () => {
    render(<FacilityTrainerCard trainer={{ ...live, rating: null, reviewCount: 0 }} />);
    expect(screen.getByText("New on BallaCity")).toBeTruthy();
    expect(screen.queryByText(/reviews?\)/)).toBeNull();
  });

  it("uses the singular for one review and hides Verified when unverified", () => {
    render(<FacilityTrainerCard trainer={{ ...live, reviewCount: 1, verified: false }} />);
    expect(screen.getByText("(1 review)")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
  });
});

function renderContainer() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <FeaturedFacilityTrainer />
    </QueryClientProvider>,
  );
}

describe("FeaturedFacilityTrainer", () => {
  it("renders nothing while loading, then the real trainer", async () => {
    featured.fn.mockResolvedValue(live);
    const { container } = renderContainer();
    expect(container.innerHTML).toBe("");
    await waitFor(() => expect(screen.getByText("Coach Dre Allen")).toBeTruthy());
    expect(screen.queryByText("Example profile")).toBeNull();
  });

  it("falls back to the example when no trainer qualifies", async () => {
    featured.fn.mockResolvedValue(null);
    renderContainer();
    await waitFor(() => expect(screen.getByText("Example profile")).toBeTruthy());
  });

  it("falls back to the example when the lookup fails", async () => {
    featured.fn.mockRejectedValue(new Error("boom"));
    renderContainer();
    await waitFor(() => expect(screen.getByText("Example profile")).toBeTruthy());
  });
});
