// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { openExternalPaymentTab } from "./external-payment-tab";

const URL_ = "https://venmo.com/?txn=pay&recipients=e2e-host&amount=15";

type Followed = { href: string; rel: string };

/** A document whose links record what was clicked instead of navigating. */
function fakeDocument() {
  const clicked: Followed[] = [];
  const doc = document.implementation.createHTMLDocument("");
  const createElement = doc.createElement.bind(doc);
  vi.spyOn(doc, "createElement").mockImplementation(((tag: string) => {
    const el = createElement(tag) as HTMLAnchorElement;
    el.click = () => clicked.push({ href: el.href, rel: el.rel });
    return el;
  }) as typeof doc.createElement);
  return { doc, clicked };
}

function fakeTab() {
  const { doc, clicked } = fakeDocument();
  const tab = {
    opener: "pay-screen" as unknown,
    document: doc,
    location: { replace: vi.fn((_url: string) => {}) },
  };
  return { tab, clicked };
}

function fakeWindow(tab: ReturnType<typeof fakeTab>["tab"] | null) {
  const { doc, clicked } = fakeDocument();
  return {
    win: { open: vi.fn((..._args: unknown[]) => tab), document: doc },
    clickedHere: clicked,
  };
}

describe("openExternalPaymentTab", () => {
  it("opens a new tab and leaves this tab on the pay screen", () => {
    const { tab, clicked } = fakeTab();
    const { win, clickedHere } = fakeWindow(tab);

    expect(openExternalPaymentTab(URL_, win)).toBe("new-tab");

    expect(clicked).toEqual([{ href: URL_, rel: "noreferrer" }]);
    expect(clickedHere).toEqual([]);
  });

  it("opens the tab empty and without features, so null means it was refused", () => {
    // "noopener" or "noreferrer" make window.open return null even when the tab opened.
    const { tab } = fakeTab();
    const { win } = fakeWindow(tab);
    openExternalPaymentTab(URL_, win);
    expect(win.open.mock.calls[0]).toEqual(["", "_blank"]);
  });

  it("cuts the new tab's link back to this page before sending it anywhere", () => {
    const { tab, clicked } = fakeTab();
    let openerWhenFollowed: unknown = "not followed";
    const doc = tab.document;
    const createElement = doc.createElement;
    doc.createElement = ((tag: string) => {
      const el = createElement(tag);
      const click = el.click;
      el.click = () => {
        openerWhenFollowed = tab.opener;
        click();
      };
      return el;
    }) as typeof doc.createElement;

    openExternalPaymentTab(URL_, fakeWindow(tab).win);

    expect(tab.opener).toBeNull();
    expect(openerWhenFollowed).toBeNull();
    expect(clicked).toHaveLength(1);
  });

  it("sends the payment site no Referer: the tab follows a noreferrer link", () => {
    const { tab, clicked } = fakeTab();
    openExternalPaymentTab(URL_, fakeWindow(tab).win);
    expect(clicked[0]?.rel).toBe("noreferrer");
    expect(tab.location.replace).not.toHaveBeenCalled();
    // The link does not stay behind in the tab's document.
    expect(tab.document.querySelectorAll("a")).toHaveLength(0);
  });

  it("goes to the link in this tab, still without a Referer, only when the browser refuses a new one", () => {
    const { win, clickedHere } = fakeWindow(null);

    expect(openExternalPaymentTab(URL_, win)).toBe("this-tab");

    expect(clickedHere).toEqual([{ href: URL_, rel: "noreferrer" }]);
  });

  it("still reports the new tab when its opener cannot be written", () => {
    const { tab, clicked } = fakeTab();
    Object.defineProperty(tab, "opener", {
      get: () => null,
      set: () => {
        throw new Error("read-only");
      },
    });
    const { win, clickedHere } = fakeWindow(tab);

    expect(openExternalPaymentTab(URL_, win)).toBe("new-tab");
    expect(clicked).toHaveLength(1);
    expect(clickedHere).toEqual([]);
  });

  it("still takes the new tab to the link when its document is out of reach", () => {
    const { tab } = fakeTab();
    Object.defineProperty(tab, "document", {
      get: () => {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    });
    const { win, clickedHere } = fakeWindow(tab);

    expect(openExternalPaymentTab(URL_, win)).toBe("new-tab");
    expect(tab.location.replace).toHaveBeenCalledWith(URL_);
    expect(clickedHere).toEqual([]);
  });
});
