import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showSupportLauncher } from "./launcher";
import {
  appendSupportMessage,
  clearSupportConversation,
  closeSupport,
  getSupportState,
  newSupportMessageId,
  openSupport,
  resetSupportStore,
  setSupportOwner,
  setSupportTopic,
  subscribeSupport,
} from "./support-store";

beforeEach(() => resetSupportStore());

const msg = (text: string) => ({
  id: newSupportMessageId(),
  role: "user" as const,
  text,
});

describe("support store", () => {
  it("opens and closes, optionally on a topic", () => {
    openSupport();
    expect(getSupportState()).toMatchObject({ open: true, topicId: null });
    openSupport("payments");
    expect(getSupportState().topicId).toBe("payments");
    closeSupport();
    expect(getSupportState().open).toBe(false);
  });

  it("keeps the conversation while the same member closes and reopens", () => {
    setSupportOwner("u1");
    openSupport();
    appendSupportMessage(msg("hello"));
    closeSupport();
    openSupport();
    expect(getSupportState().messages.map((m) => m.text)).toEqual(["hello"]);
  });

  it("starts clean and closed for a different member", () => {
    setSupportOwner("u1");
    openSupport("payments");
    appendSupportMessage(msg("my private question"));
    setSupportOwner("u2");
    expect(getSupportState()).toEqual({ open: false, ownerId: "u2", messages: [], topicId: null });
  });

  it("clears everything on sign-out", () => {
    setSupportOwner("u1");
    appendSupportMessage(msg("my private question"));
    setSupportOwner(null);
    expect(getSupportState().messages).toEqual([]);
    expect(getSupportState().ownerId).toBeNull();
  });

  it("does not reset when the same member is set again", () => {
    setSupportOwner("u1");
    appendSupportMessage(msg("keep me"));
    setSupportOwner("u1");
    expect(getSupportState().messages).toHaveLength(1);
  });

  it("clears the chat on request", () => {
    setSupportOwner("u1");
    appendSupportMessage(msg("one"));
    setSupportTopic("payments");
    clearSupportConversation();
    expect(getSupportState()).toMatchObject({ messages: [], topicId: null, ownerId: "u1" });
  });

  it("tells subscribers about changes and stops after unsubscribe", () => {
    const listener = vi.fn();
    const off = subscribeSupport(listener);
    openSupport();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    closeSupport();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("never stores the conversation anywhere but memory", () => {
    const src = readFileSync("src/lib/support/support-store.ts", "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
  });

  it("gives every message its own id", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSupportMessageId()));
    expect(ids.size).toBe(50);
  });
});

describe("floating Help button", () => {
  it("shows for signed-in members on ordinary pages", () => {
    for (const p of ["/", "/feed", "/teams", "/games/abc", "/profile", "/parent", "/players/add"])
      expect(showSupportLauncher(p, true)).toBe(true);
  });

  it("never shows for signed-out visitors", () => {
    expect(showSupportLauncher("/", false)).toBe(false);
    expect(showSupportLauncher("/feed", false)).toBe(false);
  });

  it("stays out of the way of sign-in, onboarding, approval links, messages and /contact", () => {
    for (const p of [
      "/auth",
      "/onboarding",
      "/onboarding/child",
      "/parent/consent/abc123",
      "/messages",
      "/messages/42",
      "/contact",
      "/contact/",
    ])
      expect(showSupportLauncher(p, true)).toBe(false);
  });

  it("does not treat a similarly named page as a hidden one", () => {
    expect(showSupportLauncher("/messages-guide", true)).toBe(true);
    expect(showSupportLauncher("/parents", true)).toBe(true);
  });
});
