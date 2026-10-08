import { describe, expect, it } from "vitest";
import {
  SHARE_LINK_DEFAULT_DAYS,
  SHARE_LINK_MAX_DAYS,
  generateShareToken,
  hashShareToken,
  isPlausibleShareToken,
  normalizeShareDays,
  shareLinkStatus,
  shareUrl,
} from "@/lib/family-share";

describe("share tokens", () => {
  it("are 256 bits of URL-safe randomness and never repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generateShareToken();
      expect(isPlausibleShareToken(t)).toBe(true);
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it("hash to a stable 64-character hex digest that differs from the token", async () => {
    const t = generateShareToken();
    const h = await hashShareToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(await hashShareToken(t));
    expect(h).not.toContain(t);
    expect(await hashShareToken(generateShareToken())).not.toBe(h);
  });

  it("matches the known SHA-256 of a fixed input", async () => {
    // sha256("abc")
    expect(await hashShareToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("rejects malformed tokens before they reach the database", () => {
    for (const bad of ["", "short", "a".repeat(42), "a".repeat(44), "a/b".padEnd(43, "a"), null, 5]) {
      expect(isPlausibleShareToken(bad)).toBe(false);
    }
  });
});

describe("link rules", () => {
  it("clamps the lifetime to 1..30 days and falls back to the default", () => {
    expect(normalizeShareDays(7)).toBe(7);
    expect(normalizeShareDays(500)).toBe(SHARE_LINK_MAX_DAYS);
    expect(normalizeShareDays(0)).toBe(SHARE_LINK_DEFAULT_DAYS);
    expect(normalizeShareDays(-3)).toBe(SHARE_LINK_DEFAULT_DAYS);
    expect(normalizeShareDays("abc")).toBe(SHARE_LINK_DEFAULT_DAYS);
    expect(normalizeShareDays(undefined)).toBe(SHARE_LINK_DEFAULT_DAYS);
    expect(normalizeShareDays(2.9)).toBe(2);
  });

  it("builds the URL without doubling slashes", () => {
    expect(shareUrl("https://ballacity.lovable.app/", "TOKEN")).toBe(
      "https://ballacity.lovable.app/family-share/TOKEN",
    );
  });

  it("reports active, expired and revoked", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(shareLinkStatus({ expires_at: "2026-10-09T00:00:00Z" }, now)).toBe("active");
    expect(shareLinkStatus({ expires_at: "2026-10-08T11:59:59Z" }, now)).toBe("expired");
    expect(
      shareLinkStatus({ expires_at: "2026-10-09T00:00:00Z", revoked_at: "2026-10-08T11:00:00Z" }, now),
    ).toBe("revoked");
  });
});

import { shareErrorMessage } from "@/lib/family-share";

describe("shareErrorMessage", () => {
  it("explains every database error code in plain words", () => {
    for (const code of [
      "FAMILY_SHARE_OFF",
      "FAMILY_SHARE_NOT_OWNER",
      "FAMILY_POST_NOT_GUARDIAN",
      "FAMILY_SHARE_NOT_READY",
      "FAMILY_SHARE_BAD_EXPIRY",
      "FAMILY_SHARE_TOO_MANY",
    ]) {
      const msg = shareErrorMessage({ message: `P0001 ${code}` });
      expect(msg).toBeTruthy();
      expect(msg).not.toContain("FAMILY_");
    }
  });

  it("ignores unrelated errors", () => {
    expect(shareErrorMessage(new Error("network down"))).toBeNull();
    expect(shareErrorMessage(null)).toBeNull();
  });
});
