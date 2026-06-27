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
  categoryFor,
  getNotifPrefs,
  isAllowed,
  setNotifPref,
  type NotifCategory,
} from "./notification-prefs";

const ALL_CATEGORIES: NotifCategory[] = ["messages", "approvals", "joinRequests", "general"];

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
    ["join_request", "joinRequests"],
    ["join_approved", "approvals"],
    ["join_declined", "approvals"],
    ["payment_received", "general"],
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

describe("toggle + isAllowed gating", () => {
  it.each(ALL_CATEGORIES)("turning %s in-app OFF blocks inApp but leaves push intact", (cat) => {
    setNotifPref(cat, "inApp", false);
    const sampleType = sampleTypeFor(cat);
    expect(isAllowed(sampleType, "inApp")).toBe(false);
    expect(isAllowed(sampleType, "push")).toBe(DEFAULT_NOTIF_PREFS[cat].push);
  });

  it.each(ALL_CATEGORIES)("turning %s push OFF blocks push but leaves inApp intact", (cat) => {
    setNotifPref(cat, "push", false);
    const sampleType = sampleTypeFor(cat);
    expect(isAllowed(sampleType, "push")).toBe(false);
    expect(isAllowed(sampleType, "inApp")).toBe(DEFAULT_NOTIF_PREFS[cat].inApp);
  });

  it.each(ALL_CATEGORIES)("muting %s fully blocks both channels", (cat) => {
    setNotifPref(cat, "inApp", false);
    setNotifPref(cat, "push", false);
    const sampleType = sampleTypeFor(cat);
    expect(isAllowed(sampleType, "inApp")).toBe(false);
    expect(isAllowed(sampleType, "push")).toBe(false);
  });

  it("toggling one category does not leak into others", () => {
    setNotifPref("messages", "push", false);
    expect(isAllowed("message", "push")).toBe(false);
    expect(isAllowed("join_request", "push")).toBe(DEFAULT_NOTIF_PREFS.joinRequests.push);
    expect(isAllowed("join_approved", "push")).toBe(DEFAULT_NOTIF_PREFS.approvals.push);
    expect(isAllowed("payment_received", "push")).toBe(DEFAULT_NOTIF_PREFS.general.push);
  });

  it("re-enabling after mute restores delivery", () => {
    setNotifPref("approvals", "inApp", false);
    expect(isAllowed("join_approved", "inApp")).toBe(false);
    setNotifPref("approvals", "inApp", true);
    expect(isAllowed("join_approved", "inApp")).toBe(true);
  });
});

describe("persistence", () => {
  it("writes to localStorage under the versioned key", () => {
    setNotifPref("joinRequests", "push", false);
    const raw = window.localStorage.getItem("openrun.notifPrefs.v2");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.joinRequests.push).toBe(false);
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
    case "messages": return "message";
    case "approvals": return "join_approved";
    case "joinRequests": return "join_request";
    case "general": return "payment_received";
  }
}
