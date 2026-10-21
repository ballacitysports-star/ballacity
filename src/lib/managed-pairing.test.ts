import { describe, expect, it } from "vitest";
import {
  PAIR_LINK_TTL_MINUTES,
  generatePairToken,
  hashPairToken,
  isPairToken,
  pairLinkExpiry,
  pairUrl,
  smsHref,
  tokenFromHash,
} from "@/lib/managed-pairing";
import { managedChildErrorMessage } from "@/lib/managed-children";

describe("managed pairing token", () => {
  it("is 256 bits of url-safe randomness", () => {
    const a = generatePairToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isPairToken(a)).toBe(true);
    expect(generatePairToken()).not.toBe(a);
  });

  it("rejects anything that is not a well-formed token", () => {
    for (const bad of ["", "abc", "x".repeat(42), "x".repeat(44), `${"x".repeat(42)}!`, null, 7]) {
      expect(isPairToken(bad)).toBe(false);
    }
  });

  it("hashes deterministically to a 64-char hex digest that does not contain the token", async () => {
    const token = generatePairToken();
    const h = await hashPairToken(token);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashPairToken(token)).toBe(h);
    expect(h).not.toContain(token);
    expect(await hashPairToken(generatePairToken())).not.toBe(h);
  });
});

describe("managed pairing link", () => {
  it("puts the token in the fragment so it never reaches a server", () => {
    const token = generatePairToken();
    const url = pairUrl("https://ballacity.app/", token);
    expect(url).toBe(`https://ballacity.app/pair#t=${token}`);
    expect(new URL(url).search).toBe("");
    expect(tokenFromHash(new URL(url).hash)).toBe(token);
  });

  it("only reads a well-formed token out of the fragment", () => {
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#t=short")).toBeNull();
    expect(tokenFromHash("#other=" + "x".repeat(43))).toBeNull();
  });

  it("expires after the documented lifetime", () => {
    const now = Date.UTC(2026, 9, 21, 12, 0, 0);
    expect(pairLinkExpiry(now).getTime() - now).toBe(PAIR_LINK_TTL_MINUTES * 60_000);
    expect(PAIR_LINK_TTL_MINUTES).toBe(15);
  });

  it("builds a text-message link that carries the child's name and the link", () => {
    const href = smsHref("Jake", "https://ballacity.app/pair#t=abc");
    expect(href.startsWith("sms:?&body=")).toBe(true);
    const body = decodeURIComponent(href.slice("sms:?&body=".length));
    expect(body).toContain("Jake");
    expect(body).toContain("https://ballacity.app/pair#t=abc");
  });
});

describe("managed pairing errors", () => {
  it("never explains why a link failed", () => {
    const msg = managedChildErrorMessage(new Error("PAIR_LINK_INVALID"));
    expect(msg).toMatch(/expired|already used/i);
  });
});
