// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ requestPushPermission: push.request }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import { PushOptInButton } from "./PushOptInButton";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("PushOptInButton (push delivery test)", () => {
  it("opts this device in even when the member prompt was dismissed", async () => {
    window.localStorage.setItem("openrun.pushPromptDismissed.v1", "1");
    push.request.mockResolvedValue({ permission: "granted", subscribed: true });
    const onDone = vi.fn();
    render(<PushOptInButton onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on push on this device" }));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(push.request).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith("Push notifications are on for this device.");
  });

  it("says it failed when the browser allows push but no subscription was made", async () => {
    push.request.mockResolvedValue({ permission: "granted", subscribed: false });
    render(<PushOptInButton />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on push on this device" }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("explains a blocked browser", async () => {
    push.request.mockResolvedValue({ permission: "denied", subscribed: false });
    render(<PushOptInButton />);
    fireEvent.click(screen.getByRole("button", { name: "Turn on push on this device" }));
    await waitFor(() => expect(toasts.error.mock.calls[0][0]).toMatch(/blocked/));
  });
});
