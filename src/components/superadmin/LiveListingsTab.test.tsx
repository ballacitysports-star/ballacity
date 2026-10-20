// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const listListings = vi.fn(async (_: unknown) => ({ total: 1, rows: [game] }));
const updateListing = vi.fn(async (_: unknown) => ({ ok: true, changed: ["title"] }));
const moderate = vi.fn(async (_: unknown) => ({ ok: true }));

const game = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Friday Run",
  sport: "Basketball",
  date: "2099-10-20T18:00:00+00:00",
  ends_at: null,
  location: "Rucker Park",
  neighborhood: "Harlem",
  host_id: "h1",
  joined: 4,
  max_players: 10,
  joins_closed: false,
  hidden_at: null,
  owner_name: "Sam",
};

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/superadmin-listings.functions", () => ({
  superadminListListings: (a: unknown) => listListings(a),
  superadminUpdateListing: (a: unknown) => updateListing(a),
}));
vi.mock("@/lib/superadmin.functions", () => ({ superadminModerate: (a: unknown) => moderate(a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { LiveListingsTab } from "./LiveListingsTab";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listListings.mockImplementation(async () => ({ total: 1, rows: [game] }));
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LiveListingsTab />
    </QueryClientProvider>,
  );
}

describe("LiveListingsTab", () => {
  it("lists live games with status, host and a link to the live page", async () => {
    renderTab();
    expect(await screen.findByText("Friday Run")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText(/Host: Sam/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /View live/ }).getAttribute("href")).toBe(
      `/games/${game.id}`,
    );
    expect(listListings).toHaveBeenCalledWith({
      data: expect.objectContaining({ section: "games", visibility: "visible" }),
    });
  });

  it("hides one listing through the audited moderation action", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Hide" }));
    await waitFor(() => expect(moderate).toHaveBeenCalledTimes(1));
    expect(moderate.mock.calls[0][0]).toEqual({
      data: { kind: "games", id: game.id, action: "hide", reason: "Live listings tab" },
    });
  });

  it("sends only the fields the admin changed, never an untouched date", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    const title = await screen.findByDisplayValue("Friday Run");
    fireEvent.change(title, { target: { value: "Friday Night Run" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateListing).toHaveBeenCalledTimes(1));
    expect(updateListing.mock.calls[0][0]).toEqual({
      data: {
        section: "games",
        id: game.id,
        patch: { title: "Friday Night Run" },
        reason: undefined,
      },
    });
  });

  it("blocks saving an invalid player count", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Edit/ }));
    fireEvent.change(await screen.findByDisplayValue("10"), { target: { value: "0" } });
    expect(await screen.findByText("At least 1 player")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save changes" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("LiveListingsTab tryouts and availability", () => {
  it("badges a held tryout and approves it through the moderation action", async () => {
    listListings.mockResolvedValue({
      total: 1,
      rows: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          kind: "tryout",
          title: "Fall Tryouts",
          event_date: "2099-11-01T18:00:00Z",
          moderation_status: "held",
          hidden_at: null,
          owner_name: "Hawks",
        },
      ],
    } as never);
    renderTab();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Tryouts & camps/ }));
    expect(await screen.findByText("Held for review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(moderate).toHaveBeenCalledTimes(1));
    expect(moderate.mock.calls[0][0]).toEqual({
      data: {
        kind: "posts",
        id: "22222222-2222-4222-8222-222222222222",
        action: "approve_text",
        reason: "Live listings tab",
      },
    });
  });

  it("shows availability levels per sport and intent", async () => {
    listListings.mockResolvedValue({
      total: 1,
      rows: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          user_id: "u1",
          sports: ["Basketball", "Soccer"],
          skill_level: "Rec League",
          skill_levels: { Basketball: "Rec League · High School" },
          looking_for: ["guest", "tryout"],
          status: "open",
          city: "Austin",
          hidden_at: null,
          owner_name: "Jo",
        },
      ],
    } as never);
    renderTab();
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Player availability/ }));
    expect(await screen.findByText("Basketball (Rec League · High School), Soccer")).toBeTruthy();
    expect(screen.getByText(/Guest player & Trying out · Austin/)).toBeTruthy();
  });
});
