// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

import { FeaturedFacilityTrainer } from "./FeaturedFacilityTrainer";

afterEach(cleanup);

describe("FeaturedFacilityTrainer", () => {
  it("shows the trainer, facility, rating, rate, specialties and availability", () => {
    render(<FeaturedFacilityTrainer />);
    expect(screen.getByText("Coach Jordan Kim")).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.getByText("Bogan Park Sports Complex")).toBeTruthy();
    expect(screen.getByText("(86 reviews)")).toBeTruthy();
    expect(screen.getByText("$75")).toBeTruthy();
    expect(screen.getByText("Paid to the trainer directly")).toBeTruthy();
    const chips = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(chips).toEqual(["Shooting & Footwork", "Speed & Agility", "Private 1-on-1", "Clinics"]);
    expect(screen.getByText("Booking now · Slots available this week")).toBeTruthy();
  });

  it("is labeled as an example and only links to real pages", () => {
    render(<FeaturedFacilityTrainer />);
    expect(screen.getByText("Example profile")).toBeTruthy();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/trainers", "/trainers/create"]);
  });
});
