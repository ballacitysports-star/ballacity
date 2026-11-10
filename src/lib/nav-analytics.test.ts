import { beforeEach, describe, expect, it, vi } from "vitest";

const trackEvent = vi.fn();
vi.mock("@/lib/analytics", () => ({ trackEvent: (...a: unknown[]) => trackEvent(...a) }));

const { tabName, tabNameForPath, trackOpenCreate, trackTabSelect } =
  await import("./nav-analytics");
const actual = await vi.importActual<typeof import("./analytics")>("./analytics");

beforeEach(() => trackEvent.mockReset());

describe("tab names", () => {
  it("are the five fixed bar names, never a path", () => {
    expect(["/feed", "/players", "/highlights", "/messages", "/profile"].map(tabName)).toEqual([
      "home",
      "discover",
      "reels",
      "inbox",
      "me",
    ]);
    expect(tabName("/create")).toBeNull();
  });

  it("map any route to its owning tab or 'other'", () => {
    expect(tabNameForPath("/teams/abc")).toBe("discover");
    expect(tabNameForPath("/highlights/xyz")).toBe("reels");
    expect(tabNameForPath("/games/123")).toBe("other");
  });
});

describe("trackTabSelect", () => {
  it("sends the tab, the tab it came from and how it was chosen", () => {
    trackTabSelect("/highlights", "swipe", "/players");
    expect(trackEvent).toHaveBeenCalledWith("select_tab", {
      tab: "reels",
      via: "swipe",
      from: "discover",
    });
  });

  it("sends nothing for a destination that is not a tab", () => {
    trackTabSelect("/create", "tap", "/feed");
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("its parameters survive the personal-data filter unchanged", () => {
    trackTabSelect("/profile", "tap", "/games/123");
    const params = trackEvent.mock.calls[0][1] as Record<string, unknown>;
    expect(actual.sanitizeParams(params)).toEqual(params);
  });
});

describe("trackOpenCreate", () => {
  it("sends a known kind and folds anything else into 'other'", () => {
    trackOpenCreate("clinic");
    trackOpenCreate("<script>");
    trackOpenCreate(undefined);
    expect(trackEvent.mock.calls).toEqual([
      ["open_create", { kind: "clinic" }],
      ["open_create", { kind: "other" }],
      ["open_create", { kind: "other" }],
    ]);
  });
});

describe("the events are allow-listed", () => {
  it("select_tab and open_create are in ANALYTICS_EVENTS", () => {
    expect(actual.ANALYTICS_EVENTS).toContain("select_tab");
    expect(actual.ANALYTICS_EVENTS).toContain("open_create");
  });
});
