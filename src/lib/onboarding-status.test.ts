/**
 * Unit tests for `resolveOnboardingStatus` — the pure decision function that
 * backs the `getOnboardingStatus` server fn. Covers the routing matrix the
 * onboarding gate relies on:
 *   - identity present with a social provider (even when app_metadata is missing)
 *   - identity present but non-social
 *   - identity missing (falls back to app_metadata.provider)
 *   - admin lookup failed (falls back to session claims)
 *   - accountType valid vs. invalid
 *
 * Run:
 *   bunx vitest run src/lib/onboarding-status.test.ts
 */
import { describe, expect, it } from "vitest";
import { resolveOnboardingStatus, type OnboardingStatus } from "./onboarding.functions";

const base: OnboardingStatus = {
  needsOnboarding: true,
  isSocial: false,
  provider: null,
  accountType: null,
};

describe("resolveOnboardingStatus", () => {
  it("classifies google identity as social even when app_metadata.provider is missing", () => {
    expect(
      resolveOnboardingStatus({
        accountType: null,
        identities: [{ provider: "google" }],
        appMetadataProvider: null,
      }),
    ).toEqual({ ...base, isSocial: true, provider: "google" });
  });

  it("classifies apple identity as social even when app_metadata.provider is missing", () => {
    expect(
      resolveOnboardingStatus({
        accountType: null,
        identities: [{ provider: "apple" }],
        appMetadataProvider: null,
      }),
    ).toEqual({ ...base, isSocial: true, provider: "apple" });
  });

  it("keeps non-social identity (email) as non-social with no provider fallback", () => {
    expect(
      resolveOnboardingStatus({
        accountType: null,
        identities: [{ provider: "email" }],
        appMetadataProvider: null,
      }),
    ).toEqual({ ...base });
  });

  it("falls back to app_metadata.provider (google) when no identities are returned", () => {
    expect(
      resolveOnboardingStatus({
        accountType: null,
        identities: [],
        appMetadataProvider: "google",
      }),
    ).toEqual({ ...base, isSocial: true, provider: "google" });
  });

  it("returns non-social when only app_metadata.provider is 'email' and no identities", () => {
    expect(
      resolveOnboardingStatus({
        accountType: null,
        identities: [],
        appMetadataProvider: "email",
      }),
    ).toEqual({ ...base, provider: "email" });
  });

  it("returns nulls when neither identities nor app_metadata are available", () => {
    expect(
      resolveOnboardingStatus({
        accountType: null,
        identities: null,
        appMetadataProvider: null,
      }),
    ).toEqual({ ...base });
  });

  it("uses claims.app_metadata.provider when admin lookup failed (social)", () => {
    expect(
      resolveOnboardingStatus({
        accountType: null,
        identities: [{ provider: "google" }], // ignored on failure path
        appMetadataProvider: "google", // ignored on failure path
        claimsProvider: "google",
        adminLookupFailed: true,
      }),
    ).toEqual({ ...base, isSocial: true, provider: "google" });
  });

  it("returns nulls when admin lookup failed and no claims provider is present", () => {
    expect(
      resolveOnboardingStatus({
        accountType: null,
        identities: [{ provider: "google" }],
        appMetadataProvider: "google",
        claimsProvider: null,
        adminLookupFailed: true,
      }),
    ).toEqual({ ...base });
  });

  it("marks onboarding complete when accountType is a valid role, regardless of identity", () => {
    expect(
      resolveOnboardingStatus({
        accountType: "player",
        identities: [{ provider: "google" }],
        appMetadataProvider: "google",
      }),
    ).toEqual({
      needsOnboarding: false,
      isSocial: true,
      provider: "google",
      accountType: "player",
    });
  });

  it("treats an unrecognised accountType as unset (needsOnboarding=true, accountType=null)", () => {
    expect(
      resolveOnboardingStatus({
        accountType: "admin",
        identities: [{ provider: "email" }],
        appMetadataProvider: null,
      }),
    ).toEqual({ ...base });
  });

  it("picks the social identity when non-social precedes it in the list", () => {
    expect(
      resolveOnboardingStatus({
        accountType: null,
        identities: [{ provider: "email" }, { provider: "apple" }],
        appMetadataProvider: null,
      }),
    ).toEqual({ ...base, isSocial: true, provider: "apple" });
  });
});
