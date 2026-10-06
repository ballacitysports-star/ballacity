// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    search,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => {
    let href = to;
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v);
    if (search) href += `?${new URLSearchParams(search).toString()}`;
    return <a href={href}>{children}</a>;
  },
}));
vi.mock("@/components/VenueMapPreview", () => ({ VenueMapPreview: () => null }));
vi.mock("@/components/ProfileShareCard", () => ({ ProfileShareCard: () => null }));
vi.mock("@/components/ResponsiveImage", () => ({
  ResponsiveImage: () => <img alt="" />,
  ResponsiveAvatar: () => <img alt="" />,
}));
vi.mock("@/components/org/CourtInquiryDialog", () => ({ CourtInquiryDialog: () => null }));

import { OrgListingHeader, type OrgListingRow } from "./OrgListingHeader";

afterEach(cleanup);

const org: OrgListingRow = {
  id: "org-1",
  name: "Apex Basketball Hub",
  handle: "apex",
  bio: null,
  city: "Austin",
  website: null,
  avatar: null,
  avatar_url: null,
  cover_url: null,
  verified: false,
};

const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"));

describe("OrgListingHeader host action", () => {
  it("gives managers a Host a run here action tagged with the facility", () => {
    render(<OrgListingHeader org={org} memberCount={0} isAdmin isOwner />);
    expect(screen.getByRole("link", { name: "Host a run here" })).toBeTruthy();
    expect(hrefs()).toContain("/create?orgId=org-1&kind=run");
    expect(screen.queryByRole("button", { name: /book court/i })).toBeNull();
  });

  it("shows visitors Book court instead, and no host action", () => {
    render(<OrgListingHeader org={org} memberCount={0} isAdmin={false} isOwner={false} />);
    expect(screen.queryByRole("link", { name: "Host a run here" })).toBeNull();
    expect(screen.getByRole("button", { name: /book court/i })).toBeTruthy();
  });
});
