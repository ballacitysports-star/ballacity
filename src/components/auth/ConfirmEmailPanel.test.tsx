// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmEmailPanel, RESEND_COOLDOWN_S } from "./ConfirmEmailPanel";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// One second at a time: each tick re-renders and only then schedules the next.
const tick = async (s: number) => {
  for (let i = 0; i < s; i++) await act(() => vi.advanceTimersByTimeAsync(1000));
};

describe("ConfirmEmailPanel", () => {
  it("names the address and holds the resend button until the cooldown ends", async () => {
    render(
      <ConfirmEmailPanel email="a@b.co" onResend={async () => null} onChangeEmail={vi.fn()} />,
    );
    expect(screen.getByText("a@b.co")).toBeTruthy();
    const btn = screen.getByRole("button", { name: /send it again in/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await tick(RESEND_COOLDOWN_S);
    expect(
      (screen.getByRole("button", { name: "Send it again" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("resends once, confirms it, and starts the cooldown again", async () => {
    const onResend = vi.fn(async () => null);
    render(<ConfirmEmailPanel email="a@b.co" onResend={onResend} onChangeEmail={vi.fn()} />);
    await tick(RESEND_COOLDOWN_S);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send it again" }));
    });
    expect(onResend).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sent again to a@b.co.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /send it again in/i })).toBeTruthy();
  });

  it("shows a failed resend as an alert and lets them retry without waiting again", async () => {
    const onResend = vi.fn(async () => "Too many requests");
    render(<ConfirmEmailPanel email="a@b.co" onResend={onResend} onChangeEmail={vi.fn()} />);
    await tick(RESEND_COOLDOWN_S);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Send it again" }));
    });
    expect(screen.getByRole("alert").textContent).toBe("Too many requests");
    expect(
      (screen.getByRole("button", { name: "Send it again" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("offers a way back to the form for a mistyped address", () => {
    const onChangeEmail = vi.fn();
    render(
      <ConfirmEmailPanel
        email="a@b.co"
        onResend={async () => null}
        onChangeEmail={onChangeEmail}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /different email/i }));
    expect(onChangeEmail).toHaveBeenCalled();
  });
});
