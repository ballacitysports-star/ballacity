// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  complete: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  takeParked: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("@/lib/managed-handover.functions", () => ({
  lookupManagedHandover: (...a: unknown[]) => h.lookup(...a),
  completeManagedHandover: (...a: unknown[]) => h.complete(...a),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      verifyOtp: (...a: unknown[]) => h.verifyOtp(...a),
      updateUser: (...a: unknown[]) => h.updateUser(...a),
    },
  },
}));
vi.mock("@/lib/managed-session", () => ({ takeParkedGuardianSession: () => h.takeParked() }));
vi.mock("@/lib/per-user-state", () => ({ resetPerUserClientState: () => h.reset() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { HandoverClaim } from "./HandoverClaim";

const TOKEN = "t".repeat(64);
const VALID = {
  valid: true,
  childName: "Jake S.",
  guardianName: "Alex",
  emailMasked: "j***@example.test",
  expiresAt: "2026-11-28T10:00:00Z",
};

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HandoverClaim token={TOKEN} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.lookup.mockResolvedValue(VALID);
  h.complete.mockResolvedValue({ recoveryTokenHash: "rh" });
  h.verifyOtp.mockResolvedValue({ data: { user: { id: "c1" } }, error: null });
  h.updateUser.mockResolvedValue({ error: null });
  h.reset.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("HandoverClaim", () => {
  it("asks the server about the link, and shows who is handing over what, with a masked address", async () => {
    mount();
    expect(await screen.findByText("Jake S.")).toBeTruthy();
    expect(h.lookup).toHaveBeenCalledWith({ data: { token: TOKEN } });
    expect(screen.getByText(/Alex has been managing/)).toBeTruthy();
    expect(screen.getByText(/j\*\*\*@example\.test/)).toBeTruthy();
    expect(screen.getByText(/nothing\s+changes unless you continue/)).toBeTruthy();
  });

  it("changes nothing until the adult ticks 'this is my account' and presses the button", async () => {
    mount();
    const go = (await screen.findByRole("button", {
      name: "Take over my account",
    })) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(go);
    expect(h.complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(go.disabled).toBe(false);
  });

  it("confirms on the server, signs in with the one-time link, drops a parked guardian session, then asks for a password", async () => {
    mount();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Take over my account" }));
    await screen.findByLabelText("New password");
    expect(h.complete).toHaveBeenCalledWith({ data: { token: TOKEN, confirmed: true } });
    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: "rh", type: "recovery" });
    expect(h.takeParked).toHaveBeenCalledTimes(1);
    expect(h.reset).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "correct horse" } });
    fireEvent.change(screen.getByLabelText("Type it again"), {
      target: { value: "correct horse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save password" }));
    await screen.findByText(/This account is yours/);
    // The password goes to the sign-in service in the browser, never to our server.
    expect(h.updateUser).toHaveBeenCalledWith({ password: "correct horse" });
    expect(h.complete.mock.calls.flat().join(" ")).not.toContain("correct horse");
  });

  it("does not save a short password or two that differ", async () => {
    mount();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Take over my account" }));
    await screen.findByLabelText("New password");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Type it again"), { target: { value: "short" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save password" }).closest("form")!);
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "long enough one" },
    });
    fireEvent.change(screen.getByLabelText("Type it again"), {
      target: { value: "long enough two" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Save password" }).closest("form")!);
    expect(h.updateUser).not.toHaveBeenCalled();
  });

  it("sends the adult to sign in with 'Forgot password' when the one-time sign-in could not be made (the account is already theirs)", async () => {
    h.complete.mockResolvedValue({ recoveryTokenHash: null });
    mount();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Take over my account" }));
    expect(await screen.findByText(/Your account is yours now/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to sign in" }).getAttribute("href")).toBe("/auth");
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });

  it("does the same when the browser sign-in is refused", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: "otp expired" } });
    mount();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Take over my account" }));
    expect(await screen.findByText(/Your account is yours now/)).toBeTruthy();
    expect(h.takeParked).not.toHaveBeenCalled();
  });

  it("stays on the confirmation with words, not raw text, when the server refuses; nothing was changed", async () => {
    h.complete.mockRejectedValue(
      new Error("Something went wrong and nothing was changed. Please try again."),
    );
    mount();
    fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Take over my account" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/nothing was changed/);
    expect(h.verifyOtp).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "Take over my account" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });

  it("says a link that is not valid, expired or already used is no longer valid, and offers sign-in", async () => {
    h.lookup.mockResolvedValue({ valid: false, code: "HANDOVER_EXPIRED" });
    mount();
    expect(await screen.findByText(/This link has expired/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take over my account" })).toBeNull();
    cleanup();
    h.lookup.mockResolvedValue({ valid: false, code: "HANDOVER_INVALID" });
    mount();
    expect(await screen.findByText(/isn't valid any more/)).toBeTruthy();
  });
});
