// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  pathname: "/feed",
  mobile: false,
}));

vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: any) => select({ location: { pathname: state.pathname } }),
  useLocation: ({ select }: { select: (l: { href: string }) => unknown }) =>
    select({ href: state.pathname }),
  Link: ({ to, children, onClick, className }: any) => (
    <a href={to} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: state.user, loading: false }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.mobile }));
vi.mock("@/lib/support/support.functions", () => ({ askSupportAssistant: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// vaul needs browser APIs jsdom lacks; the content is what matters here.
vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: any) =>
    open ? <div data-testid="mobile-drawer">{children}</div> : null,
  DrawerContent: ({ children }: any) => <div role="dialog">{children}</div>,
  DrawerHeader: ({ children }: any) => <div>{children}</div>,
  DrawerTitle: ({ children }: any) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: any) => <p>{children}</p>,
}));

import { getSupportState, openSupport, resetSupportStore } from "@/lib/support/support-store";
import { SupportAssistantHost } from "./SupportAssistantHost";

const signedIn = (id = "u1") => (state.user = { id, email: `${id}@example.com` });

beforeEach(() => {
  state.user = null;
  state.pathname = "/feed";
  state.mobile = false;
  resetSupportStore();
});
afterEach(cleanup);

describe("floating Help button", () => {
  it("is not shown to signed-out visitors", () => {
    render(<SupportAssistantHost />);
    expect(screen.queryByRole("button", { name: "Help and support" })).toBeNull();
  });

  it("is shown to signed-in members, as a labelled 44px target", () => {
    signedIn();
    render(<SupportAssistantHost />);
    const btn = screen.getByRole("button", { name: "Help and support" });
    expect(btn.className).toMatch(/h-11 w-11/);
    // Its bottom offset (safe area, and lift over fixed bottom bars) lives in the .help-launcher rule.
    expect(btn.className).toMatch(/(^| )help-launcher( |$)/);
  });

  it("stays out of the way on /contact, which has its own Help card", () => {
    signedIn();
    state.pathname = "/contact";
    render(<SupportAssistantHost />);
    expect(screen.queryByRole("button", { name: "Help and support" })).toBeNull();
  });

  it.each([
    "/create",
    "/create/",
    "/games/g1/pay",
    "/games/g1/pay/",
    "/orgs/create",
    "/teams/create",
    "/trainers/create",
    "/orgs/o1/edit",
    "/teams/t1/edit/",
    "/trainers/tr1/edit",
  ])(
    "stays off %s, where it would sit on form labels and the publish, Next or pay button",
    (path) => {
      signedIn();
      state.pathname = path;
      render(<SupportAssistantHost />);
      expect(screen.queryByRole("button", { name: "Help and support" })).toBeNull();
    },
  );

  it.each([
    "/games/g1",
    "/games/g1/payment-setup",
    "/feed",
    "/players",
    "/trainers/tr1",
    "/teams/t1",
  ])("is still shown on %s (fixed bottom bars lift it instead)", (path) => {
    signedIn();
    state.pathname = path;
    render(<SupportAssistantHost />);
    expect(screen.getByRole("button", { name: "Help and support" })).toBeTruthy();
  });
});

describe("the drawer", () => {
  it("opens as a side panel on desktop, with a title and description", async () => {
    signedIn();
    render(<SupportAssistantHost />);
    fireEvent.click(screen.getByRole("button", { name: "Help and support" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("BallaCity Help");
    expect(dialog.textContent).toContain("Quick answers and an AI assistant");
    expect(screen.queryByTestId("mobile-drawer")).toBeNull();
    expect(await screen.findByLabelText(/ask ballacity help/i)).toBeTruthy();
  });

  it("opens as a bottom drawer on mobile", async () => {
    signedIn();
    state.mobile = true;
    render(<SupportAssistantHost />);
    fireEvent.click(screen.getByRole("button", { name: "Help and support" }));
    expect(screen.getByTestId("mobile-drawer")).toBeTruthy();
    expect(await screen.findByLabelText(/ask ballacity help/i)).toBeTruthy();
  });

  it("hides the button while the drawer is open", () => {
    signedIn();
    render(<SupportAssistantHost />);
    fireEvent.click(screen.getByRole("button", { name: "Help and support" }));
    expect(screen.queryByRole("button", { name: "Help and support" })).toBeNull();
  });

  it("can be opened from anywhere, and shows only written answers when signed out", async () => {
    render(<SupportAssistantHost />);
    act(() => openSupport());
    expect(screen.getByRole("dialog").textContent).toContain("BallaCity Help");
    expect(await screen.findByRole("button", { name: "Paying for games" })).toBeTruthy();
    expect(screen.queryByLabelText(/ask ballacity help/i)).toBeNull();
  });

  it("closes and forgets the chat when a different member signs in", () => {
    signedIn("u1");
    const { rerender } = render(<SupportAssistantHost />);
    fireEvent.click(screen.getByRole("button", { name: "Help and support" }));
    expect(getSupportState().open).toBe(true);
    signedIn("u2");
    rerender(<SupportAssistantHost />);
    expect(getSupportState()).toMatchObject({ open: false, ownerId: "u2", messages: [] });
  });

  it("closes when a member signs out", () => {
    signedIn("u1");
    const { rerender } = render(<SupportAssistantHost />);
    fireEvent.click(screen.getByRole("button", { name: "Help and support" }));
    state.user = null;
    rerender(<SupportAssistantHost />);
    expect(getSupportState()).toMatchObject({ open: false, ownerId: null });
  });
});
