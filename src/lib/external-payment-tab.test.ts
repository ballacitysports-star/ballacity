import { describe, expect, it, vi } from "vitest";
import { openExternalPaymentTab } from "./external-payment-tab";

const URL_ = "https://venmo.com/?txn=pay&recipients=e2e-host&amount=15";

function fakeWindow(tab: { opener: unknown } | null) {
  return {
    open: vi.fn((..._args: unknown[]) => tab),
    location: { assign: vi.fn((_url: string) => {}) },
  };
}

describe("openExternalPaymentTab", () => {
  it("opens a new tab and leaves this tab on the pay screen", () => {
    const tab = { opener: "pay-screen" as unknown };
    const win = fakeWindow(tab);

    expect(openExternalPaymentTab(URL_, win)).toBe("new-tab");

    expect(win.open).toHaveBeenCalledWith(URL_, "_blank");
    expect(win.location.assign).not.toHaveBeenCalled();
  });

  it("cuts the new tab's link back to this page", () => {
    const tab = { opener: "pay-screen" as unknown };
    openExternalPaymentTab(URL_, fakeWindow(tab));
    expect(tab.opener).toBeNull();
  });

  it('does not ask for "noopener", which makes window.open return null even when the tab opened', () => {
    const win = fakeWindow({ opener: null });
    openExternalPaymentTab(URL_, win);
    expect(win.open.mock.calls[0]).toEqual([URL_, "_blank"]);
  });

  it("goes to the link in this tab only when the browser refuses a new one", () => {
    const win = fakeWindow(null);

    expect(openExternalPaymentTab(URL_, win)).toBe("this-tab");

    expect(win.location.assign).toHaveBeenCalledWith(URL_);
  });

  it("still reports the new tab when its opener cannot be written", () => {
    const tab = Object.defineProperty({} as { opener: unknown }, "opener", {
      get: () => null,
      set: () => {
        throw new Error("read-only");
      },
    });
    const win = fakeWindow(tab);

    expect(openExternalPaymentTab(URL_, win)).toBe("new-tab");
    expect(win.location.assign).not.toHaveBeenCalled();
  });
});
