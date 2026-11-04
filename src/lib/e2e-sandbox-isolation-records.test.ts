/**
 * Isolation records cannot widen what the guard accepts: a record for production, a record for a project
 * that is not designated, are refused, and any bad record stops every run. (Incomplete records: e2e-sandbox-isolation.test.ts.)
 */
import { describe, expect, it, vi } from "vitest";
import { resolveE2eTarget } from "../../e2e/safety/target-guard";

vi.mock("../../e2e/safety/sandbox-isolation", () => ({
  VERIFIED_E2E_SANDBOX_ISOLATION: {
    cpqihhcqeivbgxqbzatv: { verified_by: "owner", verified_on: "2026-11-04", evidence: "x" },
    abcdefghijklmnopqrst: { verified_by: "owner", verified_on: "2026-11-04", evidence: "x" },
  },
}));

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const key = (claims: Record<string, unknown>) =>
  `${b64({ alg: "HS256" })}.${b64(claims)}.sig-not-checked`;
const url = (ref: string) => `https://${ref}.supabase.co`;
const envFor = (ref: string) => ({
  E2E_BASE_URL: "http://localhost:8080",
  SUPABASE_URL: url(ref),
  VITE_SUPABASE_URL: url(ref),
  SUPABASE_PROJECT_ID: ref,
  VITE_SUPABASE_PROJECT_ID: ref,
  SUPABASE_SERVICE_ROLE_KEY: key({ ref, role: "service_role" }),
});
const reasons = (ref: string) => {
  const r = resolveE2eTarget(envFor(ref));
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.reasons.join("\n");
};

describe("isolation records never widen the guard", () => {
  it("a record for production is itself an error, and production is still refused", () => {
    const text = reasons("cpqihhcqeivbgxqbzatv");
    expect(text).toMatch(/cpqihhcqeivbgxqbzatv is PRODUCTION but has an isolation record/);
    expect(text).toMatch(/names the PRODUCTION project/);
  });

  it("a record for a project that is not designated is an error, and that project is refused", () => {
    const text = reasons("abcdefghijklmnopqrst");
    expect(text).toMatch(/abcdefghijklmnopqrst has an isolation record but is not a designated/);
  });

  it("a bad record blocks every target, even the designated sandbox", () => {
    expect(reasons("qkukefvzwlyusvspablz")).toMatch(/is PRODUCTION but has an isolation record/);
  });
});
