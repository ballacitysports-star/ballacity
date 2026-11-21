import { describe, expect, it } from "vitest";
import {
  HANDOVER_DAYS,
  firstNameOf,
  handoverErrorCode,
  handoverErrorMessage,
  handoverPath,
  isMissingFunctionError,
  looksLikeEmail,
  parseManagedHandovers,
} from "@/lib/managed-handover";
import { USER_ERROR_MESSAGES } from "@/lib/user-error";

describe("parseManagedHandovers", () => {
  it("reads the database's rows", () => {
    expect(
      parseManagedHandovers([
        {
          child_user_id: "c1",
          display_name: "Jake S.",
          is_adult: true,
          pending: true,
          email_masked: "a***@example.test",
          started_at: "2026-11-21T10:00:00Z",
          expires_at: "2026-11-28T10:00:00Z",
        },
      ]),
    ).toEqual([
      {
        childUserId: "c1",
        displayName: "Jake S.",
        isAdult: true,
        pending: true,
        emailMasked: "a***@example.test",
        startedAt: "2026-11-21T10:00:00Z",
        expiresAt: "2026-11-28T10:00:00Z",
      },
    ]);
  });

  it("reads anything unclear as 'no': a flag that is not exactly true is false", () => {
    const [row] = parseManagedHandovers([{ child_user_id: "c1", is_adult: "true", pending: 1 }]);
    expect(row).toMatchObject({ isAdult: false, pending: false, displayName: "Child account" });
  });

  it("drops a row with no account id, and anything that is not a list", () => {
    expect(parseManagedHandovers([{ display_name: "x" }, null, 7])).toEqual([]);
    expect(parseManagedHandovers(null)).toEqual([]);
    expect(parseManagedHandovers({ child_user_id: "c1" })).toEqual([]);
  });
});

describe("isMissingFunctionError", () => {
  it("is the function not being there yet (the migration is applied separately from the app)", () => {
    expect(isMissingFunctionError({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunctionError({ code: "42883" })).toBe(true);
    expect(isMissingFunctionError({ code: "42501" })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });
});

describe("looksLikeEmail", () => {
  it("accepts an address and refuses what is plainly not one", () => {
    expect(looksLikeEmail("adult@example.com")).toBe(true);
    expect(looksLikeEmail("  adult@example.com  ")).toBe(true);
    for (const bad of ["", "adult", "adult@", "@example.com", "adult@example", "a b@example.com"]) {
      expect(looksLikeEmail(bad), bad).toBe(false);
    }
    expect(looksLikeEmail(`${"a".repeat(250)}@b.co`)).toBe(false);
  });
});

describe("error words", () => {
  const codes = Object.keys(USER_ERROR_MESSAGES).filter((c) => c.startsWith("HANDOVER_"));

  it("has a sentence for every handover code, bare and with detail text, and never shows the code", () => {
    expect(codes.length).toBeGreaterThanOrEqual(12);
    for (const code of codes) {
      for (const raw of [code, `${code}: some detail`, new Error(`${code}: x`)]) {
        const msg = handoverErrorMessage(raw, "FALLBACK");
        expect(msg, code).not.toBe("FALLBACK");
        expect(msg).not.toMatch(/HANDOVER_/);
      }
      expect(handoverErrorCode(code)).toBe(code);
    }
  });

  it("never shows raw database text", () => {
    const msg = handoverErrorMessage(
      { message: "function public.x does not exist", code: "42883" },
      "Something went wrong.",
    );
    expect(msg).toBe("Something went wrong.");
  });

  it("makes no legal claim and uses the app's words (date of birth, invite)", () => {
    for (const code of codes) {
      const msg = USER_ERROR_MESSAGES[code as keyof typeof USER_ERROR_MESSAGES];
      expect(msg).not.toMatch(/\b(law|legal|legally|consent|guardianship|custody)\b/i);
    }
  });
});

describe("small helpers", () => {
  it("names the first name and the link", () => {
    expect(firstNameOf("Jake S.")).toBe("Jake");
    expect(firstNameOf("Jake")).toBe("Jake");
    expect(handoverPath("abc")).toBe("/handover/abc");
    expect(HANDOVER_DAYS).toBe(7);
  });
});
