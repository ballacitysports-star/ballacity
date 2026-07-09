/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import { getPostSignInDestination } from "./post-sign-in-destination";
import { savePostAuthRedirect } from "./post-auth-redirect";

const maybeSingle = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => maybeSingle(),
        }),
      }),
    }),
  },
}));

const session = { user: { id: "user-1" } } as unknown as Session;

beforeEach(() => {
  sessionStorage.clear();
  maybeSingle.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getPostSignInDestination", () => {
  it("routes to /onboarding when the profile has no username", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { username: null }, error: null });
    savePostAuthRedirect("/hosts/abc");
    expect(await getPostSignInDestination(session)).toBe("/onboarding");
  });

  it("routes to /onboarding when the profile row does not exist yet", async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await getPostSignInDestination(session)).toBe("/onboarding");
  });

  it("routes to the saved destination when onboarding is complete", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { username: "runner" },
      error: null,
    });
    savePostAuthRedirect("/hosts/abc");
    expect(await getPostSignInDestination(session)).toBe("/hosts/abc");
  });

  it("falls back to /profile when nothing was saved", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { username: "runner" },
      error: null,
    });
    expect(await getPostSignInDestination(session)).toBe("/profile");
  });

  it("uses the caller-supplied fallback when nothing was saved", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { username: "runner" },
      error: null,
    });
    expect(await getPostSignInDestination(session, "/runs")).toBe("/runs");
  });

  it("treats a profile query error as onboarding-not-required (falls back to saved path)", async () => {
    maybeSingle.mockResolvedValueOnce({
      data: null,
      error: new Error("boom"),
    });
    savePostAuthRedirect("/hosts/abc");
    expect(await getPostSignInDestination(session)).toBe("/hosts/abc");
  });

  it("falls back to the saved path if the onboarding check hangs past the timeout", async () => {
    maybeSingle.mockImplementationOnce(() => new Promise(() => {}));
    savePostAuthRedirect("/hosts/abc");
    const result = await getPostSignInDestination(session);
    expect(result).toBe("/hosts/abc");
  }, 5_000);
});
