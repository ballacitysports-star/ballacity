// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  user: { id: "u1" } as { id: string } | null,
  managedTeams: [] as { id: string; name: string }[],
  navigate: vi.fn(),
  tryouts: [] as unknown[],
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
  RsvpDialog: ({ tryout, onClose }: { tryout: { title: string }; onClose: () => void }) => (
    <div role="dialog">
      {`RSVP: ${tryout.title}`}
      <button type="button" onClick={onClose}>
        close
      </button>
    </div>
  ),
  PostTryoutDialog: () => <div role="dialog">post a tryout</div>,
}));
vi.mock("@/lib/tryouts.functions", () => ({
  listUpcomingTryouts: () => Promise.resolve(state.tryouts),
  listMyManagedTeams: () => Promise.resolve(state.managedTeams),
}));

import type { TryoutListing } from "@/lib/tryouts.functions";
import { TryoutsCampsSection } from "./TryoutsCampsSection";

const tryout = (over: Partial<TryoutListing> = {}): TryoutListing => ({
  id: "p1",
  kind: "tryout",
  title: "U14 fall tryouts",
  body: "",
  eventDate: "2026-10-17T14:00:00.000Z",
  location: "Bogan Park",
  price: null,
  spotsMax: 30,
  spotsTaken: 3,
  teamId: "t1",
  teamName: "BallaCity Select",
  teamAvatar: null,
  teamVerified: true,
  teamAgeGroups: [],
  sports: ["Basketball"],
  waiverRequired: true,
  ...over,
});

function renderSection(sports: string[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TryoutsCampsSection sports={sports} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.user = { id: "u1" };
  state.managedTeams = [];
  state.navigate.mockReset();
  state.tryouts = [tryout()];
});
afterEach(cleanup);

describe("TryoutsCampsSection", () => {
  it("shows the badge, age division, club, venue and spots with waiver status", async () => {
    renderSection();
    expect(await screen.findByText("U14 fall tryouts")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Tryouts & Camps/ })).toBeTruthy();
    expect(screen.getByText("Tryout")).toBeTruthy();
    expect(screen.getByText("14U")).toBeTruthy();
    expect(screen.getByText("Free")).toBeTruthy();
    expect(screen.getByText("BallaCity Select")).toBeTruthy();
    expect(screen.getByLabelText("Verified team")).toBeTruthy();
    expect(screen.getByText(/^\w{3} Oct \d{1,2} · \d{1,2}:\d{2} [AP]M · Bogan Park$/)).toBeTruthy();
    expect(screen.getByText("27 spots left · Waiver required")).toBeTruthy();
    expect(screen.getByRole("button", { name: "RSVP / Apply" })).toBeTruthy();
  });

  it("labels camps and clinics, and open age divisions", async () => {
    state.tryouts = [tryout({ kind: "clinic", title: "Skills camp", price: 25 })];
    renderSection();
    expect(await screen.findByText("Camp / Clinic")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("$25")).toBeTruthy();
  });

  it("leaves the waiver out of the line when its status is unknown", async () => {
    state.tryouts = [tryout({ waiverRequired: null })];
    renderSection();
    expect(await screen.findByText("27 spots left")).toBeTruthy();
  });

  it("filters by the selected sports and says so when nothing matches", async () => {
    renderSection(["Soccer"]);
    expect(
      await screen.findByText("No open tryouts or camps for the sports you picked."),
    ).toBeTruthy();
    expect(screen.queryByText("U14 fall tryouts")).toBeNull();
  });

  it("disables a full event", async () => {
    state.tryouts = [tryout({ spotsTaken: 30 })];
    renderSection();
    const full = (await screen.findByRole("button", { name: "Full" })) as HTMLButtonElement;
    expect(full.disabled).toBe(true);
  });

  it("opens the RSVP flow for a signed-in player", async () => {
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "RSVP / Apply" }));
    expect(screen.getByRole("dialog").textContent).toContain("RSVP: U14 fall tryouts");
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in, returning to the feed", async () => {
    state.user = null;
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "RSVP / Apply" }));
    expect(state.navigate).toHaveBeenCalledWith({ to: "/auth", search: { next: "/feed" } });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers Post a tryout only to people who manage a team", async () => {
    const view = renderSection();
    await screen.findByText("U14 fall tryouts");
    expect(screen.queryByRole("button", { name: "Post a tryout" })).toBeNull();
    view.unmount();

    state.managedTeams = [{ id: "t1", name: "BallaCity Select" }];
    renderSection();
    const post = await screen.findByRole("button", { name: "Post a tryout" });
    fireEvent.click(post);
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toBe("post a tryout"));
  });
});
