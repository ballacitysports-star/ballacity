// @vitest-environment jsdom
import type { ReactElement, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The Users tab of the /admin page (src/routes/admin.index.tsx): the "Make admin" and
 * "Revoke moderator" buttons. A role change the server refuses or fails shows the server's
 * message, never "Updated", and the list reloads; one change at a time.
 */

const USER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const member = {
  id: USER_ID,
  display_name: "Riley Member",
  username: "riley",
  sport: null,
  created_at: "2026-11-01T00:00:00Z",
  email: "riley@example.com",
  roles: [] as string[],
};

const listUsers = vi.fn(async (_: unknown) => ({ users: [member] }));
const setRole = vi.fn(async (_: unknown): Promise<unknown> => ({ ok: true }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => () => {},
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/admin.functions", () => ({
  adminCheck: async () => ({ isAdmin: true, userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
  adminListUsers: (a: unknown) => listUsers(a),
  adminSetRole: (a: unknown) => setRole(a),
  adminListReels: async () => ({ reels: [] }),
  adminRetryReel: async () => ({ ok: true }),
  adminRunReelWorker: async () => ({ ok: true }),
  adminListPayments: async () => ({ purchases: [], subscriptions: [] }),
  adminListReviews: async () => ({ reviews: [] }),
  adminDeleteReview: async () => ({ ok: true }),
  adminListGames: async () => ({ games: [] }),
}));
vi.mock("@/lib/legal-consent.functions", () => ({ getLegalConsentStats: async () => [] }));
vi.mock("@/lib/legal-consent", () => ({ usePublishedLegalDocuments: () => ({ published: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "admin" } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from "sonner";
import { Route } from "@/routes/admin.index";

const Page = (Route as unknown as { options: { component: () => ReactElement } }).options.component;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  listUsers.mockReset();
  setRole.mockReset();
});

/** Opens the Users tab and returns the member's "Make admin" button. */
async function openUsersTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  );
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Users" }));
  return (await screen.findByRole("button", { name: "Make admin" })) as HTMLButtonElement;
}

describe("/admin Users tab role buttons", () => {
  it("shows the server's reason when a grant fails, not 'Updated', and reloads the list", async () => {
    setRole.mockRejectedValueOnce(new Error("Could not grant the admin role: duplicate key"));
    fireEvent.click(await openUsersTab());

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Could not grant the admin role: duplicate key"),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(setRole).toHaveBeenCalledWith({ data: { userId: USER_ID, role: "admin", grant: true } });
    // Fetched again, so the badges and buttons show the roles the user really has.
    await waitFor(() => expect(listUsers).toHaveBeenCalledTimes(2));
  });

  it("allows one role change at a time", async () => {
    let finish: (v: unknown) => void = () => {};
    setRole.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const makeAdmin = await openUsersTab();
    const makeModerator = screen.getByRole("button", {
      name: "Make moderator",
    }) as HTMLButtonElement;

    fireEvent.click(makeAdmin);
    await waitFor(() => expect(makeAdmin.disabled).toBe(true));
    expect(makeModerator.disabled).toBe(true);
    fireEvent.click(makeAdmin);
    expect(setRole).toHaveBeenCalledTimes(1);

    listUsers.mockResolvedValue({ users: [{ ...member, roles: ["admin"] }] });
    finish({ ok: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Updated"));
    const revoke = (await screen.findByRole("button", {
      name: "Revoke admin",
    })) as HTMLButtonElement;
    await waitFor(() => expect(revoke.disabled).toBe(false));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
