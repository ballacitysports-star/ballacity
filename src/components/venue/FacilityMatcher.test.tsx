// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  rows: [] as { id: string; name: string; city?: string; verified?: boolean }[],
  list: vi.fn(),
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/trainer-orgs.functions", () => ({
  listTrainerOrgs: (arg: unknown) => {
    h.list(arg);
    return Promise.resolve(h.rows);
  },
}));

import { FacilityMatcher } from "./FacilityMatcher";
import { venueSearchTerm } from "@/lib/facility-hub";

function renderMatcher(props: Partial<Parameters<typeof FacilityMatcher>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onLink = vi.fn();
  const onUnlink = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <FacilityMatcher
        location="Apex"
        linked={null}
        onLink={onLink}
        onUnlink={onUnlink}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onLink, onUnlink };
}

afterEach(() => {
  cleanup();
  h.rows = [];
  h.list.mockReset();
});

describe("venueSearchTerm", () => {
  it("searches by the venue name, not the full street address", () => {
    expect(venueSearchTerm("Apex Basketball Hub, 1 Hoop St, Atlanta")).toBe("Apex Basketball Hub");
    expect(venueSearchTerm("  Bogan Park ")).toBe("Bogan Park");
  });
});

describe("FacilityMatcher", () => {
  it("suggests matching registered gyms and links the run to one", async () => {
    h.rows = [
      { id: "o1", name: "Apex Basketball Hub", city: "Atlanta", verified: true },
      { id: "o2", name: "Apex Rec Center", city: "Decatur" },
    ];
    const { onLink } = renderMatcher({ location: "Apex, Atlanta" });
    const pick = await screen.findByRole(
      "button",
      { name: "Host this run at Apex Basketball Hub" },
      { timeout: 2000 },
    );
    expect(h.list).toHaveBeenCalledWith({ data: { q: "Apex" } });
    expect(screen.getByText("Hosting at a registered gym?")).toBeTruthy();
    fireEvent.click(pick);
    expect(onLink).toHaveBeenCalledWith("o1");
  });

  it("stays quiet for short text or no matches", async () => {
    renderMatcher({ location: "Ap" });
    await new Promise((r) => setTimeout(r, 450));
    expect(h.list).not.toHaveBeenCalled();
    cleanup();

    h.rows = [];
    const { container } = renderMatcher({ location: "Nowhere Court" });
    await new Promise((r) => setTimeout(r, 450));
    expect(container.innerHTML).toBe("");
  });

  it("shows the linked gym with an Unlink action", () => {
    const { onUnlink } = renderMatcher({ linked: { id: "o1", name: "Apex Basketball Hub" } });
    expect(screen.getByRole("status").textContent).toContain("Apex Basketball Hub");
    fireEvent.click(
      screen.getByRole("button", { name: "Unlink Apex Basketball Hub from this run" }),
    );
    expect(onUnlink).toHaveBeenCalled();
    expect(h.list).not.toHaveBeenCalled();
  });
});
