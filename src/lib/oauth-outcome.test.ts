import { describe, expect, it } from "vitest";
import { classifyOAuthFailure } from "@/lib/oauth-outcome";

describe("classifyOAuthFailure", () => {
  it("treats iOS Safari's bogus popup-closed signal as inconclusive", () => {
    // What iPhone Safari produces when it freezes the opener tab mid sign-in.
    expect(classifyOAuthFailure("Sign in was cancelled")).toBe("inconclusive");
    expect(classifyOAuthFailure("The popup was closed before completing")).toBe("inconclusive");
    expect(classifyOAuthFailure("Sign in timed out")).toBe("inconclusive");
    expect(classifyOAuthFailure("User dismissed the sheet")).toBe("inconclusive");
  });

  it("still reports a genuinely blocked popup", () => {
    expect(classifyOAuthFailure("Popup was blocked by the browser")).toBe("popup_blocked");
    expect(classifyOAuthFailure("window.open returned null")).toBe("popup_blocked");
  });

  it("falls back to a hard failure for provider errors", () => {
    expect(classifyOAuthFailure("external_provider rejected the request")).toBe("failure");
    expect(classifyOAuthFailure("")).toBe("failure");
  });
});
