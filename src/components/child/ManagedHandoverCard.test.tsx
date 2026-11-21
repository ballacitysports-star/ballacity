// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ManagedHandoverInfo } from "@/lib/managed-handover";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  start: vi.fn(),
  cancel: vi.fn(),
  startPending: false,
}));
vi.mock("@/lib/use-managed-handover", () => ({
  useManagedHandovers: () => ({ data: h.rows }),
  useStartManagedHandover: () => ({ mutate: h.start, isPending: h.startPending }),
  useCancelManagedHandover: () => ({ mutate: h.cancel, isPending: false }),
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import { ManagedHandoverCard } from "./ManagedHandoverCard";

const info = (over: Partial<ManagedHandoverInfo> = {}): ManagedHandoverInfo => ({
  childUserId: "c1",
  displayName: "Jake S.",
  isAdult: true,
  pending: false,
  emailMasked: null,
  startedAt: null,
  expiresAt: null,
  ...over,
});

beforeEach(() => {
  h.rows = [info()];
  h.start.mockReset();
  h.cancel.mockReset();
  h.startPending = false;
  toasts.success.mockReset();
  toasts.error.mockReset();
});
afterEach(cleanup);

describe("ManagedHandoverCard", () => {
  it("is not there for a minor, an unknown age, another account, or while the migration is missing", () => {
    for (const rows of [[info({ isAdult: false })], [info({ childUserId: "other" })], []]) {
      h.rows = rows;
      const { container } = render(<ManagedHandoverCard childUserId="c1" />);
      expect(container.innerHTML).toBe("");
      cleanup();
    }
  });

  it("offers the handover for an adult, in kind words that say nothing changes yet", () => {
    render(<ManagedHandoverCard childUserId="c1" />);
    expect(screen.getByRole("heading", { name: "Hand over Jake's account" })).toBeTruthy();
    expect(screen.getByText(/you are the only way in/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start handover" })).toBeTruthy();
  });

  it("walks the three steps: address, confirmation, send; nothing is sent before the last", () => {
    render(<ManagedHandoverCard childUserId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Start handover" }));

    const input = screen.getByLabelText("Jake's own email address") as HTMLInputElement;
    const cont = screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement;
    expect(cont.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "not an address" } });
    expect(cont.disabled).toBe(true);
    fireEvent.change(input, { target: { value: " jake@example.test " } });
    expect(cont.disabled).toBe(false);
    fireEvent.click(cont);

    // The confirmation says what will and will not change, and needs the "not mine" box.
    expect(screen.getByText("jake@example.test")).toBeTruthy();
    expect(screen.getByText(/Nothing changes until/)).toBeTruthy();
    expect(screen.getByText(/Your family link ends/)).toBeTruthy();
    const send = screen.getByRole("button", { name: "Send the email" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(send.disabled).toBe(false);
    expect(h.start).not.toHaveBeenCalled();

    fireEvent.click(send);
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(h.start.mock.calls[0]![0]).toEqual({ childUserId: "c1", email: "jake@example.test" });
  });

  it("can go back from the confirmation to the address, and back out of the form", () => {
    render(<ManagedHandoverCard childUserId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Start handover" }));
    fireEvent.change(screen.getByLabelText("Jake's own email address"), {
      target: { value: "jake@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByLabelText("Jake's own email address")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Start handover" })).toBeTruthy();
  });

  it("shows the words, not raw text, when the server refuses", () => {
    h.start.mockImplementation((_input, opts: { onError: (e: unknown) => void }) =>
      opts.onError(new Error("HANDOVER_EMAIL_IS_OWN: nope")),
    );
    render(<ManagedHandoverCard childUserId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Start handover" }));
    fireEvent.change(screen.getByLabelText("Jake's own email address"), {
      target: { value: "me@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Send the email" }));
    expect(toasts.error).toHaveBeenCalledWith(
      expect.stringMatching(/own email address, not yours/),
    );
    expect(toasts.error.mock.calls[0]![0]).not.toMatch(/HANDOVER_/);
  });

  it("while waiting: says so, shows only the masked address, and lets the guardian cancel", () => {
    h.rows = [
      info({ pending: true, emailMasked: "j***@example.test", expiresAt: "2026-11-28T10:00:00Z" }),
    ];
    render(<ManagedHandoverCard childUserId="c1" />);
    expect(screen.getByRole("heading", { name: "Waiting for Jake" })).toBeTruthy();
    expect(screen.getByText(/j\*\*\*@example\.test/)).toBeTruthy();
    expect(
      screen.getByText(/nothing has changed: you still manage the account as usual/),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start handover" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel handover" }));
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.cancel.mock.calls[0]![0]).toEqual({ childUserId: "c1" });
  });

  it("keeps showing a pending handover (and the way to cancel it) even if the person no longer reads as an adult", () => {
    h.rows = [info({ isAdult: false, pending: true, emailMasked: "j***@example.test" })];
    render(<ManagedHandoverCard childUserId="c1" />);
    expect(screen.getByRole("button", { name: "Cancel handover" })).toBeTruthy();
  });

  it("makes no legal claim", () => {
    const { container } = render(<ManagedHandoverCard childUserId="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Start handover" }));
    fireEvent.change(screen.getByLabelText("Jake's own email address"), {
      target: { value: "jake@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(container.textContent).not.toMatch(/\b(law|legal|legally|custody|guardianship)\b/i);
  });
});
