// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  blocked: false,
  toggle: vi.fn(async () => undefined),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/moderation", () => ({
  useBlock: () => ({
    blocked: h.blocked,
    loading: false,
    pending: false,
    toggle: h.toggle,
  }),
}));
vi.mock("@/components/ReportDialog", () => ({
  ReportDialog: ({ open, reportedId, conversationId }: any) =>
    open ? <div data-testid="report" data-user={reportedId} data-conv={conversationId} /> : null,
}));
vi.mock("sonner", () => ({ toast: h.toast }));

import { ThreadSafetyDialog } from "./ThreadSafetyDialog";

const setup = (onOpenChange = vi.fn()) =>
  render(
    <ThreadSafetyDialog
      open
      onOpenChange={onOpenChange}
      userId="u2"
      displayName="Sam"
      conversationId="c1"
    />,
  );

beforeEach(() => {
  h.blocked = false;
  h.toggle.mockClear();
  h.toast.success.mockClear();
  h.toast.error.mockClear();
});
afterEach(cleanup);

describe("ThreadSafetyDialog", () => {
  it("reports the person, tied to this conversation", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Report Sam/ }));
    const r = screen.getByTestId("report");
    expect(r.getAttribute("data-user")).toBe("u2");
    expect(r.getAttribute("data-conv")).toBe("c1");
  });

  it("asks before blocking, and does nothing until confirmed", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Block Sam/ }));
    expect(h.toggle).not.toHaveBeenCalled();
    expect(screen.getByText("Block Sam?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    await waitFor(() => expect(h.toggle).toHaveBeenCalledTimes(1));
    expect(h.toast.success).toHaveBeenCalledWith("Sam blocked.");
  });

  it("cancelling the confirmation blocks nobody", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Block Sam/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.toggle).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Block Sam/ })).toBeTruthy();
  });

  it("unblocks in one tap when already blocked", async () => {
    h.blocked = true;
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Unblock Sam/ }));
    await waitFor(() => expect(h.toggle).toHaveBeenCalledTimes(1));
    expect(h.toast.success).toHaveBeenCalledWith("Sam unblocked.");
  });

  it("says so when the block could not be saved", async () => {
    h.toggle.mockRejectedValueOnce(new Error("boom"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Block Sam/ }));
    fireEvent.click(screen.getByRole("button", { name: "Block" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("boom"));
  });
});
