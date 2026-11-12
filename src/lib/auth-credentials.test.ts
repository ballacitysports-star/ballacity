import { describe, expect, it } from "vitest";
import { validateCredentials } from "@/lib/auth-credentials";

// Regression: ISSUE-003 — the sign-in form is noValidate, so an empty or
// malformed submit went straight to supabase.auth.signInWithPassword with blank
// credentials and the user saw only a raw "Failed to fetch" / "Invalid login".
// Found by /qa on 2026-11-06
// Report: .gstack/qa-reports/qa-report-127.0.0.1-2026-11-06.md
// Value: protects=no auth request leaves the browser with blank or malformed
// credentials, and the user is told which field to fix; fails_when=a check is
// dropped or its order changes; why_new=no unit covered the form's pre-submit
// rules (the inputs' native attributes never run under noValidate); seam=none;
// no_claim=does not prove the route wires the result to the DOM (jsdom-free
// unit of the pure rule)

describe("validateCredentials", () => {
  it("accepts a well-formed email and a password of at least 6 characters", () => {
    expect(validateCredentials({ email: "ada@example.com", password: "secret1" })).toEqual({
      ok: true,
    });
  });

  it("ignores surrounding whitespace in the email", () => {
    expect(validateCredentials({ email: "  ada@example.com  ", password: "secret1" })).toEqual({
      ok: true,
    });
  });

  it("rejects an empty email first, even when the password is also empty", () => {
    expect(validateCredentials({ email: "", password: "" })).toEqual({
      ok: false,
      field: "email",
      message: "Enter your email.",
    });
  });

  it("rejects whitespace-only email as empty", () => {
    expect(validateCredentials({ email: "   ", password: "secret1" })).toMatchObject({
      ok: false,
      field: "email",
    });
  });

  it.each(["not-an-email", "ada@", "@example.com", "ada@example", "ada example@x.co"])(
    "rejects a malformed email: %s",
    (email) => {
      expect(validateCredentials({ email, password: "secret1" })).toEqual({
        ok: false,
        field: "email",
        message: "Enter a valid email address.",
      });
    },
  );

  it("rejects an empty password", () => {
    expect(validateCredentials({ email: "ada@example.com", password: "" })).toEqual({
      ok: false,
      field: "password",
      message: "Enter your password.",
    });
  });

  it("rejects a password shorter than 6 characters", () => {
    expect(validateCredentials({ email: "ada@example.com", password: "abc" })).toEqual({
      ok: false,
      field: "password",
      message: "Use at least 6 characters.",
    });
  });

  it("does not trim the password: six spaces is six characters", () => {
    expect(validateCredentials({ email: "ada@example.com", password: "      " })).toEqual({
      ok: true,
    });
  });
});
