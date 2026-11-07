import { describe, expect, it } from "vitest";
import { PRODUCTION_REF, parseArgs, preflight, projectRef } from "./bootstrap-superadmin.mjs";

const SANDBOX = "https://qkukefvzwlyusvspablz.supabase.co";
const PROD = `https://${PRODUCTION_REF}.supabase.co`;

describe("parseArgs", () => {
  it("defaults to a dry run", () => {
    expect(parseArgs(["--email", "Owner@Example.com"])).toEqual({
      email: "owner@example.com",
      apply: false,
      allowProduction: false,
    });
  });

  it("takes --email=, --apply and --allow-production", () => {
    expect(parseArgs(["--email=a@b.co", "--apply", "--allow-production"])).toEqual({
      email: "a@b.co",
      apply: true,
      allowProduction: true,
    });
  });

  it("requires a plausible email", () => {
    expect(() => parseArgs([])).toThrow(/--email/);
    expect(() => parseArgs(["--email"])).toThrow(/--email/);
    expect(() => parseArgs(["--email", "not-an-email"])).toThrow(/--email/);
  });

  it("refuses unknown flags instead of ignoring them", () => {
    expect(() => parseArgs(["--email", "a@b.co", "--force"])).toThrow(/unknown argument/);
  });
});

describe("projectRef", () => {
  it("reads the ref from a project URL", () => {
    expect(projectRef(SANDBOX)).toBe("qkukefvzwlyusvspablz");
  });

  it("returns null for anything else", () => {
    expect(projectRef("http://localhost:54321")).toBeNull();
    expect(projectRef("https://example.com")).toBeNull();
    expect(projectRef("not a url")).toBeNull();
  });
});

describe("preflight", () => {
  it("needs both the URL and the service role key", () => {
    expect(preflight({ url: "", key: "k" })).toMatchObject({ ok: false });
    expect(preflight({ url: SANDBOX, key: "" })).toMatchObject({ ok: false });
  });

  it("allows a non-production project", () => {
    expect(preflight({ url: SANDBOX, key: "k", allowProduction: false })).toEqual({
      ok: true,
      ref: "qkukefvzwlyusvspablz",
    });
  });

  it("refuses production without the explicit flag", () => {
    const r = preflight({ url: PROD, key: "k", allowProduction: false });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/--allow-production/);
  });

  it("allows production only with the explicit flag", () => {
    expect(preflight({ url: PROD, key: "k", allowProduction: true })).toEqual({
      ok: true,
      ref: PRODUCTION_REF,
    });
  });

  it("treats an unrecognised host as unknown, not safe", () => {
    expect(preflight({ url: "http://localhost:54321", key: "k" })).toMatchObject({ ok: false });
  });
});
