// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// supabase client is touched by persistToBackend; stub before importing the module.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    from: vi.fn(() => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

import {
  CATEGORY_META,
  DEFAULT_NOTIF_PREFS,
  NOTIF_CATEGORIES,
  categoryFor,
  getNotifPrefs,
  isAllowed,
  isLockedChannel,
  setNotifPref,
  type NotifCategory,
} from "./notification-prefs";

const ALL_CATEGORIES = NOTIF_CATEGORIES;

function resetPrefsToDefaults() {
  for (const c of ALL_CATEGORIES) {
    setNotifPref(c, "inApp", DEFAULT_NOTIF_PREFS[c].inApp);
    setNotifPref(c, "push", DEFAULT_NOTIF_PREFS[c].push);
  }
}

beforeEach(() => {
  window.localStorage.clear();
  resetPrefsToDefaults();
});

afterEach(() => {
  resetPrefsToDefaults();
});

describe("categoryFor", () => {
  it.each([
    ["message", "messages"],
    ["game_reminder", "gameReminders"],
    ["join_request", "gameUpdates"],
    ["join_approved", "gameUpdates"],
    ["game_cancelled", "gameUpdates"],
    ["nearby_game", "nearbyGames"],
    ["game_invite", "invitations"],
    ["org_membership", "invitations"],
    ["payment_received", "payments"],
    ["moderation", "safety"],
    ["follow", "social"],
    ["reel_ready", "social"],
    ["announcement", "marketing"],
    ["totally_unknown", "general"],
  ] as const)("maps %s -> %s", (type, expected) => {
    expect(categoryFor(type)).toBe(expected);
  });
});

describe("CATEGORY_META", () => {
  it("has user-facing copy for every category", () => {
    for (const c of ALL_CATEGORIES) {
      expect(CATEGORY_META[c].label.length).toBeGreaterThan(0);
      expect(CATEGORY_META[c].description.length).toBeGreaterThan(0);
    }
  });
});

describe("defaults", () => {
  it("keeps marketing off until the member opts in", () => {
    expect(DEFAULT_NOTIF_PREFS.marketing).toEqual({ inApp: false, push: false });
  });

  it("keeps safety, messages and game alerts on by default", () => {
    for (const c of ["safety", "messages", "gameReminders", "gameUpdates"] as NotifCategory[]) {
      expect(DEFAULT_NOTIF_PREFS[c].inApp).toBe(true);
    }
  });
});

describe("safety lock", () => {
  it("in-app safety alerts cannot be switched off", () => {
    setNotifPref("safety", "inApp", false);
    expect(getNotifPrefs().safety.inApp).toBe(true);
    expect(isAllowed("moderation", "inApp")).toBe(true);
    expect(isLockedChannel("safety", "inApp")).toBe(true);
  });

  it("safety push stays user-controlled", () => {
    expect(isLockedChannel("safety", "push")).toBe(false);
    setNotifPref("safety", "push", false);
    expect(isAllowed("moderation", "push")).toBe(false);
  });
});

const TOGGLEABLE = ALL_CATEGORIES.filter((c) => c !== "safety");

describe("toggle + isAllowed gating", () => {
  it.each(TOGGLEABLE)("turning %s in-app OFF blocks inApp but leaves push intact", (cat) => {
    setNotifPref(cat, "inApp", false);
    const sampleType = sampleTypeFor(cat);
    expect(isAllowed(sampleType, "inApp")).toBe(false);
    expect(isAllowed(sampleType, "push")).toBe(DEFAULT_NOTIF_PREFS[cat].push);
  });

  it.each(TOGGLEABLE)("turning %s push OFF blocks push but leaves inApp intact", (cat) => {
    setNotifPref(cat, "push", false);
    const sampleType = sampleTypeFor(cat);
    expect(isAllowed(sampleType, "push")).toBe(false);
    expect(isAllowed(sampleType, "inApp")).toBe(DEFAULT_NOTIF_PREFS[cat].inApp);
  });

  it.each(TOGGLEABLE)("muting %s fully blocks both channels", (cat) => {
    setNotifPref(cat, "inApp", false);
    setNotifPref(cat, "push", false);
    const sampleType = sampleTypeFor(cat);
    expect(isAllowed(sampleType, "inApp")).toBe(false);
    expect(isAllowed(sampleType, "push")).toBe(false);
  });

  it("toggling one category does not leak into others", () => {
    setNotifPref("messages", "push", false);
    expect(isAllowed("message", "push")).toBe(false);
    expect(isAllowed("join_request", "push")).toBe(DEFAULT_NOTIF_PREFS.gameUpdates.push);
    expect(isAllowed("payment_received", "push")).toBe(DEFAULT_NOTIF_PREFS.payments.push);
  });

  it("marketing stays independent from product alerts", () => {
    setNotifPref("marketing", "inApp", true);
    expect(isAllowed("announcement", "inApp")).toBe(true);
    setNotifPref("messages", "inApp", false);
    expect(isAllowed("announcement", "inApp")).toBe(true);
  });

  it("re-enabling after mute restores delivery", () => {
    setNotifPref("gameUpdates", "inApp", false);
    expect(isAllowed("join_approved", "inApp")).toBe(false);
    setNotifPref("gameUpdates", "inApp", true);
    expect(isAllowed("join_approved", "inApp")).toBe(true);
  });
});

describe("persistence", () => {
  it("writes to localStorage under the versioned key", () => {
    setNotifPref("gameUpdates", "push", false);
    const raw = window.localStorage.getItem("openrun.notifPrefs.v3");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.gameUpdates.push).toBe(false);
  });

  it("getNotifPrefs reflects the latest set value", () => {
    setNotifPref("general", "push", true);
    expect(getNotifPrefs().general.push).toBe(true);
    setNotifPref("general", "push", false);
    expect(getNotifPrefs().general.push).toBe(false);
  });
});

function sampleTypeFor(cat: NotifCategory): string {
  switch (cat) {
    case "messages":
      return "message";
    case "gameReminders":
      return "game_reminder";
    case "gameUpdates":
      return "join_approved";
    case "nearbyGames":
      return "nearby_game";
    case "invitations":
      return "game_invite";
    case "payments":
      return "payment_received";
    case "safety":
      return "moderation";
    case "social":
      return "follow";
    case "marketing":
      return "announcement";
    case "general":
      return "data_export_ready";
  }
}
