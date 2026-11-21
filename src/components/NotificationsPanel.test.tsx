// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => () => {},
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
}));
vi.mock("@/lib/notifications", () => ({
  listMyNotifications: async () => n.items,
  markAllNotificationsRead: n.markAll,
  markNotificationRead: vi.fn(),
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
vi.mock("@/lib/deep-links", () => ({ resolveNotificationTarget: () => "/" }));

vi.mock("@/integrations/supabase/client", () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  return { supabase: { channel: () => channel, removeChannel: () => {} } };
});

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
