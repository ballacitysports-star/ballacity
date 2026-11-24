import { describe, expect, it } from "vitest";
import { requireLocalStack, requireLocalTarget } from "../../e2e/local-stack/local-only";
import {
  NON_PRODUCTION_E2E_PROJECT_REFS,
  PRODUCTION_PROJECT_REFS,
} from "../../e2e/safety/target-guard";

/**
 * The real-auth tests (e2e/local-stack/*.itest.ts and e2e/managed-handover-real-auth.spec.ts) create accounts and set passwords
 * through the auth Admin API. Their guard must refuse everything but the throwaway local stack, including the E2E sandbox the
 * rest of the suite is allowed to use.
 */

const PROD = PRODUCTION_PROJECT_REFS[0]!;
const SANDBOX = NON_PRODUCTION_E2E_PROJECT_REFS[0]!;
const none = () => null;

const localEnv = (over: Record<string, string | undefined> = {}) => ({
  E2E_BASE_URL: "http://localhost:8080",
  SUPABASE_URL: "http://127.0.0.1:54321",
  VITE_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_PROJECT_ID: "127",
  VITE_SUPABASE_PROJECT_ID: "127",
  SUPABASE_PUBLISHABLE_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  ...over,
});

describe("requireLocalStack", () => {
  it("accepts the local Docker stack and returns what the tests need", () => {
    expect(requireLocalStack(localEnv(), none)).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey: "anon-key",
      serviceRoleKey: "service-key",
    });
  });

  it("needs the service-role key for seeding, but a spec's target does not (global-setup removes it from workers)", () => {
    const env = localEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(() => requireLocalStack(env, none)).toThrow(/SERVICE_ROLE_KEY/);
    expect(requireLocalTarget(env, none)).toEqual({
      url: "http://127.0.0.1:54321",
      publishableKey: "anon-key",
    });
  });

  it("refuses the E2E sandbox, which the rest of the suite may use", () => {
    const env = localEnv({
      SUPABASE_URL: `https://${SANDBOX}.supabase.co`,
      VITE_SUPABASE_URL: `https://${SANDBOX}.supabase.co`,
      SUPABASE_PROJECT_ID: SANDBOX,
      VITE_SUPABASE_PROJECT_ID: SANDBOX,
    });
    expect(() => requireLocalStack(env, none)).toThrow(/only against the local Docker stack/);
    expect(() => requireLocalTarget(env, none)).toThrow(/only against the local Docker stack/);
  });

  it("refuses production, an unknown project, a missing URL and an unset environment", () => {
    const prod = localEnv({
      SUPABASE_URL: `https://${PROD}.supabase.co`,
      VITE_SUPABASE_URL: `https://${PROD}.supabase.co`,
      SUPABASE_PROJECT_ID: PROD,
      VITE_SUPABASE_PROJECT_ID: PROD,
    });
    expect(() => requireLocalStack(prod, none)).toThrow();
    const unknown = localEnv({
      SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    });
    expect(() => requireLocalStack(unknown, none)).toThrow();
    expect(() => requireLocalStack({}, none)).toThrow();
    expect(() => requireLocalStack(localEnv({ SUPABASE_URL: undefined }), none)).toThrow();
  });

  it("refuses a local URL beside a remote one, and an app served from somewhere else", () => {
    expect(() =>
      requireLocalStack(localEnv({ VITE_SUPABASE_URL: `https://${SANDBOX}.supabase.co` }), none),
    ).toThrow();
    expect(() =>
      requireLocalStack(localEnv({ E2E_BASE_URL: "https://ballacity.com" }), none),
    ).toThrow();
  });

  it("refuses a missing publishable key and a project id that is a real reference", () => {
    expect(() => requireLocalStack(localEnv({ SUPABASE_PUBLISHABLE_KEY: "" }), none)).toThrow(
      /PUBLISHABLE_KEY/,
    );
    expect(() =>
      requireLocalStack(localEnv({ SUPABASE_PROJECT_ID: "abcdefghijklmnopqrst" }), none),
    ).toThrow();
  });

  it("never puts a key in the refusal", () => {
    try {
      requireLocalStack(localEnv({ SUPABASE_URL: "https://example.com" }), none);
      expect.unreachable();
    } catch (e) {
      expect(String(e)).not.toContain("service-key");
      expect(String(e)).not.toContain("anon-key");
    }
  });
});
