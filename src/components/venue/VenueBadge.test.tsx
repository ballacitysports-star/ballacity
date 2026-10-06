// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ navigate: vi.fn(), result: { data: null as unknown, error: null } }));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => h.navigate }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => h.result }) }),
    }),
  },
}));

import { VenueBadge } from "./VenueBadge";

afterEach(() => {
  cleanup();
  h.navigate.mockReset();
  h.result = { data: null, error: null };
});

function renderBadge(orgId: string | null, onCardClick: () => void = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <a
        href="/games/g1"
        onClick={(e) => {
          e.preventDefault();
          onCardClick();
        }}
        data-testid="card"
      >
        <VenueBadge orgId={orgId} />
      </a>
    </QueryClientProvider>,
  );
}

describe("VenueBadge", () => {
  it("shows the facility name and opens its profile without triggering the card link", async () => {
    h.result = { data: { id: "o1", name: "Apex Basketball Hub", verified: true }, error: null };
    const cardClick = vi.fn();
    renderBadge("o1", cardClick);

    const badge = await screen.findByRole("button", { name: /Apex Basketball Hub/ });
    expect(badge.textContent).toContain("Apex Basketball Hub");
    expect(screen.getByLabelText("Verified")).toBeTruthy();

    fireEvent.click(badge);
    expect(h.navigate).toHaveBeenCalledWith({ to: "/orgs/$orgId", params: { orgId: "o1" } });
    expect(cardClick).not.toHaveBeenCalled(); // click stops at the badge
  });

  it("renders nothing for games without a facility, or a hidden/missing one", async () => {
    const none = renderBadge(null);
    expect(none.container.querySelector("button")).toBeNull();
    cleanup();

    h.result = { data: null, error: null }; // RLS hides removed facilities
    const { container } = renderBadge("gone");
    await waitFor(() => expect(container.querySelector("button")).toBeNull());
  });
});
