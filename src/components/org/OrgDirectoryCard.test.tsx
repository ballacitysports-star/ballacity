// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children: ReactNode; className?: string }) => (
    <a className={rest.className}>{children}</a>
  ),
}));
vi.mock("@/components/ResponsiveImage", () => ({
  ResponsiveImage: ({ alt }: { alt?: string }) => <img alt={alt} />,
}));
vi.mock("@/components/org/CourtInquiryDialog", () => ({
  CourtInquiryDialog: ({ orgName }: { orgName: string }) => (
    <div data-testid="inquiry">{`inquiry for ${orgName}`}</div>
  ),
}));

import { OrgDirectoryCard, type OrgDirectoryRow } from "./OrgDirectoryCard";

afterEach(cleanup);

const open24 = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { open24: true }]));
const row = (over: Partial<OrgDirectoryRow> = {}): OrgDirectoryRow => ({
  id: "o1",
  name: "Peak Courts",
  handle: "peak",
  avatar: null,
  avatar_url: null,
  cover_url: "https://img.test/cover.jpg",
  photos: ["https://img.test/a.jpg", "https://img.test/b.jpg"],
  city: "Austin",
  address: "123 Main St",
  bio: null,
  category: "Court rental",
  amenities: ["4 courts", "Indoor courts", "Lighting", "Parking", "Wi-Fi"],
  hours: open24,
  timezone: "UTC",
  website: null,
  verified: true,
  ...over,
});

describe("OrgDirectoryCard", () => {
  it("shows photos, category, location, live hours and amenity tags", () => {
    render(<OrgDirectoryCard org={row()} now={new Date("2026-10-06T12:00:00Z")} />);
    expect(screen.getByText("Court rental")).toBeTruthy();
    expect(screen.getByLabelText("Verified")).toBeTruthy();
    expect(screen.getByText("@peak")).toBeTruthy();
    expect(screen.getByText("3 photos")).toBeTruthy();
    expect(screen.getByText("123 Main St · Austin")).toBeTruthy();
    expect(screen.getByText("Open now")).toBeTruthy();
    expect(screen.getByText("Open 24 hours")).toBeTruthy();
    for (const t of ["4 courts", "Indoor courts", "Lighting", "Parking"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
  });

  it("links Book court straight to the venue's website when it has one", () => {
    render(<OrgDirectoryCard org={row({ website: "peakcourts.com/book" })} now={new Date()} />);
    const link = screen.getByRole("link", { name: /book court/i }) as HTMLAnchorElement;
    expect(link.href).toBe("https://peakcourts.com/book");
    expect(link.rel).toContain("noopener");
    expect(screen.queryByTestId("inquiry")).toBeNull();
    // The in-app inquiry stays available as a secondary action.
    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));
    expect(screen.getByTestId("inquiry").textContent).toBe("inquiry for Peak Courts");
  });

  it("opens the in-app inquiry dialog when there is no booking URL", () => {
    render(<OrgDirectoryCard org={row({ website: null })} now={new Date()} />);
    expect(screen.queryByRole("link", { name: /book court/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /book court/i }));
    expect(screen.getByTestId("inquiry")).toBeTruthy();
  });

  it("never turns an unsafe website into a link", () => {
    render(<OrgDirectoryCard org={row({ website: "javascript:alert(1)" })} now={new Date()} />);
    expect(screen.queryByRole("link", { name: /book court/i })).toBeNull();
    expect(screen.getByRole("button", { name: /book court/i })).toBeTruthy();
  });

  it("puts the live status on the banner and falls back to the brand mark without photos", () => {
    const { container } = render(
      <OrgDirectoryCard
        org={row({ cover_url: null, photos: null, avatar_url: null })}
        now={new Date("2026-10-06T12:00:00Z")}
      />,
    );
    // Status badge is inside the banner (the 16:9 box), not the card body.
    const banner = container.querySelector(".aspect-\\[16\\/9\\]") as HTMLElement;
    expect(banner.textContent).toContain("Open now");
    expect(banner.textContent).toContain("Court rental");
    // No photo: gradient banner with the facility's initials.
    expect(banner.querySelector(".bg-lime-gradient")?.textContent).toBe("PE");
  });

  it("marks featured facilities and leaves others unmarked", () => {
    const { rerender } = render(
      <OrgDirectoryCard org={row({ featured_at: "2026-10-01T00:00:00Z" })} now={new Date()} />,
    );
    expect(screen.getByText("Featured")).toBeTruthy();
    rerender(<OrgDirectoryCard org={row({ featured_at: null })} now={new Date()} />);
    expect(screen.queryByText("Featured")).toBeNull();
  });

  it("shows a placeholder and unset hours for a bare listing", () => {
    render(
      <OrgDirectoryCard
        org={row({ cover_url: null, photos: null, hours: {}, amenities: null, category: null })}
        now={new Date()}
      />,
    );
    expect(screen.getByText("Hours not set")).toBeTruthy();
    expect(screen.queryByText(/photos/)).toBeNull();
  });
});
