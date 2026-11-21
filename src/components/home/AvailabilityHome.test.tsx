// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * WP 1.6: the top of Home. A member with nothing listed sees a large "I'm available" card that opens the quick sheet;
 * a listed member sees where their availability stands, with "Still available" when it is running out; four shortcuts
 * follow, Invitations counting pending requests. Hidden when signed out, in parent mode, or when the switch is off.
 *
 * WP 4.1: a member who can't post yet gets a dialog saying why with the next step (never a silent redirect); a tap
 * while the check loads is answered once it settles; a placeholder holds the space while the switch loads; "My
 * availability" and "Invitations" open /availability.
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
  reason: null as null | string,
  gateLoading: false,
  settingHold: null as Promise<void> | null,
  navigate: vi.fn(),
  reconfirm: vi.fn(async () => {}),
  games: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    ...rest
  }: {
    children: React.ReactNode;
    to?: string;
    "aria-label"?: string;
  }) => (
    <a href={rest.to ?? "#"} aria-label={rest["aria-label"]}>
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
  availabilityGateMessage: (reason: string | null) => (reason ? `Why: ${reason}` : ""),
  useAvailabilityGate: () => ({
    canPost: env.canPost,
    reason: env.reason,
    loading: env.gateLoading,
  }),
}));
// The real notice reads profiles; here it only shows which reason it was given and the next step. Its switch
// button stands in for a successful "Switch to my player profile".
vi.mock("@/components/availability/AvailabilityRequiredNotice", () => ({
  AvailabilityRequiredNotice: ({
    reason,
    onSwitched,
  }: {
    reason: string;
    onSwitched?: () => void;
  }) => (
    <div>
      <p>Reason: {reason}</p>
      <a href="/profile/edit">Complete my profile</a>
      <button type="button" onClick={() => onSwitched?.()}>
        Stub: switched
      </button>
    </div>
  ),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (env.settingHold) await env.settingHold;
            return {
              data: env.setting === null ? null : { value: env.setting },
              error: env.settingError,
            };
          },
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
  QuickAvailabilitySheet: ({
    open,
    onMoreOptions,
  }: {
    open: boolean;
    onMoreOptions?: () => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="I'm available sheet">
        <button type="button" onClick={onMoreOptions}>
          More options
        </button>
      </div>
    ) : null,
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

function tree(qc: QueryClient) {
  return (
    <QueryClientProvider client={qc}>
      <AvailabilityHome onGames={env.games} />
    </QueryClientProvider>
  );
}

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(tree(qc));
  return { ...view, again: () => view.rerender(tree(qc)) };
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
  env.reason = null;
  env.gateLoading = false;
  env.settingHold = null;
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

  it("a member who cannot post yet gets a dialog saying why, with the next step, and stays on Home", async () => {
    env.canPost = false;
    env.reason = "incomplete_profile";
    show();
    fireEvent.click(await screen.findByRole("button", { name: /I'm available/ }));
    const dialog = await screen.findByRole("dialog", { name: "Post your availability" });
    expect(dialog.textContent).toContain("Reason: incomplete_profile");
    expect(screen.getByRole("link", { name: "Complete my profile" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "I'm available sheet" })).toBeNull();
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it("a tap while the posting check loads waits for it, then opens the sheet", async () => {
    env.canPost = false;
    env.gateLoading = true;
    const view = show();
    fireEvent.click(await screen.findByRole("button", { name: /I'm available/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(env.navigate).not.toHaveBeenCalled();
    env.gateLoading = false;
    env.canPost = true;
    view.again();
    expect(await screen.findByRole("dialog", { name: "I'm available sheet" })).toBeTruthy();
  });

  it("a tap while the check loads, for a member who then can't post, explains instead", async () => {
    env.canPost = false;
    env.gateLoading = true;
    const view = show();
    fireEvent.click(await screen.findByRole("button", { name: /I'm available/ }));
    env.gateLoading = false;
    env.reason = "wrong_profile";
    view.again();
    expect(await screen.findByRole("dialog", { name: "Post your availability" })).toBeTruthy();
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it("the dialog's description is the reason, so it is read with the title", async () => {
    env.canPost = false;
    env.reason = "incomplete_profile";
    show();
    fireEvent.click(await screen.findByRole("button", { name: /I'm available/ }));
    const dialog = await screen.findByRole("dialog", { name: "Post your availability" });
    const describedBy = dialog.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe("Why: incomplete_profile");
  });

  it("wrong profile: after switching to the player profile, the dialog closes and the quick sheet opens", async () => {
    env.canPost = false;
    env.reason = "wrong_profile";
    show();
    fireEvent.click(await screen.findByRole("button", { name: /I'm available/ }));
    await screen.findByRole("dialog", { name: "Post your availability" });
    // The switch writes the new active profile before it reports success, so the check already passes.
    env.canPost = true;
    env.reason = null;
    fireEvent.click(screen.getByRole("button", { name: "Stub: switched" }));
    expect(await screen.findByRole("dialog", { name: "I'm available sheet" })).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Post your availability" })).toBeNull(),
    );
  });

  it("switched, but the player profile still needs a level: the dialog shows that next step, not the sheet", async () => {
    env.canPost = false;
    env.reason = "wrong_profile";
    show();
    fireEvent.click(await screen.findByRole("button", { name: /I'm available/ }));
    await screen.findByRole("dialog", { name: "Post your availability" });
    env.reason = "incomplete_profile";
    fireEvent.click(screen.getByRole("button", { name: "Stub: switched" }));
    const dialog = await screen.findByRole("dialog", { name: "Post your availability" });
    await waitFor(() => expect(dialog.textContent).toContain("Reason: incomplete_profile"));
    expect(screen.getByRole("link", { name: "Complete my profile" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "I'm available sheet" })).toBeNull();
  });

  it("More options in the sheet opens the full form on My availability & invitations", async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /I'm available/ }));
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(env.navigate).toHaveBeenCalledWith({
      to: "/availability",
      search: { compose: "more" },
    });
  });

  it("listed: says so, links to My availability, offers another time", async () => {
    env.posts = [weekly("a", 1)];
    show();
    expect(await screen.findByText("You're available")).toBeTruthy();
    expect(screen.getByText(/Basketball · Listed until /)).toBeTruthy();
    expect(screen.getByRole("link", { name: "My availability" }).getAttribute("href")).toBe(
      "/availability",
    );
    expect(screen.getByRole("button", { name: /Add a time/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Still available" })).toBeNull();
  });

  it("Add a time follows the same posting check: the sheet, or the explanation", async () => {
    env.posts = [weekly("a", 1)];
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Add a time/ }));
    expect(screen.getByRole("dialog", { name: "I'm available sheet" })).toBeTruthy();
    cleanup();

    env.canPost = false;
    env.reason = "incomplete_profile";
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Add a time/ }));
    expect(await screen.findByRole("dialog", { name: "Post your availability" })).toBeTruthy();
    expect(env.navigate).not.toHaveBeenCalled();
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
    const link = await screen.findByRole("link", { name: "Invitations, 3 waiting" });
    expect(link.getAttribute("href")).toBe("/availability");
  });

  it("holds the space with a placeholder while the switch loads, then shows the card", async () => {
    let release = () => {};
    env.settingHold = new Promise<void>((r) => (release = r));
    const { container } = show();
    const skeleton = screen.getByTestId("home-availability-skeleton");
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    // The card (112px) and the shortcuts row (76px), so Home doesn't jump when it arrives.
    expect(skeleton.innerHTML).toContain("h-[112px]");
    expect(skeleton.innerHTML).toContain("h-[76px]");
    expect(screen.queryByRole("button", { name: /I'm available/ })).toBeNull();
    release();
    expect(await screen.findByRole("button", { name: /I'm available/ })).toBeTruthy();
    expect(container.querySelector('[data-testid="home-availability-skeleton"]')).toBeNull();
  });

  it("no placeholder in parent mode or signed out, even while the switch loads", () => {
    env.settingHold = new Promise<void>(() => {});
    env.parentMode = true;
    expect(show().container.innerHTML).toBe("");
    cleanup();
    env.parentMode = false;
    env.user = null;
    expect(show().container.innerHTML).toBe("");
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
