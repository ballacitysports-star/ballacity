// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WP 1.6: the top of Home. A member with nothing listed sees a large "I'm available" card that opens the quick sheet
 * (or sends them to set up a player profile first); a listed member sees where their availability stands, with "Still
 * available" when it is running out; four shortcuts follow, Invitations counting pending requests. Hidden when signed
 * out, in parent mode, or when the switch is off.
 */
const env = vi.hoisted(() => ({
  user: { id: "me" } as { id: string } | null,
  parentMode: false,
  setting: null as unknown,
  settingError: null as unknown,
  posts: [] as Record<string, unknown>[],
  inbox: [] as { status: string }[],
  invites: [] as unknown[],
  canPost: true,
  navigate: vi.fn(),
  reconfirm: vi.fn(async () => {}),
  games: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode; "aria-label"?: string }) => (
    <a href="#" aria-label={rest["aria-label"]}>
      {children}
    </a>
  ),
  useNavigate: () => env.navigate,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: env.user }) }));
vi.mock("@/hooks/use-parent-mode", () => ({
  useParentMode: () => ({ isParentMode: env.parentMode }),
}));
vi.mock("@/lib/availability-gate", () => ({
  useAvailabilityGate: () => ({ canPost: env.canPost }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: env.setting === null ? null : { value: env.setting },
            error: env.settingError,
          }),
        }),
      }),
    }),
  },
}));
vi.mock("@/lib/availability", () => ({
  listMyAvailabilities: async () => env.posts,
  listMyContactRequests: async () => env.inbox,
  reconfirmAvailability: env.reconfirm,
}));
vi.mock("@/lib/game-invites", () => ({
  listMyPendingGameInvites: async () => env.invites,
  respondToGameInvite: vi.fn(),
  gameInviteErrorMessage: () => "",
}));
vi.mock("@/components/availability/QuickAvailabilitySheet", () => ({
  QuickAvailabilitySheet: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="I'm available sheet" /> : null,
}));

import { AvailabilityHome } from "./AvailabilityHome";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const weekly = (id: string, confirmedDaysAgo: number) => ({
  id,
  user_id: "me",
  status: "open",
  sports: ["Basketball"],
  time_slots: [{ weekday: 2, start: "18:00", end: "20:00" }],
  timezone: "America/New_York",
  last_confirmed_at: ago(confirmedDaysAgo),
});

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AvailabilityHome onGames={env.games} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  env.user = { id: "me" };
  env.parentMode = false;
  env.setting = null;
  env.settingError = null;
  env.posts = [];
  env.inbox = [];
  env.invites = [];
  env.canPost = true;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AvailabilityHome", () => {
  it("nothing listed: a large I'm available card that opens the quick sheet, then four shortcuts", async () => {
    show();
    const card = await screen.findByRole("button", { name: /I'm available/ });
    for (const name of ["Find players", "Invitations"]) {
      expect(screen.getByRole("link", { name })).toBeTruthy();
    }
    // /discover only redirects to Home, so the games shortcuts use Home's own list.
    fireEvent.click(screen.getByRole("button", { name: "Find games" }));
    fireEvent.click(screen.getByRole("button", { name: "My games" }));
    expect(env.games.mock.calls).toEqual([["all"], ["joined"]]);
    fireEvent.click(card);
    expect(screen.getByRole("dialog", { name: "I'm available sheet" })).toBeTruthy();
  });

  it("a member who cannot post yet is sent to My availability, where the setup notice is", async () => {
    env.canPost = false;
    show();
    fireEvent.click(await screen.findByRole("button", { name: /I'm available/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(env.navigate).toHaveBeenCalledWith(expect.objectContaining({ to: "/players" }));
  });

  it("listed: says so, links to My availability, offers another time", async () => {
    env.posts = [weekly("a", 1)];
    show();
    expect(await screen.findByText("You're available")).toBeTruthy();
    expect(screen.getByText(/Basketball · Listed until /)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add a time/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Still available" })).toBeNull();
  });

  it("running out: Still available in one tap", async () => {
    env.posts = [weekly("soon", 12)];
    show();
    expect(await screen.findByText("Still available to play?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Still available" }));
    await waitFor(() => expect(env.reconfirm).toHaveBeenCalledWith("soon", "open"));
  });

  it("counts pending requests and game invitations", async () => {
    env.inbox = [{ status: "pending" }, { status: "pending" }, { status: "accepted" }];
    env.invites = [{ id: "i1" }];
    show();
    expect(await screen.findByRole("link", { name: "Invitations, 3 waiting" })).toBeTruthy();
  });

  it("hidden when the switch is off, in parent mode, or signed out; a failed read keeps it", async () => {
    env.setting = { enabled: false };
    const off = show();
    await new Promise((r) => setTimeout(r, 20));
    expect(off.container.innerHTML).toBe("");
    cleanup();

    env.setting = null;
    env.parentMode = true;
    expect(show().container.innerHTML).toBe("");
    cleanup();

    env.parentMode = false;
    env.user = null;
    expect(show().container.innerHTML).toBe("");
    cleanup();

    env.user = { id: "me" };
    env.settingError = { message: "boom" };
    show();
    expect(await screen.findByRole("button", { name: /I'm available/ })).toBeTruthy();
  });
});
