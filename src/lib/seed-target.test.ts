/**
 * seedTestAccounts creates accounts with known passwords. It must never run against production. Production is
 * recognised by the project ref in SUPABASE_URL, the same rule the E2E target guard uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NON_PRODUCTION_E2E_PROJECT_REFS,
  PRODUCTION_PROJECT_REFS,
} from "../../e2e/safety/target-guard";
import { readFileSync } from "node:fs";
import { SEED_ALLOWED_PROJECT_REFS, seedTargetRefusal } from "./seed-target";

const PROD = `https://${PRODUCTION_PROJECT_REFS[0]}.supabase.co`;
const SANDBOX = `https://${NON_PRODUCTION_E2E_PROJECT_REFS[0]}.supabase.co`;

const h = vi.hoisted(() => ({ adminTouched: false, rpcCalled: false }));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      middleware() {
        return b;
      },
      handler(fn: (ctx: { context: unknown }) => unknown) {
        return (arg: { context: unknown }) => fn(arg);
      },
    };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: new Proxy(
    {},
    {
      get() {
        h.adminTouched = true;
        throw new Error("the service-role client must not be used");
      },
    },
  ),
}));

import { seedTestAccounts } from "./seed-test-accounts.functions";

const run = () =>
  (seedTestAccounts as unknown as (arg: { context: unknown }) => Promise<unknown>)({
    context: {
      userId: "11111111-1111-4111-8111-111111111111",
      supabase: {
        rpc: async () => {
          h.rpcCalled = true;
          return { data: true, error: null };
        },
      },
    },
  });

describe("seedTargetRefusal", () => {
  it("refuses production", () => {
    expect(seedTargetRefusal(PROD)).toMatch(/never in production/);
    expect(seedTargetRefusal(PROD.toUpperCase())).toMatch(/never in production/);
  });

  it("refuses an unknown project, a missing URL and a URL it cannot read", () => {
    expect(seedTargetRefusal("https://bbbbbbbbbbbbbbbbbbbb.supabase.co")).not.toBeNull();
    expect(seedTargetRefusal(undefined)).not.toBeNull();
    expect(seedTargetRefusal("")).not.toBeNull();
    expect(seedTargetRefusal("not a url")).not.toBeNull();
  });

  it("allows exactly the E2E guard's sandbox projects, and never names production", () => {
    expect([...SEED_ALLOWED_PROJECT_REFS].sort()).toEqual(
      [...NON_PRODUCTION_E2E_PROJECT_REFS].sort(),
    );
    const source = readFileSync(new URL("./seed-target.ts", import.meta.url), "utf8");
    for (const ref of PRODUCTION_PROJECT_REFS) expect(source).not.toContain(ref);
    expect(source).not.toMatch(/from\s+["'][^"']*e2e\//);
  });

  it("allows a local Supabase and the E2E sandbox", () => {
    expect(seedTargetRefusal("http://127.0.0.1:54321")).toBeNull();
    expect(seedTargetRefusal("http://localhost:54321")).toBeNull();
    expect(seedTargetRefusal(SANDBOX)).toBeNull();
  });
});

describe("seedTestAccounts in production", () => {
  beforeEach(() => {
    h.adminTouched = false;
    h.rpcCalled = false;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses before it checks roles or touches the database", async () => {
    vi.stubEnv("SUPABASE_URL", PROD);
    await expect(run()).rejects.toThrow(/never in production/);
    expect(h.rpcCalled).toBe(false);
    expect(h.adminTouched).toBe(false);
  });

  it("refuses when the server has no SUPABASE_URL", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    await expect(run()).rejects.toThrow(/local Supabase or the E2E sandbox/);
    expect(h.adminTouched).toBe(false);
  });

  it("goes on to the admin check on the sandbox", async () => {
    vi.stubEnv("SUPABASE_URL", SANDBOX);
    // Past the target gate, the admin gate passes and the first service-role call hits the stand-in.
    await expect(run()).rejects.toThrow(/must not be used/);
    expect(h.rpcCalled).toBe(true);
  });
});
