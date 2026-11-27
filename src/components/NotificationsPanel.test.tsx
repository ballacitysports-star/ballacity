// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const router = vi.hoisted(() => ({ nav: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => router.nav,
}));
vi.mock("@/lib/auth-return", () => ({ useAuthSearchHere: () => ({}) }));

const auth = vi.hoisted(() => ({
  user: { id: "me", app_metadata: {} } as { id: string; app_metadata: object } | null,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: auth.user, loading: false }) }));

const staff = vi.hoisted(() => ({ isSuperadmin: false, isAdmin: false, isModerator: false }));
vi.mock("@/hooks/use-staff-access", () => ({
  useStaffAccess: () => ({ access: staff, loading: false }),
}));

const n = vi.hoisted(() => ({
  serverUnread: 0 as number | null,
  setCount: vi.fn(),
  refresh: vi.fn(),
  markAll: vi.fn(),
  permission: "granted" as "granted" | "denied" | "default" | "unsupported",
  requestPush: vi.fn(),
  ensureSub: vi.fn(),
  items: [] as unknown[],
  markRead: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  listMyNotifications: async () => n.items,
  markAllNotificationsRead: n.markAll,
  markNotificationRead: n.markRead,
  markNotificationUnread: vi.fn(),
  deleteNotification: vi.fn(),
  pushPermissionState: () => n.permission,
  requestPushPermission: n.requestPush,
  ensureOneSignalSubscription: n.ensureSub,
  dismissPushPrompt: vi.fn(),
  isPushPromptDismissed: () => false,
  useUnreadNotificationCountState: () => ({
    count: n.serverUnread,
    refresh: n.refresh,
    setCount: n.setCount,
  }),
}));

const device = vi.hoisted(() => ({ state: "subscribed" as string }));
vi.mock("@/lib/onesignal", () => ({ devicePushSubscriptionState: async () => device.state }));

const delivery = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/push-delivery", () => ({ loadPushDeliveryIssues: delivery.load }));

vi.mock("@/lib/notification-prefs", () => ({
  CATEGORY_META: new Proxy({}, { get: (_t, k) => ({ label: String(k), description: "" }) }),
  setNotifPref: vi.fn(),
  useNotifPrefs: () =>
    new Proxy({}, { get: () => ({ inApp: true, push: true }) }) as Record<string, unknown>,
  useHydrateNotifPrefs: () => {},
}));
vi.mock("@/lib/notification-actors", () => ({
  useNotificationActorId: () => null,
  usePrefetchNotificationActors: () => {},
}));
vi.mock("@/components/UserAvatar", () => ({ UserAvatarById: () => null }));
vi.mock("@/lib/deep-links", () => ({
  resolveNotificationTarget: (row: { link?: string }) => row.link ?? "/",
}));

// Each channel() call gets its own channel, recorded with its name, options and subscribe callback. No status is
// ever sent on its own: a test that needs SUBSCRIBED calls the recorded callback.
type StatusCb = (status: string, err?: Error) => void;
const rt = vi.hoisted(() => ({
  opened: [] as { name: string; options: unknown; onStatus?: StatusCb }[],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (name: string, options?: unknown) => {
      const entry: (typeof rt.opened)[number] = { name, options };
      rt.opened.push(entry);
      const channel = {
        on: () => channel,
        subscribe: (cb?: StatusCb) => {
          entry.onStatus = cb;
          return channel;
        },
      };
      return channel;
    },
    removeChannel: () => {},
  },
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), plain: vi.fn() }));
vi.mock("sonner", () => ({
  toast: Object.assign(toasts.plain, { success: toasts.success, error: toasts.error }),
}));

import { NotificationsPanel, PushPrompt } from "./NotificationsPanel";

const issue = {
  id: "d1",
  created_at: "2026-11-19T10:00:00Z",
  error: "OneSignal 400: invalid_player_ids",
  notification_id: "n1",
  status: "failed",
  channel: "push",
};

beforeEach(() => {
  delivery.load.mockResolvedValue([issue]);
  window.localStorage.clear();
  rt.opened.length = 0;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  auth.user = { id: "me", app_metadata: {} };
  staff.isSuperadmin = false;
  n.serverUnread = 0;
  n.permission = "granted";
  n.items = [];
  device.state = "subscribed";
});

async function renderPanel() {
  render(<NotificationsPanel />);
  await act(async () => {});
}

