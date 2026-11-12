import { describe, expect, it, vi } from "vitest";

// The app's module imports the browser client; nothing here talks to it.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import * as app from "./notification-prefs";
import * as core from "./notification-prefs-core";

describe("notification prefs rules, shared by the app and the server", () => {
  it("the app's prefs module re-exports the core, so the server reads prefs with the same code", () => {
    const shared = [
      "NOTIF_CATEGORIES",
      "DEFAULT_NOTIF_PREFS",
      "LOCKED_CHANNELS",
      "isLockedChannel",
      "categoryFor",
      "applyLocks",
      "mergeNotifPrefs",
      "isAllowedIn",
    ] as const;
    for (const name of shared) expect(app[name], name).toBe(core[name]);
  });

  it("merges stored prefs over the defaults: legacy names first, current names win, safety in-app stays on", () => {
    const merged = core.mergeNotifPrefs({
      approvals: { push: false, inApp: false }, // legacy name for gameUpdates
      gameUpdates: { push: true }, // current name: wins where both are set
      follows: { push: true }, // legacy name for social
      safety: { inApp: false, push: false },
      gameReminders: { push: false },
    });
    expect(merged.gameUpdates).toEqual({ inApp: false, push: true });
    expect(merged.social).toEqual({ inApp: true, push: true });
    expect(merged.safety).toEqual({ inApp: true, push: false });
    expect(merged.gameReminders).toEqual({ inApp: true, push: false });
    expect(core.mergeNotifPrefs(null)).toEqual(core.DEFAULT_NOTIF_PREFS);
  });

  it("game reminder push is on unless the stored switch is off", () => {
    const pushAllowed = (stored: Record<string, unknown> | null) =>
      core.isAllowedIn(core.mergeNotifPrefs(stored), "game_reminder", "push");
    expect(pushAllowed(null)).toBe(true);
    expect(pushAllowed({ gameReminders: { inApp: false } })).toBe(true);
    expect(pushAllowed({ approvals: { push: false }, messages: { push: false } })).toBe(true);
    expect(pushAllowed({ gameReminders: { push: false } })).toBe(false);
  });
});
