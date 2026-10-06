// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  navigate: vi.fn(),
  tryouts: [] as unknown[],
  asked: [] as unknown[],
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, className }: { children: ReactNode; className?: string }) => (
    <a className={className}>{children}</a>
  ),
  useNavigate: () => state.navigate,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock("@/components/ResponsiveImage", () => ({
  ResponsiveAvatar: ({ alt }: { alt?: string }) => <img alt={alt} />,
}));
vi.mock("@/components/tryouts/TryoutsSection", () => ({
  RsvpDialog: ({ tryout }: { tryout: { title: string } }) => (
    <div role="dialog">{`RSVP: ${tryout.title}`}</div>
  ),
}));
vi.mock("@/lib/tryouts.functions", () => ({
  listFacilityTryouts: (arg: unknown) => {
    state.asked.push(arg);
    return Promise.resolve(state.tryouts);
  },
}));

import type { TryoutListing } from "@/lib/tryouts.functions";
import { FacilityTryoutsSection } from "./FacilityTryoutsSection";

const tryout = (id: string, over: Partial<TryoutListing> = {}): TryoutListing => ({
  id,
  kind: "tryout",
  title: `Tryout ${id}`,
  body: "",
  eventDate: "2026-10-17T14:00:00.000Z",
  location: "Apex Basketball Hub",
  price: null,
  spotsMax: 20,
  spotsTaken: 5,
  teamId: "t1",
  teamName: "BallaCity Select",
  teamAvatar: null,
  teamVerified: false,
  teamAgeGroups: [],
  sports: ["Basketball"],
  waiverRequired: false,
  ...over,
});

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FacilityTryoutsSection orgId="org-1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.navigate.mockReset();
  state.asked = [];
  state.tryouts = [tryout("a"), tryout("b", { eventDate: "2026-10-10T14:00:00.000Z" })];
});
afterEach(cleanup);

describe("FacilityTryoutsSection", () => {
  it("asks for this facility's tryouts and lists them soonest first", async () => {
    renderSection();
    expect(await screen.findByRole("heading", { name: /Tryouts & camps here/ })).toBeTruthy();
    expect(state.asked).toEqual([{ data: { orgId: "org-1" } }]);
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Tryout b", "Tryout a"]);
  });

  it("renders nothing when the facility hosts no tryouts", async () => {
    state.tryouts = [];
    const { container } = renderSection();
    await vi.waitFor(() => expect(state.asked).toHaveLength(1));
    expect(container.querySelector("section")).toBeNull();
  });

  it("opens the RSVP flow for a signed-in player", async () => {
    renderSection();
    fireEvent.click((await screen.findAllByRole("button", { name: "RSVP / Apply" }))[0]);
    expect(screen.getByRole("dialog").textContent).toBe("RSVP: Tryout b");
  });

  it("sends a signed-out visitor to sign in and back to this facility", async () => {
    state.user = null;
    renderSection();
    fireEvent.click((await screen.findAllByRole("button", { name: "RSVP / Apply" }))[0]);
    expect(state.navigate).toHaveBeenCalledWith({ to: "/auth", search: { next: "/orgs/org-1" } });
  });
});