describe("NotificationsPanel push notices", () => {
  it("never shows a member the push delivery diagnostics or the provider's reason", async () => {
    await renderPanel();
    expect(screen.queryByText("Push delivery issue")).toBeNull();
    expect(document.body.textContent).not.toMatch(/OneSignal|invalid_player_ids/);
    expect(delivery.load).not.toHaveBeenCalled();
  });

  it("keeps the delivery diagnostics for superadmins", async () => {
    staff.isSuperadmin = true;
    await renderPanel();
    expect(await screen.findByText("Push delivery issue")).toBeTruthy();
    expect(delivery.load).toHaveBeenCalledWith(expect.anything(), "me");
  });

  it("offers a member a plain prompt when push is not allowed yet, through the app's enable flow", async () => {
    n.permission = "default";
    n.requestPush.mockResolvedValue({ permission: "granted", subscribed: true });
    await renderPanel();
    expect(screen.getByText("Turn on push notifications")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(n.requestPush).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Push notifications are on for this device."),
    );
  });

  it("offers the prompt when push is allowed but this device is not subscribed", async () => {
    device.state = "not_subscribed";
    n.ensureSub.mockResolvedValue(true);
    await renderPanel();
    expect(await screen.findByText("Turn on push notifications")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(n.ensureSub).toHaveBeenCalledTimes(1));
    expect(n.requestPush).not.toHaveBeenCalled();
  });

  it("shows no prompt when this device already gets push", async () => {
    await renderPanel();
    expect(screen.queryByText("Turn on push notifications")).toBeNull();
  });

  it("does not report success when the browser allows push but no subscription was made", async () => {
    n.permission = "default";
    n.requestPush.mockResolvedValue({ permission: "granted", subscribed: false });
    n.ensureSub.mockResolvedValue(false);
    device.state = "not_subscribed";
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(
        "Couldn't turn on push notifications on this device. Please try again.",
      ),
    );
    expect(toasts.success).not.toHaveBeenCalled();
    // Still no subscription, so the prompt stays to try again instead of contradicting the toast.
    expect(await screen.findByText("Turn on push notifications")).toBeTruthy();
  });

  it("never offers a managed child the prompt, even before the browser has been asked", async () => {
    auth.user = { id: "kid", app_metadata: { managed: true } };
    for (const permission of ["default", "denied", "granted"] as const) {
      n.permission = permission;
      device.state = "not_subscribed";
      await renderPanel();
      expect(screen.queryByText("Turn on push notifications")).toBeNull();
      expect(screen.queryByText("Push notifications are blocked")).toBeNull();
      cleanup();
    }
    expect(n.requestPush).not.toHaveBeenCalled();
  });

  it("paints nothing on the first render, before the real permission and dismissal are known", () => {
    // renderToString runs no effects: this is what the first paint shows.
    for (const permission of ["default", "granted", "denied"] as const) {
      n.permission = permission;
      expect(renderToString(<PushPrompt />)).toBe("");
    }
  });
});

describe("NotificationsPanel mark all read", () => {
  it("shows the server's unread count, not the loaded rows", async () => {
    n.serverUnread = 250;
    n.items = [];
    await renderPanel();
    expect(screen.getByRole("button", { name: /Mark all read \(250\)/ })).toBeTruthy();
  });

  it("marks every unread notification on the server and reports how many", async () => {
    n.serverUnread = 250;
    n.markAll.mockResolvedValue(250);
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Mark all read/ }));
    await waitFor(() => expect(n.markAll).toHaveBeenCalledWith("me"));
    await waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith("Marked 250 notifications as read"),
    );
    expect(n.setCount).toHaveBeenCalledWith(0);
    expect(n.refresh).toHaveBeenCalled();
  });

  it("puts the count back and words the failure plainly, without the raw error", async () => {
    n.serverUnread = 3;
    n.markAll.mockRejectedValue({ message: "JWT expired xyz", code: "PGRST301" });
    await renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Mark all read/ }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    const text = toasts.error.mock.calls[0][0] as string;
    expect(text).not.toMatch(/JWT|PGRST|xyz/);
    expect(n.setCount).toHaveBeenLastCalledWith(3);
  });

  it("stays usable with the loaded unread count when the server count is unknown", async () => {
    n.serverUnread = null;
    n.items = [
      { id: "a", read_at: null, created_at: "2026-11-19T10:00:00Z", type: "system", title: "A" },
      { id: "b", read_at: null, created_at: "2026-11-19T09:00:00Z", type: "system", title: "B" },
    ];
    await renderPanel();
    const b = (await screen.findByRole("button", {
      name: /Mark all read \(2\)/,
    })) as HTMLButtonElement;
    expect(b.disabled).toBe(false);
  });

  it("is disabled when the server says nothing is unread", async () => {
    await renderPanel();
    const b = screen.getByRole("button", { name: /Mark all read/ }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
  });
});

