// @vitest-environment jsdom
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { endDialogExit, holdDialogExitAnimation } from "@/components/ui/hold-dialog-exit.testutil";

/**
 * The "Host a game" route (src/routes/_tabs.create.tsx) and its Publish step (WP 4.2),
 * rendered with the hosting gates passed: an adult signed in, hosting as themselves.
 * Checks the route's own wiring, which PublishStepDialog.test.tsx does not reach: an
 * invalid form never opens the step and focuses the first problem (opening More options
 * for one hidden there); the host acknowledgment is never pre-checked and is asked again
 * on every open; nothing is published without it; and publishing records it per game.
 */

const nav = vi.fn();
const addHostedGame = vi.fn(async (_: unknown) => ({ id: "game-1" }));
const recordSafetyAck = vi.fn(async (_: unknown) => {});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options, useSearch: () => ({}) }),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => nav,
  useRouter: () => ({ history: { back: () => {} } }),
  useLocation: () => ({ pathname: "/create" }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/components/public/PreviewGate", () => ({
  PreviewGate: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "host-1", email: "host@example.com" }, loading: false }),
}));
vi.mock("@/lib/user-prefs-store", () => ({
  useMyProfile: () => ({
    name: "Sam Host",
    username: "sam",
    avatar: "SH",
    city: "Austin",
    stats: { sportsmanship: 5 },
  }),
}));
vi.mock("@/lib/child-safety", () => ({
  useMyChildStatus: () => ({
    can: () => ({ allowed: true }),
    status: { cohort: "adult" },
    isLoading: false,
  }),
}));
vi.mock("@/lib/account-profiles", () => ({ useMyProfiles: () => ({ active: null }) }));
vi.mock("@/lib/default-sports", () => ({
  useDefaultSports: () => ({ sports: [], loaded: true }),
}));
vi.mock("@/lib/availability-gate", () => ({
  useAvailabilityGate: () => ({ loading: false, hasOpenAvailability: true }),
}));
vi.mock("@/components/availability/AvailabilityPromptDialog", () => ({
  AvailabilityPromptBanner: () => null,
}));
vi.mock("@/components/layout/BackButton", () => ({ BackButton: () => null }));
vi.mock("@/components/ImageUploader", () => ({ ImageUploader: () => null }));
vi.mock("@/components/LocationAutocomplete", () => ({
  LocationAutocomplete: (p: {
    inputId: string;
    ariaLabel: string;
    value: string;
    onChange: (v: string) => void;
    ariaInvalid?: boolean;
    ariaDescribedBy?: string;
  }) => (
    <input
      id={p.inputId}
      aria-label={p.ariaLabel}
      aria-invalid={p.ariaInvalid || undefined}
      aria-describedby={p.ariaDescribedBy}
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
    />
  ),
}));
vi.mock("@/lib/teams.functions", () => ({ listMyTeams: async () => [] }));
vi.mock("@/lib/trainer-orgs.functions", () => ({
  getOrgEventContext: async () => ({ org: null, official: false }),
  listMyManagedOrgs: async () => [],
}));
vi.mock("@/lib/geocode.functions", () => ({
  geocodeAddress: async () => ({ lat: 30.27, lng: -97.74 }),
}));
vi.mock("@/lib/hosted-games-store", () => ({
  addHostedGame: (a: unknown) => addHostedGame(a),
  fetchHostedGame: async () => null,
}));
vi.mock("@/lib/safety-acks", () => ({ recordSafetyAck: (a: unknown) => recordSafetyAck(a) }));
vi.mock("@/lib/payments", () => ({ upsertGamePaymentSettings: async () => ({}) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {}, trackTaskError: () => {} }));
vi.mock("@/lib/nav-analytics", () => ({ trackOpenCreate: () => {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/host-snapshot", () => ({
  resolveHostSnapshot: async () => ({ name: "Sam Host", username: "sam", avatar: "SH" }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import { Route } from "@/routes/_tabs.create";

const Page = (Route as unknown as { options: { component: () => ReactElement } }).options.component;

function renderCreate() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}

const venueBox = () => screen.getByRole("textbox", { name: "Venue" });
const submit = () => fireEvent.click(screen.getByRole("button", { name: /^review and publish$/i }));
const publishStep = () => screen.queryByRole("dialog", { name: /publish this game\?/i });
const hostAckBox = () => screen.getByRole("checkbox");
const publishButton = () =>
  screen.getByRole("button", { name: /^(publish game|acknowledge to publish)$/i });

async function openPublishStep() {
  renderCreate();
  await screen.findByRole("button", { name: /^review and publish$/i });
  fireEvent.change(venueBox(), { target: { value: "Rucker Park, 155th St" } });
  submit();
  await waitFor(() => expect(publishStep()).not.toBeNull());
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* no storage */
  }
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Host a game: the form's button checks the fields first", () => {
  it("an invalid form shows its problems, never opens the Publish step, and focuses the first field", async () => {
    renderCreate();
    await screen.findByRole("button", { name: /^review and publish$/i });
    submit();
    expect(publishStep()).toBeNull();
    expect(venueBox().getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("create-venue-error")?.textContent).toMatch(/add where/i);
    // The count summary is polite: it changes as each field is fixed while typing.
    const summary = document.getElementById("create-form-error");
    expect(summary?.getAttribute("role")).toBe("status");
    await waitFor(() => expect(document.activeElement).toBe(venueBox()));
    expect(addHostedGame).not.toHaveBeenCalled();
    expect(recordSafetyAck).not.toHaveBeenCalled();
  });

  it("a problem under a closed More options opens that section and focuses the field", async () => {
    renderCreate();
    await screen.findByRole("button", { name: /^review and publish$/i });
    fireEvent.change(venueBox(), { target: { value: "Rucker Park, 155th St" } });
    const more = screen.getByRole("button", { name: /more options/i });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("switch", { name: "Paid game" }));
    fireEvent.change(screen.getByLabelText("Entry fee in dollars"), { target: { value: "0" } });
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("false");

    submit();
    expect(publishStep()).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    const fee = screen.getByLabelText("Entry fee in dollars");
    expect(fee.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(fee));
  });
});

describe("Host a game: the Publish step", () => {
  it("opens on a valid form with the host acknowledgment unticked and Publish disabled", async () => {
    await openPublishStep();
    expect(hostAckBox().getAttribute("aria-checked")).toBe("false");
    expect((publishButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("publish-summary").textContent).toContain("Rucker Park, 155th St");
  });

  it("asks again every time: closing and reopening clears the tick", async () => {
    await openPublishStep();
    fireEvent.click(hostAckBox());
    expect(hostAckBox().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^back to edit$/i }));
    await waitFor(() => expect(publishStep()).toBeNull());

    submit();
    await waitFor(() => expect(publishStep()).not.toBeNull());
    expect(hostAckBox().getAttribute("aria-checked")).toBe("false");
    expect((publishButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps the summary on screen while the step fades out after Back to edit", async () => {
    holdDialogExitAnimation();
    await openPublishStep();
    fireEvent.click(screen.getByRole("button", { name: /^back to edit$/i }));
    const closing = screen.getByRole("dialog", { hidden: true });
    expect(closing.getAttribute("data-state")).toBe("closed");
    expect(screen.getByTestId("publish-summary").textContent).toContain("Rucker Park, 155th St");
    endDialogExit();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });

  it("publishes nothing without the tick", async () => {
    await openPublishStep();
    fireEvent.click(publishButton());
    await act(async () => {});
    expect(addHostedGame).not.toHaveBeenCalled();
    expect(recordSafetyAck).not.toHaveBeenCalled();
  });

  it("with the tick: publishes and records the host acknowledgment for the game", async () => {
    await openPublishStep();
    fireEvent.click(hostAckBox());
    fireEvent.click(publishButton());
    await waitFor(() => expect(addHostedGame).toHaveBeenCalledTimes(1));
    expect(addHostedGame.mock.calls[0][0]).toMatchObject({ location: "Rucker Park, 155th St" });
    await waitFor(() =>
      expect(recordSafetyAck).toHaveBeenCalledWith({
        gameId: "game-1",
        kind: "host_responsibility",
      }),
    );
    await waitFor(() =>
      expect(nav).toHaveBeenCalledWith(expect.objectContaining({ to: "/games/$gameId" })),
    );
  });
});
