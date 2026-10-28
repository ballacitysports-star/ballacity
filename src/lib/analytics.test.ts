// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_EVENTS,
  ANALYTICS_TASKS,
  loadAnalyticsTag,
  sanitizeParams,
  setAnalyticsAudience,
  trackEvent,
  trackTaskError,
} from "./analytics";

type W = Window & {
  gtag?: (...a: unknown[]) => void;
  __bcGaLoaded?: boolean;
  dataLayer?: unknown[];
};
let gtag: ReturnType<typeof vi.fn>;

beforeEach(() => {
  gtag = vi.fn();
  (window as W).gtag = gtag as unknown as W["gtag"];
  setAnalyticsAudience(false);
});
afterEach(() => {
  delete (window as W).gtag;
});

describe("trackEvent", () => {
  it("sends nothing until the member is confirmed an adult", () => {
    trackEvent("view_game", { game_id: "g1" });
    expect(gtag).not.toHaveBeenCalled();
  });

  it("sends held events once an adult is confirmed", () => {
    trackEvent("view_game", { game_id: "g1" });
    setAnalyticsAudience(true);
    expect(gtag).toHaveBeenCalledWith("event", "view_game", { game_id: "g1" });
    trackEvent("join_game", { kind: "instant" });
    expect(gtag).toHaveBeenCalledWith("event", "join_game", { kind: "instant" });
  });

  it("drops held events when the member turns out not to be an adult", () => {
    trackEvent("create_game", { count: 1 });
    setAnalyticsAudience(false); // age answered: not an adult
    setAnalyticsAudience(true); // a different member signs in as an adult
    expect(gtag).not.toHaveBeenCalled();
  });

  it("ignores events that are not in the funnel list", () => {
    setAnalyticsAudience(true);
    trackEvent("page_scroll" as never);
    expect(gtag).not.toHaveBeenCalled();
    expect(ANALYTICS_EVENTS).toContain("join_game");
  });

  it("does not throw when the tag does", () => {
    setAnalyticsAudience(true);
    gtag.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => trackEvent("create_game")).not.toThrow();
  });
});

describe("sanitizeParams", () => {
  it("keeps plain facts and drops anything personal", () => {
    expect(
      sanitizeParams({
        game_id: "g1",
        count: 2,
        free: true,
        email: "a@b.co",
        display_name: "Sam",
        note: "reach me at sam@example.com",
        lat: 33.9,
        user_id: "u1",
        nested: { a: 1 },
        long: "x".repeat(101),
      }),
    ).toEqual({ game_id: "g1", count: 2, free: true });
  });
});

describe("loadAnalyticsTag", () => {
  it("does nothing without a measurement id", () => {
    loadAnalyticsTag("");
    expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  });

  it("adds the tag once, with ad features off", () => {
    loadAnalyticsTag("G-TEST123");
    loadAnalyticsTag("G-TEST123");
    expect(document.querySelectorAll('script[src*="googletagmanager"]').length).toBe(1);
    const flat = JSON.stringify(
      Array.from((window as W).dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>)),
    );
    expect(flat).toContain("allow_google_signals");
  });
});

describe("the wider funnel", () => {
  it("lists the new events, so a typo at a call site cannot send an unknown one", () => {
    for (const e of [
      "onboarding_complete",
      "view_listing",
      "create_listing",
      "cancel_game",
      "leave_game",
      "task_error",
    ]) {
      expect(ANALYTICS_EVENTS).toContain(e);
    }
  });

  it("sends the new events for adults only, and holds then drops them otherwise", () => {
    trackEvent("view_listing", { kind: "team" });
    trackEvent("onboarding_complete", { account_type: "player" });
    expect(gtag).not.toHaveBeenCalled();
    setAnalyticsAudience(false); // turns out not to be an adult
    setAnalyticsAudience(true);
    expect(gtag).not.toHaveBeenCalled();

    trackEvent("create_listing", { kind: "facility" });
    expect(gtag).toHaveBeenCalledWith("event", "create_listing", { kind: "facility" });
  });

  it("sends only a kind or a task name, nothing that identifies a person or a place", () => {
    setAnalyticsAudience(true);
    trackEvent("view_listing", {
      kind: "trainer",
      user_id: "u1",
      email: "a@b.co",
      lat: 33.7,
      lng: -84.3,
      name: "Sam",
    });
    expect(gtag).toHaveBeenCalledWith("event", "view_listing", { kind: "trainer" });
  });

  it("names a failed task but never the error text", () => {
    setAnalyticsAudience(true);
    trackTaskError("publish_game");
    expect(gtag).toHaveBeenCalledWith("event", "task_error", { task: "publish_game" });
    gtag.mockClear();
    trackTaskError("something else" as never);
    expect(gtag).not.toHaveBeenCalled();
    expect(ANALYTICS_TASKS).toEqual(["publish_game", "request_to_join", "cancel_game"]);
  });

  it("sends nothing for a minor's task errors either", () => {
    setAnalyticsAudience(false);
    trackTaskError("request_to_join");
    trackEvent("leave_game");
    expect(gtag).not.toHaveBeenCalled();
  });
});