describe("NotificationsPanel opening an alert", () => {
  const unreadInvite = {
    id: "inv",
    read_at: null,
    created_at: "2026-11-19T10:00:00Z",
    type: "game_invite",
    title: "You're invited",
    link: "/games/g1?invite=1",
  };

  it("opens the alert at once, without waiting for the read mark to be saved", async () => {
    n.items = [unreadInvite];
    let settle: () => void = () => {};
    n.markRead.mockReturnValue(new Promise<void>((resolve) => (settle = resolve)));
    await renderPanel();
    fireEvent.click(await screen.findByText("You're invited"));
    // The save has not answered, and the alert is already being opened.
    expect(n.markRead).toHaveBeenCalledWith("inv");
    expect(router.nav).toHaveBeenCalledWith({ href: "/games/g1?invite=1" });
    expect(n.refresh).not.toHaveBeenCalled();
    await act(async () => settle());
    expect(n.refresh).toHaveBeenCalled();
  });

  it("still opens the alert when the read mark fails, and leaves the count alone", async () => {
    n.items = [unreadInvite];
    n.markRead.mockRejectedValue(new Error("offline"));
    await renderPanel();
    fireEvent.click(await screen.findByText("You're invited"));
    expect(router.nav).toHaveBeenCalledWith({ href: "/games/g1?invite=1" });
    await act(async () => {});
    expect(n.refresh).not.toHaveBeenCalled();
  });

  it("does not mark an alert that is already read", async () => {
    n.items = [{ ...unreadInvite, read_at: "2026-11-19T11:00:00Z" }];
    await renderPanel();
    fireEvent.click(await screen.findByText("You're invited"));
    expect(n.markRead).not.toHaveBeenCalled();
    expect(router.nav).toHaveBeenCalledWith({ href: "/games/g1?invite=1" });
  });
});

describe("NotificationsPanel live list", () => {
  const listChannel = () => rt.opened.find((c) => c.name === "notif-list-me");
  const sendStatus = async (status: string) => {
    await act(async () => listChannel()!.onStatus!(status));
  };

  it("opens the list channel with wait, so SUBSCRIBED means changes are live", async () => {
    await renderPanel();
    expect(listChannel()?.options).toStrictEqual({
      config: { postgres_changes_options: { wait: true } },
    });
  });

  it("re-reads the list and the unread count on the first SUBSCRIBED and on each rejoin", async () => {
    await renderPanel();
    expect(n.refresh).not.toHaveBeenCalled();
    // A row written after the mount load answered but before changes were live.
    n.items = [
      {
        id: "late",
        read_at: null,
        created_at: "2026-11-19T10:00:00Z",
        type: "system",
        title: "Late",
      },
    ];
    await sendStatus("SUBSCRIBED");
    expect(await screen.findByText("Late")).toBeTruthy();
    expect(n.refresh).toHaveBeenCalledTimes(1);

    n.items = [
      {
        id: "gap",
        read_at: null,
        created_at: "2026-11-19T11:00:00Z",
        type: "system",
        title: "Gap",
      },
      ...n.items,
    ];
    await sendStatus("CHANNEL_ERROR");
    await sendStatus("SUBSCRIBED");
    expect(await screen.findByText("Gap")).toBeTruthy();
    expect(n.refresh).toHaveBeenCalledTimes(2);
  });

  it("says Connecting before the first SUBSCRIBED, Live once joined, and Reconnecting after a drop", async () => {
    await renderPanel();
    expect(screen.getByText("Connecting…")).toBeTruthy();
    // An error before the channel has ever joined is still the first connect.
    await sendStatus("TIMED_OUT");
    expect(screen.getByText("Connecting…")).toBeTruthy();
    await sendStatus("SUBSCRIBED");
    expect(screen.getByText("Live")).toBeTruthy();
    await sendStatus("CHANNEL_ERROR");
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
  });

  it("keeps the newest list when an older load answers last", async () => {
    let answerFirst: (rows: unknown[]) => void = () => {};
    const first = new Promise<unknown[]>((resolve) => (answerFirst = resolve));
    const newer = [
      {
        id: "new",
        read_at: null,
        created_at: "2026-11-19T12:00:00Z",
        type: "system",
        title: "Newer",
      },
    ];
    let calls = 0;
    const notifications = await import("@/lib/notifications");
    const spy = vi
      .spyOn(notifications, "listMyNotifications")
      .mockImplementation(() => (++calls === 1 ? first : Promise.resolve(newer)) as never);
    await renderPanel();
    await sendStatus("SUBSCRIBED");
    expect(await screen.findByText("Newer")).toBeTruthy();
    await act(async () =>
      answerFirst([
        {
          id: "old",
          read_at: null,
          created_at: "2026-11-19T09:00:00Z",
          type: "system",
          title: "Older",
        },
      ]),
    );
    expect(screen.getByText("Newer")).toBeTruthy();
    expect(screen.queryByText("Older")).toBeNull();
    spy.mockRestore();
  });

  it("opens the superadmin delivery-log channel without wait, since that table is not published", async () => {
    staff.isSuperadmin = true;
    await renderPanel();
    await screen.findByText("Push delivery issue");
    const deliv = rt.opened.find((c) => c.name === "notif-deliv-me");
    expect(deliv).toBeTruthy();
    expect(deliv!.options).toBeUndefined();
  });
});
